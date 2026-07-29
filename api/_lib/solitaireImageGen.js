// Image-gen wrapper for the solitaire jewellery designer's admin-only AI
// Design Generator, supporting two interchangeable providers — pick per
// generation via `provider: "openai" | "fal"` (defaults to "fal"; see the
// "AI image provider" dropdown next to the quality selector in the admin
// screen). Given a design concept (from solitaire_designs) plus admin-picked
// filters (gold colour, diamond shape, optional carat size), generates one
// image set: front view, 3/4 angle view, and a "worn by a model" shot.
//
// fal.ai: flux-pro/v1.1 for text-to-image, flux-pro/kontext (image-to-image,
// reference as a data URI) for reference-based edits.
// OpenAI: gpt-image-1 images/generations, or images/edits when a reference
// image is supplied. Being retired by OpenAI on 2026-10-23 — kept available
// here for cost comparison only, not the default.
//
// Name/concept suggestion (text + vision, not image generation) always use
// OpenAI regardless of this setting — see suggestDesignName /
// suggestDesignVariationConcept below.

import { OPENAI_API_KEY, OPENAI_MODEL, FAL_KEY } from "./config.js";

const FAL_TEXT_TO_IMAGE_MODEL = "fal-ai/flux-pro/v1.1";
const FAL_IMAGE_EDIT_MODEL = "fal-ai/flux-pro/kontext";

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

// Real-world round-brilliant diameter estimate (mm) for a given carat weight —
// diameter scales roughly with the cube root of weight. Same fix as the size
// chart: without a concrete mm anchor, the model tends to render "a big
// diamond" as exaggerated fantasy-scale rather than the actual physical size.
const mmForCarat = (ct) => (6.5 * Math.cbrt(ct)).toFixed(1);

function buildPrompt({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view, hasReference, matchReferenceDesign }) {
  const parts = [
    `Fine jewellery product photography of a solitaire ${category.replace("_", " ")}: ${promptOverride ? promptOverride : conceptPrompt}.`,
    promptOverride && conceptPrompt ? `Base design direction: ${conceptPrompt}.` : "",
    `Center stone: a ${diamondShape}-cut diamond${caratSize ? `, ${caratSize} carat (approximately ${mmForCarat(caratSize)}mm across — keep the stone THIS real-world size relative to the band/setting, not exaggerated)` : ""}, brilliant and clear, realistic proportions for the setting.`,
    `Metal: polished ${goldColor} gold.`,
    hasSideDiamonds ? "Includes smaller pave or accent side diamonds as described in the design." : "No side diamonds — the center stone is the sole diamond.",
    hasReference
      ? (matchReferenceDesign
        ? "The attached reference image IS this exact jewellery design (same setting, band shape/width, prong style, and overall silhouette) — reproduce it as faithfully as possible, changing ONLY the gold colour and center diamond shape/size to match the instructions above. Do not redesign the setting or invent a different style."
        : "Use the attached reference image as the style/composition guide — match its framing and lighting approach, but render OUR jewellery design as described above, not the reference piece itself.")
      : "",
    view.key === "worn" ? `Shot ${CATEGORY_WEAR_AREA[category] || "worn by a model"}.` : "Shown as a standalone product shot, not worn.",
    view.prompt,
    "Photorealistic, high-end jewellery catalogue quality, square 1:1 composition. No text or watermark in the image.",
  ];
  return parts.filter(Boolean).join(" ");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "WxH" string (as used throughout this file) -> fal's {width,height} image_size object.
// quality scales the actual pixel count (fal has no separate quality tier —
// this is the real cost lever, same role OpenAI's quality param played):
// low ~0.56MP, medium = requested size (~1MP for 1024x1024), high ~1.5x that.
function falImageSize(sizeStr, quality) {
  const [w, h] = sizeStr.split("x").map(Number);
  const scale = quality === "low" ? 0.75 : quality === "high" ? 1.25 : 1;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function callFalOnce(prompt, referenceImageBase64, imageSize) {
  const model = referenceImageBase64 ? FAL_IMAGE_EDIT_MODEL : FAL_TEXT_TO_IMAGE_MODEL;
  const body = referenceImageBase64
    ? { prompt, image_url: `data:image/png;base64,${referenceImageBase64}`, output_format: "png" }
    : { prompt, image_size: imageSize, output_format: "png" };
  return fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callOpenAIOnce(prompt, referenceImageBase64, size, quality) {
  if (!referenceImageBase64) {
    return fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size, quality }),
    });
  }
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("image[]", new Blob([Buffer.from(referenceImageBase64, "base64")], { type: "image/png" }), "reference.png");
  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
}

// Retries on 429 (rate limit) with backoff — a full cascade fires dozens of
// these back to back and can hit per-minute image-generation limits; without
// a retry, a rate limit on combo #1 fails EVERY subsequent combo the same
// way since nothing ever waits for the window to clear.
async function generateOne(prompt, referenceImageBase64, size = "1024x1024", quality = "medium", provider = "fal") {
  if (provider === "openai") {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await callOpenAIOnce(prompt, referenceImageBase64, size, quality);
      if (res.ok) {
        const data = await res.json();
        return data?.data?.[0]?.b64_json || null;
      }
      const body = (await res.text()).slice(0, 300);
      lastErr = new Error(`OpenAI ${referenceImageBase64 ? "images/edits" : "images/generations"} ${res.status}: ${body}`);
      if (res.status !== 429 || attempt === 3) throw lastErr;
      await sleep(3000 * 2 ** attempt); // 3s, 6s, 12s
    }
    throw lastErr;
  }

  if (!FAL_KEY) throw new Error("FAL_KEY missing");
  const model = referenceImageBase64 ? FAL_IMAGE_EDIT_MODEL : FAL_TEXT_TO_IMAGE_MODEL;
  const imageSize = falImageSize(size, quality);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await callFalOnce(prompt, referenceImageBase64, imageSize);
    if (res.ok) {
      const data = await res.json();
      const url = data?.images?.[0]?.url;
      if (!url) return null;
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`fal image download ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    }
    const body = (await res.text()).slice(0, 300);
    lastErr = new Error(`fal ${model} ${res.status}: ${body}`);
    if (res.status !== 429 || attempt === 3) throw lastErr;
    await sleep(3000 * 2 ** attempt); // 3s, 6s, 12s
  }
  throw lastErr;
}

// Returns [{ key, label, base64, prompt }] — one image per view generated.
// Sequential, not Promise.all — firing views concurrently per variant (x
// however many variants a cascade queues) is exactly what was tripping
// OpenAI's per-minute image rate limit; one at a time trades a little
// latency for actually completing instead of failing every combo.
//
// includeWorn: the "worn by a model" shot is the priciest to skip on scale —
// pass true only for the one variant an admin deliberately reviews by hand
// (manual "Generate Variant" / "Generate Another Version"); cascade-filled
// combos default to front+angle only (2 images instead of 3).
// viewKeys: explicit override — e.g. ["front"] for a cheap preview batch
// (see action=generate-variant's "Create Variants" bulk-preview flow) where
// only a front shot is needed to pick a favourite before committing to the
// full multi-view/multi-combo cost.
// quality: "low" | "medium" | "high" — the real cost lever (fal scales pixel
// count, OpenAI has a native quality param). Admin-configurable, see
// pricing-config's imageQuality; defaults to "low" here only as a safety net.
// provider: "fal" | "openai" — admin-configurable, see pricing-config's
// imageProvider; defaults to "fal".
export async function generateSolitaireDesignViews({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, referenceImageBase64, matchReferenceDesign = false, includeWorn = true, viewKeys, quality = "low", provider = "fal" }) {
  if (provider === "openai" ? !OPENAI_API_KEY : !FAL_KEY) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "FAL_KEY"} missing`);

  const views = viewKeys ? VIEWS.filter((v) => viewKeys.includes(v.key)) : (includeWorn ? VIEWS : VIEWS.filter((v) => v.key !== "worn"));
  const results = [];
  for (const view of views) {
    const prompt = buildPrompt({ conceptPrompt, promptOverride, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view, hasReference: !!referenceImageBase64, matchReferenceDesign });
    const b64 = await generateOne(prompt, referenceImageBase64, "1024x1024", quality, provider);
    if (!b64) throw new Error(`no image returned for view "${view.key}"`);
    results.push({ key: view.key, label: view.label, base64: b64, prompt });
  }
  return results;
}

// Suggests a nice product name by looking at the ACTUAL generated front-view
// image (not just the text prompt) — cheap vision call on a small text
// model, admin reviews/edits the suggestion before it's saved (see
// action=suggest-design-name / action=update-design).
export async function suggestDesignName({ imageUrl, category, conceptPrompt }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  // Fetch the image ourselves and send it as a base64 data URI rather than
  // handing OpenAI the raw Supabase Storage URL — OpenAI's own server-side
  // fetch of that URL was timing out ("Timeout while downloading ...front.png"),
  // even though the URL is perfectly reachable from here. Embedding the
  // bytes directly removes that extra network hop from OpenAI's side.
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`couldn't fetch the design image (${imgRes.status})`);
  const contentType = imgRes.headers.get("content-type") || "image/png";
  const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const dataUri = `data:${contentType};base64,${b64}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Look at this solitaire ${category.replace("_", " ")} jewellery photo and suggest ONE short, elegant product name for it (3-5 words, jewellery-catalogue style, e.g. "Classic Solitaire Ring" or "Royal Halo Pendant" — no quotes, no punctuation, no explanation, just the name). Design direction it was generated from: ${conceptPrompt}` },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      }],
      max_tokens: 20,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat/completions ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const name = data?.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "");
  if (!name) throw new Error("no name suggested");
  return name;
}

// Generates a genuinely DIFFERENT design concept in the same category,
// loosely inspired by an existing one — used to spin up new sibling
// designs (e.g. "Classic Solitaire Ring 2") for the admin to review as
// distinct products, not alternate renders of the same design.
export async function suggestDesignVariationConcept({ baseConceptPrompt, category }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{
        role: "user",
        content: `You design fine jewellery. Here is an existing solitaire ${category.replace("_", " ")} design concept: "${baseConceptPrompt}". Invent ONE genuinely DIFFERENT solitaire ${category.replace("_", " ")} design in the same general spirit (similar quality tier and formality) but with a clearly distinct setting style, band treatment, or silhouette — not just a minor tweak. Write it as a single descriptive sentence, the same style as the example (style direction for an AI image generator, no marketing fluff, no product name). Reply with ONLY that sentence.`,
      }],
      max_tokens: 100,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat/completions ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const concept = data?.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "");
  if (!concept) throw new Error("no concept suggested");
  return concept;
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
export async function generateCategoryCoverImage(category, provider = "fal") {
  if (provider === "openai" ? !OPENAI_API_KEY : !FAL_KEY) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "FAL_KEY"} missing`);
  const prompt = CATEGORY_COVER_PROMPTS[category];
  if (!prompt) throw new Error(`unknown category "${category}"`);
  const b64 = await generateOne(prompt, null, "1024x1024", "medium", provider);
  if (!b64) throw new Error("no image returned");
  return { base64: b64 };
}

// Carat sizes shown in the one-image size-comparison chart — .30ct to 5ct
// only (Saurav's request): beyond 5ct the relative-size illustration stops
// being useful/realistic in a single frame, and the full 20-size list
// (up to 12ct) would be illegible crammed into one image anyway.
export const SIZE_CHART_CARATS = [0.30, 0.50, 0.70, 0.90, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5];

// Real round-brilliant diameters (mm) at each carat weight — standard GIA-ish
// reference. Earlier prompt just said "dramatically larger", which pushed
// the model toward exaggerated fantasy-scale stones (a 5ct read as a golf
// ball, not the ~11mm stone it actually is). Anchoring each size to its real
// mm diameter keeps the whole chart proportionally honest.
const CARAT_MM = { 0.30: 4.4, 0.50: 5.2, 0.70: 5.7, 0.90: 6.2, 1: 6.5, 1.5: 7.4, 2: 8.2, 3: 9.4, 3.5: 9.7, 4: 10.4, 4.5: 10.8, 5: 11.0 };
const rowLabel = (row) => row.map((c) => `${c}ct (~${CARAT_MM[c]}mm diameter)`).join(", ");

// One wide reference image per DESIGN (not per gold-colour/shape variant)
// showing the same setting repeated with diamonds from .30ct to 5ct side by
// side, each labelled, so the size progression is visible in a single photo.
// Laid out as a 2-row x 6-column grid (not one long row) — a single row of
// 12 distinct pieces was where the model was merging/dropping sizes.
export async function generateSizeChartImage({ conceptPrompt, category, hasSideDiamonds, quality = "low", provider = "fal" }) {
  if (provider === "openai" ? !OPENAI_API_KEY : !FAL_KEY) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "FAL_KEY"} missing`);
  const topRow = SIZE_CHART_CARATS.slice(0, 6);
  const bottomRow = SIZE_CHART_CARATS.slice(6);
  const prompt = [
    `A single jewellery-catalogue size-comparison chart image, laid out as a clean 2-row x 6-column grid — exactly 12 separate photographs of the same solitaire ${category.replace("_", " ")} setting, one per grid cell, each shot as a straight-on FRONT VIEW product photo only (no angled/3-4 view, no "worn by a model" shot, no hands, no people — product-only front-facing shots on a plain neutral studio background for every single cell).`,
    `Every one of the 12 pieces is the exact SAME design: ${conceptPrompt}.`,
    hasSideDiamonds ? "Each includes the same smaller pave/accent side diamonds as described." : "No side diamonds on any of them — only the center stone.",
    `Polished yellow gold metal, identical for all 12 pieces. The band/setting itself is the SAME real-world physical size in every cell (a normal finger-ring/pendant/earring size) — only the center diamond's size changes between cells, never the metalwork.`,
    `REALISM IS CRITICAL: use the actual real-world diamond diameter for each carat weight given below — do not exaggerate or dramatize the size. A 5 carat round brilliant is approximately 11mm across (roughly the size of a small pea/chickpea) — noticeably large for a ring, but NOT an oversized boulder or costume-jewellery-scale stone. Keep every stone believably wearable and true to its real mm size relative to the band.`,
    `Top row (left to right), 6 pieces with center diamond sizes exactly: ${rowLabel(topRow)}.`,
    `Bottom row (left to right), 6 pieces with center diamond sizes exactly: ${rowLabel(bottomRow)}.`,
    `All 12 cells MUST be present — do not skip, merge, or combine any of the 12 sizes into fewer pieces.`,
    `A small elegant carat-weight label (e.g. "0.30ct", "1.00ct", "5.00ct") is printed directly beneath each of the 12 pieces, in a clean serif font, matching that cell's exact carat size.`,
    `Even studio lighting across the whole grid, sharp focus, photorealistic, high-end jewellery catalogue quality. No watermark, no other text besides the 12 carat labels.`,
  ].filter(Boolean).join(" ");
  const b64 = await generateOne(prompt, null, "1536x1024", quality, provider);
  if (!b64) throw new Error("no image returned");
  return { base64: b64 };
}
