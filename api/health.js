// GET /api/health — deploy + env sanity check.
// GET /api/health?test_claude=1 — also tests live Claude API call.

import { SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, CLAUDE_MODEL } from "./_lib/config.js";

export default async function handler(req, res) {
  const WA_SERVICE_URL = process.env.WA_SERVICE_URL || "";
  let wa = { configured: Boolean(WA_SERVICE_URL), reachable: null, connected: null };
  if (WA_SERVICE_URL) {
    try {
      // Check all clients, find first connected one (avoids stale DEFAULT_CLIENT_ID issue)
      const base = WA_SERVICE_URL.replace(/\/+$/, "");
      const r = await fetch(`${base}/clients`);
      if (r.ok) {
        const data = await r.json();
        wa.reachable = true;
        const all = data.clients || [];
        const connected = all.filter((c) => c.connected);
        wa.connected = connected.length > 0;
        wa.me = connected[0]?.me || null;
        wa.client = connected[0]?.client_id || null;
        wa.sessions = all.map((c) => ({ id: c.client_id, connected: c.connected, me: c.me }));
      } else {
        wa.reachable = false;
      }
    } catch {
      wa.reachable = false;
    }
  }
  let claude = null;
  if (req.query.test_claude === "1" && ANTHROPIC_API_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 32,
          messages: [{ role: "user", content: "Say OK" }],
        }),
      });
      const body = await r.text();
      claude = { ok: r.ok, status: r.status, model: CLAUDE_MODEL, body: body.slice(0, 400) };
    } catch (e) {
      claude = { ok: false, error: String(e), model: CLAUDE_MODEL };
    }
  }

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      supabase_service_key: Boolean(SUPABASE_SERVICE_KEY),
      anthropic_api_key: Boolean(ANTHROPIC_API_KEY),
      anthropic_key_prefix: ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY.slice(0, 14) + "..." : null,
      claude_model: CLAUDE_MODEL,
      wa_service: wa,
    },
    ...(claude !== null ? { claude_test: claude } : {}),
  });
}
