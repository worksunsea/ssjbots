// POST /api/demand-outcome
// Sales/admin marks a demand as converted | lost | not_interested.
// Sets demand.outcome, lead.status, then transitions the lead into the
// funnel's configured next_on_<outcome> funnel.
//
// Body: { demandId, outcome: "converted"|"lost"|"not_interested", staffId?, lostReason? }

import { supa } from "./_lib/supabase.js";
import { transitionLeadToFunnel } from "./_lib/drip.js";

async function schedulePostSaleMessages(sb, tenantId, leadId, funnelId, leadName, productCategory) {
  // Read config templates + google review link from bullion_dropdowns
  const { data: configs } = await sb.from("bullion_dropdowns")
    .select("field, value")
    .eq("tenant_id", tenantId)
    .in("field", ["google_review_link", "post_sale_day3", "post_sale_day7", "post_sale_day30"]);

  const cfg = {};
  for (const row of configs || []) cfg[row.field] = row.value;

  const vName = leadName || "Sir/Ma'am";
  const prod = (productCategory || "jewellery").replace(/_/g, " ");
  const reviewLink = cfg["google_review_link"] || "";

  const messages = [
    {
      days: 3,
      key: "post_sale_day3",
      fallback: `Hi ${vName}, we hope you're loving your new ${prod} 💎 It was a pleasure serving you at Sun Sea Jewellers! If you need any adjustments or have questions, we're always here. 🙏`,
      type: "post_sale_feedback",
    },
    {
      days: 7,
      key: "post_sale_day7",
      fallback: `Hi ${vName}, we hope your ${prod} is bringing you joy! ✨ If you have a moment, we'd truly appreciate a Google review — it means the world to us:\n${reviewLink}\n\nThank you for your trust. 🙏`,
      type: "post_sale_review",
    },
    {
      days: 30,
      key: "post_sale_day30",
      fallback: `Hi ${vName}, it's been a month since you picked up your ${prod} from Sun Sea Jewellers 💎 We hope it's perfect! If you ever need a resize, repair, or cleaning — just reach out. Always here for you. 🙏`,
      type: "post_sale_checkin",
    },
  ];

  const now = Date.now();
  for (const m of messages) {
    let body = cfg[m.key] || m.fallback;
    // Simple interpolation
    body = body.replace(/\{name\}/gi, vName).replace(/\{product\}/gi, prod).replace(/\{review_link\}/gi, reviewLink);
    const sendAt = new Date(now + m.days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await sb.from("bullion_scheduled_messages").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      funnel_id: funnelId,
      send_at: sendAt,
      body,
      status: "pending",
      message_type: m.type,
    });
    if (error) console.error(`post_sale insert ${m.type}`, error);
  }
}

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

  // ── Merge leads: manager+ requests, superadmin approves ─────────────────
  // Merge re-points a lot of data and soft-deletes a record — previously
  // executed the instant a manager confirmed the modal, no second set of
  // eyes on it. Now `action: "merge"` only queues a request
  // (bullion_lead_merge_requests); the actual reassignment happens in
  // `action: "approve-merge"`, superadmin only.
  const MANAGER_PLUS = ["superadmin", "admin", "manager"];

  if (body.action === "merge") {
    const { primaryLeadId, secondaryLeadId, actor, actorRole } = body;
    if (!primaryLeadId || !secondaryLeadId || primaryLeadId === secondaryLeadId)
      return res.status(400).json({ ok: false, error: "primaryLeadId and secondaryLeadId required and must differ" });
    if (!MANAGER_PLUS.includes(actorRole)) return res.status(403).json({ ok: false, error: "manager_or_above_required" });
    const sb = supa();
    const { data: primary } = await sb.from("bullion_leads").select("id,tenant_id").eq("id", primaryLeadId).single();
    if (!primary) return res.status(404).json({ ok: false, error: "primary_not_found" });
    const { data: reqRow, error } = await sb.from("bullion_lead_merge_requests")
      .insert({ tenant_id: primary.tenant_id, primary_lead_id: primaryLeadId, secondary_lead_id: secondaryLeadId, requested_by: actor || null })
      .select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, pending: true, requestId: reqRow.id });
  }

  // GET-style via POST (consistent with rest of this file) — list pending merge requests, superadmin only.
  if (body.action === "list-pending-merges") {
    if (body.actorRole !== "superadmin") return res.status(403).json({ ok: false, error: "superadmin_required" });
    const sb = supa();
    const { data, error } = await sb.from("bullion_lead_merge_requests")
      .select("id, requested_by, requested_at, primary:bullion_leads!bullion_lead_merge_requests_primary_lead_id_fkey(id,name,phone), secondary:bullion_leads!bullion_lead_merge_requests_secondary_lead_id_fkey(id,name,phone)")
      .eq("status", "pending").order("requested_at", { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, requests: data || [] });
  }

  if (body.action === "reject-merge") {
    if (body.actorRole !== "superadmin") return res.status(403).json({ ok: false, error: "superadmin_required" });
    if (!body.requestId) return res.status(400).json({ ok: false, error: "requestId_required" });
    const sb = supa();
    const { error } = await sb.from("bullion_lead_merge_requests")
      .update({ status: "rejected", decided_by: body.actor || null, decided_at: new Date().toISOString() })
      .eq("id", body.requestId).eq("status", "pending");
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (body.action === "approve-merge") {
    if (body.actorRole !== "superadmin") return res.status(403).json({ ok: false, error: "superadmin_required" });
    if (!body.requestId) return res.status(400).json({ ok: false, error: "requestId_required" });
    const sb = supa();
    const { data: reqRow } = await sb.from("bullion_lead_merge_requests").select("*").eq("id", body.requestId).eq("status", "pending").maybeSingle();
    if (!reqRow) return res.status(404).json({ ok: false, error: "request_not_found_or_already_decided" });
    const { primary_lead_id: primaryLeadId, secondary_lead_id: secondaryLeadId } = reqRow;

    const [{ data: primary }, { data: secondary }] = await Promise.all([
      sb.from("bullion_leads").select("*").eq("id", primaryLeadId).single(),
      sb.from("bullion_leads").select("*").eq("id", secondaryLeadId).single(),
    ]);
    if (!primary || !secondary) {
      await sb.from("bullion_lead_merge_requests").update({ status: "rejected", decided_by: body.actor || null, decided_at: new Date().toISOString() }).eq("id", body.requestId);
      return res.status(404).json({ ok: false, error: "primary_or_secondary_no_longer_exists" });
    }
    for (const { table, col } of [
      { table: "bullion_demands", col: "lead_id" },
      { table: "bullion_messages", col: "lead_id" },
      { table: "bullion_scheduled_messages", col: "lead_id" },
      { table: "bullion_call_logs", col: "lead_id" },
      { table: "bullion_funnel_history", col: "lead_id" },
      // Without this, merging two duplicate contacts left the secondary's
      // Kitty enrollment(s) still pointing at the now-dead/soft-deleted
      // record — the member's gold scheme effectively vanished from view
      // even though the DB rows were intact. If both records happen to have
      // an active enrollment in the same scheme, staff already has a
      // separate "merge duplicate member" action in Kitty Admin to combine
      // those two enrollments into one.
      { table: "kitty_enrollments", col: "lead_id" },
    ]) {
      const { error } = await sb.from(table).update({ [col]: primaryLeadId }).eq(col, secondaryLeadId);
      if (error && !error.message.includes("does not exist")) console.error(`merge: reassign ${table}`, error.message);
    }
    const fillFields = ["name","city","email","bday","anniversary","client_rating","wedding_date","wedding_family_member","wa_display_name","source","discovery_source"];
    const fillPatch = {};
    for (const f of fillFields) { if (!primary[f] && secondary[f]) fillPatch[f] = secondary[f]; }
    const mergedTags = Array.from(new Set([...(primary.tags || []), ...(secondary.tags || [])]));
    if (mergedTags.length > (primary.tags || []).length) fillPatch.tags = mergedTags;

    // Secondary's phone would otherwise just vanish into a search-only alias
    // row — give it a real, visible home too when primary's Mobile 2 is free.
    if (secondary.phone && secondary.phone !== primary.phone && !primary.mobile2) {
      fillPatch.mobile2 = secondary.phone;
    }
    // Any other field where BOTH records have a real, different value: keep
    // primary's (never silently overwrite), but don't just drop secondary's —
    // stash it on extra_fields.merge_conflicts (the same JSONB column the
    // contact editor already reads/writes as its custom-field bag) so staff
    // can reconcile later (surfaced as a warning banner on the merged contact).
    const conflictFields = ["salutation","email","city","address_house","address_locality","address_state","address_pincode","bday","anniversary","spouse_name","spouse_dob","spouse_mobile","profession","company","client_code"];
    const conflicts = {};
    for (const f of conflictFields) {
      if (primary[f] && secondary[f] && String(primary[f]).trim().toLowerCase() !== String(secondary[f]).trim().toLowerCase()) {
        conflicts[f] = secondary[f];
      }
    }
    if (Object.keys(conflicts).length > 0) {
      fillPatch.extra_fields = {
        ...(primary.extra_fields || {}),
        merge_conflicts: { ...conflicts, _from: secondary.name || secondary.phone, _at: new Date().toISOString() },
      };
    }
    if (Object.keys(fillPatch).length > 0) await sb.from("bullion_leads").update(fillPatch).eq("id", primaryLeadId);
    if (secondary.phone) {
      await sb.from("bullion_lead_aliases").insert({ tenant_id: secondary.tenant_id, alias_phone: secondary.phone, lead_id: primaryLeadId, created_by: "merge_leads" }).then(() => {}, () => {});
    }
    await sb.from("bullion_leads").update({ status: "dead", bot_paused: true, name: `[MERGED] ${secondary.name || secondary.phone}` }).eq("id", secondaryLeadId);
    await sb.from("bullion_lead_merge_requests").update({ status: "approved", decided_by: body.actor || null, decided_at: new Date().toISOString() }).eq("id", body.requestId);
    return res.status(200).json({ ok: true, primaryLeadId, secondaryLeadId, filledFields: Object.keys(fillPatch) });
  }

  const demandId  = body.demandId;
  const outcome   = String(body.outcome || "");
  const lostReason = body.lostReason || null;   // structured reason e.g. LOST_PRICE
  if (!demandId || !OUTCOME_TO_LEAD_STATUS[outcome]) {
    return res.status(400).json({ ok: false, error: "bad_args" });
  }

  const sb = supa();

  const { data: demand } = await sb.from("bullion_demands")
    .select("id, lead_id, funnel_id, tenant_id, product_category")
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

  // On CONVERTED: schedule 3 post-sale WA messages (day 3 feedback, day 7 review, day 30 check-in)
  if (outcome === "converted") {
    const { data: lead } = await sb.from("bullion_leads").select("name").eq("id", demand.lead_id).single();
    await schedulePostSaleMessages(sb, demand.tenant_id, demand.lead_id, demand.funnel_id, lead?.name, demand.product_category)
      .catch((e) => console.error("schedulePostSaleMessages failed", e));
  }

  return res.status(200).json({ ok: true, outcome, transitionedTo: transitioned });
}
