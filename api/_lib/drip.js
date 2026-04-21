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

// Called when a NEW lead is created OR on explicit (re)enrollment.
// Idempotent: skips if any scheduled rows already exist for this lead.
export async function enrollLeadInDrip({ lead, funnel }) {
  const sb = supa();

  // Skip if already enrolled
  const { count } = await sb
    .from("bullion_scheduled_messages")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", lead.id);
  if (count && count > 0) return { ok: true, skipped: "already_enrolled" };

  const { data: steps } = await sb
    .from("bullion_funnel_steps")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("funnel_id", funnel.id)
    .eq("active", true)
    .order("step_order", { ascending: true });

  if (!steps?.length) return { ok: true, skipped: "no_steps" };

  const now = Date.now();
  const ctx = {
    name: lead.name || "",
    phone: lead.phone || "",
    funnel_name: funnel.name || "",
    goal: funnel.goal || "",
  };

  // send_at is cumulative: step 1 = enrollment + d1, step 2 = step1.send_at + d2, etc.
  let cursor = now;
  const rows = steps.map((s) => {
    cursor += (s.delay_minutes || 0) * 60_000;
    return {
      tenant_id: TENANT_ID,
      lead_id: lead.id,
      step_id: s.id,
      funnel_id: funnel.id,
      send_at: new Date(cursor).toISOString(),
      body: render(s.message_template, ctx),
      status: "pending",
    };
  });

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
