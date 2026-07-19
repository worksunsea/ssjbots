// OpenAI gpt-image-1 wrapper for corporate-gifting branded packaging mockups.
// Uses the images/edits endpoint with TWO reference images: (1) a real photo
// of Sun Sea's actual fixed box + card (same size/shape for every order —
// only the branding plate print changes), and (2) the customer's logo.
// The prompt instructs the model to keep the box's exact shape, size, and
// card/coin-slot layout from image 1, and only swap the branding-plate
// print / accent color per style variant, inserting image 2 into the plate.

import { OPENAI_API_KEY } from "./config.js";

// Real product packaging photo (open box + card + closed box) — same
// physical box for every corporate-gifting order, per Saurav 2026-07-19.
const BOX_REFERENCE_URL = "https://img.jewelflix.com/indigo-prints4170/products/jkgtvet5t6ujnars0xex";

const STYLE_VARIANTS = [
  { label: "Classic Maroon & Gold", prompt: "keep the exact maroon/burgundy box color and gold arch pattern shown in the reference photo" },
  { label: "Minimal Elegant", prompt: "recolor the box to a minimal elegant matte white and gold, same arch pattern style, understated and premium" },
  { label: "Festive Bright", prompt: "recolor the box to a festive deep red and bright gold, celebratory feel, same arch pattern style" },
  { label: "Modern Bold", prompt: "recolor the box to a modern bold black and gold, same arch pattern style, clean and premium" },
];

async function fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/png";
  return { base64: buf.toString("base64"), contentType };
}

function extFor(contentType) {
  return contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
}

// Returns [{ label, base64 }] — 4 generated PNG images (base64, no data: prefix).
export async function generateBrandedDesigns({ logoUrl, color, customText }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const [boxRef, logo] = await Promise.all([fetchAsBase64(BOX_REFERENCE_URL), fetchAsBase64(logoUrl)]);

  const results = await Promise.all(STYLE_VARIANTS.map(async (variant) => {
    const prompt = [
      `Reference image 1 is Sun Sea Jewellers' actual coin gift box and card — its exact size, shape, box structure (flip-top lid, curved arch print), and the card/coin-slot layout inside must be preserved EXACTLY. Do not change the box shape, size, or layout in any way.`,
      `Reference image 2 is the customer's company logo.`,
      `Task: ${variant.prompt}. Replace the blank rectangular branding plate on the box lid (and the corresponding spot on the card) with reference image 2's logo, rendered cleanly and legibly, same placement and size as the blank plate in reference image 1.`,
      color ? `Lean the accent color toward: ${color}.` : "",
      customText ? `Also print this text near the logo on the box/card: "${customText}".` : "",
      `Show both the open box (with card and coin visible) and the closed box, matching reference image 1's composition.`,
      `Add a small, tasteful "Sun Sea Jewellers" watermark in one corner — this is a preview mockup, not the final product.`,
      `Plain neutral studio background, soft shadow, square 1:1 composition.`,
    ].filter(Boolean).join(" ");

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    form.append("image[]", new Blob([Buffer.from(boxRef.base64, "base64")], { type: boxRef.contentType }), `box.${extFor(boxRef.contentType)}`);
    form.append("image[]", new Blob([Buffer.from(logo.base64, "base64")], { type: logo.contentType }), `logo.${extFor(logo.contentType)}`);

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
