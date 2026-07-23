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

async function generateOne(prompt, referenceImageBase64) {
  if (!referenceImageBase64) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: "medium" }),
    });
    if (!res.ok) throw new Error(`OpenAI images/generations ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data?.data?.[0]?.b64_json || null;
  }

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
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
