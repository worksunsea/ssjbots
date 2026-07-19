// OpenAI gpt-image-1 wrapper for corporate-gifting branded packaging mockups.
// Uses the images/edits endpoint with TWO reference images: (1) a real photo
// of Sun Sea's actual fixed box + card (same size/shape for every order —
// only the branding plate print changes), and (2) the customer's logo.
// The prompt instructs the model to keep the box's exact shape, size, and
// card/coin-slot layout from image 1, and only swap the branding-plate
// print / accent color per style variant, inserting image 2 into the plate.

import sharp from "sharp";
import { OPENAI_API_KEY } from "./config.js";

// Real product packaging photo (open box + card + closed box) — same
// physical box for every corporate-gifting order, per Saurav 2026-07-19.
// Re-hosted on our own storage — jewelflix's CDN 403s server-side fetches
// (hotlink protection blocks datacenter IPs regardless of headers sent).
const BOX_REFERENCE_URL = "https://uppyxzellmuissdlxsmy.supabase.co/storage/v1/object/public/media/uploads/corporate-gifting/logos/95c99e18-a9b2-4284-a66b-b886a1550ab1/1784464401952.webp";

const STYLE_VARIANTS = [
  { label: "Classic Maroon & Gold", prompt: "keep the exact maroon/burgundy box color and gold arch pattern shown in the reference photo" },
  { label: "Minimal Elegant", prompt: "recolor the box to a minimal elegant matte white and gold, same arch pattern style, understated and premium" },
  { label: "Festive Bright", prompt: "recolor the box to a festive deep red and bright gold, celebratory feel, same arch pattern style" },
  { label: "Modern Bold", prompt: "recolor the box to a modern bold black and gold, same arch pattern style, clean and premium" },
];

async function fetchAsBase64(url) {
  // jewelflix's CDN 403s plain server-to-server fetches (hotlink protection) —
  // it only serves images to requests that look like they came from a
  // browser on their own site.
  const res = await fetch(url, {
    headers: {
      Referer: "https://www.shaguncoins.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/png";
  return { base64: buf.toString("base64"), contentType };
}

function extFor(contentType) {
  return contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
}

// Deterministic watermark — AI-rendered text is unreliable (garbled fine
// print), so "Sun Sea Jewellers" is composited on afterward as real text,
// not asked for in the generation prompt.
async function addWatermark(pngBuffer) {
  const width = 1024;
  const svg = `
    <svg width="${width}" height="60" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="60" fill="black" fill-opacity="0.32" />
      <text x="${width - 16}" y="38" text-anchor="end" font-family="Georgia, serif" font-size="26"
        font-style="italic" fill="white" fill-opacity="0.92">Sun Sea Jewellers</text>
    </svg>`;
  const watermark = Buffer.from(svg);
  return sharp(pngBuffer)
    .composite([{ input: watermark, gravity: "south" }])
    .png()
    .toBuffer();
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
      `Plain neutral studio background, soft shadow, square 1:1 composition. Do not add any watermark or extra text beyond what's specified above — one will be added separately.`,
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
    const watermarked = await addWatermark(Buffer.from(b64, "base64"));
    return { label: variant.label, base64: watermarked.toString("base64") };
  }));

  return results;
}
