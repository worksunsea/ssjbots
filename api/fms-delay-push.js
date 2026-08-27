// GET /api/fms-delay-push — fired by cron-job.org every couple hours.
// Checks every active (non-cancelled) FMS job's CURRENT step: if its
// planDate has passed and it's still not done, pushes the responsible
// staff member. "who":"Salesperson" resolves to job.attend_by, matching
// fms-tracker's own resolution logic (App.jsx). Dedup'd per
// (job, step, day) so a stuck step doesn't re-notify every run.

import { supa } from "./_lib/supabase.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { TENANT_ID, DIGEST_CRON_SECRET, CRON_SECRET } from "./_lib/config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const sb = supa();
  const today = todayIST();

  try {
    const { data: jobs } = await sb
      .from("jobs")
      .select("id,serial,attend_by,current_step,steps,cancelled")
      .eq("tenant_id", TENANT_ID)
      .eq("cancelled", false);

    const delayed = [];
    for (const j of jobs || []) {
      const steps = Array.isArray(j.steps) ? j.steps : [];
      const cur = steps[j.current_step];
      if (!cur || cur.status === "done" || !cur.planDate) continue;
      if (new Date(cur.planDate) >= new Date()) continue;
      const who = cur.who === "Salesperson" ? j.attend_by : cur.who;
      if (!who) continue;
      delayed.push({ jobId: j.id, serial: j.serial, stepId: String(cur.id ?? j.current_step), stepName: cur.stepName, who });
    }
    if (!delayed.length) return res.status(200).json({ ok: true, checked: (jobs || []).length, delayed: 0 });

    const { data: alreadySent } = await sb
      .from("fms_delay_notify_log")
      .select("job_id,step_id")
      .eq("tenant_id", TENANT_ID)
      .eq("notify_date", today);
    const alreadySentSet = new Set((alreadySent || []).map((r) => `${r.job_id}:${r.step_id}`));

    const { data: staffRows } = await sb
      .from("staff")
      .select("id,name,type")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);
    const activeStaff = (staffRows || []).filter((s) => s.type !== "artisan");

    let sent = 0;
    const results = [];
    for (const d of delayed) {
      const key = `${d.jobId}:${d.stepId}`;
      if (alreadySentSet.has(key)) continue;
      const staffRow = activeStaff.find((s) => nameEq(s.name, d.who));
      if (staffRow?.id) {
        const r = await sendPushNotification({
          userId: String(staffRow.id),
          title: "⚙️ FMS Step Delayed",
          body: `${d.serial} — "${d.stepName}" is overdue`,
          url: "/",
        });
        results.push({ serial: d.serial, step: d.stepName, who: d.who, pushed: r.ok });
        if (r.ok) sent++;
      } else {
        results.push({ serial: d.serial, step: d.stepName, who: d.who, pushed: false, error: "staff_not_found" });
      }
      await sb.from("fms_delay_notify_log").insert({ tenant_id: TENANT_ID, job_id: d.jobId, step_id: d.stepId, notify_date: today });
    }

    return res.status(200).json({ ok: true, checked: (jobs || []).length, delayed: delayed.length, sent, results });
  } catch (err) {
    console.error("fms-delay-push error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
