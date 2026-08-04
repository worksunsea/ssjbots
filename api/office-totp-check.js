// POST /api/office-totp-check — cross-app version of device-check.js.
// Called by ssj-hr and ssj-suite (which don't have their own office-TOTP
// secret) so all three apps gate logins against the SAME single office
// Authenticator device, with the same per-staff 15-day reauth window.
//
// Unlike device-check.js this has no device-token concept (those apps don't
// share ssjbots' device-trust model) — it's purely "has THIS staff member
// (by name) verified the office code within reauth_days, from any app?"
//
// Body: { tenantId, app, staffName, code? }
// Returns:
//   { ok:true, needsCode:false }              — 2FA off, or already verified recently
//   { ok:true, needsCode:true }                — needs a code, none sent yet
//   { ok:false, error:"wrong_code" }           — code sent but invalid
//   { ok:false, error:"totp_not_configured" }  — feature on but no secret generated yet

import { supa } from "./_lib/supabase.js";
import { getSecuritySettings, recentlyVerifiedByName, validateOfficeCode, logVerification } from "./_lib/officeTotp.js";

const STAFF_OTP_SECRET = process.env.STAFF_OTP_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!STAFF_OTP_SECRET || req.headers["x-staff-otp-secret"] !== STAFF_OTP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { tenantId, app, staffName, code } = req.body || {};
  if (!tenantId || !app || !staffName) {
    return res.status(400).json({ ok: false, error: "tenantId, app and staffName required" });
  }

  const sb = supa();
  const settings = await getSecuritySettings(sb, tenantId);

  if (!settings?.totp_enabled) {
    return res.status(200).json({ ok: true, needsCode: false });
  }

  const reauthDays = settings.reauth_days || 15;

  if (await recentlyVerifiedByName(sb, tenantId, staffName, reauthDays)) {
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

  await logVerification(sb, {
    tenantId, staffId: null, staffName,
    deviceToken: `cross-app:${app}`,
    ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
    device: app,
  });

  return res.status(200).json({ ok: true, needsCode: false });
}
