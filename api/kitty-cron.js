// GET /api/kitty-cron — fired once daily by Vercel cron (see vercel.json).
// Three independent sweeps, all WhatsApp-only:
//   1. Monthly due reminder — for each `due` installment whose due_date is
//      within REMINDER_DAYS_BEFORE days, send once (reminded_at stamped so
//      later ticks don't repeat) unless already overdue-reminded today.
//   2. Legacy unclaimed-benefit reminder — for completed enrollments with
//      claim_status in (unclaimed, reminded), re-nudge every
//      CLAIM_REMINDER_INTERVAL_DAYS days until staff marks it claimed.
//   3. Lucky-draw batch rollover — when a batch's 12-month term has fully
//      elapsed (start_date + scheme.duration_months <= today), mark it
//      completed and WA-nudge every member to enroll in the next round
//      (the next open batch gets created automatically the moment someone
//      confirms into it — see getOrCreateOpenBatch in kitty.js).
// Auth mirrors schedule-reminders.js: Vercel's real cron signature
// (Authorization: Bearer CRON_SECRET / x-vercel-cron), or x-cron-secret /
// ?secret= for manual/legacy triggering.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { TENANT_ID, DIGEST_CRON_SECRET } from "./_lib/config.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";

const REMINDER_DAYS_BEFORE = 3;
const CLAIM_REMINDER_INTERVAL_DAYS = 14;

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true;
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${DIGEST_CRON_SECRET}`) return true;
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

function addMonths(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const sb = supa();
  const today = todayIST();
  const windowEnd = new Date(Date.now() + 5.5 * 3600000 + REMINDER_DAYS_BEFORE * 86400000).toISOString().slice(0, 10);
  const stats = { dueReminders: 0, claimReminders: 0, batchesRolledOver: 0, rolloverNudges: 0, failed: 0 };

  try {
    // ── 1. Monthly due reminders ──────────────────────────────────
    const { data: due } = await sb.from("kitty_installments")
      .select("id,due_date,amount,month_number,enrollment:kitty_enrollments!inner(id,lead_id,tenant_id,status,scheme:kitty_schemes(name))")
      .eq("tenant_id", TENANT_ID).eq("status", "due").is("reminded_at", null)
      .lte("due_date", windowEnd).gte("due_date", today);

    for (const row of due || []) {
      if (row.enrollment?.status !== "active") continue;
      const { data: lead } = await sb.from("bullion_leads").select("phone,name").eq("id", row.enrollment.lead_id).maybeSingle();
      if (!lead?.phone) continue;
      const schemeName = row.enrollment.scheme?.name || "your Kitty scheme";
      const msg = `🪙 Reminder: your ${schemeName} installment #${row.month_number} of ₹${row.amount} is due on ${row.due_date}.\n- Sun Sea Jewellers, Karol Bagh`;
      const wa = await sendWhatsApp({ phone: lead.phone, msg }).catch(() => ({ status: 0 }));
      if (wa.status !== 1) { stats.failed++; continue; }
      await sb.from("kitty_installments").update({ reminded_at: new Date().toISOString() }).eq("id", row.id);
      stats.dueReminders++;
    }

    // ── 2. Legacy unclaimed-benefit reminders ───────────────────────
    const cutoff = new Date(Date.now() - CLAIM_REMINDER_INTERVAL_DAYS * 86400000).toISOString();
    const { data: unclaimed } = await sb.from("kitty_enrollments")
      .select("id,lead_id,legacy_scheme_name,is_legacy,scheme:kitty_schemes(name)")
      .eq("tenant_id", TENANT_ID).in("claim_status", ["unclaimed", "reminded"])
      .or(`last_claim_reminded_at.is.null,last_claim_reminded_at.lt.${cutoff}`);

    for (const row of unclaimed || []) {
      const { data: lead } = await sb.from("bullion_leads").select("phone,name").eq("id", row.lead_id).maybeSingle();
      if (!lead?.phone) continue;
      const schemeName = row.legacy_scheme_name || row.scheme?.name || "your Kitty scheme";
      const msg = `🎁 Your ${schemeName} is complete and waiting to be claimed! Visit Sun Sea Jewellers, Karol Bagh to pick your jewellery/benefit whenever convenient.\n- Sun Sea Jewellers`;
      const wa = await sendWhatsApp({ phone: lead.phone, msg }).catch(() => ({ status: 0 }));
      if (wa.status !== 1) { stats.failed++; continue; }
      await sb.from("kitty_enrollments").update({ claim_status: "reminded", last_claim_reminded_at: new Date().toISOString() }).eq("id", row.id);
      stats.claimReminders++;
    }

    // ── 3. Lucky-draw batch rollover ────────────────────────────────
    const { data: openBatches } = await sb.from("kitty_batches")
      .select("id,batch_label,start_date,scheme:kitty_schemes(name,duration_months)")
      .eq("tenant_id", TENANT_ID).in("status", ["open", "full"]);

    for (const batch of openBatches || []) {
      if (!batch.scheme) continue;
      const cycleEnd = addMonths(batch.start_date, batch.scheme.duration_months);
      if (cycleEnd > today) continue;

      await sb.from("kitty_batches").update({ status: "completed" }).eq("id", batch.id);
      await logKittyAudit({ entityType: "batch", entityId: batch.id, action: "auto-complete", actor: "system:cron", details: { batchLabel: batch.batch_label } });
      stats.batchesRolledOver++;

      const { data: members } = await sb.from("kitty_enrollments")
        .select("id,lead_id,status").eq("batch_id", batch.id).in("status", ["active", "completed"]);
      for (const m of members || []) {
        const { data: lead } = await sb.from("bullion_leads").select("phone").eq("id", m.lead_id).maybeSingle();
        if (!lead?.phone) continue;
        const msg = `🪙 Your ${batch.scheme.name} (${batch.batch_label}) round has completed! Enroll for the next round anytime — visit https://ssj.in/kitty-schemes or reply here.\n- Sun Sea Jewellers, Karol Bagh`;
        const wa = await sendWhatsApp({ phone: lead.phone, msg }).catch(() => ({ status: 0 }));
        if (wa.status === 1) stats.rolloverNudges++; else stats.failed++;
      }
    }

    return res.status(200).json({ ok: true, ts: new Date().toISOString(), stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
