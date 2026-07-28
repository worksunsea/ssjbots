// GET /api/staff-task-reminders — fired by cron-job.org every few minutes.
// Sends every active staff member (including Saurav) a single daily 11am
// WhatsApp message: today's motivating/team-building quote (cycles through
// motivational_quotes, ~75 entries repeating through the year), their
// pending one-time delegated tasks (overdue AND upcoming), and their
// recurring KRAs due today. Sent from TASKS_WA_CLIENT_ID (Priyanka's
// number), once per person per day. Only runs during the 11:00-11:59 IST
// window (self-guarded) so it's safe to schedule the cron job to fire
// frequently without a start/end time config.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function isReminderWindowIST() {
  const hourIST = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  return hourIST === 11;
}

function nowIST() {
  return new Date(Date.now() + 5.5 * 3600000);
}
function todayIST() {
  return nowIST().toISOString().slice(0, 10);
}
function dayOfYearIST() {
  const d = nowIST();
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const diffDays = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
  return diffDays + 1; // 1-366
}

async function getQuoteOfDay(sb) {
  const { count } = await sb.from("motivational_quotes").select("id", { count: "exact", head: true });
  if (!count) return null;
  const idx = (dayOfYearIST() - 1) % count;
  const { data } = await sb.from("motivational_quotes").select("quote").eq("day_index", idx).maybeSingle();
  return data?.quote || null;
}

function buildReminderText({ name, quote, delegations, todayTasks, today }) {
  // Only what actually needs attention today — overdue or due today.
  // Future-dated delegations don't belong in a daily nudge; they'll surface
  // here on their own day.
  const overdue = delegations.filter((t) => t.due_date < today);
  const dueToday = delegations.filter((t) => t.due_date === today);
  const relevant = [...overdue, ...dueToday];
  const lines = [`⏰ Good morning, ${name}!`];
  if (quote) lines.push("", `💬 "${quote}"`);
  lines.push("", `📌 Delegated tasks — overdue or due today (${relevant.length}):`);
  if (overdue.length) {
    lines.push(`🔴 Overdue (${overdue.length}):`);
    overdue.forEach((t) => lines.push(`- ${t.title} (was due ${t.due_date})`));
  }
  if (dueToday.length) {
    lines.push(`📋 Due today (${dueToday.length}):`);
    dueToday.forEach((t) => lines.push(`- ${t.title}`));
  }
  if (!relevant.length) lines.push("Nothing pending. 🎉");
  lines.push("", `✅ Today's other tasks (${todayTasks.length}):`);
  if (todayTasks.length) todayTasks.forEach((t) => lines.push(`- ${t.title}`));
  else lines.push("Nothing scheduled for today.");
  lines.push("", "Please update the status in the HR app. Have a great day! 🚀");
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!isReminderWindowIST()) return res.status(200).json({ ok: true, skipped: "outside_reminder_window" });

  const sb = supa();
  const today = todayIST();

  try {
    const [{ data: staffRows }, { data: delegationRows }, { data: todayTaskRows }, quote] = await Promise.all([
      sb.from("staff").select("id,name,phone,type").eq("tenant_id", TENANT_ID).eq("active", true),
      sb.from("tasks").select("title,assigned_to,due_date")
        .eq("tenant_id", TENANT_ID).eq("task_type", "one-time").in("status", ["Pending", "In Progress"]).lte("due_date", today),
      sb.from("tasks").select("title,assigned_to")
        .eq("tenant_id", TENANT_ID).eq("task_type", "recurring").in("status", ["Pending", "In Progress"]).eq("due_date", today),
      getQuoteOfDay(sb),
    ]);

    const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const delegationsByStaff = new Map();
    for (const t of delegationRows || []) {
      const key = (t.assigned_to || "").trim();
      if (!key) continue;
      if (!delegationsByStaff.has(key)) delegationsByStaff.set(key, []);
      delegationsByStaff.get(key).push(t);
    }
    const todayTasksByStaff = new Map();
    for (const t of todayTaskRows || []) {
      const key = (t.assigned_to || "").trim();
      if (!key) continue;
      if (!todayTasksByStaff.has(key)) todayTasksByStaff.set(key, []);
      todayTasksByStaff.get(key).push(t);
    }

    const { data: alreadySent } = await sb
      .from("task_reminder_log")
      .select("staff_name")
      .eq("tenant_id", TENANT_ID)
      .eq("reminder_date", today);
    const alreadySentSet = new Set((alreadySent || []).map((r) => r.staff_name.toLowerCase()));

    // Karigars (type=artisan) are not staff and never get app logins or
    // task assignments — see feedback_karigars_not_staff.
    const activeStaff = (staffRows || []).filter((s) => s.name && s.type !== "artisan" && !alreadySentSet.has(s.name.trim().toLowerCase()));
    const batch = activeStaff.slice(0, BATCH_SIZE);

    if (!batch.length) {
      return res.status(200).json({ ok: true, sent: 0, remaining: 0 });
    }

    const phones = await staffPhoneMap(sb, TENANT_ID);

    let sent = 0;
    const results = [];
    for (let i = 0; i < batch.length; i++) {
      const staffRow = batch[i];
      const delegations = [...delegationsByStaff].find(([k]) => nameEq(k, staffRow.name))?.[1] || [];
      const todayTasks = [...todayTasksByStaff].find(([k]) => nameEq(k, staffRow.name))?.[1] || [];
      const targetPhone = phones.forStaff(staffRow) || staffRow.phone;

      if (targetPhone) {
        const wa = await sendWhatsApp({
          phone: targetPhone,
          msg: buildReminderText({ name: staffRow.name, quote, delegations, todayTasks, today }),
          client: TASKS_WA_CLIENT_ID,
        });
        results.push({ staffName: staffRow.name, delegationCount: delegations.length, sent: wa.status === 1, error: wa.status === 1 ? null : wa.message });
        if (wa.status === 1) sent++;
      } else {
        results.push({ staffName: staffRow.name, delegationCount: delegations.length, sent: false, error: "no_phone_on_file" });
      }

      // Log as handled regardless of send success — a permanently-missing
      // phone/failed send shouldn't retry every 5 minutes for the rest of
      // the window; it'll get picked up again tomorrow.
      await sb.from("task_reminder_log").insert({ tenant_id: TENANT_ID, staff_name: staffRow.name, reminder_date: today });

      if (i < batch.length - 1) await sleep(SEND_GAP_MS);
    }

    return res.status(200).json({
      ok: true,
      sent,
      remaining: activeStaff.length - batch.length,
      results,
    });
  } catch (err) {
    console.error("staff-task-reminders error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
