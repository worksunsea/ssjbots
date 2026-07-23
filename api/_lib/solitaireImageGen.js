// OpenAI gpt-image-1 wrapper for the solitaire jewellery designer's admin-only
// AI Design Generator. Given a design concept (from solitaire_designs) plus
// admin-picked filters (gold colour, diamond shape, optional carat size), it
// generates one image set: front view, 3/4 angle view, and a "worn by a
// model" shot. Mirrors the structure of generateBrandedDesigns() in
// imageGen.js (same provider, same images/generations call shape) but there
// is no fixed physical reference photo here — every design is fully
// AI-imagined, so we use text-to-image generation rather than image edits.

import { OPENAI_API_KEY } from "./config.js";

const VIEWS = [
  { key: "front", label: "Front view", prompt: "a straight-on front product photo, studio lighting, plain neutral background, the jewellery piece centered and in sharp focus" },
  { key: "angle", label: "3/4 angle view", prompt: "a 3/4 angle product photo showing depth and the side profile of the setting, studio lighting, plain neutral background" },
  { key: "worn", label: "Worn by model", prompt: "the same jewellery piece worn by an elegant model in a soft-lit lifestyle photo, hand/ear/neck as appropriate to the jewellery type, natural skin tone, tasteful close-up crop, luxury editorial feel" },
];

const CATEGORY_WEAR_AREA = {
  ring: "worn on a model's hand, finger prominently shown",
  pendant: "worn on a model's neck on a fine chain",
  earring: "worn as a matching pair on a model's ear",
};

function buildPrompt({ conceptPrompt, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view }) {
  const parts = [
    `Fine jewellery product photography of a solitaire ${category}: ${conceptPrompt}.`,
    `Center stone: a ${diamondShape}-cut diamond${caratSize ? `, approximately ${caratSize} carat` : ""}, brilliant and clear, realistic proportions for the setting.`,
    `Metal: polished ${goldColor} gold.`,
    hasSideDiamonds ? "Includes smaller pave or accent side diamonds as described in the design." : "No side diamonds — the center stone is the sole diamond.",
    view.key === "worn" ? `Shot ${CATEGORY_WEAR_AREA[category] || "worn by a model"}.` : "Shown as a standalone product shot, not worn.",
    view.prompt,
    "Photorealistic, high-end jewellery catalogue quality, square 1:1 composition. No text or watermark in the image.",
  ];
  return parts.filter(Boolean).join(" ");
}

// Returns [{ key, label, base64 }] — one image per VIEWS entry.
export async function generateSolitaireDesignViews({ conceptPrompt, category, goldColor, diamondShape, caratSize, hasSideDiamonds }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const results = await Promise.all(VIEWS.map(async (view) => {
    const prompt = buildPrompt({ conceptPrompt, category, goldColor, diamondShape, caratSize, hasSideDiamonds, view });

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality: "medium",
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI images/generations ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`no image returned for view "${view.key}"`);
    return { key: view.key, label: view.label, base64: b64, prompt };
  }));

  return results;
}
