// GET /api/health — sanity check for deploy + env wiring.

import { SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, WBIZTOOL_API_KEY } from "./_lib/config.js";

export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      supabase_service_key: Boolean(SUPABASE_SERVICE_KEY),
      anthropic_api_key: Boolean(ANTHROPIC_API_KEY),
      wbiztool_api_key: Boolean(WBIZTOOL_API_KEY),
    },
  });
}
