// POST /api/order-form-scan
// Extracts structured field data from a photographed page of the Sun Sea
// Jewellers paper Order Form or Repair Form book via AI vision — the OCR
// step for fms-tracker's optional "scan the order book" feature. This is a
// human-confirms prefill, never a silent auto-save: fms-tracker always shows
// the extracted values in the normal job form for staff to review/edit
// before saving, same as vendor-card-scan.js does for vendor cards.
//
// Body: { formType: "order"|"repair", imageDataUrl }
//   imageDataUrl must be a base64 data: URI, not an http(s) URL — OpenAI's
//   fetch-by-URL path was unreliably 400ing ("unable to download content
//   before the timeout") on freshly-uploaded Supabase Storage public URLs,
//   so the caller sends image bytes inline instead of a URL for OpenAI to
//   go fetch itself.
// Returns: { ok:true, fields: {...}, missing: [string] }
//   "missing" lists operationally-critical fields the model found blank on
//   the paper — surfaced so the scanning staff member can chase them down
//   before the job is created, not just silently left empty.

import { askAI, parseBotJson } from "./_lib/ai.js";
import { checkCrmSecret } from "./_lib/config.js";

export const config = { maxDuration: 30 };

// Fields on each paper form judged operationally critical enough to flag
// if the AI reads them as blank — mirrors fms-tracker's required-field set.
const CRITICAL_FIELDS = {
  order: ["client_name", "contact_no", "item_name", "gold_wt", "exp_delivery_date", "gold_rate_type", "estimate_amount"],
  repair: ["customer_name", "phone", "item_name", "gross_wt", "delivery_date", "estimate_amount"],
};

const PROMPTS = {
  order: `Extract fields from this photo of a handwritten "Sun Sea Jewellers ORDER FORM" page as JSON:
{
  "client_id": string|null,
  "client_name": string|null,
  "contact_no": string|null,
  "address": string|null,
  "diamond_rate_per_ct": string|null,
  "cert_no": string|null,
  "diamond_quality": string|null,
  "old_gold_diamond_received": string|null,
  "stone_rate_per_ct": string|null,
  "advance_amt_rec": string|null,
  "gold_rate_if_advance_given": string|null,
  "estimate_amount": string|null,
  "sample_received": boolean|null,
  "sample_weight": string|null,
  "metal_type": "Gold"|"Silver"|"Mix"|null,
  "finish": "High"|"Matt"|"Mix"|null,
  "purity": string|null,
  "polish_checked": [string],
  "order_no": string|null,
  "item_name": string|null,
  "size": string|null,
  "gold_wt": string|null,
  "diamond_weight": string|null,
  "stone_weight": string|null,
  "vendor_code": string|null,
  "exp_delivery_date": string|null,
  "remark_description": string|null,
  "attended_by": string|null,
  "gold_rate_type": "Cut"|"Uncut"|null
}
- "purity": read the checked box among 14/18/9/22/Sil/Panch/Plat and return that raw label.
- "polish_checked": the paper has a grid of Polish checkboxes — "Full Gold", "Full White", "Rose Gold", "Mix" in one column and "Dia White", "Gerua", "Antique", "Ganga Yamuna" in another. List every box that is actually checked/ticked, exactly as printed. Empty array if none checked.
- "gold_rate_type": the form doesn't print this as a labelled checkbox but a "Gold Rate (If Advance Given)" line is filled only when the shop used an UNCUT/spot gold rate that day; if you see a separate "Cut gold rate" figure written anywhere, or any handwritten note saying "cut"/"uncut", use that — otherwise null (staff will fill this live, it is NOT guessable from the paper alone).
- Dates: return exactly as written (do not reformat or guess the year).
- Use null for anything not filled in / not legible. Do not invent data.`,
  repair: `Extract fields from this photo of a handwritten "Sun Sea Jewellers REPAIR FORM" page (top "REPAIR ISSUE" intake half only — ignore any "REPAIR RECEIVE" section at the bottom, that belongs to a later stage) as JSON:
{
  "repair_no": string|null,
  "customer_name": string|null,
  "phone": string|null,
  "address": string|null,
  "delivery_date": string|null,
  "no_of_items": string|null,
  "gross_wt": string|null,
  "item_name": string|null,
  "description": string|null,
  "work_types_checked": [string],
  "sol_cert_plotting": string|null,
  "extra_gold_given": string|null,
  "sample_ghat": string|null,
  "dia_wt": string|null,
  "dia_pc": string|null,
  "st_wt": string|null,
  "st_pc": string|null,
  "attended_by": string|null,
  "estimate_amount": string|null
}
- "work_types_checked": the form has a grid of ~15 work-type checkboxes (Wash/Cleaning, Resize, Reshape/Bend, Screw Tight, Screw Make, Dia Setting/Sto., Edge Sharp, Solder/Joint Repair, Redesign, Polki Cleaning, Mala Puvai, Full Gold, Full White, Rose Gold, Dia White). List every box that is actually checked/ticked, exactly as printed. Empty array if none checked.
- "estimate_amount" is usually NOT printed on this form (it's agreed with the client separately) — return null unless a rupee figure is actually handwritten near "Estimate" anywhere on the page.
- Dates: return exactly as written (do not reformat or guess the year).
- Use null for anything not filled in / not legible. Do not invent data.`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const authFail = checkCrmSecret(req, res);
  if (authFail) return authFail;

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { formType, imageDataUrl } = body;
  if (formType !== "order" && formType !== "repair") return res.status(400).json({ ok: false, error: "formType_must_be_order_or_repair" });
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) return res.status(400).json({ ok: false, error: "imageDataUrl_required" });

  const system = "You extract structured field data from a photographed handwritten jewellery-shop paper form. Respond with ONLY a JSON object, no prose, no markdown fences.";
  // "high" detail sends the image at full resolution in tiles instead of downsampling
  // to ~512px — same setting vendor-card-scan.js uses, needed to read small handwriting.
  const content = [
    { type: "text", text: PROMPTS[formType] },
    { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
  ];

  try {
    const { text } = await askAI({ system, messages: [{ role: "user", content }], maxTokens: 1200 });
    const parsed = parseBotJson(text);
    if (!parsed) return res.status(502).json({ ok: false, error: "ai_no_parseable_json" });
    const missing = (CRITICAL_FIELDS[formType] || []).filter(k => parsed[k] === null || parsed[k] === undefined || parsed[k] === "" || (Array.isArray(parsed[k]) && parsed[k].length === 0));
    return res.status(200).json({ ok: true, fields: parsed, missing });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
