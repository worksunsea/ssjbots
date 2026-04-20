// GET /api/health — deploy + env sanity check.

import { SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } from "./_lib/config.js";

export default async function handler(_req, res) {
  const WA_SERVICE_URL = process.env.WA_SERVICE_URL || "";
  let wa = { configured: Boolean(WA_SERVICE_URL), reachable: null, connected: null };
  if (WA_SERVICE_URL) {
    try {
      const r = await fetch(`${WA_SERVICE_URL.replace(/\/+$/, "")}/status`);
      if (r.ok) {
        const data = await r.json();
        wa.reachable = true;
        wa.connected = Boolean(data.connected);
        wa.me = data.me || null;
        wa.client = data.client || null;
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
