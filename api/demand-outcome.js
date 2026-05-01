// POST /api/demand-outcome
// Sales/admin marks a demand as converted | lost | not_interested.
// Sets demand.outcome, lead.status, then transitions the lead into the
// funnel's configured next_on_<outcome> funnel.
//
// Body: { demandId, outcome: "converted"|"lost"|"not_interested", staffId?, lostReason? }

import { supa } from "./_lib/supabase.js";
import { transitionLeadToFunnel } from "./_lib/drip.js";

export const config = { maxDuration: 30 };

const OUTCOME_TO_LEAD_STATUS = {
  converted: "converted",
  lost: "dead",
  not_interested: "active",   // still in CRM, just nudged into a softer funnel
  junk: "dead",                // irrelevant message — discard, no further messaging
  supplier: "dead",            // supplier/karigar inbound — never a sales demand
};

const OUTCOME_TO_FIELD = {
  converted: "next_on_convert",
  lost: "next_on_lost",
  not_interested: "next_on_not_interested",
  junk: null,
  supplier: null,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const demandId  = body.demandId;
  const outcome   = String(body.outcome || "");
  const lostReason = body.lostReason || null;   // structured reason e.g. LOST_PRICE
  if (!demandId || !OUTCOME_TO_LEAD_STATUS[outcome]) {
    return res.status(400).json({ ok: false, error: "bad_args" });
  }

  const sb = supa();

  const { data: demand } = await sb.from("bullion_demands")
    .select("id, lead_id, funnel_id, tenant_id")
    .eq("id", demandId).single();
  if (!demand) return res.status(404).json({ ok: false, error: "demand_not_found" });

  const demandPatch = {
    outcome,
    bot_active:   false,
    next_call_at: null,
    updated_at:   new Date().toISOString(),
  };
  if (outcome === "lost" && lostReason) {
    demandPatch.lost_reason = lostReason;
  }
  await sb.from("bullion_demands").update(demandPatch).eq("id", demand.id);

  await sb.from("bullion_leads").update({
    status: OUTCOME_TO_LEAD_STATUS[outcome],
    bot_paused: outcome === "junk" ? true : undefined,
  }).eq("id", demand.lead_id);

  // For junk / supplier, cancel pending drips so we never bother them again.
  if (outcome === "junk" || outcome === "supplier") {
    await sb.from("bullion_scheduled_messages")
      .update({ status: "canceled", canceled_reason: `marked_${outcome}` })
      .eq("lead_id", demand.lead_id).eq("status", "pending");
    if (outcome === "supplier") {
      // Tag the lead as a supplier so they're permanently filtered out of demands.
      await sb.from("bullion_leads").update({ source: "supplier" }).eq("id", demand.lead_id);
    }
    return res.status(200).json({ ok: true, outcome, transitionedTo: null });
  }

  const targetField = OUTCOME_TO_FIELD[outcome];
  const { data: funnel } = targetField ? await sb.from("funnels")
    .select(`id, ${targetField}`)
    .eq("id", demand.funnel_id).maybeSingle() : { data: null };
  const target = targetField ? (funnel?.[targetField] || null) : null;

  let transitioned = null;
  if (target) {
    const r = await transitionLeadToFunnel({
      leadId: demand.lead_id,
      newFunnelId: target,
      reason: outcome,
    }).catch((e) => ({ ok: false, error: String(e) }));
    transitioned = r?.ok ? target : null;
    if (!r?.ok) console.error("transition failed", r);
  }

  return res.status(200).json({ ok: true, outcome, transitionedTo: transitioned });
}
