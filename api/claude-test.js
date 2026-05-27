// GET /api/claude-test?secret=... — diagnostic endpoint to check Claude API health
// Remove after debugging.

import { ANTHROPIC_API_KEY, CLAUDE_MODEL, WEBHOOK_SECRET_CHECK } from "./_lib/config.js";

const SECRET = process.env.WEBHOOK_SECRET || "";

export default async function handler(req, res) {
  if (!SECRET || req.query.secret !== SECRET) {
    return res.status(200).json({ ok: false, reason: "bad_secret" });
  }

  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const apiKey = process.env.ANTHROPIC_API_KEY || "";

  if (!apiKey) {
    return res.status(200).json({ ok: false, reason: "no_api_key" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: "Say OK" }],
      }),
    });

    const body = await r.text();
    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      model,
      api_key_prefix: apiKey.slice(0, 12) + "...",
      response_preview: body.slice(0, 500),
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err), model });
  }
}
