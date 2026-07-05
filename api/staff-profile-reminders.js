// GET /api/staff-profile-reminders — fired by cron-job.org (daily is fine;
// the 7-day lookback in profile_reminder_log naturally spaces actual sends
// out to about once a week per person, no day-of-week logic needed).
//
// Sends both a WhatsApp message and a push notification (plain template,
// no AI) to any active staff member whose profile is still missing the
// "always applicable" fields — personal phone, parent contact, home
// address/ownership. Doesn't nag about spouse/sibling/landline/office phone
// since those don't apply to everyone.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { TENANT_ID, DIGEST_CRON_SECRET, WA_SESSION_CLIENT_ID, REPORTING_URL } from "./_lib/config.js";

export const config = { maxDuration: 280 };

const BATCH_SIZE = 9;
const SEND_GAP_MS = 30_000;
const REMINDER_LOOKBACK_DAYS = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function isIncomplete(docs) {
  if (!docs) return true;
  return !docs.personal_phone || !docs.parent_name || !docs.parent_phone || !docs.home_address || !docs.home_ownership;
}

function hrOrigin() {
  try { return new URL(REPORTING_URL).origin; } catch { return "https://hr.gemtre.in"; }
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const sb = supa();
  try {
    const { data: staff } = await sb
      .from("staff")
      .select("id,name,phone,onboard_token")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);

    const { data: docsRows } = await sb
      .from("employee_docs")
      .select("staff_id,personal_phone,parent_name,parent_phone,home_address,home_ownership")
      .eq("tenant_id", TENANT_ID);
    const docsByStaff = new Map((docsRows || []).map((d) => [d.staff_id, d]));

    const incompleteStaff = (staff || []).filter((s) => isIncomplete(docsByStaff.get(s.id)));

    const cutoff = new Date(Date.now() - REMINDER_LOOKBACK_DAYS * 86400000).toISOString();
    const { data: recentlyReminded } = await sb
      .from("profile_reminder_log")
      .select("staff_id")
      .eq("tenant_id", TENANT_ID)
      .gte("sent_at", cutoff);
    const recentSet = new Set((recentlyReminded || []).map((r) => r.staff_id));

    const dueStaff = incompleteStaff.filter((s) => !recentSet.has(s.id));
    const batch = dueStaff.slice(0, BATCH_SIZE);

    if (!batch.length) {
      return res.status(200).json({ ok: true, sent: 0, incompleteTotal: incompleteStaff.length, remaining: 0 });
    }

    const origin = hrOrigin();
    let sent = 0;
    for (let i = 0; i < batch.length; i++) {
      const s = batch[i];
      const docs = docsByStaff.get(s.id);
      const targetPhone = docs?.personal_phone || s.phone;
      const link = `${origin}/?onboard=${s.onboard_token}`;
      const message = `📋 Please complete a few missing profile details (personal number, parent contact, home address): ${link}\nTakes 2 minutes.`;

      if (targetPhone) {
        await sendWhatsApp({ phone: targetPhone, msg: message, client: WA_SESSION_CLIENT_ID }).catch(() => {});
      }
      await fetch(`${origin}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: String(s.id), title: "📋 Complete your profile", body: "A few details are still missing — tap to fill them in.", url: `/?onboard=${s.onboard_token}` }),
      }).catch(() => {});

      await sb.from("profile_reminder_log").insert({ tenant_id: TENANT_ID, staff_id: s.id });
      sent++;

      if (i < batch.length - 1) await sleep(SEND_GAP_MS);
    }

    return res.status(200).json({ ok: true, sent, incompleteTotal: incompleteStaff.length, remaining: dueStaff.length - batch.length });
  } catch (err) {
    console.error("staff-profile-reminders error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
