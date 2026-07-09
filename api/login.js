// POST /api/login
// Server-verified staff login. Replaces the old client-side flow where the
// browser ran `sb.from("staff").select("*").eq("password", p)` directly
// against Supabase with the anon key — meaning the password column had to be
// anon-readable and nothing server-side ever attested "this really is staff
// member X". This endpoint does the password check with the service role
// (password column stays out of anon RLS entirely) and returns a signed
// session token that api/demand-queue.js and api/log-call.js now require,
// instead of trusting a client-supplied staffId.
//
// Body: { tenantId, username, password }
// Returns: { ok:true, user:{...no password field}, token } | { ok:false, error }

import { supa } from "./_lib/supabase.js";
import { checkCrmSecret } from "./_lib/config.js";
import { signSession } from "./_lib/session.js";

export default async function handler(req, res) {
  if (checkCrmSecret(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const { tenantId, username, password } = req.body || {};
  if (!tenantId || !username || !password) {
    return res.status(400).json({ ok: false, error: "tenantId, username and password required" });
  }

  const sb = supa();
  const { data, error } = await sb
    .from("staff")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("username", String(username).trim())
    .eq("password", password)
    .maybeSingle();

  if (error || !data) {
    return res.status(200).json({ ok: false, error: "invalid_credentials" });
  }
  if (data.active === false) {
    return res.status(200).json({ ok: false, error: "account_deactivated" });
  }

  const token = signSession({ staffId: data.id, tenantId: data.tenant_id, role: data.role });
  const { password: _pw, ...safeUser } = data;

  return res.status(200).json({ ok: true, user: safeUser, token });
}
