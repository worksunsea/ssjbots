// ──────────────────────────────────────────────────────────────────────────────
// GET /api/demand-queue
// Returns the priority-ordered call queue for the authenticated telecaller.
//
// Query params:
//   staffId   — required, UUID of the telecaller
//   tenantId  — optional, defaults to DEFAULT_TENANT_ID
//   limit     — optional, max rows (default 30)
//
// Returns demands that:
//   - are assigned to this telecaller
//   - have no outcome yet (outcome IS NULL)
//   - are on a call step (step_type = 'call') or have no step set yet
//   - next_call_at is in the past OR null (ie. due now)
//
// Sorted by: priority_score DESC, then next_call_at ASC (oldest first)
// ──────────────────────────────────────────────────────────────────────────────

import { supa } from "./_lib/supabase.js";
import { checkCrmSecret, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

const DEFAULT_TENANT_ID = "a1b2c3d4-0000-0000-0000-000000000001";

// ── Priority score formula ────────────────────────────────────────────────────
// (temperature_weight × 40) + (days_overdue × 15, cap 45)
// + (is_callback_promised × 50) + (source_weight)
// − (attempt_number × 5, cap 25)
function calcPriority({ temperature, nextCallAt, isCallbackPromised, crmSource, callAttempts }) {
  const tempWeight = { hot: 40, warm: 20, cold: 5 }[temperature] || 10;
  const sourceWeight = {
    online_google: 15,
    online_instagram: 15,
    walkin: 10,
    old_client: 8,
    referral: 12,
    exhibition: 10,
  }[crmSource] || 5;
  const callbackBonus = isCallbackPromised ? 50 : 0;
  const daysOverdue = nextCallAt
    ? Math.max(0, (Date.now() - new Date(nextCallAt).getTime()) / 86400000)
    : 0;
  const overdueScore = Math.min(daysOverdue * 15, 45);
  const attemptPenalty = Math.min((callAttempts || 0) * 5, 25);
  return Math.round(tempWeight + sourceWeight + callbackBonus + overdueScore - attemptPenalty);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: "missing_env" });
  const authErr = checkCrmSecret(req, res);
  if (authErr) return;

  const { staffId, tenantId, limit: rawLimit } = req.query;
  if (!staffId) return res.status(400).json({ ok: false, error: "staffId is required" });

  const tid = tenantId || DEFAULT_TENANT_ID;
  const limit = Math.min(parseInt(rawLimit || "30", 10), 100);
  const now = new Date().toISOString();

  try {
  const sb = supa();

  // Fetch demands assigned to this telecaller that are:
  //   - open (no outcome)
  //   - due for a call (next_call_at <= now OR next_call_at is null)
  const { data: demands, error } = await sb
    .from("bullion_demands")
    .select(`
      id,
      lead_id,
      funnel_id,
      fms_step_id,
      product_category,
      description,
      budget,
      occasion,
      occasion_date,
      for_whom,
      call_attempts,
      next_call_at,
      crm_source,
      priority_score,
      is_callback_promised,
      assigned_staff_id,
      assigned_to,
      created_at,
      updated_at,
      visit_scheduled_at,
      ai_summary,
      bullion_funnel_steps!fms_step_id ( step_type, name ),
      bullion_leads!lead_id ( id, name, phone, city, source )
    `)
    .eq("tenant_id", tid)
    .eq("assigned_staff_id", staffId)
    .is("outcome", null)
    .or(`next_call_at.is.null,next_call_at.lte.${now}`)
    .order("priority_score", { ascending: false })
    .order("next_call_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    console.error("[demand-queue] DB error:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  // Filter to only call-type steps (or demands with no step yet — they need a call too)
  const callDemands = (demands || []).filter((d) => {
    const stepType = d.bullion_funnel_steps?.step_type;
    return stepType === "call" || stepType == null;
  });

  // Recompute priority_score live in case DB value is stale, and attach a
  // temperature label from the demand data.
  const enriched = callDemands.map((d) => {
    const temperature = deriveTemperature(d);
    const freshScore = calcPriority({
      temperature,
      nextCallAt: d.next_call_at,
      isCallbackPromised: d.is_callback_promised,
      crmSource: d.crm_source,
      callAttempts: d.call_attempts,
    });
    return {
      ...d,
      temperature,
      priority_score: freshScore,
      step_type: d.bullion_funnel_steps?.step_type || "call",
      step_name: d.bullion_funnel_steps?.name || null,
      lead: d.bullion_leads || null,
      // Remove nested join objects to keep payload clean
      bullion_funnel_steps: undefined,
      bullion_leads: undefined,
    };
  });

  // Re-sort after live recalculation
  enriched.sort((a, b) => b.priority_score - a.priority_score);

  return res.status(200).json({ ok: true, demands: enriched, count: enriched.length });
  } catch (err) {
    console.error("[demand-queue] unhandled error", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// ── Simple temperature heuristic matching demandTemperature() in the frontend ──
function deriveTemperature(d) {
  if (!d.next_call_at) return "warm";
  const ageMs = Date.now() - new Date(d.next_call_at).getTime();
  const ageDays = ageMs / 86400000;
  if (d.is_callback_promised) return "hot";
  if (d.occasion_date) {
    const daysToOccasion = (new Date(d.occasion_date).getTime() - Date.now()) / 86400000;
    if (daysToOccasion <= 30) return "hot";
  }
  if (ageDays <= 1) return "hot";
  if (ageDays <= 7) return "warm";
  return "cold";
}
