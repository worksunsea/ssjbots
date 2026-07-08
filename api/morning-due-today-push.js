// GET /api/morning-due-today-push — fired by cron-job.org ~9am IST.
// Per-employee push (not the owner digest) listing one-time delegations due
// TODAY, so nothing due today gets missed. Not Saurav (owner view lives in
// digest-ping/reporting) and not karigars. Self-guarded to the 9am IST hour.

import { supa } from "./_lib/supabase.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { TENANT_ID, DIGEST_CRON_SECRET } from "./_lib/config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function isMorningWindowIST() {
  const hourIST = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  return hourIST === 9;
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!isMorningWindowIST()) return res.status(200).json({ ok: true, skipped: "outside_morning_window" });

  const sb = supa();
  const today = todayIST();

  try {
    const { data: dueTodayTasks } = await sb
      .from("tasks")
      .select("title,assigned_to")
      .eq("tenant_id", TENANT_ID)
      .eq("task_type", "one-time")
      .in("status", ["Pending", "In Progress"])
      .eq("due_date", today);

    const byStaff = new Map();
    for (const t of dueTodayTasks || []) {
      const key = (t.assigned_to || "").trim();
      if (!key || nameEq(key, "Saurav")) continue;
      if (!byStaff.has(key)) byStaff.set(key, []);
      byStaff.get(key).push(t);
    }
    if (!byStaff.size) return res.status(200).json({ ok: true, sent: 0 });

    const { data: alreadySent } = await sb
      .from("morning_reminder_log")
      .select("staff_name")
      .eq("tenant_id", TENANT_ID)
      .eq("reminder_date", today);
    const alreadySentSet = new Set((alreadySent || []).map((r) => r.staff_name.toLowerCase()));

    const { data: staffRows } = await sb
      .from("staff")
      .select("id,name,type")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);
    const activeStaff = (staffRows || []).filter((s) => s.type !== "artisan");

    let sent = 0;
    const results = [];
    for (const [staffName, tasks] of byStaff) {
      if (alreadySentSet.has(staffName.toLowerCase())) continue;
      const staffRow = activeStaff.find((s) => nameEq(s.name, staffName));
      if (staffRow?.id) {
        const r = await sendPushNotification({
          userId: String(staffRow.id),
          title: "📋 Due Today",
          body: `${tasks.length} task${tasks.length > 1 ? "s" : ""} due today: ${tasks.map((t) => t.title).join(", ").slice(0, 120)}`,
          url: "/",
        });
        results.push({ staffName, taskCount: tasks.length, pushed: r.ok });
        if (r.ok) sent++;
      }
      await sb.from("morning_reminder_log").insert({ tenant_id: TENANT_ID, staff_name: staffName, reminder_date: today });
    }

    return res.status(200).json({ ok: true, sent, results });
  } catch (err) {
    console.error("morning-due-today-push error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
