// GET  /api/rates                    — public, live gold/silver rates for
//        ssj-website's client-facing RatesPage. Reuses api/_lib/rates.js
//        (same parsed shape + 60s cache the WA bot uses).
// POST /api/rates?action=subscribe   — { phone, name? } daily-rate signup.
//        Tags the lead extra_fields.daily_rate_subscriber: true so it's
//        visible in the CRM, and submits into the same Google Form
//        ("Gold Price Update") the manual signups already feed, so the
//        existing daily WA broadcast tool enrolls them with no staff step.

import { getRates } from "./_lib/rates.js";
import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";

// Entry IDs scraped from the live form's FB_PUBLIC_LOAD_DATA_ — brittle if
// the form is edited (fields added/removed/reordered); re-scrape if signups
// stop appearing in the sheet.
const GOLD_PRICE_FORM_ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSfkAUG8-3Ljtre88DjCh2sG6ewT7MciVlwgM03mqsjRJY69eA/formResponse";
const GOLD_PRICE_FORM_ENTRIES = { name: "entry.1791059630", mobile: "entry.2131913468" };

async function submitToGoldPriceForm(name, phone) {
  const params = new URLSearchParams();
  params.set(GOLD_PRICE_FORM_ENTRIES.name, name || phone);
  params.set(GOLD_PRICE_FORM_ENTRIES.mobile, phone.replace(/^\+?91/, "").slice(-10));
  await fetch(GOLD_PRICE_FORM_ACTION, { method: "POST", body: params }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST" && req.query.action === "subscribe") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const phone = normalizePhone(body.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
    const name = String(body.name || "").trim().slice(0, 100);

    const sb = supa();
    const { data: existing } = await sb.from("bullion_leads")
      .select("id, extra_fields").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

    if (existing) {
      await sb.from("bullion_leads").update({
        ...(name ? { name } : {}),
        extra_fields: { ...(existing.extra_fields || {}), daily_rate_subscriber: true },
      }).eq("id", existing.id);
    } else {
      const { error } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID,
        phone,
        name: name || null,
        source: "ssj_website_rate_subscribe",
        status: "new",
        stage: "greeting",
        extra_fields: { daily_rate_subscriber: true },
      });
      if (error) return res.status(500).json({ ok: false, error: error.message });
    }
    await submitToGoldPriceForm(name, phone);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const rates = await getRates();
  return res.status(200).json({ ok: true, rates });
}
