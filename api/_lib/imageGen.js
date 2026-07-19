// OpenAI gpt-image-1 wrapper for corporate-gifting branded packaging mockups.
// Uses the images/edits endpoint with the customer's logo as the sole
// reference image (no mask) — gpt-image-1 treats this as a style/content
// reference and generates a new scene incorporating it, rather than
// literally painting over the uploaded file.

import { OPENAI_API_KEY } from "./config.js";

const STYLE_VARIANTS = [
  { label: "Classic Red & Gold", prompt: "a premium red velvet gift box with gold trim and ribbon, lid open, the branding plate on the box showing the attached logo exactly as given" },
  { label: "Minimal Elegant", prompt: "a minimal elegant matte white and gold gift box, understated and premium, the branding plate showing the attached logo exactly as given" },
  { label: "Festive Bright", prompt: "a festive bright gift box with warm gold and deep maroon accents, celebratory feel, the branding plate showing the attached logo exactly as given" },
  { label: "Modern Bold", prompt: "a modern bold black and gold gift box with clean geometric lines, the branding plate showing the attached logo exactly as given" },
];

async function fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/png";
  return { base64: buf.toString("base64"), contentType };
}

// Returns [{ label, base64 }] — 4 generated PNG images (base64, no data: prefix).
export async function generateBrandedDesigns({ logoUrl, color, customText }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const logo = await fetchAsBase64(logoUrl);
  const ext = logo.contentType.includes("png") ? "png" : logo.contentType.includes("webp") ? "webp" : "jpg";

  const results = await Promise.all(STYLE_VARIANTS.map(async (variant) => {
    const prompt = [
      `Generate a photorealistic product mockup of ${variant.prompt} for a corporate gold/silver coin gift, for a jewellery brand called Sun Sea Jewellers.`,
      color ? `Primary accent color to lean into: ${color}.` : "",
      customText ? `Include this text engraved or printed on the box/card: "${customText}".` : "",
      `Add a small, tasteful "Sun Sea Jewellers" watermark in one corner of the image — this is a preview mockup, not the final product.`,
      `Plain neutral studio background, soft shadow, square 1:1 composition.`,
    ].filter(Boolean).join(" ");

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    form.append("image", new Blob([Buffer.from(logo.base64, "base64")], { type: logo.contentType }), `logo.${ext}`);

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI images/edits ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image returned");
    return { label: variant.label, base64: b64 };
  }));

  return results;
}
