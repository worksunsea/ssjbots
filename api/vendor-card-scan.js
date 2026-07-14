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
//   vendor_kind: "jewellery"|"service"|"other", // coarse classification — same read, no extra scan
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
  "other_notes": [string],
  "vendor_kind": "jewellery"|"service"|"other"
}
- "contacts": business cards VERY OFTEN list MORE THAN ONE person — e.g. an owner and a manager, or two partners — each with their own name and mobile number, sometimes printed on separate lines, in different corners, in a smaller font below the main name, or on the back of the card. Before answering, deliberately scan the ENTIRE image line by line (not just the most prominent name) and list EVERY distinct name+phone pair you find — do not stop after the first one. Phone digits only where possible.
- "address": capture the COMPLETE address exactly as printed — building/shop number, street/road name, area or locality, landmark if any, city, state, and PIN code. Do NOT shorten this to just a city name (e.g. "Mumbai") if more detail is printed on the card — read every address line present, including ones wrapping onto a second line or printed in a smaller font near the bottom.
- "deals_in_text": if the card explicitly states what the company deals in / trades in / manufactures, put that raw text here.
- "other_notes": any other text on the card that doesn't map to a field above (tagline, certifications, additional addresses, etc.) — one string per distinct piece of info.
- "vendor_kind": classify the business based on everything on the card — "jewellery" if they deal in gold/silver/diamonds/gemstones/findings/jewellery manufacturing/polishing/setting or similar jewellery-trade goods; "service" if they supply packaging, boxes, pouches, display equipment, cleaning chemicals, machinery, or other non-jewellery supplies/services to a jewellery business; "other" if genuinely unclear or unrelated. Best-effort guess from the card content — do not ask for clarification.
- Use null (or empty array) for anything not present. Do not invent data.`;

  // "low" detail downsamples the image to ~512px before the model ever
  // sees it — plenty for a single bold name, but it was almost certainly
  // why a second (smaller-print) contact and full address lines were
  // getting missed. "high" sends the image at full resolution in tiles.
  const content = [{ type: "text", text: promptText }];
  if (frontUrl) content.push({ type: "image_url", image_url: { url: frontUrl, detail: "high" } });
  if (backUrl) content.push({ type: "image_url", image_url: { url: backUrl, detail: "high" } });

  try {
    const { text } = await askAI({ system, messages: [{ role: "user", content }], maxTokens: 700 });
    const parsed = parseBotJson(text);
    if (!parsed) return res.status(502).json({ ok: false, error: "ai_no_parseable_json" });
    return res.status(200).json({ ok: true, fields: parsed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
