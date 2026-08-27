// GET/POST /api/security-settings
// Superadmin-only: manage the shared office-TOTP secret + trusted device list.
//
// There is no server session in this app (see SSJ_STABLE_FEATURES.md §19), so the
// caller passes staffId and this endpoint independently verifies staff.role === "superadmin"
// server-side before doing anything — never trust a client-sent role.
//
// GET  ?tenantId=&staffId=            -> { ok, totpEnabled, hasSecret, reauthDays, deviceTrustDays, devices:[...] }
// POST { tenantId, staffId, action, deviceToken? }
//   action: "generate" | "rotate"  -> creates a new secret, returns { ok, otpauthUri, secret } ONCE
//   action: "enable" | "disable"   -> toggles totp_enabled
//   action: "revoke_device"        -> deletes one trusted_devices row (needs deviceToken)

import { TOTP, Secret } from "otpauth";
import { supa } from "./_lib/supabase.js";
import { checkCrmSecret } from "./_lib/config.js";

async function requireSuperadmin(sb, staffId) {
  if (!staffId) return false;
  const { data } = await sb.from("staff").select("role").eq("id", staffId).maybeSingle();
  return data?.role === "superadmin";
}

async function getOrCreateSettings(sb, tenantId) {
  const { data, error: selErr } = await sb.from("tenant_security_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (selErr) console.error("getOrCreateSettings select failed:", selErr.message);
  if (data) return data;
  const { data: created, error: insErr } = await sb
    .from("tenant_security_settings")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();
  if (insErr) console.error("getOrCreateSettings insert failed:", insErr.message);
  return created;
}

export default async function handler(req, res) {
  if (checkCrmSecret(req, res)) return;
  const sb = supa();

  if (req.method === "GET") {
    const { tenantId, staffId } = req.query || {};
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId required" });
    if (!(await requireSuperadmin(sb, staffId))) return res.status(403).json({ ok: false, error: "superadmin_only" });

    const settings = await getOrCreateSettings(sb, tenantId);
    const { data: devices } = await sb
      .from("trusted_devices")
      .select("id,device_token,label,verified_by_name,trusted_until,last_seen_at,created_at")
      .eq("tenant_id", tenantId)
      .order("last_seen_at", { ascending: false });

    return res.status(200).json({
      ok: true,
      totpEnabled: !!settings?.totp_enabled,
      hasSecret: !!settings?.totp_secret,
      reauthDays: settings?.reauth_days ?? 15,
      deviceTrustDays: settings?.device_trust_days ?? 30,
      devices: devices || [],
    });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const { tenantId, staffId, action, deviceToken } = req.body || {};
  if (!tenantId || !action) return res.status(400).json({ ok: false, error: "tenantId and action required" });
  if (!(await requireSuperadmin(sb, staffId))) return res.status(403).json({ ok: false, error: "superadmin_only" });

  await getOrCreateSettings(sb, tenantId); // ensure row exists before update

  if (action === "generate" || action === "rotate") {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: "SSJ CRM", label: "Office Device", algorithm: "SHA1", digits: 6, period: 30, secret });
    const { error } = await sb
      .from("tenant_security_settings")
      .update({ totp_secret: secret.base32, totp_enabled: true, updated_at: new Date().toISOString(), updated_by: staffId })
      .eq("tenant_id", tenantId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, otpauthUri: totp.toString(), secret: secret.base32 });
  }

  if (action === "enable" || action === "disable") {
    const { error } = await sb
      .from("tenant_security_settings")
      .update({ totp_enabled: action === "enable", updated_at: new Date().toISOString(), updated_by: staffId })
      .eq("tenant_id", tenantId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === "revoke_device") {
    if (!deviceToken) return res.status(400).json({ ok: false, error: "deviceToken required" });
    await sb.from("trusted_devices").delete().eq("tenant_id", tenantId).eq("device_token", deviceToken);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
