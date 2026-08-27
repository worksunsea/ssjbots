// GET /api/staff-profile-reminders — fired by cron-job.org (daily is fine;
// the 15-day lookback in profile_reminder_log spaces actual sends out to
// once per 15 days per person, per Saurav's spec).
//
// Sends both a WhatsApp message and a push notification (plain template,
// no AI) to any active staff member whose profile has incomplete sections
// or unverified phone numbers. Respects employee_docs.na_fields — anything
// the person ticked "Not applicable" is never nagged about. The message
// names the specific missing items so they know exactly what's pending.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { staffPhoneMap } from "./_lib/staffPhone.js";
import { TENANT_ID, DIGEST_CRON_SECRET, CRON_SECRET, TASKS_WA_CLIENT_ID, REPORTING_URL } from "./_lib/config.js";

export const config = { maxDuration: 280 };

const BATCH_SIZE = 9;
const SEND_GAP_MS = 30_000;
const REMINDER_LOOKBACK_DAYS = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

// field -> label, checked unless ticked N/A (na-eligible ones) or filled.
const REQUIRED_FIELDS = [
  ["personal_phone", "Personal phone"],
  ["emergency_contact_phone", "Emergency contact"],
  ["parent_name", "Parent's name"],
  ["parent_phone", "Parent's phone"],
  ["date_of_birth", "Date of birth"],
  ["current_address", "Current address"],
  ["home_address", "Permanent home address"],
  ["home_ownership", "Home ownership"],
  ["education", "Education"],
  ["bank_name", "Bank name"],
  ["bank_account", "Bank account no"],
  ["bank_ifsc", "Bank IFSC"],
];
// Phones that must be WA-verified once filled (and not N/A).
const VERIFY_FIELDS = [
  ["personal_phone", "Personal phone"],
  ["office_phone", "Office phone"],
  ["emergency_contact_phone", "Emergency contact"],
  ["parent_phone", "Parent's phone"],
  ["sibling_phone", "Sibling's phone"],
  ["spouse_phone", "Spouse's phone"],
];

function pendingItems(docs) {
  const na = Array.isArray(docs?.na_fields) ? docs.na_fields : [];
  const missing = REQUIRED_FIELDS
    .filter(([f]) => !na.includes(f) && !docs?.[f])
    .map(([, label]) => label);
  const unverified = VERIFY_FIELDS
    .filter(([f]) => !na.includes(f) && docs?.[f] && !docs?.[`${f}_verified_at`])
    .map(([, label]) => label);
  // Hard rule: at least 2 different verified numbers — own personal + one family.
  if (!docs?.personal_phone_verified_at && !unverified.includes("Personal phone") && !missing.includes("Personal phone")) {
    unverified.push("Personal phone (must be verified)");
  }
  const famVerified = ["parent_phone", "sibling_phone", "spouse_phone"].some((f) => docs?.[`${f}_verified_at`]);
  if (!famVerified) unverified.push("One family number — parent/sibling/spouse (must be verified)");
  return { missing, unverified };
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
      .select("id,name,phone,onboard_token,type")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);
    const eligibleStaff = (staff || []).filter((s) => s.type !== "artisan");

    const docCols = new Set(["staff_id", "na_fields"]);
    for (const [f] of REQUIRED_FIELDS) docCols.add(f);
    for (const [f] of VERIFY_FIELDS) { docCols.add(f); docCols.add(`${f}_verified_at`); }
    const { data: docsRows } = await sb
      .from("employee_docs")
      .select([...docCols].join(","))
      .eq("tenant_id", TENANT_ID);
    const docsByStaff = new Map((docsRows || []).map((d) => [d.staff_id, d]));

    const incompleteStaff = eligibleStaff
      .map((s) => ({ s, ...pendingItems(docsByStaff.get(s.id)) }))
      .filter(({ missing, unverified }) => missing.length || unverified.length);

    const cutoff = new Date(Date.now() - REMINDER_LOOKBACK_DAYS * 86400000).toISOString();
    const { data: recentlyReminded } = await sb
      .from("profile_reminder_log")
      .select("staff_id")
      .eq("tenant_id", TENANT_ID)
      .gte("sent_at", cutoff);
    const recentSet = new Set((recentlyReminded || []).map((r) => r.staff_id));

    const dueStaff = incompleteStaff.filter(({ s }) => !recentSet.has(s.id));
    const batch = dueStaff.slice(0, BATCH_SIZE);

    if (!batch.length) {
      return res.status(200).json({ ok: true, sent: 0, incompleteTotal: incompleteStaff.length, remaining: 0 });
    }

    const phones = await staffPhoneMap(sb, TENANT_ID);
    const origin = hrOrigin();
    let sent = 0;
    for (let i = 0; i < batch.length; i++) {
      const { s, missing, unverified } = batch[i];
      const targetPhone = phones.forStaff(s);
      const link = `${origin}/?onboard=${s.onboard_token}`;
      const lines = [`📋 Hi ${s.name}, some of your HR profile details are incomplete:`];
      if (missing.length) lines.push(`\nMissing: ${missing.join(", ")}`);
      if (unverified.length) lines.push(`\nNumbers not yet verified (a WhatsApp code confirms them): ${unverified.join(", ")}`);
      lines.push(`\nComplete here (2 minutes): ${link}`);
      lines.push(`If something doesn't apply to you, tick "Not applicable" on that field. We'll remind you every 15 days until it's done.`);
      const message = lines.join("\n");

      if (targetPhone) {
        await sendWhatsApp({ phone: targetPhone, msg: message, client: TASKS_WA_CLIENT_ID }).catch(() => {});
      }
      await fetch(`${origin}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: String(s.id), title: "📋 Profile incomplete", body: `Pending: ${[...missing, ...unverified].slice(0, 4).join(", ")}${missing.length + unverified.length > 4 ? "…" : ""}`, url: `/?onboard=${s.onboard_token}` }),
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
