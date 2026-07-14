// GET /api/staff-task-reminders — fired by cron-job.org every few minutes.
// Sends a plain-template (no AI) WhatsApp reminder to each staff member
// listing ALL their pending one-time delegated tasks (overdue AND upcoming,
// not overdue-only), once per person per day. Only runs during the
// 11:00-11:59 IST window (self-guarded) so it's safe to schedule the
// cron job to fire frequently without a start/end time config.
//
// Batched: 30s gap between sends (anti-ban pacing, per Saurav's spec) means
// only a handful of people fit in one serverless invocation — task_reminder_log
// tracks who's already been notified today so later ticks in the same window
// pick up whoever's left, instead of re-sending or needing one giant call.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { staffPhoneMap } from "./_lib/staffPhone.js";
import { TENANT_ID, DIGEST_CRON_SECRET, TASKS_WA_CLIENT_ID } from "./_lib/config.js";

export const config = { maxDuration: 280 };

const SEND_GAP_MS = 30_000;
const BATCH_SIZE = 9; // 9 * 30s = 270s, under the 280s function limit
const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function isReminderWindowIST() {
  const hourIST = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  return hourIST === 11;
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

function buildReminderText(name, tasks, today) {
  const overdue = tasks.filter((t) => t.due_date < today);
  const upcoming = tasks.filter((t) => t.due_date >= today);
  const lines = [];
  if (overdue.length) {
    lines.push(`🔴 Overdue (${overdue.length}):`);
    overdue.forEach((t) => lines.push(`- ${t.title} (was due ${t.due_date})`));
  }
  if (upcoming.length) {
    lines.push(`📋 Pending (${upcoming.length}):`);
    upcoming.forEach((t) => lines.push(`- ${t.title} (due ${t.due_date})`));
  }
  return [
    `⏰ Hi ${name}, your delegated tasks (${tasks.length} total):`,
    ...lines,
    "Please update the status in the HR app.",
  ].join("\n");
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!isReminderWindowIST()) return res.status(200).json({ ok: true, skipped: "outside_reminder_window" });

  const sb = supa();
  const today = todayIST();

  try {
    const { data: pendingTasks } = await sb
      .from("tasks")
      .select("title,assigned_to,due_date")
      .eq("tenant_id", TENANT_ID)
      .eq("task_type", "one-time")
      .in("status", ["Pending", "In Progress"])
      .not("assigned_to", "ilike", "Saurav");

    const byStaff = new Map();
    for (const t of pendingTasks || []) {
      const key = (t.assigned_to || "").trim();
      if (!key) continue;
      if (!byStaff.has(key)) byStaff.set(key, []);
      byStaff.get(key).push(t);
    }

    const { data: alreadySent } = await sb
      .from("task_reminder_log")
      .select("staff_name")
      .eq("tenant_id", TENANT_ID)
      .eq("reminder_date", today);
    const alreadySentSet = new Set((alreadySent || []).map((r) => r.staff_name.toLowerCase()));

    const pendingStaffNames = [...byStaff.keys()].filter((n) => !alreadySentSet.has(n.toLowerCase()));
    const batch = pendingStaffNames.slice(0, BATCH_SIZE);

    if (!batch.length) {
      return res.status(200).json({ ok: true, sent: 0, remaining: 0 });
    }

    const { data: staffRows } = await sb
      .from("staff")
      .select("id,name,phone")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);
    const phones = await staffPhoneMap(sb, TENANT_ID);

    let sent = 0;
    const results = [];
    for (let i = 0; i < batch.length; i++) {
      const staffName = batch[i];
      const tasks = byStaff.get(staffName);
      const staffRow = (staffRows || []).find((s) => nameEq(s.name, staffName));
      const targetPhone = phones.forStaff(staffRow);

      if (targetPhone) {
        const wa = await sendWhatsApp({
          phone: targetPhone,
          msg: buildReminderText(staffRow?.name || staffName, tasks, today),
          client: TASKS_WA_CLIENT_ID,
        });
        results.push({ staffName, taskCount: tasks.length, sent: wa.status === 1, error: wa.status === 1 ? null : wa.message });
        if (wa.status === 1) sent++;
      } else {
        results.push({ staffName, taskCount: tasks.length, sent: false, error: "no_phone_on_file" });
      }

      // Log as handled regardless of send success — a permanently-missing
      // phone/failed send shouldn't retry every 5 minutes for the rest of
      // the window; it'll get picked up again tomorrow.
      await sb.from("task_reminder_log").insert({ tenant_id: TENANT_ID, staff_name: staffName, reminder_date: today });

      if (i < batch.length - 1) await sleep(SEND_GAP_MS);
    }

    return res.status(200).json({
      ok: true,
      sent,
      remaining: pendingStaffNames.length - batch.length,
      results,
    });
  } catch (err) {
    console.error("staff-task-reminders error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
