// POST /api/office-totp-check — cross-app version of device-check.js.
// Called by each app's OWN /api/office-totp-check.js proxy (ssj-hr,
// fms-tracker), which reads/sets the shared `ssj_device_id` cookie
// (Domain=.gemtre.in) and forwards it here as `deviceToken` — so trust is
// scoped per BROWSER, shared across all apps under gemtre.in, not per
// staff name (a verification on one app now covers the others on the same
// device, but a different device always needs its own code).
//
// Body: { tenantId, app, staffId?, staffName, deviceToken, code? }
// Returns:
//   { ok:true, needsCode:false }              — 2FA off, or this device already trusted
//   { ok:true, needsCode:true }                — needs a code, none sent yet
//   { ok:false, error:"wrong_code" }           — code sent but invalid
//   { ok:false, error:"totp_not_configured" }  — feature on but no secret generated yet

import { supa } from "./_lib/supabase.js";
import { getSecuritySettings, checkDeviceTrust, upsertTrustedDevice, validateOfficeCode, logVerification } from "./_lib/officeTotp.js";

const STAFF_OTP_SECRET = process.env.STAFF_OTP_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!STAFF_OTP_SECRET || req.headers["x-staff-otp-secret"] !== STAFF_OTP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { tenantId, app, staffId, staffName, deviceToken, code } = req.body || {};
  if (!tenantId || !app || !staffName || !deviceToken) {
    return res.status(400).json({ ok: false, error: "tenantId, app, staffName and deviceToken required" });
  }

  const sb = supa();
  const settings = await getSecuritySettings(sb, tenantId);

  if (!settings?.totp_enabled) {
    return res.status(200).json({ ok: true, needsCode: false });
  }

  const reauthDays = settings.reauth_days || 15;

  if (await checkDeviceTrust(sb, tenantId, deviceToken)) {
    return res.status(200).json({ ok: true, needsCode: false });
  }

  if (!code) {
    return res.status(200).json({ ok: true, needsCode: true });
  }

  if (!settings.totp_secret) {
    return res.status(200).json({ ok: false, error: "totp_not_configured" });
  }
  if (!validateOfficeCode(settings.totp_secret, code)) {
    return res.status(200).json({ ok: false, error: "wrong_code" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();

  await upsertTrustedDevice(sb, { tenantId, deviceToken, label: app, ip, staffId, staffName, reauthDays });
  await logVerification(sb, { tenantId, staffId, staffName, deviceToken, ip, device: app });

  return res.status(200).json({ ok: true, needsCode: false });
}
