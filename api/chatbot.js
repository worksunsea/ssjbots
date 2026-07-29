// POST /api/chatbot — public, no auth, CORS open. Website AI chatbot widget
// for ssj-website. Grounded on the same bullion_faqs the WA bot uses
// (api/_lib/faqs.js), answers via OpenAI (api/_lib/ai.js), and falls back
// to a WhatsApp handoff CTA for anything transactional or low-confidence.
//
// Body: { message, history? } — history is [{role:"user"|"assistant", content}]
// for short conversational context (last few turns only, no persistence).

import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { askAI } from "./_lib/ai.js";
import { TENANT_ID, OPENAI_MODEL } from "./_lib/config.js";

const MAX_HISTORY_TURNS = 6;
const WA_HANDOFF = "For anything specific to your order, pricing, or to speak with our team directly, chat with us on WhatsApp: https://wa.me/918860866000";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const message = String(body.message || "").trim().slice(0, 1000);
  if (!message) return res.status(400).json({ ok: false, error: "empty_message" });

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
  const faqs = await getFaqs(TENANT_ID);

  const system = [
    "You are the website assistant for Sun Sea Jewellers, a jewellery store in Karol Bagh, Delhi (40+ years, 5.0 Google rating, 479+ reviews).",
    "Answer briefly and warmly — 2-4 sentences, plain text, no markdown.",
    "Only answer using the store info below. If the question is about a specific order, pricing negotiation, or anything you're not confident about, say so and point them to WhatsApp.",
    faqs?.length ? `Store info:\n${faqsForPrompt(faqs)}` : "(no FAQs configured yet)",
    `Always end with this exact line on its own: "${WA_HANDOFF}" — but ONLY when the question needs staff/order-specific help, not for general questions you can answer confidently.`,
  ].join("\n\n");

  try {
    const ai = await askAI({
      system,
      messages: [...history, { role: "user", content: message }],
      maxTokens: 300,
      model: OPENAI_MODEL,
    });
    const reply = ai?.text?.trim() || WA_HANDOFF;
    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    return res.status(200).json({ ok: true, reply: `Sorry, I'm having trouble right now. ${WA_HANDOFF}` });
  }
}
