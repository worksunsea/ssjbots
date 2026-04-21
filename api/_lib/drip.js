// Drip campaign helpers — enroll new leads into their funnel's step sequence,
// and render per-step message templates with lead/funnel context.

import { supa } from "./supabase.js";
import { TENANT_ID } from "./config.js";

function render(tpl, ctx) {
  return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = ctx[k];
    return v == null ? "" : String(v);
  });
}

// Called when a lead reaches a state worth nurturing (QUOTE_SENT, or any
// explicit re-enrollment). Idempotent: skips if any scheduled rows already
// exist for this lead.
//
// Each step can pick its own trigger_type to compute send_at:
//   after_prev_step      — cumulative from previous step (default)
//   after_enrollment     — delay_minutes after NOW
//   after_last_inbound   — delay_minutes after the lead's last inbound message
//   after_last_purchase  — delay_minutes after bullion_leads.last_purchase_at
//   specific_datetime    — send at step.trigger_at (ignore delay_minutes)
export async function enrollLeadInDrip({ lead, funnel }) {
  const sb = supa();

  const { count } = await sb
    .from("bullion_scheduled_messages")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", lead.id)
    .in("status", ["pending", "sent"]);
  if (count && count > 0) return { ok: true, skipped: "already_enrolled" };

  const { data: steps } = await sb
    .from("bullion_funnel_steps")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("funnel_id", funnel.id)
    .eq("active", true)
    .order("step_order", { ascending: true });

  if (!steps?.length) return { ok: true, skipped: "no_steps" };

  // Look up last inbound time for after_last_inbound triggers
  let lastInboundTs = null;
  const { data: lastIn } = await sb
    .from("bullion_messages")
    .select("created_at")
    .eq("lead_id", lead.id)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1);
  if (lastIn?.length) lastInboundTs = Date.parse(lastIn[0].created_at);

  const nowMs = Date.now();
  const lastPurchaseMs = lead.last_purchase_at ? Date.parse(lead.last_purchase_at) : null;

  const ctx = {
    name: lead.name || "",
    phone: lead.phone || "",
    city: lead.city || "",
    funnel_name: funnel.name || "",
    goal: funnel.goal || "",
  };

  let cursor = nowMs; // for after_prev_step
  const rows = [];

  for (const s of steps) {
    const delay = Number(s.delay_minutes || 0) * 60_000;
    let sendAt;

    switch (s.trigger_type || "after_prev_step") {
      case "after_enrollment":
        sendAt = nowMs + delay;
        break;
      case "after_last_inbound":
        if (lastInboundTs == null) { sendAt = nowMs + delay; }
        else { sendAt = lastInboundTs + delay; }
        break;
      case "after_last_purchase":
        if (lastPurchaseMs == null) continue; // skip — no purchase on record yet
        sendAt = lastPurchaseMs + delay;
        break;
      case "specific_datetime":
        if (!s.trigger_at) continue;
        sendAt = Date.parse(s.trigger_at);
        break;
      case "after_prev_step":
      default:
        cursor += delay;
        sendAt = cursor;
        break;
    }

    // Don't schedule into the past
    if (sendAt < nowMs) sendAt = nowMs + 60_000;

    rows.push({
      tenant_id: TENANT_ID,
      lead_id: lead.id,
      step_id: s.id,
      funnel_id: funnel.id,
      send_at: new Date(sendAt).toISOString(),
      body: render(s.message_template, ctx),
      status: "pending",
    });
  }

  if (!rows.length) return { ok: true, skipped: "no_applicable_steps" };
  const { error } = await sb.from("bullion_scheduled_messages").insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true, enrolled: rows.length };
}

// Cancel all pending scheduled messages for a lead (called when they reply
// mid-drip, convert, or the funnel gets disabled).
export async function cancelPendingForLead(leadId, reason) {
  const sb = supa();
  const { error } = await sb
    .from("bullion_scheduled_messages")
    .update({ status: "canceled", canceled_reason: reason })
    .eq("lead_id", leadId)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
