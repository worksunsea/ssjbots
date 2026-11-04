// POST /api/mmtc-prices — daily MMTC-PAMP price refresh (10:00 IST).
//
// mmtcpamp.com blocks server-side requests (403), so the prices are read in a
// real Chrome tab by the scheduled task in scripts/mmtc-refresh/ and POSTed
// here from that page. This endpoint validates them and writes
// corporate_gifting_products.reference_price. Our price is NOT capped at it any
// more (it follows live rates all day); instead, after each refresh, admins get
// a WhatsApp listing coins priced above MMTC's listed price.
//
// Auth: header x-mmtc-token = first 32 hex of HMAC-SHA256(CRM_SECRET, "mmtc-refresh").
// Body: { prices: { "<MMTC title>": { price: number, soldOut?: boolean } } }
// Query: ?dry=1 validate only.

import crypto from "node:crypto";
import { supa } from "./_lib/supabase.js";
import { TENANT_ID, CRM_SECRET, OWNER_PHONE, DIGEST_EXTRA_RECIPIENTS, WA_SESSION_CLIENT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { computePrice } from "./_lib/giftingPrice.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { MMTC_TITLES, RATIO_BAND, normKey } from "./_lib/mmtcMap.js";

export const config = { maxDuration: 60 };

export function refreshToken(secret) {
  return crypto.createHmac("sha256", secret).update("mmtc-refresh").digest("hex").slice(0, 32);
}

function rateFor(mode, spot) {
  return mode === "live_gold22_markup" ? spot.gold22kt : mode === "live_gold_markup" ? spot.gold24kt : spot.silverPerGram;
}

// Coins whose live price (our rates + making + GST) is above the MMTC price just read.
async function findAboveMmtc(sb, rates, updated) {
  if (!updated.length) return [];
  const mmtcById = new Map(updated.map((u) => [u.id, u.to]));
  const { data, error } = await sb.from("corporate_gifting_products")
    .select("*").eq("tenant_id", TENANT_ID).in("id", [...mmtcById.keys()]);
  if (error) return [];
  const out = [];
  for (const p of data || []) {
    const ours = computePrice(p, rates);
    const mmtc = mmtcById.get(p.id);
    if (ours != null && mmtc > 0 && ours > mmtc) out.push({ name: p.name, ours, mmtc, diff: ours - mmtc });
  }
  return out.sort((a, b) => b.diff - a.diff);
}

async function alertAdmins(above) {
  const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
  const shown = above.slice(0, 15).map((a) => `• ${a.name}: ours ${inr(a.ours)} vs MMTC ${inr(a.mmtc)} (+${inr(a.diff)})`);
  const more = above.length > shown.length ? `\n…and ${above.length - shown.length} more` : "";
  const msg = `⚠️ MMTC morning check: ${above.length} coin(s) on ssj.in are priced ABOVE MMTC's listed price.\n\n${shown.join("\n")}${more}\n\nAdjust "price adjustment" in CRM → Corp Gifting Pricing if needed.`;
  const phones = [OWNER_PHONE, ...String(DIGEST_EXTRA_RECIPIENTS || "").split(",")].map((p) => p.trim()).filter(Boolean);
  const results = await Promise.all([...new Set(phones)].map((phone) =>
    sendWhatsApp({ phone, msg, client: WA_SESSION_CLIENT_ID }).then(() => true).catch(() => false)));
  return results.some(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.mmtcpamp.com");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-mmtc-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  // mmtcpamp.com's CSP blocks cross-site fetches, so the runner stores
  // {token, prices} in window.name, navigates the tab here, and this page
  // (same origin as the API) does the POST and shows the result.
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><title>MMTC ingest</title><body><pre id="r">working...</pre><script>
(async()=>{const r=document.getElementById("r");let p;try{p=JSON.parse(window.name)}catch(e){r.textContent="RESULT "+JSON.stringify({ok:false,error:"no_payload"});return}
window.name="";try{const x=await fetch(location.pathname+(p.dry?"?dry=1":""),{method:"POST",headers:{"Content-Type":"application/json","x-mmtc-token":p.token},body:JSON.stringify({prices:p.prices})});
r.textContent="RESULT "+JSON.stringify({status:x.status,...(await x.json())})}catch(e){r.textContent="RESULT "+JSON.stringify({ok:false,error:String(e)})}})();
</script>`);
  }
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

  // Our price is no longer capped at MMTC's. Tell the admins which coins are priced above MMTC today.
  const above = await findAboveMmtc(sb, rates, updated);
  let alerted = false;
  if (req.query?.dry !== "1" && above.length) alerted = await alertAdmins(above);

  return res.status(200).json({
    ok: true, dry: req.query?.dry === "1", updated: updated.length,
    changed: updated.filter((u) => Number(u.from) !== u.to).length, unmapped, missing, rejected,
    aboveMmtc: above.length, alerted,
  });
}
