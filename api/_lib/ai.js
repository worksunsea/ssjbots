// OpenAI API wrapper — returns parsed JSON from the bot's reply.
// Replaces the old Anthropic/Claude wrapper (was api/_lib/claude.js) —
// switched 2026-07-09. Same call signature as before (system + messages
// array of {role,content}, no system message inside `messages`) so every
// caller (webhook.js, demand.js, ownerCommand.js, emailDigest.js, cron.js)
// only needed its import path + the OPENAI_* config names updated, not its
// call sites.

import { OPENAI_API_KEY, OPENAI_MODEL } from "./config.js";

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
