// GET /api/health — deploy + env sanity check.

import { SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } from "./_lib/config.js";

export default async function handler(_req, res) {
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
  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      supabase_service_key: Boolean(SUPABASE_SERVICE_KEY),
      anthropic_api_key: Boolean(ANTHROPIC_API_KEY),
      wa_service: wa,
    },
  });
}
