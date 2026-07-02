// POST /api/device-check
// Office-TOTP "new device" gate. Called right after password login succeeds.
//
// Body: { tenantId, deviceToken, staffId?, staffName?, code? }
//
// Returns:
//   { ok:true, needsTotp:false, trusted:true }               — feature off, or device already trusted
//   { ok:true, needsTotp:true,  trusted:false }               — new device, no code sent yet
//   { ok:true, needsTotp:false, trusted:true }                — code sent + valid, device now trusted
//   { ok:false, error:"wrong_code" }                          — code sent but invalid
//
// The shared office TOTP secret never reaches the browser — this endpoint (service role)
// is the only thing that reads tenant_security_settings.totp_secret. See
// SSJ_STABLE_FEATURES.md §19 for the full design writeup and why RLS denies anon
// access to tenant_security_settings / trusted_devices entirely.

import { TOTP, Secret } from "otpauth";
import { supa } from "./_lib/supabase.js";
import { checkCrmSecret } from "./_lib/config.js";

export default async function handler(req, res) {
  if (checkCrmSecret(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const { tenantId, deviceToken, staffId, staffName, code } = req.body || {};
  if (!tenantId || !deviceToken) {
    return res.status(400).json({ ok: false, error: "tenantId and deviceToken required" });
  }

  const sb = supa();

  const { data: settings } = await sb
    .from("tenant_security_settings")
    .select("totp_secret,totp_enabled,device_trust_days")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!settings?.totp_enabled) {
    return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
  }

  const trustDays = settings.device_trust_days || 30;

  const { data: trusted } = await sb
    .from("trusted_devices")
    .select("id,trusted_until")
    .eq("tenant_id", tenantId)
    .eq("device_token", deviceToken)
    .maybeSingle();

  if (trusted && new Date(trusted.trusted_until) > new Date()) {
    await sb.from("trusted_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", trusted.id);
    return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
  }

  if (!code) {
    return res.status(200).json({ ok: true, needsTotp: true, trusted: false });
  }

  if (!settings.totp_secret) {
    return res.status(200).json({ ok: false, error: "totp_not_configured" });
  }

  let valid = false;
  try {
    const totp = new TOTP({ secret: Secret.fromBase32(settings.totp_secret), algorithm: "SHA1", digits: 6, period: 30 });
    valid = totp.validate({ token: String(code).padStart(6, "0"), window: 1 }) !== null;
  } catch {
    valid = false;
  }
  if (!valid) return res.status(200).json({ ok: false, error: "wrong_code" });

  const trustedUntil = new Date(Date.now() + trustDays * 86400000).toISOString();
  const label = (req.headers["user-agent"] || "").slice(0, 200);

  await sb.from("trusted_devices").upsert(
    {
      tenant_id: tenantId,
      device_token: deviceToken,
      label,
      verified_by_staff_id: staffId || null,
      verified_by_name: staffName || null,
      trusted_until: trustedUntil,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,device_token" }
  );

  await sb.from("device_verifications").insert({
    tenant_id: tenantId,
    staff_id: staffId || null,
    staff_name: staffName || null,
    device_token: deviceToken,
    ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
    device: label,
  });

  return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
}
