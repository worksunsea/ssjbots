// POST /api/staff-otp-send — called by ssj-hr's staff-onboard.js.
// Plain template, no AI — sends a WhatsApp OTP code to ANY phone number
// (personal/office/parent/sibling/spouse) so ssj-hr can confirm it's
// reachable. Secret-protected since it accepts an arbitrary target phone.

import { sendWhatsApp } from "./_lib/wa.js";
import { WA_SESSION_CLIENT_ID } from "./_lib/config.js";

const STAFF_OTP_SECRET = process.env.STAFF_OTP_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!STAFF_OTP_SECRET || req.headers["x-staff-otp-secret"] !== STAFF_OTP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { phone, code, label, name } = req.body || {};
  if (!phone || !code) return res.status(400).json({ ok: false, error: "missing_phone_or_code" });

  const msg = `🔐 ${name ? `Hi ${name}, your` : "Your"} SSJ HR verification code${label ? ` for ${label}` : ""}: ${code}\nValid for 10 minutes. Do not share this code.`;
  const wa = await sendWhatsApp({ phone, msg, client: WA_SESSION_CLIENT_ID });

  if (wa.status !== 1) return res.status(502).json({ ok: false, error: wa.message });
  return res.json({ ok: true });
}
