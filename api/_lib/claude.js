// Claude API wrapper — returns parsed JSON from the bot's reply.

import { ANTHROPIC_API_KEY, CLAUDE_MODEL } from "./config.js";

export async function askClaude({ system, messages, maxTokens = 512 }) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
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
