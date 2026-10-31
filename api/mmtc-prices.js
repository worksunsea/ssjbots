// POST /api/mmtc-prices — daily MMTC-PAMP price refresh (10:00 IST).
//
// mmtcpamp.com blocks server-side requests (403), so the prices are read in a
// real Chrome tab by the scheduled task in scripts/mmtc-refresh/ and POSTed
// here from that page. This endpoint validates them and writes
// corporate_gifting_products.reference_price, which giftingPrice.js uses as a
// hard ceiling: our price may never exceed MMTC's listed price.
//
// Auth: header x-mmtc-token = first 32 hex of HMAC-SHA256(CRM_SECRET, "mmtc-refresh").
// Body: { prices: { "<MMTC title>": { price: number, soldOut?: boolean } } }
// Query: ?dry=1 validate only.

import crypto from "node:crypto";
import { supa } from "./_lib/supabase.js";
import { TENANT_ID, CRM_SECRET } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { MMTC_TITLES, RATIO_BAND, normKey } from "./_lib/mmtcMap.js";

export const config = { maxDuration: 60 };

export function refreshToken(secret) {
  return crypto.createHmac("sha256", secret).update("mmtc-refresh").digest("hex").slice(0, 32);
}

function rateFor(mode, spot) {
  return mode === "live_gold22_markup" ? spot.gold22kt : mode === "live_gold_markup" ? spot.gold24kt : spot.silverPerGram;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.mmtcpamp.com");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-mmtc-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
  if (!CRM_SECRET || req.headers["x-mmtc-token"] !== refreshToken(CRM_SECRET)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const scraped = req.body?.prices;
  if (!scraped || typeof scraped !== "object") return res.status(400).json({ ok: false, error: "no_prices" });
  const byKey = new Map();
  for (const [title, v] of Object.entries(scraped)) {
    const price = Number(v?.price);
    if (price > 0) byKey.set(normKey(title), price);
  }
  if (byKey.size < 30) return res.status(422).json({ ok: false, error: "too_few_prices", got: byKey.size });

  const sb = supa();
  const { data: rows, error } = await sb.from("corporate_gifting_products")
    .select("id, name, category, weight_grams, price_mode, reference_price")
    .eq("tenant_id", TENANT_ID).in("category", ["mmtc_gold", "mmtc_silver"]);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  const rates = await getRates();

  const updated = [], unmapped = [], missing = [], rejected = [];
  for (const r of rows) {
    const title = MMTC_TITLES[r.name];
    if (!title) { unmapped.push(r.name); continue; }
    const price = byKey.get(normKey(title));
    if (price == null) { missing.push(r.name); continue; }
    const rate = rateFor(r.price_mode, rates.spot);
    const [lo, hi] = RATIO_BAND[r.category];
    const ratio = rate && r.weight_grams ? price / (Number(r.weight_grams) * rate) : null;
    if (ratio != null && (ratio < lo || ratio > hi)) { rejected.push({ name: r.name, price, ratio: Number(ratio.toFixed(3)) }); continue; }
    updated.push({ id: r.id, name: r.name, from: r.reference_price, to: price });
  }

  if (req.query?.dry !== "1") {
    for (const u of updated) {
      if (Number(u.from) === u.to) continue;
      const { error: e } = await sb.from("corporate_gifting_products").update({ reference_price: u.to }).eq("id", u.id);
      if (e) return res.status(500).json({ ok: false, error: e.message, at: u.name });
    }
  }
  return res.status(200).json({
    ok: true, dry: req.query?.dry === "1", updated: updated.length,
    changed: updated.filter((u) => Number(u.from) !== u.to).length, unmapped, missing, rejected,
  });
}
