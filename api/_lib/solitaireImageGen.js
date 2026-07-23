// OpenAI gpt-image-1 wrapper for the solitaire jewellery designer's admin-only
// AI Design Generator. Given a design concept (from solitaire_designs) plus
// admin-picked filters (gold colour, diamond shape, optional carat size), it
// generates one image set: front view, 3/4 angle view, and a "worn by a
// model" shot. Mirrors the structure of generateBrandedDesigns() in
// imageGen.js (same provider) — uses text-to-image generation by default
// (no fixed physical reference photo), but switches to images/edits with the
// admin-supplied reference image when one is provided, same as imageGen.js's
// box-photo pattern.

import { OPENAI_API_KEY } from "./config.js";

const VIEWS = [
  { key: "front", label: "Front view", prompt: "a straight-on front product photo, studio lighting, plain neutral background, the jewellery piece centered and in sharp focus" },
  { key: "angle", label: "3/4 angle view", prompt: "a 3/4 angle product photo showing depth and the side profile of the setting, studio lighting, plain neutral background" },
  { key: "worn", label: "Worn by model", prompt: "the same jewellery piece worn by an elegant model in a soft-lit lifestyle photo, hand/ear/neck as appropriate to the jewellery type, natural skin tone, tasteful close-up crop, luxury editorial feel" },
];

const CATEGORY_WEAR_AREA = {
  ring: "worn on a model's hand, finger prominently shown",
  gents_ring: "worn on a man's hand, finger prominently shown",
  pendant: "worn on a model's neck on a fine chain",
  earring: "worn as a matching pair on a model's ear",
};

function buildPrompt({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view, hasReference }) {
  const parts = [
    `Fine jewellery product photography of a solitaire ${category.replace("_", " ")}: ${promptOverride ? promptOverride : conceptPrompt}.`,
    promptOverride && conceptPrompt ? `Base design direction: ${conceptPrompt}.` : "",
    `Center stone: a ${diamondShape}-cut diamond${caratSize ? `, approximately ${caratSize} carat` : ""}, brilliant and clear, realistic proportions for the setting.`,
    `Metal: polished ${goldColor} gold.`,
    hasSideDiamonds ? "Includes smaller pave or accent side diamonds as described in the design." : "No side diamonds — the center stone is the sole diamond.",
    hasReference ? "Use the attached reference image as the style/composition guide — match its framing and lighting approach, but render OUR jewellery design as described above, not the reference piece itself." : "",
    view.key === "worn" ? `Shot ${CATEGORY_WEAR_AREA[category] || "worn by a model"}.` : "Shown as a standalone product shot, not worn.",
    view.prompt,
    "Photorealistic, high-end jewellery catalogue quality, square 1:1 composition. No text or watermark in the image.",
  ];
  return parts.filter(Boolean).join(" ");
}

async function generateOne(prompt, referenceImageBase64, size = "1024x1024") {
  if (!referenceImageBase64) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size, quality: "medium" }),
    });
    if (!res.ok) throw new Error(`OpenAI images/generations ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data?.data?.[0]?.b64_json || null;
  }

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", "medium");
  form.append("image[]", new Blob([Buffer.from(referenceImageBase64, "base64")], { type: "image/png" }), "reference.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI images/edits ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.data?.[0]?.b64_json || null;
}

// Returns [{ key, label, base64, prompt }] — one image per VIEWS entry.
export async function generateSolitaireDesignViews({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, referenceImageBase64 }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const results = await Promise.all(VIEWS.map(async (view) => {
    const prompt = buildPrompt({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view, hasReference: !!referenceImageBase64 });
    const b64 = await generateOne(prompt, referenceImageBase64);
    if (!b64) throw new Error(`no image returned for view "${view.key}"`);
    return { key: view.key, label: view.label, base64: b64, prompt };
  }));

  return results;
}

// One attractive editorial hero shot per category, used for the public
// landing page's category-picker tiles (not a design variant).
const CATEGORY_COVER_PROMPTS = {
  ring: "Elegant luxury jewellery photograph of a single solitaire diamond engagement ring on a woman's hand, soft natural light, warm cream and gold tones, shallow depth of field, editorial fine-jewellery catalogue style, minimal negative space on one side for text overlay, no text or watermark in the image.",
  gents_ring: "Elegant luxury jewellery photograph of a bold solitaire diamond men's ring on a man's hand resting on dark textured fabric, warm gold tones, dramatic soft studio lighting, masculine editorial fine-jewellery catalogue style, no text or watermark in the image.",
  pendant: "Elegant luxury jewellery photograph of a delicate solitaire diamond pendant necklace resting on a woman's collarbone, soft warm light, cream and gold tones, shallow depth of field, editorial fine-jewellery catalogue style, no text or watermark in the image.",
  earring: "Elegant luxury jewellery photograph of a pair of solitaire diamond stud earrings on a woman's ear, soft side profile, warm natural light, cream and gold tones, shallow depth of field, editorial fine-jewellery catalogue style, no text or watermark in the image.",
};

// Returns { base64 } for one category cover image.
export async function generateCategoryCoverImage(category) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const prompt = CATEGORY_COVER_PROMPTS[category];
  if (!prompt) throw new Error(`unknown category "${category}"`);
  const b64 = await generateOne(prompt, null);
  if (!b64) throw new Error("no image returned");
  return { base64: b64 };
}

// Carat sizes shown in the one-image size-comparison chart — .30ct to 5ct
// only (Saurav's request): beyond 5ct the relative-size illustration stops
// being useful/realistic in a single frame, and the full 20-size list
// (up to 12ct) would be illegible crammed into one image anyway.
export const SIZE_CHART_CARATS = [0.30, 0.50, 0.70, 0.90, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5];

// One wide reference image per DESIGN (not per gold-colour/shape variant)
// showing the same setting repeated with diamonds from .30ct to 5ct side by
// side, each labelled, so the size progression is visible in a single photo.
export async function generateSizeChartImage({ conceptPrompt, category, hasSideDiamonds }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const caratList = SIZE_CHART_CARATS.join(", ");
  const prompt = [
    `A single wide jewellery-catalogue comparison photograph, ${SIZE_CHART_CARATS.length} identical solitaire ${category.replace("_", " ")} settings arranged in one evenly-spaced horizontal row on a plain neutral studio background.`,
    `Every setting is the SAME design: ${conceptPrompt}.`,
    hasSideDiamonds ? "Each includes the same smaller pave/accent side diamonds as described." : "No side diamonds on any of them — only the center stone.",
    `Polished yellow gold metal, consistent for every piece in the row.`,
    `Each setting holds a round brilliant center diamond, with the diamond size increasing left to right through this exact carat progression: ${caratList} carat — the size difference between each piece MUST be clearly visible and proportionally accurate (a 5 carat stone should look dramatically larger than a 0.30 carat stone, not just slightly bigger).`,
    `A small, elegant carat-weight label (e.g. "0.30ct", "1.00ct", "5.00ct") is printed directly beneath each piece in the row, in a clean serif font.`,
    `Even studio lighting across the whole row, sharp focus, photorealistic, high-end jewellery catalogue quality, landscape composition. No watermark, no other text besides the carat labels.`,
  ].filter(Boolean).join(" ");
  const b64 = await generateOne(prompt, null, "1536x1024");
  if (!b64) throw new Error("no image returned");
  return { base64: b64 };
}
