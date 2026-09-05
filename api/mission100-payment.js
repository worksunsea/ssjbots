// /api/mission100-payment — client-session gated (Authorization: Bearer
// <token from api/client-auth>), CORS open. Powers Mission 100's online
// self-pay flow: quote a purchase, create a Razorpay order for it. This is
// the ONE place Mission 100 asks for login — browsing/joining/starting a
// group stays fully anonymous elsewhere (api/mission100.js) — because real
// payment requires knowing who's receiving the gold.
//
// No daily cap, no subscription/auto-debit here (unlike Swarn Suraksha) —
// Mission 100 purchases are one-off top-ups at whatever coin size the
// member picks (1/2/5/10g), any time.
//
// payment.captured is handled by the EXISTING api/razorpay-webhook.js with
// zero changes — it already matches any kitty_installments row by
// razorpay_order_id/status:'awaiting_payment', with no scheme-specific
// filtering in that path.

import { supa } from "./_lib/supabase.js";
import { requireClientSession } from "./_lib/clientAuth.js";
import { TENANT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { razorpayConfigured, createOrder } from "./_lib/razorpay.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireClientSession(req, res);
  if (!session) return;

  const sb = supa();
  const action = req.query?.action;

  // GET ?action=quote&grams=<n> — live rate × grams, no cap.
  if (req.method === "GET" && action === "quote") {
    const grams = Number(req.query.grams);
    if (!grams || grams <= 0) return res.status(400).json({ ok: false, error: "grams_required" });
    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });
    const amount = Math.round(grams * ratePerGram * 100) / 100;
    return res.status(200).json({ ok: true, ratePerGram, amount });
  }

  // POST ?action=create-order — body { enrollmentId, grams }.
  if (req.method === "POST" && action === "create-order") {
    if (!razorpayConfigured()) return res.status(400).json({ ok: false, error: "razorpay_not_configured" });
    const body = req.body || {};
    const grams = Number(body.grams);
    if (!body.enrollmentId || !grams || grams <= 0) return res.status(400).json({ ok: false, error: "enrollmentId_grams_required" });

    const { data: enrollment } = await sb.from("kitty_enrollments")
      .select("*, scheme:kitty_schemes(perks)").eq("tenant_id", TENANT_ID).eq("id", body.enrollmentId).eq("lead_id", session.leadId).maybeSingle();
    if (!enrollment) return res.status(404).json({ ok: false, error: "enrollment_not_found" });
    if (!enrollment.scheme?.perks?.mission100) return res.status(400).json({ ok: false, error: "not_a_mission100_enrollment" });

    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });

    // Never trust a client-sent amount — always re-derive from the live
    // rate server-side, same rule api/kitty-payment.js follows.
    const amount = Math.round(grams * ratePerGram * 100) / 100;
    const amountPaise = Math.round(amount * 100);

    let order;
    try {
      order = await createOrder({ amountPaise, receipt: `mission100-${enrollment.id}-${Date.now()}`, notes: { enrollmentId: enrollment.id, leadId: session.leadId, grams } });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }

    const { data: nextMonthRow } = await sb.from("kitty_installments").select("month_number").eq("enrollment_id", enrollment.id).order("month_number", { ascending: false }).limit(1);
    const nextMonth = (nextMonthRow?.[0]?.month_number || 0) + 1;

    const { data: installment, error } = await sb.from("kitty_installments").insert({
      tenant_id: TENANT_ID, enrollment_id: enrollment.id, month_number: nextMonth, due_date: todayIST(),
      amount, status: "awaiting_payment", rate_locked: ratePerGram, grams_purchased: grams,
      source: "online_self_pay", razorpay_order_id: order.id,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    await logKittyAudit({ entityType: "installment", entityId: installment.id, action: "mission100_order_created", actor: session.phone, details: { enrollmentId: enrollment.id, grams, amount } });

    return res.status(200).json({ ok: true, orderId: order.id, amountPaise, razorpayKeyId: process.env.RAZORPAY_KEY_ID || "", enrollmentId: enrollment.id, installmentId: installment.id });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
