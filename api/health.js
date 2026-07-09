// GET /api/health — deploy + env sanity check.
// GET /api/health?test_ai=1 — also tests a live OpenAI API call.

import { SUPABASE_SERVICE_KEY, OPENAI_API_KEY, OPENAI_MODEL } from "./_lib/config.js";

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
  let ai = null;
  if (req.query.test_ai === "1" && OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: 32,
          messages: [{ role: "user", content: "Say OK" }],
        }),
      });
      const body = await r.text();
      ai = { ok: r.ok, status: r.status, model: OPENAI_MODEL, body: body.slice(0, 400) };
    } catch (e) {
      ai = { ok: false, error: String(e), model: OPENAI_MODEL };
    }
  }

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      supabase_service_key: Boolean(SUPABASE_SERVICE_KEY),
      openai_api_key: Boolean(OPENAI_API_KEY),
      ai_model: OPENAI_MODEL,
      wa_service: wa,
    },
    ...(ai !== null ? { ai_test: ai } : {}),
  });
}
