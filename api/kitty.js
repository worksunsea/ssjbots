// GET  /api/kitty?action=list                 — public. Active schemes only, for ssj.in scheme cards.
// GET  /api/kitty?action=admin-list-schemes    — staff. All schemes (incl. inactive).
// POST /api/kitty?action=scheme-create         — staff. Body: scheme fields.
// POST /api/kitty?action=scheme-update         — staff. Body: { id, ...fields }.
// POST /api/kitty?action=scheme-delete         — staff. Body: { id }.
// GET  /api/kitty?action=admin-list-enrollments — staff. Query: status?, schemeId?
// POST /api/kitty?action=confirm-enrollment    — staff. Body: { id, startDate, confirmedBy }
//      Generates the full kitty_installments schedule (duration_months rows,
//      one per calendar month from startDate) and sets status=active.
// POST /api/kitty?action=cancel-enrollment     — staff. Body: { id }.
// POST /api/kitty?action=mark-installment-paid — staff. Body: { installmentId, paidAmount, rateLocked?, recordedBy }
// POST /api/kitty?action=record-draw           — staff. Body: { schemeId, drawMonth, winnerEnrollmentId?,
//      goldCoinWinnerEnrollmentId?, nonWinnerBenefitAmount?, recordedBy }
//      Waives all remaining unpaid installments for the winner (card rule:
//      "not to pay ahead if you get lucky").
// POST /api/kitty?action=add-legacy-member     — staff. Body: { name, phone, legacySchemeName, notes }
//      Upserts a bullion_leads row + a completed, unclaimed legacy enrollment
//      — kitty-cron.js starts reminding them to claim immediately.
// POST /api/kitty?action=update-claim-status   — staff. Body: { id, claimStatus }

import { supa } from "./_lib/supabase.js";
import { TENANT_ID, checkCrmSecret, normalizePhone } from "./_lib/config.js";

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

const SCHEME_FIELDS = (b) => ({
  name: b.name,
  slug: b.slug,
  monthly_amount: Number(b.monthlyAmount),
  duration_months: Number(b.durationMonths) || 12,
  perks: b.perks || {},
  description: b.description || null,
  active: b.active !== false,
  sort_order: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
  funnel_id: b.funnelId || null,
});

// Adds N calendar months to a YYYY-MM-DD date string, same day-of-month
// (clamped to the shorter month where needed, e.g. Jan 31 + 1mo = Feb 28/29).
function addMonths(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // rolled into next month — clamp back to last day of target month
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  if (req.method === "GET" && action === "list") {
    const { data, error } = await sb.from("kitty_schemes")
      .select("id,name,slug,monthly_amount,duration_months,perks,description,sort_order")
      .eq("tenant_id", TENANT_ID).eq("active", true).order("sort_order", { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, schemes: data || [] });
  }

  if (req.method === "GET" && action === "admin-list-schemes") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const { data, error } = await sb.from("kitty_schemes").select("*").eq("tenant_id", TENANT_ID).order("sort_order", { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, schemes: data || [] });
  }

  if (req.method === "POST" && action === "scheme-create") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.name || !body.slug || !body.monthlyAmount) return res.status(400).json({ ok: false, error: "name_slug_monthlyAmount_required" });
    const { data, error } = await sb.from("kitty_schemes").insert({ ...SCHEME_FIELDS(body), tenant_id: TENANT_ID }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, scheme: data });
  }

  if (req.method === "POST" && action === "scheme-update") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { data, error } = await sb.from("kitty_schemes")
      .update({ ...SCHEME_FIELDS(body), updated_at: new Date().toISOString() })
      .eq("tenant_id", TENANT_ID).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, scheme: data });
  }

  if (req.method === "POST" && action === "scheme-delete") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("kitty_schemes").delete().eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET" && action === "admin-list-enrollments") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    let q = sb.from("kitty_enrollments")
      .select("*, lead:bullion_leads(name,phone), scheme:kitty_schemes(name,slug,monthly_amount,duration_months,perks), installments:kitty_installments(*)")
      .eq("tenant_id", TENANT_ID).order("created_at", { ascending: false });
    if (req.query.status) q = q.eq("status", req.query.status);
    if (req.query.schemeId) q = q.eq("scheme_id", req.query.schemeId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, enrollments: data || [] });
  }

  if (req.method === "POST" && action === "confirm-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.startDate) return res.status(400).json({ ok: false, error: "id_startDate_required" });
    const { data: enrollment, error: fetchErr } = await sb.from("kitty_enrollments")
      .select("*, scheme:kitty_schemes(monthly_amount,duration_months)")
      .eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (fetchErr) return res.status(500).json({ ok: false, error: fetchErr.message });
    if (!enrollment) return res.status(404).json({ ok: false, error: "not_found" });
    if (!enrollment.scheme) return res.status(400).json({ ok: false, error: "enrollment_has_no_scheme" });

    const { error: updErr } = await sb.from("kitty_enrollments").update({
      status: "active", start_date: body.startDate,
      confirmed_by: body.confirmedBy || null, confirmed_at: new Date().toISOString(),
    }).eq("id", body.id);
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    const perks = enrollment.scheme.perks || {};
    const rows = [];
    for (let m = 1; m <= enrollment.scheme.duration_months; m++) {
      const isFree = perks.free_installment_month && m === perks.free_installment_month;
      rows.push({
        tenant_id: TENANT_ID, enrollment_id: body.id, month_number: m,
        due_date: addMonths(body.startDate, m - 1),
        amount: enrollment.scheme.monthly_amount,
        status: isFree ? "free" : "due",
      });
    }
    const { error: insErr } = await sb.from("kitty_installments").insert(rows);
    if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
    return res.status(200).json({ ok: true, installmentsCreated: rows.length });
  }

  if (req.method === "POST" && action === "cancel-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("kitty_enrollments").update({ status: "cancelled" }).eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && action === "mark-installment-paid") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.installmentId) return res.status(400).json({ ok: false, error: "installmentId_required" });
    const { data, error } = await sb.from("kitty_installments").update({
      status: "paid",
      paid_amount: body.paidAmount != null ? Number(body.paidAmount) : null,
      paid_at: new Date().toISOString(),
      rate_locked: body.rateLocked != null ? Number(body.rateLocked) : null,
      recorded_by: body.recordedBy || null,
    }).eq("tenant_id", TENANT_ID).eq("id", body.installmentId).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    // If this was the enrollment's last unpaid installment, mark the scheme
    // complete and open the claim-status tracker (kitty-cron.js starts
    // reminding them to come collect once claim_status = unclaimed).
    const { count: remaining } = await sb.from("kitty_installments")
      .select("*", { count: "exact", head: true })
      .eq("enrollment_id", data.enrollment_id).eq("status", "due");
    if (!remaining) {
      await sb.from("kitty_enrollments").update({ status: "completed", claim_status: "unclaimed" }).eq("id", data.enrollment_id);
    }
    return res.status(200).json({ ok: true, installment: data });
  }

  if (req.method === "POST" && action === "record-draw") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.schemeId || !body.drawMonth) return res.status(400).json({ ok: false, error: "schemeId_drawMonth_required" });
    const { data: draw, error } = await sb.from("kitty_draws").insert({
      tenant_id: TENANT_ID, scheme_id: body.schemeId, draw_month: body.drawMonth,
      winner_enrollment_id: body.winnerEnrollmentId || null,
      gold_coin_winner_enrollment_id: body.goldCoinWinnerEnrollmentId || null,
      non_winner_benefit_amount: body.nonWinnerBenefitAmount != null ? Number(body.nonWinnerBenefitAmount) : null,
      recorded_by: body.recordedBy || null,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    if (body.winnerEnrollmentId) {
      await sb.from("kitty_installments")
        .update({ status: "waived" })
        .eq("enrollment_id", body.winnerEnrollmentId).eq("status", "due");
    }
    return res.status(200).json({ ok: true, draw });
  }

  if (req.method === "POST" && action === "add-legacy-member") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    const name = String(body.name || "").trim();
    if (!phone || !name || !body.legacySchemeName) return res.status(400).json({ ok: false, error: "name_phone_legacySchemeName_required" });

    const { data: existing } = await sb.from("bullion_leads").select("id").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();
    let leadId = existing?.id;
    if (!leadId) {
      const { data: inserted, error: leadErr } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name, source: "kitty_legacy_import", status: "converted", stage: "greeting",
      }).select("id").single();
      if (leadErr) return res.status(500).json({ ok: false, error: leadErr.message });
      leadId = inserted.id;
    }

    const { data, error } = await sb.from("kitty_enrollments").insert({
      tenant_id: TENANT_ID, lead_id: leadId, is_legacy: true, legacy_scheme_name: body.legacySchemeName,
      status: "completed", claim_status: "unclaimed", notes: body.notes || null,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, enrollment: data });
  }

  if (req.method === "POST" && action === "update-claim-status") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.claimStatus) return res.status(400).json({ ok: false, error: "id_claimStatus_required" });
    const patch = { claim_status: body.claimStatus };
    if (body.claimStatus === "claimed") patch.claimed_at = new Date().toISOString();
    const { data, error } = await sb.from("kitty_enrollments").update(patch).eq("tenant_id", TENANT_ID).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, enrollment: data });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
