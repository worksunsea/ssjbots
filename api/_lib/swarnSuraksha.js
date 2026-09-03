// Shared helpers for the Swarn Suraksha online kitty scheme — used by both
// api/kitty-payment.js (client-initiated top-ups/subscriptions) and
// api/razorpay-webhook.js (payment/subscription-charge events), so the
// daily cap and 11-month freeze-and-roll-over logic can't drift between
// the two call paths.

import { TENANT_ID } from "./config.js";

export const SWARN_SLUG = "swarn-suraksha";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export async function getSwarnScheme(sb) {
  const { data } = await sb.from("kitty_schemes").select("*").eq("tenant_id", TENANT_ID).eq("slug", SWARN_SLUG).maybeSingle();
  return data || null;
}

// Sum of grams already bought TODAY by this lead across every one of their
// Swarn Suraksha enrollments (any cycle) — the 10g cap is per-client, not
// per-enrollment, so a frozen-and-rolled-over cycle doesn't reset it.
export async function gramsPurchasedTodayByLead(sb, leadId, schemeId) {
  const { data: enrollmentRows } = await sb.from("kitty_enrollments")
    .select("id").eq("tenant_id", TENANT_ID).eq("lead_id", leadId).eq("scheme_id", schemeId);
  const enrollmentIds = (enrollmentRows || []).map((e) => e.id);
  if (!enrollmentIds.length) return 0;

  const today = todayIST();
  const { data: rows } = await sb.from("kitty_installments")
    .select("grams_purchased")
    .in("enrollment_id", enrollmentIds)
    .eq("status", "paid")
    .in("source", ["topup", "subscription"])
    .gte("paid_at", `${today}T00:00:00.000Z`)
    .lt("paid_at", `${today}T23:59:59.999Z`);
  return (rows || []).reduce((sum, r) => sum + Number(r.grams_purchased || 0), 0);
}

// If `enrollment` has passed its 11-month freeze (frozen_at set by the
// daily cron, or the freeze window has arrived but the cron hasn't ticked
// yet), returns a freshly created next-cycle enrollment for the same
// lead+scheme instead — so an in-flight payment always lands somewhere
// live. Otherwise returns the enrollment unchanged.
export async function ensureUnfrozenEnrollment(sb, enrollment, scheme) {
  const maxMonths = scheme?.perks?.max_duration_months;
  const freezeDate = maxMonths ? addMonths(enrollment.start_date, maxMonths) : null;
  const isFrozen = Boolean(enrollment.frozen_at) || (freezeDate && freezeDate <= todayIST());
  if (!isFrozen) return enrollment;

  if (!enrollment.frozen_at) {
    await sb.from("kitty_enrollments").update({ frozen_at: new Date().toISOString(), status: "completed", claim_status: "unclaimed" }).eq("id", enrollment.id);
  }

  const { data: newEnrollment, error } = await sb.from("kitty_enrollments").insert({
    tenant_id: TENANT_ID, lead_id: enrollment.lead_id, scheme_id: enrollment.scheme_id,
    status: "active", start_date: todayIST(), cycle_number: (enrollment.cycle_number || 1) + 1,
    previous_enrollment_id: enrollment.id, razorpay_customer_id: enrollment.razorpay_customer_id,
  }).select().single();
  if (error) throw new Error(error.message);
  return newEnrollment;
}

function addMonths(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
