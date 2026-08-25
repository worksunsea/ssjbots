// OpenAI API wrapper — returns parsed JSON from the bot's reply.
// Replaces the old Anthropic/Claude wrapper (was api/_lib/claude.js) —
// switched 2026-07-09. Same call signature as before (system + messages
// array of {role,content}, no system message inside `messages`) so every
// caller (webhook.js, demand.js, ownerCommand.js, emailDigest.js, cron.js)
// only needed its import path + the OPENAI_* config names updated, not its
// call sites.

import { OPENAI_API_KEY, OPENAI_MODEL, DEEPSEEK_API_KEY } from "./config.js";

export async function askAI({ system, messages, maxTokens = 512, model }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const usedModel = model || OPENAI_MODEL;
  console.log("askAI:model", usedModel);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: usedModel,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...(messages || [])],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { raw: data, text };
}

// DeepSeek vision wrapper — separate from askAI (OpenAI) since only DeepSeek's
// experimental deepseek-v4-flash-vision-exp model accepts image input; every
// other DeepSeek model 400s on an image block. 384-token cap per image,
// auto-downscaled (~800x800 equiv max) — fine for a business card, unproven
// for a dense handwritten form; caller should compare against askAI+gpt-4o
// vision on real samples before relying on this for OCR accuracy.
export async function askAIVisionDeepSeek({ system, promptText, imageUrls, maxTokens = 1200 }) {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing");
  const content = [{ type: "text", text: promptText }];
  for (const url of (imageUrls || []).filter(Boolean)) {
    content.push({ type: "image_url", image_url: { url } });
  }
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash-vision-exp",
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { raw: data, text };
}

// Parse the bot's JSON-shaped reply. Tolerates minor wrapping (e.g. markdown code fences).
export function parseBotJson(text) {
  if (!text) return null;
  // Strip ```json ... ``` fences if present.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Find first { and last } in case there's extra prose.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
