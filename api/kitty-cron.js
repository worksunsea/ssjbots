// GET /api/kitty-cron — fired once daily by Vercel cron (see vercel.json),
// plus a second lighter daily hit at 10am IST with ?only=due_today that
// runs ONLY the due-today sweep below and skips everything else.
// Five independent sweeps, all WhatsApp-only:
//   1. Monthly due reminder — for each `due` installment whose due_date is
//      within REMINDER_DAYS_BEFORE (7) days, send once (reminded_at
//      stamped so later ticks don't repeat).
//   1b. 3-day urgent reminder — same shape, REMINDER_DAYS_BEFORE_3DAY (3)
//      days out, own stamp (reminded_3day_at) so it fires independently
//      of 1. — both nudges go out, not one replacing the other.
//   1c. Due-today urgent nudge (?only=due_today, 10am IST) — anyone whose
//      installment is due TODAY and still unpaid, separate stamp
//      (due_today_reminded_at) so it fires once more even if 1./1b.
//      already reminded them days earlier.
//   1d. Overdue nudge — due_date already in the past, still unpaid.
//      Unlike 1/1b/1c this is QUEUED, not sent, so staff approve each one
//      from Kitty Admin > Pending Messages first. Re-queued every
//      OVERDUE_REMINDER_INTERVAL_DAYS days until paid (own stamp,
//      overdue_reminded_at).
//   2. Legacy unclaimed-benefit reminder — for completed enrollments with
//      claim_status in (unclaimed, reminded), re-nudge every
//      CLAIM_REMINDER_INTERVAL_DAYS days until staff marks it claimed.
//   3. Lucky-draw batch rollover — when a batch's 12-month term has fully
//      elapsed (start_date + scheme.duration_months <= today), mark it
//      completed and WA-nudge every member to enroll in the next round
//      (the next open batch gets created automatically the moment someone
//      confirms into it — see getOrCreateOpenBatch in kitty.js).
//   4. Swarn Suraksha 11-month freeze.
//   5. Mission 100 — checkpoint (25/50/75g) and trip (100g) winner
//      detection (earliest by real purchase date, not batch-processing
//      order), the universal +1g completion bonus for every finisher, and
//      the every-5-qualifying-referrals bonus.
// Auth mirrors schedule-reminders.js: Vercel's real cron signature
// (Authorization: Bearer CRON_SECRET / x-vercel-cron), or x-cron-secret /
// ?secret= for manual/legacy triggering.

import { supa } from "./_lib/supabase.js";
import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { sendKittyWA, queueKittyWA } from "./_lib/kittyMessageQueue.js";
import { TENANT_ID, DIGEST_CRON_SECRET, CRON_SECRET, OWNER_PHONE, DIGEST_EXTRA_RECIPIENTS } from "./_lib/config.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";
import { getSwarnScheme } from "./_lib/swarnSuraksha.js";
import { gramsForInstallments } from "./_lib/kittyGrams.js";
import { computeCheckpointCrossingTimes, awardBonusCoin, CHECKPOINTS_G } from "./_lib/mission100.js";
import { getKittyMessage } from "./_lib/kittyTemplates.js";

// Two separate advance reminders, not one replacing the other (owner
// instruction, 2026-09-20): a 7-day heads-up AND a more urgent 3-day
// nudge, each with its own stamp column so they fire independently.
const REMINDER_DAYS_BEFORE = 7;
const REMINDER_DAYS_BEFORE_3DAY = 3;
const CLAIM_REMINDER_INTERVAL_DAYS = 14;
// Overdue nudges are queued (not sent) — this just controls how often a
// still-unpaid overdue installment gets re-queued for staff to approve.
const OVERDUE_REMINDER_INTERVAL_DAYS = 5;

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

function addMonths(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Same-day urgent nudge — anyone whose installment is due TODAY and still
// unpaid, stamped so it only ever fires once per installment (unlike the
// advance reminder above, which can fire days before the due date and
// never again). Triggered by the separate 10am IST cron entry.
async function sendDueTodayReminders(sb, today, stats) {
  const { data: due } = await sb.from("kitty_installments")
    .select("id,due_date,amount,month_number,enrollment:kitty_enrollments!inner(id,lead_id,tenant_id,status,scheme:kitty_schemes(name))")
    .eq("tenant_id", TENANT_ID).eq("status", "due").is("due_today_reminded_at", null).eq("due_date", today);

  for (const row of due || []) {
    if (row.enrollment?.status !== "active") continue;
    const { data: lead } = await sb.from("bullion_leads").select("phone,name,dnd").eq("id", row.enrollment.lead_id).maybeSingle();
    if (!lead?.phone || lead.dnd) continue;
    const schemeName = row.enrollment.scheme?.name || "your Kitty scheme";
    const msg = await getKittyMessage(sb, TENANT_ID, "due_today_reminder", {
      scheme_name: schemeName, month_number: row.month_number, amount: row.amount,
    });
    const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: row.enrollment.lead_id, phone: lead.phone, msg, context: { type: "due_today_reminder", installmentId: row.id } });
    if (!sent) { if (queued) stats.queued++; continue; }
    await sb.from("kitty_installments").update({ due_today_reminded_at: new Date().toISOString() }).eq("id", row.id);
    stats.dueTodayReminders++;
  }
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const sb = supa();
  const today = todayIST();
  const windowEnd = new Date(Date.now() + 5.5 * 3600000 + REMINDER_DAYS_BEFORE * 86400000).toISOString().slice(0, 10);
  const windowEnd3day = new Date(Date.now() + 5.5 * 3600000 + REMINDER_DAYS_BEFORE_3DAY * 86400000).toISOString().slice(0, 10);
  const stats = {
    dueReminders: 0, dueReminders3day: 0, dueTodayReminders: 0, overdueQueued: 0, claimReminders: 0, batchesRolledOver: 0, rolloverNudges: 0, swarnFrozen: 0, failed: 0, queued: 0,
    mission100Finishers: 0, mission100CompletionBonuses: 0, mission100CheckpointWins: 0, mission100Winners: 0,
    mission100Announcements: 0, mission100ReferralBonuses: 0,
  };

  // A second, lighter daily trigger (?only=due_today — see vercel.json,
  // 10am IST) does ONLY the same-day urgent nudge below and skips
  // everything else, so the 10am hit doesn't duplicate the other sweeps'
  // work (they're all idempotent anyway, but there's no reason to re-run
  // them twice a day).
  if (req.query?.only === "due_today") {
    try {
      await sendDueTodayReminders(sb, today, stats);
      return res.status(200).json({ ok: true, ...stats });
    } catch (e) {
      return res.status(200).json({ ok: false, error: e.message, ...stats });
    }
  }

  try {
    // ── 1. Monthly due reminders ──────────────────────────────────
    const { data: due } = await sb.from("kitty_installments")
      .select("id,due_date,amount,month_number,enrollment:kitty_enrollments!inner(id,lead_id,tenant_id,status,scheme:kitty_schemes(name))")
      .eq("tenant_id", TENANT_ID).eq("status", "due").is("reminded_at", null)
      .lte("due_date", windowEnd).gte("due_date", today);

    for (const row of due || []) {
      if (row.enrollment?.status !== "active") continue;
      const { data: lead } = await sb.from("bullion_leads").select("phone,name,dnd").eq("id", row.enrollment.lead_id).maybeSingle();
      if (!lead?.phone || lead.dnd) continue;
      const schemeName = row.enrollment.scheme?.name || "your Kitty scheme";
      const msg = await getKittyMessage(sb, TENANT_ID, "due_reminder", {
        scheme_name: schemeName, month_number: row.month_number, amount: row.amount, due_date: row.due_date,
      });
      const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: row.enrollment.lead_id, phone: lead.phone, msg, context: { type: "due_reminder", installmentId: row.id } });
      if (!sent) { if (queued) stats.queued++; continue; }
      await sb.from("kitty_installments").update({ reminded_at: new Date().toISOString() }).eq("id", row.id);
      stats.dueReminders++;
    }

    // ── 1b. 3-day urgent reminder — separate from the 7-day one above,
    //        fires independently even though both use the same `due` +
    //        date-window shape, since each has its own stamp column.
    const { data: due3day } = await sb.from("kitty_installments")
      .select("id,due_date,amount,month_number,enrollment:kitty_enrollments!inner(id,lead_id,tenant_id,status,scheme:kitty_schemes(name))")
      .eq("tenant_id", TENANT_ID).eq("status", "due").is("reminded_3day_at", null)
      .lte("due_date", windowEnd3day).gte("due_date", today);

    for (const row of due3day || []) {
      if (row.enrollment?.status !== "active") continue;
      const { data: lead } = await sb.from("bullion_leads").select("phone,name,dnd").eq("id", row.enrollment.lead_id).maybeSingle();
      if (!lead?.phone || lead.dnd) continue;
      const schemeName = row.enrollment.scheme?.name || "your Kitty scheme";
      const msg = await getKittyMessage(sb, TENANT_ID, "due_reminder_3day", {
        scheme_name: schemeName, month_number: row.month_number, amount: row.amount, due_date: row.due_date,
      });
      const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: row.enrollment.lead_id, phone: lead.phone, msg, context: { type: "due_reminder_3day", installmentId: row.id } });
      if (!sent) { if (queued) stats.queued++; continue; }
      await sb.from("kitty_installments").update({ reminded_3day_at: new Date().toISOString() }).eq("id", row.id);
      stats.dueReminders3day++;
    }

    // ── 1c. Overdue nudge — due_date already passed, still unpaid. Queued
    //        for staff approval (never auto-sent), re-queued every
    //        OVERDUE_REMINDER_INTERVAL_DAYS days until paid so it isn't a
    //        one-shot that's easy to miss.
    const overdueCutoff = new Date(Date.now() - OVERDUE_REMINDER_INTERVAL_DAYS * 86400000).toISOString();
    const { data: overdue } = await sb.from("kitty_installments")
      .select("id,due_date,amount,month_number,enrollment:kitty_enrollments!inner(id,lead_id,tenant_id,status,scheme:kitty_schemes(name))")
      .eq("tenant_id", TENANT_ID).eq("status", "due").lt("due_date", today)
      .or(`overdue_reminded_at.is.null,overdue_reminded_at.lt.${overdueCutoff}`);

    for (const row of overdue || []) {
      if (row.enrollment?.status !== "active") continue;
      const { data: lead } = await sb.from("bullion_leads").select("phone,name,dnd").eq("id", row.enrollment.lead_id).maybeSingle();
      if (!lead?.phone || lead.dnd) continue;
      const schemeName = row.enrollment.scheme?.name || "your Kitty scheme";
      const msg = await getKittyMessage(sb, TENANT_ID, "overdue_reminder", {
        scheme_name: schemeName, month_number: row.month_number, amount: row.amount, due_date: row.due_date,
      });
      const { queued } = await queueKittyWA(sb, { tenantId: TENANT_ID, leadId: row.enrollment.lead_id, phone: lead.phone, msg, context: { type: "overdue_reminder", installmentId: row.id } });
      if (!queued) continue;
      await sb.from("kitty_installments").update({ overdue_reminded_at: new Date().toISOString() }).eq("id", row.id);
      stats.overdueQueued++;
    }

    // ── 2. Legacy unclaimed-benefit reminders ───────────────────────
    const cutoff = new Date(Date.now() - CLAIM_REMINDER_INTERVAL_DAYS * 86400000).toISOString();
    const { data: unclaimed } = await sb.from("kitty_enrollments")
      .select("id,lead_id,legacy_scheme_name,is_legacy,scheme:kitty_schemes(name)")
      .eq("tenant_id", TENANT_ID).in("claim_status", ["unclaimed", "reminded"])
      .or(`last_claim_reminded_at.is.null,last_claim_reminded_at.lt.${cutoff}`);

    for (const row of unclaimed || []) {
      const { data: lead } = await sb.from("bullion_leads").select("phone,name,dnd").eq("id", row.lead_id).maybeSingle();
      if (!lead?.phone || lead.dnd) continue;
      const schemeName = row.legacy_scheme_name || row.scheme?.name || "your Kitty scheme";
      const msg = `🎁 Your ${schemeName} is complete and waiting to be claimed! Visit Sun Sea Jewellers, Karol Bagh to pick your jewellery/benefit whenever convenient.\n- Sun Sea Jewellers`;
      const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: row.lead_id, phone: lead.phone, msg, context: { type: "unclaimed_reminder", enrollmentId: row.id } });
      if (!sent) { if (queued) stats.queued++; continue; }
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
        const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", m.lead_id).maybeSingle();
        if (!lead?.phone || lead.dnd) continue;
        const msg = `🪙 Your ${batch.scheme.name} (${batch.batch_label}) round has completed! Enroll for the next round anytime — visit https://ssj.in/kitty-schemes or reply here.\n- Sun Sea Jewellers, Karol Bagh`;
        const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: m.lead_id, phone: lead.phone, msg, context: { type: "batch_rollover", batchId: batch.id } });
        if (sent) stats.rolloverNudges++; else if (queued) stats.queued++;
      }
    }

    // ── 4. Swarn Suraksha 11-month freeze ───────────────────────────
    // RBI guidance caps an online-sold gold scheme at 11 months. Proactively
    // freezes here (rather than waiting for a stray payment to trigger
    // ensureUnfrozenEnrollment in kitty-payment.js/razorpay-webhook.js) so
    // the client sees "come redeem in-store" promptly, not only if/when
    // they happen to pay again.
    const swarnScheme = await getSwarnScheme(sb);
    if (swarnScheme?.perks?.max_duration_months) {
      const { data: liveEnrollments } = await sb.from("kitty_enrollments")
        .select("id,lead_id,start_date").eq("tenant_id", TENANT_ID).eq("scheme_id", swarnScheme.id)
        .eq("status", "active").is("frozen_at", null);
      for (const e of liveEnrollments || []) {
        if (addMonths(e.start_date, swarnScheme.perks.max_duration_months) > today) continue;
        await sb.from("kitty_enrollments").update({ frozen_at: new Date().toISOString(), status: "completed", claim_status: "unclaimed" }).eq("id", e.id);
        await logKittyAudit({ entityType: "enrollment", entityId: e.id, action: "auto_freeze_11mo", actor: "system:cron" });
        stats.swarnFrozen++;
        const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", e.lead_id).maybeSingle();
        if (!lead?.phone || lead.dnd) continue;
        const msg = `🪙 Your ${swarnScheme.name} scheme has completed its 11-month term and is now ready to redeem — visit Sun Sea Jewellers, Karol Bagh to collect (redemption is in-store only). Want to keep saving? Start a fresh Swarn Suraksha anytime.\n- Sun Sea Jewellers`;
        const { queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: e.lead_id, phone: lead.phone, msg, context: { type: "swarn_freeze", enrollmentId: e.id } });
        if (queued) stats.queued++;
      }
    }

    // ── 5. Mission 100 — checkpoints, completion bonus, referral bonus ──
    // Every mutation/WA-send here is guarded by an idempotency column
    // (checkpoint_25_reached_at, finished_at, completion_bonus_awarded_at,
    // the mission100_checkpoint_wins unique constraint, referral_bonus_tier_awarded)
    // so re-running this sweep never double-awards or double-sends.
    const { data: racingGroups } = await sb.from("mission100_groups")
      .select("id, group_label, invite_code, scheme:kitty_schemes(perks), members:mission100_group_members(id, enrollment_id, checkpoint_25_reached_at, finished_at, completion_bonus_awarded_at, finish_rank, last_purchase_at, enrollment:kitty_enrollments(id, lead_id, installments:kitty_installments(status,paid_amount,amount,rate_locked,paid_at)))")
      .eq("tenant_id", TENANT_ID).eq("status", "racing");

    for (const group of racingGroups || []) {
      const { data: existingWins } = await sb.from("mission100_checkpoint_wins").select("checkpoint_grams").eq("group_id", group.id);
      const wonSet = new Set((existingWins || []).map((w) => w.checkpoint_grams));
      let finishedCountSoFar = (group.members || []).filter((m) => m.finished_at).length;
      const candidatesByCheckpoint = { 25: [], 50: [], 75: [], 100: [] };

      for (const m of group.members || []) {
        const installments = m.enrollment?.installments || [];
        const { totalGrams } = gramsForInstallments(installments);
        const crossings = computeCheckpointCrossingTimes(installments);

        // Personal 25g marker — the referral-eligibility bar, independent of race placement.
        if (totalGrams >= 25 && !m.checkpoint_25_reached_at) {
          await sb.from("mission100_group_members").update({ checkpoint_25_reached_at: crossings[25] || new Date().toISOString() }).eq("id", m.id);
        }

        // Personal 100g finish — every finisher, regardless of rank, gets the universal completion bonus.
        if (totalGrams >= 100 && !m.finished_at) {
          finishedCountSoFar++;
          await sb.from("mission100_group_members").update({ finished_at: crossings[100] || new Date().toISOString(), finish_rank: finishedCountSoFar }).eq("id", m.id);
          stats.mission100Finishers++;
        }
        if (totalGrams >= 100 && !m.completion_bonus_awarded_at) {
          try {
            await awardBonusCoin(sb, { enrollmentId: m.enrollment.id, reason: "completion", recordedBy: "system:cron" });
            await sb.from("mission100_group_members").update({ completion_bonus_awarded_at: new Date().toISOString() }).eq("id", m.id);
            stats.mission100CompletionBonuses++;
            const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", m.enrollment.lead_id).maybeSingle();
            if (lead?.phone && !lead.dnd) {
              const msg = `🎉 You've completed all 100 coins in Mission 100 — +1g free bonus added, 101g total in hand!\n- Sun Sea Jewellers, Karol Bagh`;
              const { queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: m.enrollment.lead_id, phone: lead.phone, msg, context: { type: "mission100_completion", enrollmentId: m.enrollment.id } });
              if (queued) stats.queued++;
            }
          } catch { stats.failed++; }
        }

        // last_purchase_at, denormalized for the inactive-flag display.
        const paidDates = installments.filter((i) => i.status === "paid" || i.status === "free").map((i) => i.paid_at).filter(Boolean).sort();
        const lastPurchaseAt = paidDates[paidDates.length - 1] || null;
        if (lastPurchaseAt && lastPurchaseAt !== m.last_purchase_at) {
          await sb.from("mission100_group_members").update({ last_purchase_at: lastPurchaseAt }).eq("id", m.id);
        }

        for (const cp of CHECKPOINTS_G) {
          if (wonSet.has(cp) || !crossings[cp]) continue;
          candidatesByCheckpoint[cp].push({ memberId: m.id, enrollmentId: m.enrollment.id, leadId: m.enrollment.lead_id, crossedAt: crossings[cp] });
        }
      }

      // Resolve each unclaimed checkpoint's winner = earliest real purchase
      // date to cross it, not whoever this batch happened to process first.
      for (const cp of CHECKPOINTS_G) {
        if (wonSet.has(cp)) continue;
        const candidates = candidatesByCheckpoint[cp];
        if (!candidates.length) continue;
        candidates.sort((a, b) => new Date(a.crossedAt) - new Date(b.crossedAt));
        const winner = candidates[0];

        const { error: winErr } = await sb.from("mission100_checkpoint_wins")
          .insert({ tenant_id: TENANT_ID, group_id: group.id, checkpoint_grams: cp, winner_member_id: winner.memberId });
        if (winErr) continue; // unique-constraint race — another tick already claimed it
        stats.mission100CheckpointWins++;

        if (cp < 100) {
          try {
            await awardBonusCoin(sb, { enrollmentId: winner.enrollmentId, reason: "checkpoint", recordedBy: "system:cron" });
            const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", winner.leadId).maybeSingle();
            if (lead?.phone && !lead.dnd) {
              const msg = `🥇 You're first in your Mission 100 group to reach ${cp}g! +1g free bonus coin added.\n- Sun Sea Jewellers, Karol Bagh`;
              const { queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: winner.leadId, phone: lead.phone, msg, context: { type: "mission100_checkpoint", enrollmentId: winner.enrollmentId, checkpoint: cp } });
              if (queued) stats.queued++;
            }
          } catch { stats.failed++; }
        } else {
          await sb.from("mission100_groups").update({ winner_enrollment_id: winner.enrollmentId, winner_declared_at: new Date().toISOString(), status: "completed" }).eq("id", group.id);
          stats.mission100Winners++;
          const tripDesc = group.scheme?.perks?.trip_prize_description || "a couple's trip";
          for (const m of group.members || []) {
            const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", m.enrollment?.lead_id).maybeSingle();
            if (!lead?.phone || lead.dnd) continue;
            const isWinner = m.id === winner.memberId;
            const msg = isWinner
              ? `🏆 Congratulations — you're first in "${group.group_label}" to complete Mission 100! You've won ${tripDesc} (pending confirmation). Our team will be in touch.\n- Sun Sea Jewellers, Karol Bagh`
              : `🏆 Mission 100 winner declared in "${group.group_label}"! One of your group finished first and won ${tripDesc}. Keep going — your own checkpoints and completion bonus are still yours to win.\n- Sun Sea Jewellers, Karol Bagh`;
            const { sent, queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: m.enrollment?.lead_id, phone: lead.phone, msg, context: { type: "mission100_winner", groupId: group.id } });
            if (sent) stats.mission100Announcements++; else if (queued) stats.queued++;
          }
        }
      }
    }

    // Referral bonus — own pass across ALL groups regardless of status,
    // since a referrer can sit in a completed group and still keep
    // referring people into other groups.
    const { data: allMembers } = await sb.from("mission100_group_members").select("id, enrollment_id, referral_bonus_tier_awarded, enrollment:kitty_enrollments(lead_id)").eq("tenant_id", TENANT_ID);
    for (const m of allMembers || []) {
      const { count: qualifyingCount } = await sb.from("mission100_group_members").select("*", { count: "exact", head: true })
        .eq("referred_by_member_id", m.id).not("checkpoint_25_reached_at", "is", null);
      const eligibleTier = Math.floor((qualifyingCount || 0) / 5);
      if (eligibleTier <= m.referral_bonus_tier_awarded) continue;
      const diff = eligibleTier - m.referral_bonus_tier_awarded;
      try {
        for (let i = 0; i < diff; i++) await awardBonusCoin(sb, { enrollmentId: m.enrollment_id, reason: "referral", recordedBy: "system:cron" });
        await sb.from("mission100_group_members").update({ referral_bonus_tier_awarded: eligibleTier }).eq("id", m.id);
        stats.mission100ReferralBonuses += diff;
        const { data: lead } = await sb.from("bullion_leads").select("phone,dnd").eq("id", m.enrollment?.lead_id).maybeSingle();
        if (lead?.phone && !lead.dnd) {
          const msg = `🎁 You've referred ${qualifyingCount} friends into Mission 100 who've each hit their first checkpoint — +${diff}g free bonus coin${diff > 1 ? "s" : ""} added!\n- Sun Sea Jewellers, Karol Bagh`;
          const { queued } = await sendKittyWA(sb, { tenantId: TENANT_ID, leadId: m.enrollment?.lead_id, phone: lead.phone, msg, context: { type: "mission100_referral", enrollmentId: m.enrollment_id } });
          if (queued) stats.queued++;
        }
      } catch { stats.failed++; }
    }

    // ── 6. Nudge admins if any Kitty messages are stuck pending ─────────
    // Every failed send above got queued instead of dropped (kitty_message_queue).
    // Tell admins once per cron run so they know to go hit "Send Now" in Kitty
    // Admin — sent via WbizTool (sendWhatsAppWbiz), deliberately NOT the same
    // Baileys channel (KITTY_WA_CLIENT_ID) that's usually why these are stuck
    // in the first place.
    const { count: pendingCount } = await sb.from("kitty_message_queue")
      .select("*", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "pending");
    if (pendingCount > 0) {
      try {
        const { data: adminStaff } = await sb.from("staff").select("phone,role")
          .eq("tenant_id", TENANT_ID).eq("active", true).in("role", ["superadmin", "admin"]);
        const recipients = [...new Set(
          [OWNER_PHONE, ...DIGEST_EXTRA_RECIPIENTS.split(","), ...(adminStaff || []).map((s) => s.phone)]
            .map((p) => (p || "").trim()).filter(Boolean)
        )];
        const msg = `🔔 ${pendingCount} Kitty message${pendingCount === 1 ? "" : "s"} pending (couldn't send — WA session down or number issue). Open Kitty Admin → Pending Messages → Send Now to retry.`;
        await Promise.all(recipients.map((phone) => sendWhatsAppWbiz({ phone, msg, whatsappClient: null }).catch(() => {})));
      } catch { /* nudge is best-effort, never fail the cron over it */ }
    }

    return res.status(200).json({ ok: true, ts: new Date().toISOString(), stats, pendingMessages: pendingCount || 0 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
