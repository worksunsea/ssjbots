// Server-side Supabase client using service role key — bypasses RLS.
// NEVER expose this file to the browser. It's in /api/ which Vercel only
// runs server-side.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./config.js";

let _client = null;

export function supa() {
  if (!_client) {
    if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_KEY missing");
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
