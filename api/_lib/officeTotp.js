// Shared logic behind the office 2FA gate — one TOTP secret kept on a single
// physical office phone, checked per-STAFF-MEMBER every `reauth_days` (default
// 15), independent of which device/app they're logging into. Used by both
// device-check.js (ssjbots' own login) and office-totp-check.js (cross-app,
// called by ssj-hr/ssj-suite so all three apps share the one office code).
//
// Per-user recency is tracked in the existing `device_verifications` log,
// matched by lower-cased staff_name — not staff_id, since staff_id spaces
// differ across apps (ssjbots/ssj-hr/ssj-suite each have their own staff
// tables/uuid spaces) but a person's name is the one thing consistent
// everywhere. No new tables needed — this table already logs every
// successful verification with a staff_name column.

import { TOTP, Secret } from "otpauth";

export async function getSecuritySettings(sb, tenantId) {
  const { data } = await sb
    .from("tenant_security_settings")
    .select("totp_secret,totp_enabled,reauth_days")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

// Has this staff member (by name) verified the office code within reauth_days,
// from ANY device or app? If so, they skip re-entry.
export async function recentlyVerifiedByName(sb, tenantId, staffName, reauthDays) {
  if (!staffName) return false;
  const cutoff = new Date(Date.now() - reauthDays * 86400000).toISOString();
  const { data } = await sb
    .from("device_verifications")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("staff_name", staffName.trim())
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  return !!data;
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
