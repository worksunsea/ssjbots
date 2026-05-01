// POST /api/log-call
// Telecaller logs a call attempt against a demand. Drives the cadence engine:
// next_call_at gets recomputed, funnel transitions on terminal dispositions,
// and after attempt #6 with no answer the demand auto-flips to next_on_lost.
//
// Body: {
//   demandId:       uuid (required),
//   staffId:        uuid (the telecaller — typically currentUser.id),
//   disposition:    text (required, see allowed below),
//   openedAt?:      iso8601 — when telecaller opened the Log Call modal (for lag tracking),
//   notes?:         text,
//   durationSec?:   int  — auto-calculated by frontend from (now - openedAt),
//   nextCallbackAt?: iso8601 (only for 'callback_requested' | 'answered_not_now'),
// }
//
// Returns: { ok, callLogId, attemptNo, nextAction, outcome?, nextCallAt? }

import { supa } from "./_lib/supabase.js";
import { transitionLeadToFunnel } from "./_lib/drip.js";

export const config = { maxDuration: 30 };

const TERMINAL             = new Set(["wrong_number", "dnc"]);
const ANSWERED_NOT_INTERESTED = "answered_not_interested";
const ANSWERED_INTERESTED  = "answered_interested";
const RETRY                = new Set(["no_answer", "voicemail_left", "busy"]);
const ANSWERED_NOT_NOW     = "answered_not_now";
const CALLBACK_REQ         = "callback_requested";
const MAX_ATTEMPTS         = 6;
const BUSY_RETRY_MIN       = 15; // busy retries quickly and doesn't count toward the 6 attempts

// ── Classifier helpers ────────────────────────────────────────────────────────

function classifyLag(lagMinutes) {
  if (lagMinutes == null) return null;
  if (lagMinutes < 5)    return "INSTANT";
  if (lagMinutes < 30)   return "FAST";
  if (lagMinutes < 120)  return "SLOW";
  if (lagMinutes < 1440) return "DELAYED";
  return "MISSED";
}

function classifyTalk(seconds) {
  if (seconds == null || seconds < 0) return null;
  if (seconds < 10)  return "GHOST";
  if (seconds < 60)  return "SHORT";
  if (seconds < 300) return "NORMAL";
  return "LONG";
}

// A call is suspicious if it has an "answered" disposition but duration is
// suspiciously short (< 8 seconds — not enough to actually speak).
const ANSWERED_DISPOSITIONS = new Set([
  "answered_interested",
  "answered_not_interested",
  "answered_not_now",
  "callback_requested",
]);

function isSuspicious(disposition, durationSec) {
  if (!ANSWERED_DISPOSITIONS.has(disposition)) return false;
  if (durationSec == null) return false; // can't tell without duration
  return durationSec < 8;
}

// ── Priority score calculator (mirrors frontend demandTemperature() logic) ───

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

function deriveTemperature(demand, nextCallAt) {
  if (demand.is_callback_promised) return "hot";
  if (demand.occasion_date) {
    const daysTo = (new Date(demand.occasion_date).getTime() - Date.now()) / 86400000;
    if (daysTo <= 30) return "hot";
  }
  if (!nextCallAt) return "warm";
  const ageDays = (Date.now() - new Date(nextCallAt).getTime()) / 86400000;
  if (ageDays <= 1) return "hot";
  if (ageDays <= 7) return "warm";
  return "cold";
}

// ── Cadence helper ────────────────────────────────────────────────────────────

async function getCadenceMinutes(sb, tenantId) {
  const { data } = await sb.from("bullion_dropdowns")
    .select("value, sort_order")
    .eq("tenant_id", tenantId)
    .eq("field", "telecaller_cadence_minutes")
    .eq("active", true)
    .order("sort_order");
  if (!data?.length) return [5, 120, 1320, 3960, 6480, 9720]; // sane defaults
  return data.map((r) => Number(r.value) || 0).filter((n) => n > 0);
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const demandId   = body.demandId;
  const staffId    = body.staffId || null;
  const disposition = String(body.disposition || "");
  if (!demandId || !disposition) {
    return res.status(400).json({ ok: false, error: "missing_demandId_or_disposition" });
  }

  const sb = supa();

  const { data: demand, error: dErr } = await sb.from("bullion_demands")
    .select(`
      id, tenant_id, lead_id, funnel_id, fms_step_id,
      call_attempts, next_call_at,
      crm_source, is_callback_promised, occasion_date,
      lead:bullion_leads(id, phone)
    `)
    .eq("id", demandId)
    .single();
  if (dErr || !demand) return res.status(404).json({ ok: false, error: "demand_not_found" });

  // 'busy' retries quickly and doesn't count toward the 6-attempt budget
  const isBusy   = disposition === "busy";
  const attemptNo = (demand.call_attempts || 0) + (isBusy ? 0 : 1);
  const isFirstCall = attemptNo === 1 && !isBusy;

  // ── Lag calculation ────────────────────────────────────────────────────────
  // openedAt = when the telecaller opened the Log Call modal (sent from client).
  // lag = time between demand.next_call_at and when they actually started dialling.
  const openedAt     = body.openedAt ? new Date(body.openedAt) : null;
  const dueAt        = demand.next_call_at ? new Date(demand.next_call_at) : null;
  const lagMinutes   = openedAt && dueAt
    ? Math.round((openedAt.getTime() - dueAt.getTime()) / 60000)
    : null;
  const lagBucket    = classifyLag(lagMinutes);

  // ── Talk-time classification ────────────────────────────────────────────────
  const durationSec  = body.durationSec != null ? Number(body.durationSec) : null;
  const talkBucket   = classifyTalk(durationSec);
  const suspicious   = isSuspicious(disposition, durationSec);

  // ── Is this a callback-promised call? ─────────────────────────────────────
  const isCallbackPromised =
    disposition === CALLBACK_REQ || disposition === ANSWERED_NOT_NOW;

  // 1) Insert the call log row
  const { data: log, error: lErr } = await sb.from("bullion_call_logs").insert({
    tenant_id:         demand.tenant_id,
    demand_id:         demand.id,
    lead_id:           demand.lead_id,
    staff_id:          staffId,
    attempt_no:        attemptNo,
    duration_sec:      durationSec,
    disposition,
    notes:             body.notes || null,
    next_callback_at:  body.nextCallbackAt || null,
    opened_at:         openedAt ? openedAt.toISOString() : null,
    lag_minutes:       lagMinutes,
    lag_bucket:        lagBucket,
    talk_bucket:       talkBucket,
    is_first_call:     isFirstCall,
    is_suspicious:     suspicious,
  }).select("id").single();

  if (lErr) {
    console.error("log-call insert failed", lErr);
    return res.status(500).json({ ok: false, error: lErr.message });
  }

  // 2) Branch on disposition
  let nextAction = "stay_call_step";
  let outcome    = null;
  let nextCallAt = null;

  const demandUpdate = {
    call_attempts:        attemptNo,
    is_callback_promised: isCallbackPromised,
    updated_at:           new Date().toISOString(),
  };

  if (disposition === ANSWERED_INTERESTED) {
    // Advance demand to the next funnel step (messaging) — bot resumes.
    const { data: steps } = await sb.from("bullion_funnel_steps")
      .select("id, step_order")
      .eq("tenant_id", demand.tenant_id)
      .eq("funnel_id", demand.funnel_id)
      .eq("active", true)
      .order("step_order");
    const curIdx = (steps || []).findIndex((s) => s.id === demand.fms_step_id);
    const next   = (steps || [])[curIdx + 1];
    if (next) {
      demandUpdate.fms_step_id = next.id;
      nextAction = "advance_step";
    }
    demandUpdate.next_call_at     = null;
    demandUpdate.is_callback_promised = false;

  } else if (disposition === ANSWERED_NOT_INTERESTED) {
    outcome = "not_interested";
    demandUpdate.outcome          = outcome;
    demandUpdate.next_call_at     = null;
    demandUpdate.is_callback_promised = false;
    nextAction = "transition_funnel";

  } else if (TERMINAL.has(disposition)) {
    outcome = "lost";
    demandUpdate.outcome          = outcome;
    demandUpdate.next_call_at     = null;
    demandUpdate.is_callback_promised = false;
    if (disposition === "dnc") {
      await sb.from("bullion_leads").update({ dnd: true, status: "dead" }).eq("id", demand.lead_id);
    } else {
      await sb.from("bullion_leads").update({ status: "dead" }).eq("id", demand.lead_id);
    }
    nextAction = "transition_funnel";

  } else if (disposition === ANSWERED_NOT_NOW || disposition === CALLBACK_REQ) {
    nextCallAt                    = body.nextCallbackAt || null;
    demandUpdate.next_call_at     = nextCallAt;
    // is_callback_promised already set above

  } else if (RETRY.has(disposition) || isBusy) {
    if (isBusy) {
      nextCallAt                  = new Date(Date.now() + BUSY_RETRY_MIN * 60 * 1000).toISOString();
      demandUpdate.next_call_at   = nextCallAt;
    } else if (attemptNo >= MAX_ATTEMPTS) {
      outcome = "lost";
      demandUpdate.outcome        = outcome;
      demandUpdate.next_call_at   = null;
      nextAction = "transition_funnel";
    } else {
      const cadence               = await getCadenceMinutes(sb, demand.tenant_id);
      const offsetMin             = cadence[attemptNo] || cadence[cadence.length - 1] || 1440;
      nextCallAt                  = new Date(Date.now() + offsetMin * 60 * 1000).toISOString();
      demandUpdate.next_call_at   = nextCallAt;
    }
  }

  // ── Recompute priority score after the call ────────────────────────────────
  if (!outcome) {
    // Only update score for still-active demands
    const temperature = deriveTemperature(demand, demandUpdate.next_call_at || demand.next_call_at);
    demandUpdate.priority_score = calcPriority({
      temperature,
      nextCallAt:         demandUpdate.next_call_at || demand.next_call_at,
      isCallbackPromised: demandUpdate.is_callback_promised,
      crmSource:          demand.crm_source,
      callAttempts:       attemptNo,
    });
  }

  await sb.from("bullion_demands").update(demandUpdate).eq("id", demand.id);

  // 3) Funnel transition where required (after demand row update)
  if (nextAction === "transition_funnel") {
    const { data: funnel } = await sb.from("funnels")
      .select("next_on_lost,next_on_not_interested")
      .eq("id", demand.funnel_id)
      .maybeSingle();
    const target = outcome === "not_interested"
      ? (funnel?.next_on_not_interested || null)
      : (funnel?.next_on_lost || null);
    if (target) {
      await transitionLeadToFunnel({
        leadId:    demand.lead_id,
        newFunnelId: target,
        reason:    outcome || "telecaller_close",
      }).catch((e) => console.error("transitionLeadToFunnel failed", e));
    }
  }

  return res.status(200).json({
    ok:         true,
    callLogId:  log.id,
    attemptNo,
    nextAction,
    outcome,
    nextCallAt:    demandUpdate.next_call_at || null,
    lagMinutes,
    lagBucket,
    talkBucket,
    isSuspicious:  suspicious,
  });
}
