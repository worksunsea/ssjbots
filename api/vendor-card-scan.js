// POST /api/vendor-card-scan
// Extracts structured contact details from photographed supplier business
// card image(s) via AI vision. Images are already uploaded to Supabase
// storage client-side (secureImageUpload) before this endpoint is called —
// this endpoint only receives the resulting public URL(s), never raw files.
//
// Body: { frontUrl, backUrl? }
// Returns: { fields: {
//   company_name, email, address, website, gstin,
//   contacts: [{name, phone, designation}],   // one card can list 2-3 people
//   deals_in_text,                            // free text if the card says what they deal in
//   other_notes: [string],                    // any other card text that doesn't fit a field above
// } }

import { askAI, parseBotJson } from "./_lib/ai.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { frontUrl, backUrl } = body;
  if (!frontUrl && !backUrl) return res.status(400).json({ ok: false, error: "frontUrl_or_backUrl_required" });

  const system = "You extract structured contact details from photographed business card image(s) — front and possibly back of the same card. Respond with ONLY a JSON object, no prose, no markdown fences.";
  const promptText = `Extract fields from ${backUrl ? "these business card images (front and back of the same card)" : "this business card image"} as JSON:
{
  "company_name": string|null,
  "email": string|null,
  "address": string|null,
  "website": string|null,
  "gstin": string|null,
  "contacts": [{"name": string, "phone": string, "designation": string|null}],
  "deals_in_text": string|null,
  "other_notes": [string]
}
- "contacts": the card may list MORE THAN ONE person/number — include every distinct name+phone pair found. Phone digits only where possible.
- "deals_in_text": if the card explicitly states what the company deals in / trades in / manufactures, put that raw text here.
- "other_notes": any other text on the card that doesn't map to a field above (tagline, certifications, additional addresses, etc.) — one string per distinct piece of info.
- Use null (or empty array) for anything not present. Do not invent data.`;

  const content = [{ type: "text", text: promptText }];
  if (frontUrl) content.push({ type: "image_url", image_url: { url: frontUrl, detail: "low" } });
  if (backUrl) content.push({ type: "image_url", image_url: { url: backUrl, detail: "low" } });

  try {
    const { text } = await askAI({ system, messages: [{ role: "user", content }], maxTokens: 700 });
    const parsed = parseBotJson(text);
    if (!parsed) return res.status(502).json({ ok: false, error: "ai_no_parseable_json" });
    return res.status(200).json({ ok: true, fields: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
