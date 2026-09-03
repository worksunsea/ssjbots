// /api/kitty-payment — client-session gated (Authorization: Bearer <token
// from api/client-auth>), CORS open for ssj-website. Powers the Swarn
// Suraksha self-serve flow: enroll, quote a top-up, create a Razorpay
// order for a top-up, and set up/cancel an auto-debit subscription
// (daily, weekly, fortnightly, or monthly — client's choice).
// Actual money only moves once RAZORPAY_KEY_ID/SECRET are configured —
// every action below fails cleanly with razorpay_not_configured until then.
//
// Every amount/rate is re-derived server-side from live rates + DB state —
// never trust a client-sent amount for anything that creates a real order.

import { supa } from "./_lib/supabase.js";
import { requireClientSession } from "./_lib/clientAuth.js";
import { TENANT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { razorpayConfigured, createOrder, createOrGetCustomer, createPlan, createSubscription, cancelSubscription } from "./_lib/razorpay.js";
import { getSwarnScheme, gramsPurchasedTodayByLead, ensureUnfrozenEnrollment } from "./_lib/swarnSuraksha.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";

const RAZORPAY_KEY_ID_PUBLIC = process.env.RAZORPAY_KEY_ID || "";

// Razorpay has no native "fortnightly" period — built from period="daily",
// interval=15. days is used to size total_count against the scheme's
// remaining 11-month window.
const FREQUENCIES = {
  daily: { period: "daily", interval: 1, days: 1, label: "Daily" },
  weekly: { period: "weekly", interval: 1, days: 7, label: "Weekly" },
  fortnightly: { period: "daily", interval: 15, days: 15, label: "Every 15 days" },
  monthly: { period: "monthly", interval: 1, days: 30, label: "Monthly" },
};

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

async function loadEnrollment(sb, enrollmentId, leadId) {
  const { data } = await sb.from("kitty_enrollments").select("*").eq("tenant_id", TENANT_ID).eq("id", enrollmentId).eq("lead_id", leadId).maybeSingle();
  return data;
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

  const scheme = await getSwarnScheme(sb);
  if (!scheme) return res.status(500).json({ ok: false, error: "scheme_not_configured" });

  // POST ?action=enroll — idempotent. Returns the lead's live (non-frozen)
  // Swarn Suraksha enrollment, creating one if they don't have one yet.
  if (req.method === "POST" && action === "enroll") {
    const { data: existing } = await sb.from("kitty_enrollments")
      .select("*").eq("tenant_id", TENANT_ID).eq("lead_id", session.leadId).eq("scheme_id", scheme.id)
      .is("frozen_at", null).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, enrollment: existing });

    const { data: created, error } = await sb.from("kitty_enrollments").insert({
      tenant_id: TENANT_ID, lead_id: session.leadId, scheme_id: scheme.id, status: "active", start_date: todayIST(),
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    await logKittyAudit({ entityType: "enrollment", entityId: created.id, action: "self_enroll", actor: session.phone, details: { scheme: scheme.name } });
    return res.status(200).json({ ok: true, enrollment: created });
  }

  // GET ?action=quote&enrollmentId=&grams= — live rate + remaining daily cap.
  if (req.method === "GET" && action === "quote") {
    const grams = Number(req.query.grams);
    if (!grams || grams <= 0) return res.status(400).json({ ok: false, error: "grams_required" });
    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });

    const alreadyToday = await gramsPurchasedTodayByLead(sb, session.leadId, scheme.id);
    const capG = scheme.perks?.daily_gram_cap_g || 10;
    const remainingG = Math.max(0, capG - alreadyToday);
    if (grams > remainingG) return res.status(200).json({ ok: true, ratePerGram, alreadyPurchasedTodayG: alreadyToday, remainingTodayG: remainingG, exceedsCap: true });

    const amount = Math.round(grams * ratePerGram * 100) / 100;
    return res.status(200).json({ ok: true, ratePerGram, amount, alreadyPurchasedTodayG: alreadyToday, remainingTodayG: remainingG, exceedsCap: false });
  }

  // POST ?action=create-topup-order — body { enrollmentId, grams }.
  if (req.method === "POST" && action === "create-topup-order") {
    if (!razorpayConfigured()) return res.status(400).json({ ok: false, error: "razorpay_not_configured" });
    const body = req.body || {};
    const grams = Number(body.grams);
    if (!body.enrollmentId || !grams || grams <= 0) return res.status(400).json({ ok: false, error: "enrollmentId_grams_required" });

    let enrollment = await loadEnrollment(sb, body.enrollmentId, session.leadId);
    if (!enrollment) return res.status(404).json({ ok: false, error: "enrollment_not_found" });
    enrollment = await ensureUnfrozenEnrollment(sb, enrollment, scheme);

    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });

    const capG = scheme.perks?.daily_gram_cap_g || 10;
    const alreadyToday = await gramsPurchasedTodayByLead(sb, session.leadId, scheme.id);
    if (alreadyToday + grams > capG) {
      return res.status(400).json({ ok: false, error: "daily_cap_exceeded", alreadyPurchasedTodayG: alreadyToday, capG });
    }

    const amount = Math.round(grams * ratePerGram * 100) / 100;
    const amountPaise = Math.round(amount * 100);

    let order;
    try {
      order = await createOrder({ amountPaise, receipt: `swarn-${enrollment.id}-${Date.now()}`, notes: { enrollmentId: enrollment.id, leadId: session.leadId, grams } });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }

    const { data: nextMonthRow } = await sb.from("kitty_installments").select("month_number").eq("enrollment_id", enrollment.id).order("month_number", { ascending: false }).limit(1);
    const nextMonth = (nextMonthRow?.[0]?.month_number || 0) + 1;

    const { data: installment, error } = await sb.from("kitty_installments").insert({
      tenant_id: TENANT_ID, enrollment_id: enrollment.id, month_number: nextMonth, due_date: todayIST(),
      amount, status: "awaiting_payment", rate_locked: ratePerGram, grams_purchased: grams,
      source: "topup", razorpay_order_id: order.id,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, orderId: order.id, amountPaise, razorpayKeyId: RAZORPAY_KEY_ID_PUBLIC, enrollmentId: enrollment.id, installmentId: installment.id });
  }

  // POST ?action=create-subscription — body { enrollmentId, amount, frequency }.
  // frequency: daily | weekly | fortnightly | monthly. amount is the fixed
  // per-charge amount at that cadence, chosen at signup (min ₹100 — no
  // forced ₹5,000-multiple rule here since daily/weekly contributions are
  // naturally small; that rule is specific to the older fixed-monthly
  // schemes). Cancels any existing live subscription on the enrollment
  // first — one active mandate at a time.
  if (req.method === "POST" && action === "create-subscription") {
    if (!razorpayConfigured()) return res.status(400).json({ ok: false, error: "razorpay_not_configured" });
    const body = req.body || {};
    const amount = Number(body.amount);
    const freq = FREQUENCIES[body.frequency];
    if (!body.enrollmentId || !amount || amount < 100 || !freq) {
      return res.status(400).json({ ok: false, error: "enrollmentId_amount_min100_and_valid_frequency_required", validFrequencies: Object.keys(FREQUENCIES) });
    }

    let enrollment = await loadEnrollment(sb, body.enrollmentId, session.leadId);
    if (!enrollment) return res.status(404).json({ ok: false, error: "enrollment_not_found" });
    enrollment = await ensureUnfrozenEnrollment(sb, enrollment, scheme);

    const { data: lead } = await sb.from("bullion_leads").select("name,phone").eq("id", session.leadId).maybeSingle();

    try {
      let customerId = enrollment.razorpay_customer_id;
      if (!customerId) {
        const customer = await createOrGetCustomer({ name: lead?.name || "Sun Sea Jewellers client", phone: session.phone });
        customerId = customer.id;
      }
      const plan = await createPlan({ amountPaise: amount * 100, name: `${scheme.name} — ₹${amount} ${freq.label}`, period: freq.period, interval: freq.interval });

      // Cap total charges to whatever's left of the 11-month window from
      // this enrollment's own start date, at this cadence's charge
      // frequency, so the mandate can never outlive the RBI freeze point
      // on its own.
      const maxDays = (scheme.perks?.max_duration_months || 11) * 30;
      const daysElapsed = Math.max(0, Math.floor((Date.now() - new Date(`${enrollment.start_date}T00:00:00Z`).getTime()) / 86400000));
      const totalCount = Math.max(1, Math.ceil((maxDays - daysElapsed) / freq.days));
      const startAt = Math.floor(Date.now() / 1000) + 86400; // tomorrow — Razorpay requires start_at in the future

      if (enrollment.razorpay_subscription_id) {
        await cancelSubscription(enrollment.razorpay_subscription_id).catch(() => {});
      }
      const subscription = await createSubscription({ planId: plan.id, customerId, totalCount, startAt });

      await sb.from("kitty_enrollments").update({
        razorpay_customer_id: customerId, razorpay_subscription_id: subscription.id, monthly_amount_override: amount, swarn_frequency: body.frequency,
      }).eq("id", enrollment.id);
      await logKittyAudit({ entityType: "enrollment", entityId: enrollment.id, action: "subscription_created", actor: session.phone, details: { amount, frequency: body.frequency, subscriptionId: subscription.id } });

      return res.status(200).json({ ok: true, subscriptionId: subscription.id, shortUrl: subscription.short_url, enrollmentId: enrollment.id });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }
  }

  // POST ?action=cancel-subscription — body { enrollmentId }.
  if (req.method === "POST" && action === "cancel-subscription") {
    const body = req.body || {};
    const enrollment = await loadEnrollment(sb, body.enrollmentId, session.leadId);
    if (!enrollment) return res.status(404).json({ ok: false, error: "enrollment_not_found" });
    if (!enrollment.razorpay_subscription_id) return res.status(400).json({ ok: false, error: "no_active_subscription" });

    try {
      await cancelSubscription(enrollment.razorpay_subscription_id);
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }
    await sb.from("kitty_enrollments").update({ razorpay_subscription_id: null }).eq("id", enrollment.id);
    await logKittyAudit({ entityType: "enrollment", entityId: enrollment.id, action: "subscription_cancelled", actor: session.phone });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
