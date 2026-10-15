// POST /api/contact-card-scan
// Reads a photo of a handwritten Sun Sea Jewellers "Client Details Card" (the A5
// paper form from tools/make-client-form.mjs) via AI vision and returns the
// values in CRM format. Human-confirms step: the CRM shows the result for staff
// to correct, and only then saves it through /api/contact-update — nothing is
// written here.
//
// Body: { imageDataUrl }  (base64 data: URI, same reason as order-form-scan.js)
// Returns: { ok:true, fields, family, referrals, warnings }

import { askAI, parseBotJson } from "./_lib/ai.js";
import { checkCrmSecret } from "./_lib/config.js";
import { sanitizeCardFields } from "./_lib/cardScan.js";

export const config = { maxDuration: 60 };

const PROMPT = `Extract the handwritten fields from this photo of a "Sun Sea Jewellers CLIENT DETAILS CARD" as JSON:
{
  "name": string|null,
  "phone": string|null,
  "email": string|null,
  "bday": string|null,
  "anniversary": string|null,
  "address_house": string|null,
  "address_locality": string|null,
  "city": string|null,
  "address_state": string|null,
  "address_pincode": string|null,
  "family": [ { "relationship": string, "name": string|null, "dob": string|null, "mobile": string|null } ],
  "referrals": [ { "name": string|null, "phone": string|null } ]
}
- The form has one letter per box for mobile, pincode and dates. Join the boxes into one value; keep dates as DD/MM/YYYY or DD/MM exactly as written.
- "family" is the 6-row table (Relation, Name, Birthday, Mobile). Include only rows where something is written. Keep the relation word as written.
- "referrals" is the "Gift a friend" section (friend's name, friend's mobile).
- Ignore the printed labels and the "For office use" strip.
- Use null for anything blank or illegible. Do not invent or guess digits.`;

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
  const imageDataUrl = body?.imageDataUrl;
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return res.status(400).json({ ok: false, error: "imageDataUrl_required" });
  }

  const system = "You extract structured field data from a photographed handwritten jewellery-shop paper form. Respond with ONLY a JSON object, no prose, no markdown fences.";
  const content = [
    { type: "text", text: PROMPT },
    { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
  ];

  try {
    const { text } = await askAI({ system, messages: [{ role: "user", content }], maxTokens: 1500 });
    const parsed = parseBotJson(text);
    if (!parsed) return res.status(502).json({ ok: false, error: "ai_no_parseable_json" });
    return res.status(200).json({ ok: true, ...sanitizeCardFields(parsed) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
