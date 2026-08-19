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
// POST /api/kitty?action=enroll-new-member     — staff. Body: { name, phone, schemeId,
//      startDate, confirmedBy, paidMonths? }. Direct in-store enrolment (no
//      prior public interest submission needed); paidMonths backfills
//      already-elapsed months if the member actually started earlier.
// POST /api/kitty?action=change-scheme         — staff. Body: { id, newSchemeId }.
//      Corrects a wrongly-picked scheme; blocked once any installment is paid.
// POST /api/kitty?action=delete-enrollment      — staff. Body: { id }.
//      Hard-deletes a genuine duplicate entry; blocked once any installment is paid.

import crypto from "crypto";
import { supa } from "./_lib/supabase.js";
import { TENANT_ID, checkCrmSecret, normalizePhone } from "./_lib/config.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";
import { sendWhatsApp } from "./_lib/wa.js";

const REDEMPTION_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

// Schemes redeeming in actual gold (Golden Sparkle's raw-gold option,
// Gullak) let each member pick their own monthly amount in ₹5,000
// multiples, ₹5,000–₹3,00,000, instead of the scheme's fixed amount.
const MIN_FLEXIBLE_AMOUNT = 5000;
const MAX_FLEXIBLE_AMOUNT = 300000;
function isGoldRedemptionScheme(perks) {
  return perks?.redemption === "jewellery_or_raw_gold" || perks?.redemption === "sell_anytime_or_jewellery";
}
// Resolves the monthly amount to actually use for a flexible-amount
// enrollment, validating it's a ₹5,000 multiple in range. Returns
// { ok:true, amount } or { ok:false, error }.
function resolveFlexibleAmount(requested, schemeMonthlyAmount) {
  if (requested == null || requested === "") return { ok: true, amount: schemeMonthlyAmount };
  const n = Number(requested);
  if (!Number.isFinite(n) || n < MIN_FLEXIBLE_AMOUNT || n > MAX_FLEXIBLE_AMOUNT || n % MIN_FLEXIBLE_AMOUNT !== 0) {
    return { ok: false, error: `monthlyAmount must be a multiple of ₹${MIN_FLEXIBLE_AMOUNT}, between ₹${MIN_FLEXIBLE_AMOUNT} and ₹${MAX_FLEXIBLE_AMOUNT}` };
  }
  return { ok: true, amount: n };
}

const SCHEME_FIELDS = (b) => ({
  name: b.name,
  slug: b.slug,
  monthly_amount: b.perks?.unit === "grams" || b.monthlyAmount === "" || b.monthlyAmount == null ? null : Number(b.monthlyAmount),
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

// Every mutating action logs who did what, when — a real footprint, not
// just the mutation itself. sb param kept for call-site consistency with
// the rest of this file even though the shared writer opens its own client.
async function logAudit(_sb, opts) {
  await logKittyAudit(opts);
}

// Builds the full monthly installment schedule for an enrollment.
// paidMonths (optional) backfills already-elapsed months — e.g. staff is
// enrolling someone today who actually started 2 months ago and already
// paid those months in cash: [{ monthNumber, paidAt, amount }].
function buildInstallmentSchedule({ enrollmentId, scheduleStart, durationMonths, monthlyAmount, perks, paidMonths }) {
  const paidByMonth = new Map((Array.isArray(paidMonths) ? paidMonths : []).map((m) => [Number(m.monthNumber), m]));
  const rows = [];
  for (let m = 1; m <= durationMonths; m++) {
    const isFree = perks.free_installment_month && m === perks.free_installment_month;
    const backfill = paidByMonth.get(m);
    if (backfill) {
      const amount = backfill.amount != null ? Number(backfill.amount) : monthlyAmount;
      rows.push({
        tenant_id: TENANT_ID, enrollment_id: enrollmentId, month_number: m,
        due_date: backfill.paidAt || addMonths(scheduleStart, m - 1),
        amount, status: "paid", paid_amount: amount,
        paid_at: backfill.paidAt ? `${backfill.paidAt}T00:00:00Z` : new Date().toISOString(),
        recorded_by: "staff (backfill)",
      });
    } else {
      rows.push({
        tenant_id: TENANT_ID, enrollment_id: enrollmentId, month_number: m,
        due_date: addMonths(scheduleStart, m - 1),
        amount: monthlyAmount, status: isFree ? "free" : "due",
      });
    }
  }
  return rows;
}

// Lucky-draw schemes (Golden Bliss/Bloom) cap membership at 100 per
// 12-month round. Finds the current open batch with room, or opens the
// next-numbered one if none exists / the current one is full.
async function getOrCreateOpenBatch(sb, scheme, startDate) {
  const { data: openBatches } = await sb.from("kitty_batches")
    .select("*, member_count:kitty_enrollments(count)")
    .eq("scheme_id", scheme.id).eq("status", "open").order("created_at", { ascending: false });

  for (const b of openBatches || []) {
    const count = b.member_count?.[0]?.count || 0;
    if (count < b.max_members) return b;
    await sb.from("kitty_batches").update({ status: "full" }).eq("id", b.id);
  }

  const { count: totalBatches } = await sb.from("kitty_batches").select("*", { count: "exact", head: true }).eq("scheme_id", scheme.id);
  const { data: newBatch, error } = await sb.from("kitty_batches").insert({
    tenant_id: TENANT_ID, scheme_id: scheme.id,
    batch_label: `${scheme.name} — Batch ${(totalBatches || 0) + 1}`,
    start_date: startDate, max_members: 100, status: "open",
  }).select().single();
  if (error) throw new Error(error.message);
  return newBatch;
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

  // GET ?action=available-numbers&schemeId=X — public. Lucky-draw schemes
  // only. Opens/reuses the current batch and returns a random sample of
  // 5-10 free numbers (never the full 1..100 list) for the enrol form's
  // "pick your number" step.
  if (req.method === "GET" && action === "available-numbers") {
    const schemeId = req.query.schemeId;
    if (!schemeId) return res.status(400).json({ ok: false, error: "schemeId_required" });
    const { data: scheme } = await sb.from("kitty_schemes").select("id,name,perks").eq("tenant_id", TENANT_ID).eq("id", schemeId).eq("active", true).maybeSingle();
    if (!scheme) return res.status(400).json({ ok: false, error: "scheme_not_found" });
    if (!scheme.perks?.lucky_draw) return res.status(400).json({ ok: false, error: "not_a_lucky_draw_scheme" });

    let batch;
    try { batch = await getOrCreateOpenBatch(sb, scheme, new Date().toISOString().slice(0, 10)); }
    catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

    const { data: taken } = await sb.from("kitty_enrollments")
      .select("member_number").eq("batch_id", batch.id).not("member_number", "is", null).not("status", "eq", "cancelled");
    const takenSet = new Set((taken || []).map((r) => r.member_number));
    const free = [];
    for (let n = 1; n <= batch.max_members; n++) if (!takenSet.has(n)) free.push(n);
    if (!free.length) return res.status(200).json({ ok: true, batchId: batch.id, batchLabel: batch.batch_label, availableNumbers: [] });

    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
    const sampleSize = Math.min(free.length, 5 + Math.floor(Math.random() * 6)); // 5–10
    return res.status(200).json({ ok: true, batchId: batch.id, batchLabel: batch.batch_label, availableNumbers: free.slice(0, sampleSize).sort((a, b) => a - b) });
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
    await logAudit(sb, { entityType: "scheme", entityId: data.id, action: "create", actor: body.actor, details: { name: data.name } });
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
    await logAudit(sb, { entityType: "scheme", entityId: data.id, action: "update", actor: body.actor, details: { name: data.name } });
    return res.status(200).json({ ok: true, scheme: data });
  }

  if (req.method === "POST" && action === "scheme-delete") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("kitty_schemes").delete().eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "scheme", entityId: body.id, action: "delete", actor: body.actor });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET" && action === "admin-list-enrollments") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    let q = sb.from("kitty_enrollments")
      .select("*, lead:bullion_leads(name,phone), scheme:kitty_schemes(name,slug,monthly_amount,duration_months,perks), installments:kitty_installments(*), redemptions:kitty_redemptions(*)")
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
      .select("*, scheme:kitty_schemes(id,name,monthly_amount,duration_months,perks)")
      .eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (fetchErr) return res.status(500).json({ ok: false, error: fetchErr.message });
    if (!enrollment) return res.status(404).json({ ok: false, error: "not_found" });
    if (!enrollment.scheme) return res.status(400).json({ ok: false, error: "enrollment_has_no_scheme" });

    const perks = enrollment.scheme.perks || {};

    // Lucky-draw schemes (Golden Bliss/Bloom) run in capped rounds — max 100
    // members per 12-month batch. All members of a batch share the same
    // start_date so the monthly draw lines up across the whole round.
    let batchId = enrollment.batch_id || null;
    let scheduleStart = body.startDate;
    if (perks.lucky_draw) {
      let batch;
      if (batchId) {
        // Already assigned a batch + numbered slot at enrol time (the
        // public "pick your number" step) — reuse it, don't reassign.
        const { data: existingBatch } = await sb.from("kitty_batches").select("*").eq("id", batchId).maybeSingle();
        batch = existingBatch;
      }
      if (!batch) {
        try { batch = await getOrCreateOpenBatch(sb, enrollment.scheme, body.startDate); }
        catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
      }
      batchId = batch.id;
      scheduleStart = batch.start_date;
    }

    let monthlyAmountOverride = enrollment.monthly_amount_override;
    if (isGoldRedemptionScheme(perks) && body.monthlyAmount != null) {
      const resolved = resolveFlexibleAmount(body.monthlyAmount, enrollment.scheme.monthly_amount);
      if (!resolved.ok) return res.status(400).json({ ok: false, error: resolved.error });
      monthlyAmountOverride = resolved.amount;
    }

    const { error: updErr } = await sb.from("kitty_enrollments").update({
      status: "active", start_date: scheduleStart, batch_id: batchId, monthly_amount_override: monthlyAmountOverride,
      confirmed_by: body.confirmedBy || null, confirmed_at: new Date().toISOString(),
    }).eq("id", body.id);
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    // Gram-based (gullak) schemes don't have a fixed monthly rupee amount —
    // each purchase is logged ad-hoc via ?action=add-installment instead of
    // a pre-generated fixed schedule.
    if (perks.unit === "grams" || enrollment.scheme.monthly_amount == null) {
      await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "confirm", actor: body.actor || body.confirmedBy, details: { startDate: scheduleStart, note: "gram_based" } });
      return res.status(200).json({ ok: true, installmentsCreated: 0, note: "gram_based_no_fixed_schedule" });
    }
    const rows = buildInstallmentSchedule({
      enrollmentId: body.id, scheduleStart, durationMonths: enrollment.scheme.duration_months,
      monthlyAmount: monthlyAmountOverride || enrollment.scheme.monthly_amount, perks, paidMonths: body.paidMonths,
    });
    const { error: insErr } = await sb.from("kitty_installments").insert(rows);
    if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "confirm", actor: body.actor || body.confirmedBy, details: { startDate: scheduleStart, monthlyAmountOverride } });
    return res.status(200).json({ ok: true, installmentsCreated: rows.length, batchId });
  }

  // POST ?action=enroll-new-member — staff. Direct in-store enrolment, no
  // prior public "interest" submission needed. Body: { name, phone,
  // schemeId, startDate, confirmedBy, paidMonths? }. paidMonths backfills
  // already-elapsed months (e.g. member actually started 2 months ago) —
  // same shape as add-legacy-member: [{ monthNumber, paidAt, amount }].
  if (req.method === "POST" && action === "enroll-new-member") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    const name = String(body.name || "").trim();
    if (!phone || !name || !body.schemeId || !body.startDate) {
      return res.status(400).json({ ok: false, error: "name_phone_schemeId_startDate_required" });
    }

    const { data: scheme } = await sb.from("kitty_schemes").select("*").eq("tenant_id", TENANT_ID).eq("id", body.schemeId).maybeSingle();
    if (!scheme) return res.status(400).json({ ok: false, error: "scheme_not_found" });
    const perks = scheme.perks || {};

    let monthlyAmountOverride = null;
    if (isGoldRedemptionScheme(perks) && body.monthlyAmount != null) {
      const resolved = resolveFlexibleAmount(body.monthlyAmount, scheme.monthly_amount);
      if (!resolved.ok) return res.status(400).json({ ok: false, error: resolved.error });
      monthlyAmountOverride = resolved.amount;
    }

    const { data: existingLead } = await sb.from("bullion_leads").select("id").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();
    let leadId = existingLead?.id;
    if (!leadId) {
      const { data: inserted, error: leadErr } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name, source: "kitty_staff_enrollment", status: "converted", stage: "greeting",
      }).select("id").single();
      if (leadErr) return res.status(500).json({ ok: false, error: leadErr.message });
      leadId = inserted.id;
    }

    let batchId = null;
    let scheduleStart = body.startDate;
    if (perks.lucky_draw) {
      let batch;
      try { batch = await getOrCreateOpenBatch(sb, scheme, body.startDate); }
      catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
      batchId = batch.id;
      scheduleStart = batch.start_date;
    }

    const { data: enrollment, error: enrollErr } = await sb.from("kitty_enrollments").insert({
      tenant_id: TENANT_ID, lead_id: leadId, scheme_id: scheme.id, batch_id: batchId, monthly_amount_override: monthlyAmountOverride,
      status: "active", start_date: scheduleStart, confirmed_by: body.confirmedBy || "staff", confirmed_at: new Date().toISOString(),
    }).select().single();
    if (enrollErr) return res.status(500).json({ ok: false, error: enrollErr.message });

    // Attach to the scheme's WA funnel, same as an online enrolment would.
    if (scheme.funnel_id) {
      const { data: funnel } = await sb.from("funnels").select("*").eq("tenant_id", TENANT_ID).eq("id", scheme.funnel_id).eq("active", true).maybeSingle();
      if (funnel) {
        const { data: lead } = await sb.from("bullion_leads").select("*").eq("id", leadId).maybeSingle();
        if (lead) await enrollLeadInDrip({ lead, funnel }).catch(() => {});
      }
    }

    if (perks.unit === "grams" || scheme.monthly_amount == null) {
      await logAudit(sb, { entityType: "enrollment", entityId: enrollment.id, action: "create", actor: body.actor || body.confirmedBy, details: { name, phone, schemeId: scheme.id, note: "gram_based" } });
      return res.status(200).json({ ok: true, enrollment, installmentsCreated: 0, note: "gram_based_no_fixed_schedule" });
    }
    const rows = buildInstallmentSchedule({
      enrollmentId: enrollment.id, scheduleStart, durationMonths: scheme.duration_months,
      monthlyAmount: monthlyAmountOverride || scheme.monthly_amount, perks, paidMonths: body.paidMonths,
    });
    const { error: insErr } = await sb.from("kitty_installments").insert(rows);
    if (insErr) return res.status(500).json({ ok: false, error: insErr.message, enrollment });
    await logAudit(sb, { entityType: "enrollment", entityId: enrollment.id, action: "create", actor: body.actor || body.confirmedBy, details: { name, phone, schemeId: scheme.id, monthlyAmountOverride, startDate: scheduleStart } });
    return res.status(200).json({ ok: true, enrollment, installmentsCreated: rows.length, batchId });
  }

  // GET ?action=admin-list-batches — staff. Query: schemeId?
  if (req.method === "GET" && action === "admin-list-batches") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    let q = sb.from("kitty_batches")
      .select("*, scheme:kitty_schemes(name), member_count:kitty_enrollments(count)")
      .eq("tenant_id", TENANT_ID).order("created_at", { ascending: false });
    if (req.query.schemeId) q = q.eq("scheme_id", req.query.schemeId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, batches: (data || []).map((b) => ({ ...b, member_count: b.member_count?.[0]?.count || 0 })) });
  }

  // POST ?action=close-batch — staff. Manually stops a batch/round from
  // taking further enrollments (distinct from the automatic 'full' at
  // capacity or 'completed' at term end) — e.g. staff decides to close a
  // round early. getOrCreateOpenBatch only ever considers status='open', so
  // a closed batch is naturally skipped and a new one opens on next enrol.
  if (req.method === "POST" && action === "close-batch") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("kitty_batches").update({ status: "closed" }).eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "batch", entityId: body.id, action: "close", actor: body.actor });
    return res.status(200).json({ ok: true });
  }

  // GET ?action=admin-list-legacy-names — staff. Dropdown source for the
  // Legacy Member form.
  if (req.method === "GET" && action === "admin-list-legacy-names") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const { data, error } = await sb.from("kitty_legacy_scheme_names").select("*").eq("tenant_id", TENANT_ID).order("name");
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, names: data || [] });
  }

  // POST ?action=add-legacy-name — staff. Adds a new old-kitty name to the
  // dropdown (idempotent — reuses the existing row if the name already
  // exists instead of erroring on the unique constraint).
  if (req.method === "POST" && action === "add-legacy-name") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    const { data: existing } = await sb.from("kitty_legacy_scheme_names").select("*").eq("tenant_id", TENANT_ID).eq("name", name).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, legacyName: existing });
    const { data, error } = await sb.from("kitty_legacy_scheme_names").insert({ tenant_id: TENANT_ID, name }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "legacy_name", entityId: data.id, action: "create", actor: body.actor, details: { name } });
    return res.status(200).json({ ok: true, legacyName: data });
  }

  // POST ?action=add-installment — staff. For ad-hoc purchase logging on
  // gram-based (gullak) enrollments, or any extra/adjustment entry on a
  // fixed-schedule enrollment. Body: { enrollmentId, monthNumber, dueDate,
  // amount, gramsPurchased?, ratePerGram?, recordedBy }. If gramsPurchased
  // is given, rate_locked is derived (amount / grams) so the client account
  // can total up grams-to-date the same way rate-lock schemes do.
  if (req.method === "POST" && action === "add-installment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.enrollmentId || !body.amount) return res.status(400).json({ ok: false, error: "enrollmentId_amount_required" });
    const amount = Number(body.amount);
    const grams = body.gramsPurchased != null ? Number(body.gramsPurchased) : null;
    const rateLocked = grams ? amount / grams : (body.ratePerGram != null ? Number(body.ratePerGram) : null);
    const { data: existingCount } = await sb.from("kitty_installments")
      .select("month_number", { count: "exact", head: false }).eq("enrollment_id", body.enrollmentId).order("month_number", { ascending: false }).limit(1);
    const nextMonth = body.monthNumber != null ? Number(body.monthNumber) : ((existingCount?.[0]?.month_number || 0) + 1);
    const { data, error } = await sb.from("kitty_installments").insert({
      tenant_id: TENANT_ID, enrollment_id: body.enrollmentId, month_number: nextMonth,
      due_date: body.dueDate || new Date().toISOString().slice(0, 10),
      amount, status: "paid", paid_amount: amount, paid_at: new Date().toISOString(),
      rate_locked: rateLocked, recorded_by: body.recordedBy || null,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "installment", entityId: data.id, action: "create", actor: body.actor || body.recordedBy, details: { enrollmentId: body.enrollmentId, amount, grams } });
    return res.status(200).json({ ok: true, installment: data });
  }

  if (req.method === "POST" && action === "cancel-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("kitty_enrollments").update({ status: "cancelled" }).eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "cancel", actor: body.actor });
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
    await logAudit(sb, { entityType: "installment", entityId: data.id, action: "paid", actor: body.actor || body.recordedBy, details: { paidAmount: data.paid_amount, rateLocked: data.rate_locked } });
    return res.status(200).json({ ok: true, installment: data });
  }

  // POST ?action=send-installment-reminder — staff. Body: { installmentId }.
  // On-demand WA nudge for a pending payment (same wording as kitty-cron.js's
  // automatic 3-day-before reminder), for staff working the Overview
  // dashboard's pending-payments list right now instead of waiting for the
  // next cron tick.
  if (req.method === "POST" && action === "send-installment-reminder") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.installmentId) return res.status(400).json({ ok: false, error: "installmentId_required" });
    const { data: row } = await sb.from("kitty_installments")
      .select("id,due_date,amount,month_number,enrollment:kitty_enrollments(lead_id,is_legacy,legacy_scheme_name,scheme:kitty_schemes(name))")
      .eq("tenant_id", TENANT_ID).eq("id", body.installmentId).maybeSingle();
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    const { data: lead } = await sb.from("bullion_leads").select("phone").eq("id", row.enrollment?.lead_id).maybeSingle();
    if (!lead?.phone) return res.status(400).json({ ok: false, error: "member_has_no_phone_on_file" });
    const schemeName = row.enrollment?.is_legacy ? row.enrollment.legacy_scheme_name : (row.enrollment?.scheme?.name || "your Kitty scheme");
    const msg = `🪙 Reminder: your ${schemeName} installment #${row.month_number} of ₹${row.amount} is due on ${row.due_date}.\n- Sun Sea Jewellers, Karol Bagh`;
    const wa = await sendWhatsApp({ phone: lead.phone, msg }).catch(() => ({ status: 0 }));
    if (wa.status !== 1) return res.status(500).json({ ok: false, error: "whatsapp_send_failed" });
    await sb.from("kitty_installments").update({ reminded_at: new Date().toISOString() }).eq("id", body.installmentId);
    await logAudit(sb, { entityType: "installment", entityId: body.installmentId, action: "reminder-sent", actor: body.actor });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && action === "record-draw") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.schemeId || !body.drawMonth) return res.status(400).json({ ok: false, error: "schemeId_drawMonth_required" });
    // batchId required once a scheme has more than one concurrent round —
    // keeps a draw scoped to the members who are actually in that round.
    const { data: draw, error } = await sb.from("kitty_draws").insert({
      tenant_id: TENANT_ID, scheme_id: body.schemeId, batch_id: body.batchId || null, draw_month: body.drawMonth,
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
    await logAudit(sb, { entityType: "batch", entityId: body.batchId, action: "record-draw", actor: body.actor || body.recordedBy, details: { schemeId: body.schemeId, drawMonth: body.drawMonth, winnerEnrollmentId: body.winnerEnrollmentId } });
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

    // Optional: record exactly which months they already paid, so the
    // enrollment shows real history instead of just a "completed" label.
    // Body.paidMonths: [{ monthNumber, paidAt (date), amount }]
    if (Array.isArray(body.paidMonths) && body.paidMonths.length) {
      const rows = body.paidMonths.map((m) => ({
        tenant_id: TENANT_ID, enrollment_id: data.id,
        month_number: Number(m.monthNumber),
        due_date: m.paidAt || new Date().toISOString().slice(0, 10),
        amount: m.amount != null ? Number(m.amount) : 0,
        status: "paid",
        paid_amount: m.amount != null ? Number(m.amount) : null,
        paid_at: m.paidAt ? `${m.paidAt}T00:00:00Z` : new Date().toISOString(),
        recorded_by: body.recordedBy || "staff (legacy import)",
      }));
      const { error: instErr } = await sb.from("kitty_installments").insert(rows);
      if (instErr) return res.status(500).json({ ok: false, error: instErr.message, enrollment: data });
    }
    await logAudit(sb, { entityType: "enrollment", entityId: data.id, action: "create", actor: body.actor || body.recordedBy, details: { name, phone, legacySchemeName: body.legacySchemeName, isLegacy: true } });
    return res.status(200).json({ ok: true, enrollment: data });
  }

  // Actually performs a redemption — shared by the WA-code-verified flow
  // below (the normal path) and left available as a direct fallback. Works
  // from ANY status (active mid-cycle exit, or completed at natural end) —
  // marks the enrollment redeemed, waives any still-due installments (early
  // exit forfeits further collection AND completion-only perks like
  // Sparkle's making-charge discount — recorded via is_early_exit).
  async function performRedemption({ enrollmentId, redemptionType, itemDescription, value, notes, redeemedBy, actor }) {
    const { data: enrollmentBefore } = await sb.from("kitty_enrollments").select("status").eq("id", enrollmentId).maybeSingle();
    const isEarlyExit = enrollmentBefore?.status === "active";

    const { data: redemption, error } = await sb.from("kitty_redemptions").insert({
      tenant_id: TENANT_ID, enrollment_id: enrollmentId, redemption_type: redemptionType,
      item_description: itemDescription || null,
      value: value != null ? Number(value) : null,
      notes: notes || null, redeemed_by: redeemedBy || null, is_early_exit: isEarlyExit,
    }).select().single();
    if (error) return { ok: false, error: error.message };

    await sb.from("kitty_enrollments").update({ status: "redeemed", claim_status: "claimed", claimed_at: new Date().toISOString() }).eq("id", enrollmentId);
    await sb.from("kitty_installments").update({ status: "waived" }).eq("enrollment_id", enrollmentId).eq("status", "due");

    await logAudit(sb, { entityType: "enrollment", entityId: enrollmentId, action: "redeem", actor: actor || redeemedBy, details: { redemptionType, value, isEarlyExit } });
    return { ok: true, redemption, isEarlyExit };
  }

  // POST ?action=redeem-enrollment — staff. Body: { id, redemptionType,
  // itemDescription?, value?, notes?, redeemedBy }. Direct redemption with
  // no WA code verification — kept as a fallback (e.g. member has no phone
  // on file). Normal path is initiate-redeem / confirm-redeem below.
  if (req.method === "POST" && action === "redeem-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.redemptionType) return res.status(400).json({ ok: false, error: "id_redemptionType_required" });
    const result = await performRedemption({
      enrollmentId: body.id, redemptionType: body.redemptionType, itemDescription: body.itemDescription,
      value: body.value, notes: body.notes, redeemedBy: body.redeemedBy, actor: body.actor,
    });
    if (!result.ok) return res.status(500).json(result);
    return res.status(200).json(result);
  }

  // POST ?action=initiate-redeem — staff. Body: { id (enrollmentId),
  // redemptionType, itemDescription?, value?, notes? }. Sends the member a
  // WA message with a 6-digit code + what's being redeemed. Staff never
  // sees the code — the member reads it out in person to authenticate that
  // THEY actually requested this redemption, not just whoever has CRM
  // access. Code expires in 30 minutes.
  if (req.method === "POST" && action === "initiate-redeem") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.redemptionType) return res.status(400).json({ ok: false, error: "id_redemptionType_required" });

    const { data: enrollment } = await sb.from("kitty_enrollments")
      .select("id,lead_id,is_legacy,legacy_scheme_name,scheme:kitty_schemes(name)")
      .eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (!enrollment) return res.status(404).json({ ok: false, error: "not_found" });
    const { data: lead } = await sb.from("bullion_leads").select("phone,name").eq("id", enrollment.lead_id).maybeSingle();
    if (!lead?.phone) return res.status(400).json({ ok: false, error: "member_has_no_phone_on_file" });

    const code = String(crypto.randomInt(100000, 999999));
    const schemeName = enrollment.is_legacy ? enrollment.legacy_scheme_name : (enrollment.scheme?.name || "your Kitty");
    const amountLine = body.value ? `worth ₹${Number(body.value).toLocaleString("en-IN")}` : (body.itemDescription || "");

    const { error: codeErr } = await sb.from("kitty_redemption_codes").insert({
      tenant_id: TENANT_ID, enrollment_id: body.id, code_hash: hashCode(code),
      redemption_type: body.redemptionType, item_description: body.itemDescription || null,
      value: body.value != null ? Number(body.value) : null, notes: body.notes || null,
      initiated_by: body.actor || null, expires_at: new Date(Date.now() + REDEMPTION_CODE_TTL_MS).toISOString(),
    });
    if (codeErr) return res.status(500).json({ ok: false, error: codeErr.message });

    const msg = `🪙 You're redeeming your ${schemeName}${amountLine ? ` ${amountLine}` : ""}.\n\nTo confirm, share this code with our staff: *${code}*\n(Valid 30 minutes — don't share it with anyone else.)\n- Sun Sea Jewellers, Karol Bagh`;
    const wa = await sendWhatsApp({ phone: lead.phone, msg }).catch(() => ({ status: 0 }));
    if (wa.status !== 1) return res.status(500).json({ ok: false, error: "whatsapp_send_failed" });

    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "redeem-initiated", actor: body.actor, details: { redemptionType: body.redemptionType, value: body.value } });
    return res.status(200).json({ ok: true, codeSentTo: lead.phone });
  }

  // POST ?action=confirm-redeem — staff. Body: { id (enrollmentId), code,
  // redeemedBy }. Verifies the code the member read out, then actually
  // performs the redemption and sends them a thank-you WA message.
  if (req.method === "POST" && action === "confirm-redeem") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.code) return res.status(400).json({ ok: false, error: "id_code_required" });

    const { data: codeRow } = await sb.from("kitty_redemption_codes")
      .select("*").eq("tenant_id", TENANT_ID).eq("enrollment_id", body.id).is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!codeRow) return res.status(400).json({ ok: false, error: "no_pending_redemption_code" });
    if (new Date(codeRow.expires_at).getTime() < Date.now()) return res.status(400).json({ ok: false, error: "code_expired" });
    if (hashCode(String(body.code).trim()) !== codeRow.code_hash) return res.status(400).json({ ok: false, error: "code_mismatch" });

    const result = await performRedemption({
      enrollmentId: body.id, redemptionType: codeRow.redemption_type, itemDescription: codeRow.item_description,
      value: codeRow.value, notes: codeRow.notes, redeemedBy: body.redeemedBy || codeRow.initiated_by, actor: body.actor,
    });
    if (!result.ok) return res.status(500).json(result);

    await sb.from("kitty_redemption_codes").update({ consumed_at: new Date().toISOString() }).eq("id", codeRow.id);

    const { data: enrollment } = await sb.from("kitty_enrollments")
      .select("lead_id,is_legacy,legacy_scheme_name,scheme:kitty_schemes(name)").eq("id", body.id).maybeSingle();
    const { data: lead } = await sb.from("bullion_leads").select("phone").eq("id", enrollment?.lead_id).maybeSingle();
    if (lead?.phone) {
      const schemeName = enrollment.is_legacy ? enrollment.legacy_scheme_name : (enrollment.scheme?.name || "your Kitty");
      await sendWhatsApp({ phone: lead.phone, msg: `🙏 Thank you! Your ${schemeName} has been redeemed successfully.\n- Sun Sea Jewellers, Karol Bagh` }).catch(() => {});
    }

    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "redeem-confirmed", actor: body.actor || body.redeemedBy });
    return res.status(200).json(result);
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
    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "update-claim-status", actor: body.actor, details: { claimStatus: body.claimStatus } });
    return res.status(200).json({ ok: true, enrollment: data });
  }

  // POST ?action=update-enrollment — staff. Corrects an existing active
  // enrollment's start date (and/or notes). Shifting the start date
  // re-dates every still-'due' installment's due_date to match (month N's
  // due date = new start + N-1 months) — already-paid/free/waived rows are
  // left alone, since those are settled history, not something a start-date
  // correction should retroactively rewrite.
  if (req.method === "POST" && action === "update-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });

    const { data: before } = await sb.from("kitty_enrollments").select("*").eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (!before) return res.status(404).json({ ok: false, error: "not_found" });

    const patch = {};
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.startDate && body.startDate !== before.start_date) {
      patch.start_date = body.startDate;
      const { data: dueRows } = await sb.from("kitty_installments").select("id,month_number").eq("enrollment_id", body.id).eq("status", "due");
      for (const row of dueRows || []) {
        await sb.from("kitty_installments").update({ due_date: addMonths(body.startDate, row.month_number - 1) }).eq("id", row.id);
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "nothing_to_update" });

    const { data, error } = await sb.from("kitty_enrollments").update(patch).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "update", actor: body.actor, details: { before: { startDate: before.start_date, notes: before.notes }, after: patch } });
    return res.status(200).json({ ok: true, enrollment: data });
  }

  // POST ?action=change-scheme — staff. Corrects a wrongly-picked scheme on
  // an enrollment. Body: { id, newSchemeId, actor }. Only allowed while
  // nothing's actually been paid yet (no 'paid' installments) — once real
  // money has moved, cancel and re-enroll instead so payment history isn't
  // lost. Rebuilds the installment schedule from scratch under the new
  // scheme (old due/free rows deleted, new ones generated); reassigns a
  // lucky-draw batch if the new scheme uses one.
  if (req.method === "POST" && action === "change-scheme") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id || !body.newSchemeId) return res.status(400).json({ ok: false, error: "id_newSchemeId_required" });

    const { data: enrollment } = await sb.from("kitty_enrollments").select("*, scheme:kitty_schemes(*)").eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (!enrollment) return res.status(404).json({ ok: false, error: "not_found" });
    if (enrollment.is_legacy) return res.status(400).json({ ok: false, error: "cannot_change_scheme_on_legacy_enrollment" });

    const { data: paidRows } = await sb.from("kitty_installments").select("id").eq("enrollment_id", body.id).eq("status", "paid");
    if (paidRows?.length) return res.status(400).json({ ok: false, error: "has_paid_installments_cancel_and_reenroll_instead" });

    const { data: newScheme } = await sb.from("kitty_schemes").select("*").eq("tenant_id", TENANT_ID).eq("id", body.newSchemeId).maybeSingle();
    if (!newScheme) return res.status(400).json({ ok: false, error: "scheme_not_found" });
    const newPerks = newScheme.perks || {};

    await sb.from("kitty_installments").delete().eq("enrollment_id", body.id);

    let batchId = null;
    let scheduleStart = enrollment.start_date || new Date().toISOString().slice(0, 10);
    if (newPerks.lucky_draw) {
      let batch;
      try { batch = await getOrCreateOpenBatch(sb, newScheme, scheduleStart); }
      catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
      batchId = batch.id;
      scheduleStart = batch.start_date;
    }

    const patch = { scheme_id: newScheme.id, batch_id: batchId, monthly_amount_override: null, start_date: scheduleStart };
    const { data: updated, error: updErr } = await sb.from("kitty_enrollments").update(patch).eq("id", body.id).select().single();
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    let installmentsCreated = 0;
    if (newPerks.unit !== "grams" && newScheme.monthly_amount != null) {
      const rows = buildInstallmentSchedule({
        enrollmentId: body.id, scheduleStart, durationMonths: newScheme.duration_months,
        monthlyAmount: newScheme.monthly_amount, perks: newPerks, paidMonths: null,
      });
      const { error: insErr } = await sb.from("kitty_installments").insert(rows);
      if (insErr) return res.status(500).json({ ok: false, error: insErr.message, enrollment: updated });
      installmentsCreated = rows.length;
    }
    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "change-scheme", actor: body.actor, details: { fromSchemeId: enrollment.scheme_id, fromSchemeName: enrollment.scheme?.name, toSchemeId: newScheme.id, toSchemeName: newScheme.name } });
    return res.status(200).json({ ok: true, enrollment: updated, installmentsCreated });
  }

  // POST ?action=delete-enrollment — staff. Hard-deletes a genuine duplicate
  // entry (e.g. staff double-enrolled the same member by mistake). Body:
  // { id, actor }. Blocked if any installment is 'paid' — real money means
  // it's not a duplicate, use cancel-enrollment (soft) instead, which keeps
  // the record for the audit trail. Deletes installments + any pending
  // redemption codes first (FK children), then the enrollment row itself.
  if (req.method === "POST" && action === "delete-enrollment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });

    const { data: enrollment } = await sb.from("kitty_enrollments").select("*, scheme:kitty_schemes(name), lead:bullion_leads(name,phone)").eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (!enrollment) return res.status(404).json({ ok: false, error: "not_found" });

    const { data: paidRows } = await sb.from("kitty_installments").select("id").eq("enrollment_id", body.id).eq("status", "paid");
    if (paidRows?.length) return res.status(400).json({ ok: false, error: "has_paid_installments_cannot_delete_use_cancel" });

    await sb.from("kitty_redemption_codes").delete().eq("enrollment_id", body.id);
    await sb.from("kitty_installments").delete().eq("enrollment_id", body.id);
    const { error: delErr } = await sb.from("kitty_enrollments").delete().eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (delErr) return res.status(500).json({ ok: false, error: delErr.message });

    await logAudit(sb, { entityType: "enrollment", entityId: body.id, action: "delete", actor: body.actor, details: { name: enrollment.lead?.name, phone: enrollment.lead?.phone, schemeName: enrollment.is_legacy ? enrollment.legacy_scheme_name : enrollment.scheme?.name, note: "hard_delete_duplicate" } });
    return res.status(200).json({ ok: true });
  }

  // POST ?action=update-installment — staff. Corrects a single installment
  // row (amount, due date, status, paid amount/date, locked rate) after the
  // fact — e.g. a typo in an amount, or a status set wrong by mistake.
  if (req.method === "POST" && action === "update-installment") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });

    const { data: before } = await sb.from("kitty_installments").select("*").eq("tenant_id", TENANT_ID).eq("id", body.id).maybeSingle();
    if (!before) return res.status(404).json({ ok: false, error: "not_found" });

    const patch = {};
    if (body.amount != null) patch.amount = Number(body.amount);
    if (body.dueDate) patch.due_date = body.dueDate;
    if (body.status) patch.status = body.status;
    if (body.paidAmount != null) patch.paid_amount = Number(body.paidAmount);
    if (body.paidAt) patch.paid_at = body.paidAt;
    if (body.rateLocked != null) patch.rate_locked = Number(body.rateLocked);
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "nothing_to_update" });

    const { data, error } = await sb.from("kitty_installments").update(patch).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logAudit(sb, { entityType: "installment", entityId: body.id, action: "update", actor: body.actor, details: { before, after: patch } });
    return res.status(200).json({ ok: true, installment: data });
  }

  // GET ?action=admin-list-audit-log — staff. Query: entityType?, entityId?, limit? (default 200)
  if (req.method === "GET" && action === "admin-list-audit-log") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    let q = sb.from("kitty_audit_log").select("*").eq("tenant_id", TENANT_ID).order("created_at", { ascending: false }).limit(Number(req.query.limit) || 200);
    if (req.query.entityType) q = q.eq("entity_type", req.query.entityType);
    if (req.query.entityId) q = q.eq("entity_id", req.query.entityId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, log: data || [] });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
