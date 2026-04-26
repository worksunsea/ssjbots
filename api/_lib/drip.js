// Drip campaign helpers — enroll new leads into their funnel's step sequence,
// and render per-step message templates with lead/funnel context.

import { supa } from "./supabase.js";

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
// Snap a timestamp to 10:30 AM IST (UTC+5:30 → UTC 05:00) on its calendar day.
// staggerMs adds offset so multiple same-day sends don't fire simultaneously.
function snapToISTMorning(ms, staggerMs = 0) {
  const d = new Date(ms);
  d.setUTCHours(5, 0, 0, 0); // 10:30 AM IST
  return d.getTime() + staggerMs;
}

// Clamp a send_at to IST business hours (9 AM–8 PM = UTC 03:30–14:30).
// If outside window, push to 10:30 AM IST next valid day.
function clampToBusinessHours(ms) {
  const d = new Date(ms);
  const hourIST = ((d.getUTCHours() * 60 + d.getUTCMinutes()) - (-330)) / 60; // convert UTC to IST hours
  // IST hour = UTC hour + 5.5
  const istMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + 330;
  const istHour = (istMinutes % 1440) / 60;
  if (istHour >= 9 && istHour < 20) return ms; // within window
  // Push to 10:30 AM IST next day
  const next = new Date(ms);
  if (istHour >= 20) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(5, 0, 0, 0); // 10:30 AM IST
  return next.getTime();
}

export async function enrollLeadInDrip({ lead, funnel, eventDateMs, staggerMs = 0 }) {
  const sb = supa();

  const { count } = await sb
    .from("bullion_scheduled_messages")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", lead.id)
    .eq("funnel_id", funnel.id)
    .in("status", ["pending", "sent"]);
  if (count && count > 0) return { ok: true, skipped: "already_enrolled" };

  const { data: steps } = await sb
    .from("bullion_funnel_steps")
    .select("*")
    .eq("tenant_id", funnel.tenant_id)
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
      case "calendar_event": {
        // delay_minutes is days-offset × 1440, can be negative (before event)
        if (!eventDateMs) { sendAt = nowMs + Math.abs(delay); break; }
        const calSendAt = snapToISTMorning(eventDateMs + delay, staggerMs);
        // If this step's date is already past, SKIP it — don't push to today
        if (calSendAt < nowMs) continue;
        sendAt = calSendAt;
        break;
      }
      case "after_prev_step":
      default:
        cursor += delay;
        sendAt = cursor;
        break;
    }

    // Don't schedule into the past
    if (sendAt < nowMs) sendAt = nowMs + 60_000;
    // Clamp to business hours (9 AM – 8 PM IST)
    sendAt = clampToBusinessHours(sendAt);

    rows.push({
      tenant_id: funnel.tenant_id,
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

// Move a lead into a different funnel (after conversion or drip exhaustion).
// Cancels any pending drip in the old funnel, appends the old funnel to
// funnel_history, updates funnel_id, then enrolls in the new funnel's drip.
export async function transitionLeadToFunnel({ leadId, newFunnelId, reason }) {
  if (!leadId || !newFunnelId) return { ok: false, error: "missing_args" };
  const sb = supa();

  const { data: lead } = await sb
    .from("bullion_leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (!lead) return { ok: false, error: "lead_not_found" };
  if (lead.funnel_id === newFunnelId) return { ok: true, skipped: "same_funnel" };

  await cancelPendingForLead(leadId, `transition_${reason}`);

  const history = Array.isArray(lead.funnel_history) ? lead.funnel_history : [];
  history.push({
    from_funnel_id: lead.funnel_id,
    entered_at: lead.updated_at,
    exited_at: new Date().toISOString(),
    reason,
  });

  await sb
    .from("bullion_leads")
    .update({ funnel_id: newFunnelId, funnel_history: history })
    .eq("id", leadId);

  const { data: newFunnel } = await sb
    .from("funnels")
    .select("*")
    .eq("id", newFunnelId)
    .single();
  if (newFunnel?.active) {
    await enrollLeadInDrip({
      lead: { ...lead, funnel_id: newFunnelId, funnel_history: history },
      funnel: newFunnel,
    });
  }

  return { ok: true, to: newFunnelId };
}
