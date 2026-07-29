// Attributes a newly-captured lead to the associate whose referral link
// they arrived through (?ref=<code>, captured client-side in
// ssj-website/src/utils/referral.js and sent back as `ref_code` on any
// lead-creating request). Links the visit row to the lead and opens a
// pending commission entry for staff to review/approve/pay (Phase 3 admin
// panel — no automatic payout, no payment gateway yet).
//
// Safe to call on every lead submission — no-ops silently if ref_code is
// missing/invalid or the lead has already been attributed to this associate.

import { supa } from "./supabase.js";
import { TENANT_ID } from "./config.js";

export async function attributeReferral({ refCode, leadId, orderReference }) {
  if (!refCode || !leadId) return;
  const sb = supa();

  const { data: associate } = await sb.from("bullion_associates")
    .select("id").eq("referral_code", refCode).eq("status", "active").maybeSingle();
  if (!associate) return;

  // Link the most recent not-yet-attributed visit from this associate to
  // this lead, so the associate's "visits → conversions" story is traceable.
  const { data: openVisit } = await sb.from("bullion_referral_visits")
    .select("id").eq("associate_id", associate.id).is("visitor_lead_id", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (openVisit) {
    await sb.from("bullion_referral_visits").update({ visitor_lead_id: leadId }).eq("id", openVisit.id);
  }

  // One pending commission row per associate+lead — avoid duplicates if the
  // same referred person submits multiple forms (bridal + rate subscribe etc).
  const { data: existingCommission } = await sb.from("bullion_commissions")
    .select("id").eq("associate_id", associate.id).eq("referred_lead_id", leadId).maybeSingle();
  if (existingCommission) return;

  await sb.from("bullion_commissions").insert({
    tenant_id: TENANT_ID,
    associate_id: associate.id,
    referred_lead_id: leadId,
    order_reference: orderReference || "website enquiry",
    status: "pending",
  }).catch(() => {});
}
