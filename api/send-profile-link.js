// POST /api/send-profile-link — called by ssj-hr's staff-send-link.js when
// an admin clicks "Send Employee Form" for someone. Plain template, no AI.

import { sendWhatsApp } from "./_lib/wa.js";
import { WA_SESSION_CLIENT_ID } from "./_lib/config.js";

const STAFF_OTP_SECRET = process.env.STAFF_OTP_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!STAFF_OTP_SECRET || req.headers["x-staff-otp-secret"] !== STAFF_OTP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { phone, link, name } = req.body || {};
  if (!phone || !link) return res.status(400).json({ ok: false, error: "missing_phone_or_link" });

  const msg = `📋 Hi${name ? ` ${name}` : ""}! Please fill in/complete your profile details (contact info, address, documents) here: ${link}\nTakes a few minutes, and you can come back to this same link anytime.`;
  const wa = await sendWhatsApp({ phone, msg, client: WA_SESSION_CLIENT_ID });

  if (wa.status !== 1) return res.status(502).json({ ok: false, error: wa.message });
  return res.json({ ok: true });
}
