// POST /api/razorpay-webhook — Razorpay calls this directly (no session,
// no CRM secret; authenticity comes entirely from the HMAC signature in
// X-Razorpay-Signature, keyed with RAZORPAY_WEBHOOK_SECRET). Configure
// this URL + the same secret in the Razorpay Dashboard → Webhooks once the
// merchant account exists; until RAZORPAY_WEBHOOK_SECRET is set every
// request here 400s harmlessly.
//
// bodyParser is disabled so we can verify the signature against the exact
// raw bytes Razorpay signed — re-serializing a parsed JSON object can
// produce different bytes (whitespace/key order) and silently break
// verification.
//
// Handles:
//   payment.captured      — a Swarn Suraksha top-up order was paid. Finds
//                            the awaiting_payment installment by order_id,
//                            marks it paid.
//   subscription.charged  — a monthly auto-debit fired. Finds the
//                            enrollment by subscription_id, rolls it to a
//                            fresh cycle first if the 11-month freeze has
//                            passed, then records the payment as a new
//                            installment at that day's gold rate.
// Idempotent via the unique index on kitty_installments.razorpay_payment_id
// — a retried webhook delivery is a harmless no-op.

import { supa } from "./_lib/supabase.js";
import { TENANT_ID, OWNER_ALERT_PHONE } from "./_lib/config.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { verifyWebhookSignature } from "./_lib/razorpay.js";
import { getSwarnScheme, gramsPurchasedTodayByLead, ensureUnfrozenEnrollment } from "./_lib/swarnSuraksha.js";
import { getRates } from "./_lib/rates.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-razorpay-signature"] || "";
  if (!verifyWebhookSignature(rawBody, signature)) return res.status(400).json({ ok: false, error: "invalid_signature" });

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }

  const sb = supa();
  const event = payload.event;

  try {
    if (event === "payment.captured") {
      const payment = payload.payload?.payment?.entity;
      if (!payment?.order_id) return res.status(200).json({ ok: true, ignored: "no_order_id" });

      const { data: installment } = await sb.from("kitty_installments")
        .select("*, enrollment:kitty_enrollments(id,lead_id,scheme_id)")
        .eq("tenant_id", TENANT_ID).eq("razorpay_order_id", payment.order_id).eq("status", "awaiting_payment").maybeSingle();
      if (!installment) return res.status(200).json({ ok: true, ignored: "no_matching_installment" });

      const { error } = await sb.from("kitty_installments").update({
        status: "paid", paid_amount: payment.amount / 100, paid_at: new Date().toISOString(),
        razorpay_payment_id: payment.id, payment_method: "razorpay",
      }).eq("id", installment.id);
      // Unique-index violation on razorpay_payment_id means a retried
      // delivery already processed this payment — treat as success, not error.
      if (error && !String(error.message || "").includes("duplicate")) return res.status(500).json({ ok: false, error: error.message });

      await logKittyAudit({ entityType: "installment", entityId: installment.id, action: "razorpay_topup_paid", actor: "system:razorpay_webhook", details: { paymentId: payment.id, amount: payment.amount / 100 } });

      // Race guard: two top-up orders placed back-to-back could both land
      // under the cap individually but exceed it together by the time both
      // capture. Can't un-charge a captured payment — flag for manual
      // reconciliation instead of silently over-crediting gold.
      const scheme = await getSwarnScheme(sb);
      if (scheme && installment.enrollment) {
        const totalToday = await gramsPurchasedTodayByLead(sb, installment.enrollment.lead_id, installment.enrollment.scheme_id);
        const capG = scheme.perks?.daily_gram_cap_g || 10;
        if (totalToday > capG && OWNER_ALERT_PHONE) {
          await sendWhatsApp({ phone: OWNER_ALERT_PHONE, msg: `⚠️ Swarn Suraksha: lead ${installment.enrollment.lead_id} bought ${totalToday.toFixed(3)}g today — over the ${capG}g/day cap (concurrent orders). Review in Kitty Admin.` }).catch(() => {});
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (event === "subscription.charged") {
      const subscriptionId = payload.payload?.subscription?.entity?.id;
      const payment = payload.payload?.payment?.entity;
      if (!subscriptionId || !payment) return res.status(200).json({ ok: true, ignored: "missing_subscription_or_payment" });

      const { data: enrollment } = await sb.from("kitty_enrollments").select("*").eq("tenant_id", TENANT_ID).eq("razorpay_subscription_id", subscriptionId).maybeSingle();
      if (!enrollment) return res.status(200).json({ ok: true, ignored: "no_matching_enrollment" });

      const scheme = await getSwarnScheme(sb);
      const target = scheme ? await ensureUnfrozenEnrollment(sb, enrollment, scheme) : enrollment;
      if (target.id !== enrollment.id) {
        // Rolled to a new cycle — carry the subscription id forward so
        // future charges keep matching straight to the new enrollment.
        await sb.from("kitty_enrollments").update({ razorpay_subscription_id: subscriptionId }).eq("id", target.id);
        await sb.from("kitty_enrollments").update({ razorpay_subscription_id: null }).eq("id", enrollment.id);
      }

      const rates = await getRates();
      const ratePerGram = rates?.spot?.gold24kt || null;
      const amount = payment.amount / 100;

      const { data: nextMonthRow } = await sb.from("kitty_installments").select("month_number").eq("enrollment_id", target.id).order("month_number", { ascending: false }).limit(1);
      const nextMonth = (nextMonthRow?.[0]?.month_number || 0) + 1;

      const { error } = await sb.from("kitty_installments").insert({
        tenant_id: TENANT_ID, enrollment_id: target.id, month_number: nextMonth, due_date: new Date().toISOString().slice(0, 10),
        amount, status: "paid", paid_amount: amount, paid_at: new Date().toISOString(),
        rate_locked: ratePerGram, grams_purchased: ratePerGram ? Math.round((amount / ratePerGram) * 1000) / 1000 : null,
        source: "subscription", razorpay_payment_id: payment.id, payment_method: "razorpay",
      });
      if (error && !String(error.message || "").includes("duplicate")) return res.status(500).json({ ok: false, error: error.message });

      await logKittyAudit({ entityType: "enrollment", entityId: target.id, action: "razorpay_subscription_charged", actor: "system:razorpay_webhook", details: { paymentId: payment.id, amount } });
      return res.status(200).json({ ok: true });
    }

    if (event === "subscription.cancelled" || event === "subscription.completed") {
      const subscriptionId = payload.payload?.subscription?.entity?.id;
      if (subscriptionId) await sb.from("kitty_enrollments").update({ razorpay_subscription_id: null }).eq("tenant_id", TENANT_ID).eq("razorpay_subscription_id", subscriptionId);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: event || "unknown_event" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
