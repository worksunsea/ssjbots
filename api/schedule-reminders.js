// GET /api/schedule-reminders — fired by cron-job.org every 5 minutes.
// Sends Saurav a WhatsApp + push reminder for his own schedule_events
// (ssj-hr Calendar tab, shared Supabase project):
//   - Timed events: ~10 minutes before event_time.
//   - All-day events (no event_time): once, in the 08:00 IST tick.
// reminded_at marks it done so later ticks don't re-notify.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { TENANT_ID, DIGEST_CRON_SECRET, CRON_SECRET, TASKS_WA_CLIENT_ID, OWNER_PHONE } from "./_lib/config.js";

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function nowIST() {
  return new Date(Date.now() + 5.5 * 3600000);
}
function todayIST() {
  return nowIST().toISOString().slice(0, 10);
}
function hhmmIST() {
  return nowIST().toISOString().slice(11, 16);
}
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = String(Math.floor(((total % 1440) + 1440) % 1440 / 60)).padStart(2, "0");
  const mm = String(((total % 60) + 60) % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!OWNER_PHONE) return res.status(200).json({ ok: true, skipped: "no_owner_phone_configured" });

  const sb = supa();
  const today = todayIST();
  const nowHM = hhmmIST();
  // Fire for events whose time falls in [now, now+10min] — a 5-min cron tick
  // with a 10-min lookahead means each event gets exactly one hit before it
  // slips past, even if a tick is briefly delayed.
  const windowEnd = addMinutes(nowHM, 10);

  try {
    const { data: timedEvents } = await sb
      .from("schedule_events")
      .select("id,title,event_date,event_time,notes")
      .eq("tenant_id", TENANT_ID)
      .eq("event_date", today)
      .is("reminded_at", null)
      .not("event_time", "is", null)
      .gte("event_time", nowHM)
      .lte("event_time", windowEnd);

    let allDayEvents = [];
    if (nowHM >= "08:00" && nowHM < "08:05") {
      const { data } = await sb
        .from("schedule_events")
        .select("id,title,event_date,event_time,notes")
        .eq("tenant_id", TENANT_ID)
        .eq("event_date", today)
        .is("reminded_at", null)
        .is("event_time", null);
      allDayEvents = data || [];
    }

    const due = [...(timedEvents || []), ...allDayEvents];
    if (!due.length) return res.status(200).json({ ok: true, sent: 0 });

    const { data: owner } = await sb.from("staff").select("id").eq("tenant_id", TENANT_ID).ilike("name", "Saurav").maybeSingle();

    let sent = 0;
    for (const ev of due) {
      const timeText = ev.event_time ? ` at ${ev.event_time.slice(0, 5)}` : " (today)";
      const msg = `⏰ Reminder: "${ev.title}"${timeText}${ev.notes ? `\n${ev.notes}` : ""}`;
      const wa = await sendWhatsApp({ phone: OWNER_PHONE, msg, client: TASKS_WA_CLIENT_ID });
      if (owner?.id) {
        await sendPushNotification({ userId: String(owner.id), title: "📅 Schedule Reminder", body: `${ev.title}${timeText}`, url: "/?goto=dashboard" });
      }
      await sb.from("schedule_events").update({ reminded_at: new Date().toISOString() }).eq("id", ev.id);
      if (wa.status === 1) sent++;
    }

    return res.status(200).json({ ok: true, sent, total: due.length });
  } catch (err) {
    console.error("schedule-reminders error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
