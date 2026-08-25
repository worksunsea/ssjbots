// GET /api/evening-completion-reminder — fired by Vercel cron at 7:30pm IST.
// For each active staff member (not karigars, not Saurav — he gets the
// owner-facing view via digest-ping/reporting instead), checks:
//   1. Today's KRAs (recurring tasks) not yet marked done today
//   2. One-time delegations due today, not yet completed (about to go overdue)
//   3. One-time delegations already overdue
// and sends ONE combined WhatsApp + push notification if anything's missing,
// including a direct link to the Tasks screen to go complete them.
// Self-guarded to the 19:30–20:20 IST window so the cron can fire every 15
// min without a start/end config, same pattern as staff-task-reminders.js.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { staffPhoneMap } from "./_lib/staffPhone.js";
import { TENANT_ID, DIGEST_CRON_SECRET, TASKS_WA_CLIENT_ID } from "./_lib/config.js";

export const config = { maxDuration: 280 };

const SEND_GAP_MS = 30_000;
const BATCH_SIZE = 9;
const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function isEveningWindowIST() {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const minutesOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutesOfDay >= 19 * 60 + 25 && minutesOfDay <= 20 * 60 + 20; // 7:25–8:20pm IST
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!isEveningWindowIST()) return res.status(200).json({ ok: true, skipped: "outside_evening_window" });

  const sb = supa();
  const today = todayIST();

  try {
    const { data: staffRows } = await sb
      .from("staff")
      .select("id,name,phone,type")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);
    const activeStaff = (staffRows || []).filter((s) => s.type !== "artisan" && !nameEq(s.name, "Saurav"));

    const { data: kras } = await sb
      .from("tasks")
      .select("title,assigned_to,completions")
      .eq("tenant_id", TENANT_ID)
      .eq("task_type", "recurring");

    const { data: oneTime } = await sb
      .from("tasks")
      .select("title,assigned_to,due_date")
      .eq("tenant_id", TENANT_ID)
      .eq("task_type", "one-time")
      .in("status", ["Pending", "In Progress"]);

    const byStaff = new Map();
    const bucket = (name) => {
      const key = (name || "").trim();
      if (!key) return null;
      if (!byStaff.has(key)) byStaff.set(key, { kras: [], dueToday: [], overdue: [] });
      return byStaff.get(key);
    };

    for (const t of kras || []) {
      const doneToday = Array.isArray(t.completions) && t.completions.some((c) => (c.date || "").slice(0, 10) === today);
      if (!doneToday) bucket(t.assigned_to)?.kras.push(t);
    }
    for (const t of oneTime || []) {
      if (!t.due_date) continue;
      const b = bucket(t.assigned_to);
      if (!b) continue;
      if (t.due_date === today) b.dueToday.push(t);
      else if (t.due_date < today) b.overdue.push(t);
    }

    const { data: alreadySent } = await sb
      .from("evening_reminder_log")
      .select("staff_name")
      .eq("tenant_id", TENANT_ID)
      .eq("reminder_date", today);
    const alreadySentSet = new Set((alreadySent || []).map((r) => r.staff_name.toLowerCase()));

    const pendingNames = [...byStaff.keys()]
      .filter((n) => !alreadySentSet.has(n.toLowerCase()))
      .filter((n) => {
        const b = byStaff.get(n);
        return b.kras.length || b.dueToday.length || b.overdue.length;
      });
    const batch = pendingNames.slice(0, BATCH_SIZE);

    if (!batch.length) return res.status(200).json({ ok: true, sent: 0, remaining: 0 });

    const phones = await staffPhoneMap(sb, TENANT_ID);
    let sent = 0;
    const results = [];
    for (let i = 0; i < batch.length; i++) {
      const staffName = batch[i];
      const b = byStaff.get(staffName);
      const staffRow = activeStaff.find((s) => nameEq(s.name, staffName));

      const lines = [`⏰ End-of-day check, ${staffName}:`];
      if (b.kras.length) lines.push(`\nKRAs not marked done today (${b.kras.length}):`, ...b.kras.map((t) => `- ${t.title}`));
      if (b.dueToday.length) lines.push(`\nDue today, not yet completed (${b.dueToday.length}):`, ...b.dueToday.map((t) => `- ${t.title}`));
      if (b.overdue.length) lines.push(`\nAlready overdue (${b.overdue.length}):`, ...b.overdue.map((t) => `- ${t.title} (due ${t.due_date})`));
      lines.push("\nComplete them here: https://hr.gemtre.in/?goto=tasks&tab=mine");
      const msg = lines.join("\n");

      let waSent = false, waError = null;
      const targetPhone = phones.forStaff(staffRow, { preferPersonal: true });
      if (targetPhone) {
        const wa = await sendWhatsApp({ phone: targetPhone, msg, client: TASKS_WA_CLIENT_ID });
        waSent = wa.status === 1;
        waError = waSent ? null : wa.message;
      } else {
        waError = "no_phone_on_file";
      }
      if (staffRow?.id) {
        const missingCount = b.kras.length + b.dueToday.length + b.overdue.length;
        await sendPushNotification({
          userId: String(staffRow.id),
          title: "⏰ End-of-day check",
          body: `${missingCount} item${missingCount > 1 ? "s" : ""} still need${missingCount > 1 ? "" : "s"} attention today`,
          url: "/",
        });
      }

      results.push({ staffName, kras: b.kras.length, dueToday: b.dueToday.length, overdue: b.overdue.length, waSent, waError });
      if (waSent) sent++;

      await sb.from("evening_reminder_log").insert({ tenant_id: TENANT_ID, staff_name: staffName, reminder_date: today });

      if (i < batch.length - 1) await sleep(SEND_GAP_MS);
    }

    return res.status(200).json({ ok: true, sent, remaining: pendingNames.length - batch.length, results });
  } catch (err) {
    console.error("evening-completion-reminder error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
