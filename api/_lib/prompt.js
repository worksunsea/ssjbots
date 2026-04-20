// Assemble the system prompt from persona + funnel context + live rates.

export function buildSystemPrompt({ persona, funnel, ratesText, maxExchanges }) {
  const base = persona?.system_prompt || "You are a helpful WhatsApp assistant for Sun Sea Jewellers, Karol Bagh.";
  return [
    base,
    "",
    "# Funnel context",
    `Name: ${funnel?.name || "—"}`,
    `Purpose: ${funnel?.description || "—"}`,
    `Product focus: ${funnel?.product_focus || "all"}`,
    `Goal: ${funnel?.goal || "—"}`,
    `Max exchanges before handoff: ${maxExchanges ?? 3}`,
    "",
    "# Live rates (source: Google Sheet, updated by owner)",
    ratesText,
    "",
    "# Output rules",
    "Respond with ONLY a JSON object — no prose, no markdown fences. Schema:",
    '{',
    '  "reply": "WhatsApp message body (Hinglish ok, max 3 short lines, emojis ok)",',
    '  "action": "CONTINUE | QUOTE_SENT | CONVERTED | HANDOFF",',
    '  "stage": "greeting | qualifying | quoted | objection | closing | handoff",',
    '  "product_interest": "24K | 22K | silver | coin | bar | unknown",',
    '  "qty_grams": 0',
    '}',
    "",
    "Use action=HANDOFF if the user is confused, angry, asking complex questions, or you've already had 3+ exchanges without progress.",
    "Use action=CONVERTED if the user commits to visiting the showroom or placing an order.",
    "Use action=QUOTE_SENT only after giving a precise per-gram quote.",
    "Otherwise use CONTINUE.",
  ].join("\n");
}

export function buildMessages({ history, inboundBody }) {
  const msgs = (history || []).map((m) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: String(m.body || ""),
  }));
  msgs.push({ role: "user", content: inboundBody });
  return msgs;
}
