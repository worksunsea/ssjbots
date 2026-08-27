// POST /api/device-check
// Office-TOTP "new device" gate. Called right after password login succeeds.
//
// Body: { tenantId, staffId?, staffName?, code? }
//
// Device identity comes from a `ssj_device_id` cookie scoped to
// `Domain=.gemtre.in` (set here if missing) — NOT a client-supplied token —
// so the same browser is recognized across ssjbots/ssj-hr/fms-tracker, and a
// verification on any one app trusts the browser on all three.
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

import { randomUUID } from "crypto";
import { supa } from "./_lib/supabase.js";
import { checkCrmSecret } from "./_lib/config.js";
import { getSecuritySettings, checkDeviceTrust, upsertTrustedDevice, validateOfficeCode, logVerification } from "./_lib/officeTotp.js";

const DEVICE_COOKIE = "ssj_device_id";

function readDeviceCookie(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|; )${DEVICE_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function ensureDeviceCookie(req, res) {
  let token = readDeviceCookie(req);
  if (token) return token;
  token = randomUUID();
  res.setHeader("Set-Cookie", `${DEVICE_COOKIE}=${token}; Domain=.gemtre.in; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
  return token;
}

export default async function handler(req, res) {
  if (checkCrmSecret(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const { tenantId, staffId, staffName, code } = req.body || {};
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId required" });

  const deviceToken = ensureDeviceCookie(req, res);
  const sb = supa();
  const settings = await getSecuritySettings(sb, tenantId);

  if (!settings?.totp_enabled) {
    return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
  }

  const reauthDays = settings.reauth_days || 15;

  if (await checkDeviceTrust(sb, tenantId, deviceToken)) {
    return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
  }

  if (!code) {
    return res.status(200).json({ ok: true, needsTotp: true, trusted: false });
  }

  if (!settings.totp_secret) {
    return res.status(200).json({ ok: false, error: "totp_not_configured" });
  }
  if (!validateOfficeCode(settings.totp_secret, code)) {
    return res.status(200).json({ ok: false, error: "wrong_code" });
  }

  const label = (req.headers["user-agent"] || "").slice(0, 200);
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();

  await upsertTrustedDevice(sb, { tenantId, deviceToken, label, ip, staffId, staffName, reauthDays });
  await logVerification(sb, { tenantId, staffId, staffName, deviceToken, ip, device: label });

  return res.status(200).json({ ok: true, needsTotp: false, trusted: true });
}
