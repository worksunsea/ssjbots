// Thin Razorpay REST wrapper — no SDK dependency, just fetch + basic auth
// (key_id:key_secret), matching how the rest of this codebase calls
// external APIs (wa.js, ai.js). Powers Swarn Suraksha: one-time top-up
// orders and fixed-amount monthly auto-debit subscriptions.
//
// Every function throws if Razorpay isn't configured — callers must check
// razorpayConfigured() first and return a clean 400 instead of a 500.

import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from "./config.js";
import crypto from "crypto";

const BASE = "https://api.razorpay.com/v1";

export function razorpayConfigured() {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}

async function rzp(path, { method = "GET", body } = {}) {
  if (!razorpayConfigured()) throw new Error("razorpay_not_configured");
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || `razorpay_${res.status}`);
  return data;
}

// amountPaise must be a whole number (₹ × 100) — Razorpay works in paise.
export function createOrder({ amountPaise, receipt, notes }) {
  return rzp("/orders", { method: "POST", body: { amount: Math.round(amountPaise), currency: "INR", receipt, notes, payment_capture: 1 } });
}

export function createOrGetCustomer({ name, phone, email }) {
  // Razorpay dedupes customers by contact/email automatically and returns
  // the existing one with a 400 "Customer already exists" — surface its id
  // instead of failing, same pattern staff would expect from any upsert.
  return rzp("/customers", { method: "POST", body: { name, contact: phone, email, fail_existing: 0 } });
}

// Plans are cheap and Razorpay has no "find by amount" lookup — a fresh
// plan per subscription call is fine for this volume.
export function createPlan({ amountPaise, name }) {
  return rzp("/plans", { method: "POST", body: { period: "monthly", interval: 1, item: { name, amount: Math.round(amountPaise), currency: "INR" } } });
}

// startAt: unix seconds for the first charge. total_count: number of
// monthly charges before Razorpay auto-stops the mandate — capped to the
// scheme's remaining months so a subscription can never outlive the
// 11-month RBI window on its own.
export function createSubscription({ planId, customerId, totalCount, startAt }) {
  return rzp("/subscriptions", {
    method: "POST",
    body: { plan_id: planId, customer_id: customerId, total_count: totalCount, customer_notify: 1, start_at: startAt },
  });
}

export function cancelSubscription(subscriptionId) {
  return rzp(`/subscriptions/${subscriptionId}/cancel`, { method: "POST" });
}

// HMAC-SHA256 of the raw request body, keyed with the webhook secret —
// Razorpay's documented signature scheme. rawBody must be the exact bytes
// received, not a re-serialized JSON.parse'd object (whitespace differences
// would break the signature).
export function verifyWebhookSignature(rawBody, signature) {
  if (!RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
