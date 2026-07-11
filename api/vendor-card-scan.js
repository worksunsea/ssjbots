// POST /api/vendor-card-scan
// Extracts structured contact details from a photographed supplier business
// card via AI vision. The image is already uploaded to Supabase storage
// client-side (secureImageUpload) before this endpoint is called — this
// endpoint only receives the resulting public URL, never the raw file.
//
// Body: { imageUrl }
// Returns: { fields: {company_name, contact_person, designation, phone, email, address, website, gstin} }

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
  const { imageUrl } = body;
  if (!imageUrl) return res.status(400).json({ ok: false, error: "imageUrl_required" });

  const system = "You extract structured contact details from a photographed business card image. Respond with ONLY a JSON object, no prose, no markdown fences.";
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: "Extract the following fields from this business card image as JSON: {company_name, contact_person, designation, phone, email, address, website, gstin}. Use null for any field not present on the card. Phone should be digits only where possible." },
      { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
    ],
  }];

  try {
    const { text } = await askAI({ system, messages, maxTokens: 400 });
    const parsed = parseBotJson(text);
    if (!parsed) return res.status(502).json({ ok: false, error: "ai_no_parseable_json" });
    return res.status(200).json({ ok: true, fields: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
