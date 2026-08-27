// Shared logic behind the office 2FA gate — one TOTP secret kept on a single
// physical office phone, checked per-DEVICE (browser) every `reauth_days`
// (default 15). Used by both device-check.js (ssjbots' own login) and
// office-totp-check.js (cross-app, called by ssj-hr/fms-tracker so all apps
// share the one office code). Device identity is a UUID shared across all
// three apps via a `Domain=.gemtre.in` cookie set by each app's own
// office-totp-check.js proxy — see that file for the cookie logic — so one
// verification on any app trusts that browser everywhere.
//
// Trust used to also fall back to "has this staff NAME verified anywhere
// recently" (recentlyVerifiedByName, now removed) — that let one person's
// verification on one device silently cover every other device they used,
// which defeats per-device trust. Removed; device_verifications is now a
// pure audit log (who verified, from what IP/device, when), not a trust
// source.

import { TOTP, Secret } from "otpauth";

export async function getSecuritySettings(sb, tenantId) {
  const { data } = await sb
    .from("tenant_security_settings")
    .select("totp_secret,totp_enabled,reauth_days")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

// Is this exact device (by device_token) currently trusted? Bumps
// last_seen_at on a hit so "last used" stays accurate for the admin panel.
export async function checkDeviceTrust(sb, tenantId, deviceToken) {
  if (!deviceToken) return false;
  const { data, error } = await sb
    .from("trusted_devices")
    .select("id,trusted_until")
    .eq("tenant_id", tenantId)
    .eq("device_token", deviceToken)
    .maybeSingle();
  if (error) { console.error("checkDeviceTrust query failed:", error.message); return false; }
  if (!data || new Date(data.trusted_until) <= new Date()) return false;
  await sb.from("trusted_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

// Marks this device trusted for reauthDays from now, after a successful code.
export async function upsertTrustedDevice(sb, { tenantId, deviceToken, label, ip, staffId, staffName, reauthDays }) {
  const trustedUntil = new Date(Date.now() + reauthDays * 86400000).toISOString();
  const { error } = await sb.from("trusted_devices").upsert(
    {
      tenant_id: tenantId,
      device_token: deviceToken,
      label: label || null,
      ip: ip || null,
      verified_by_staff_id: staffId || null,
      verified_by_name: staffName || null,
      trusted_until: trustedUntil,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,device_token" }
  );
  if (error) console.error("upsertTrustedDevice failed:", error.message);
}

export function validateOfficeCode(totpSecret, code) {
  if (!totpSecret || !code) return false;
  try {
    const totp = new TOTP({ secret: Secret.fromBase32(totpSecret), algorithm: "SHA1", digits: 6, period: 30 });
    return totp.validate({ token: String(code).padStart(6, "0"), window: 1 }) !== null;
  } catch {
    return false;
  }
}

export async function logVerification(sb, { tenantId, staffId, staffName, deviceToken, ip, device }) {
  await sb.from("device_verifications").insert({
    tenant_id: tenantId,
    staff_id: staffId || null,
    staff_name: staffName || null,
    device_token: deviceToken,
    ip: ip || null,
    device: device || null,
  });
}
