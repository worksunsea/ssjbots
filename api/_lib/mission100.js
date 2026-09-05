// Shared helpers for the Mission 100 gamified race scheme — used by
// api/kitty.js (admin actions), api/mission100.js (public join/leaderboard),
// api/mission100-payment.js (online self-pay), and api/kitty-cron.js (the
// checkpoint/referral/completion-bonus sweep).

import { TENANT_ID } from "./config.js";
import { getRates } from "./rates.js";
import { logKittyAudit } from "./kittyAudit.js";

export const CHECKPOINTS_G = [25, 50, 75, 100];

export function isMission100Scheme(perks) {
  return perks?.mission100 === true;
}

// Short, unambiguous invite code (no 0/O/1/I) — collision-checked by the
// caller, same retry-on-conflict shape as other short-code generators in
// this codebase (e.g. redemption codes).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateInviteCode(length = 7) {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

// Walks a member's settled installments in real purchase-date order and
// returns the timestamp each checkpoint (25/50/75/100g) was first crossed
// — derived from the actual paid_at of the installment that tipped the
// cumulative total over the line, NOT "now" at cron-detection time. This
// is what makes "first in the group to reach 25g" fair regardless of which
// order the daily batch happens to process members in.
export function computeCheckpointCrossingTimes(installments, checkpoints = CHECKPOINTS_G) {
  const settled = (installments || [])
    .filter((i) => (i.status === "paid" || i.status === "free") && i.rate_locked && i.paid_at)
    .map((i) => ({ paidAt: i.paid_at, grams: Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) }))
    .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));

  const crossings = {};
  let cumulative = 0;
  let remaining = [...checkpoints].sort((a, b) => a - b);
  for (const row of settled) {
    cumulative += row.grams;
    while (remaining.length && cumulative >= remaining[0]) {
      crossings[remaining[0]] = row.paidAt;
      remaining.shift();
    }
    if (!remaining.length) break;
  }
  return crossings;
}

// Inserts a comped ("free") 1g bonus installment on an enrollment — reused
// by checkpoint wins, the universal completion bonus, and referral bonuses.
// rate_locked is set to today's live rate so paid_amount/rate_locked still
// derives to exactly `grams`, same math every other installment uses.
export async function awardBonusCoin(sb, { enrollmentId, grams = 1, reason, recordedBy = "system:mission100" }) {
  const rates = await getRates().catch(() => null);
  const ratePerGram = rates?.spot?.gold24kt;
  if (!ratePerGram) throw new Error("rate_unavailable");

  const { data: existingCount } = await sb.from("kitty_installments")
    .select("month_number", { count: "exact", head: false }).eq("enrollment_id", enrollmentId).order("month_number", { ascending: false }).limit(1);
  const nextMonth = (existingCount?.[0]?.month_number || 0) + 1;

  const amount = Math.round(grams * ratePerGram * 100) / 100;
  const { data, error } = await sb.from("kitty_installments").insert({
    tenant_id: TENANT_ID, enrollment_id: enrollmentId, month_number: nextMonth,
    due_date: new Date().toISOString().slice(0, 10),
    amount, status: "free", paid_amount: amount, paid_at: new Date().toISOString(),
    rate_locked: ratePerGram, recorded_by: recordedBy,
  }).select().single();
  if (error) throw new Error(error.message);

  await logKittyAudit({ entityType: "installment", entityId: data.id, action: "mission100_bonus", actor: recordedBy, details: { enrollmentId, grams, reason } });
  return data;
}
