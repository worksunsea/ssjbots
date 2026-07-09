// POST /api/connection-alert — called by wa-service/watchdog.ps1 (runs on the
// NAS via Task Scheduler) when a Baileys WA session drops. Sends a WhatsApp
// alert via WbizTool — deliberately NOT via Baileys/sendWhatsApp, since the
// Baileys channel may be the very thing that's down.
//
// This is the WA-message half of the "session down" alert; the push
// notification half (user_id "admin", covers all superadmin+admin staff)
// already happens directly from watchdog.ps1 against hr.gemtre.in/api/push.

import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { checkCrmSecret, OWNER_PHONE, DIGEST_EXTRA_RECIPIENTS } from "./_lib/config.js";

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const authFail = checkCrmSecret(req, res);
  if (authFail) return authFail;

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { title, message } = body;
  if (!message) return res.status(400).json({ ok: false, error: "message_required" });

  const recipients = [OWNER_PHONE, ...DIGEST_EXTRA_RECIPIENTS.split(",")].map((p) => p.trim()).filter(Boolean);
  if (!recipients.length) return res.status(200).json({ ok: false, error: "no_recipients_configured" });

  const msg = `🔔 ${title || "WhatsApp session alert"}\n\n${message}`;
  const results = await Promise.all(recipients.map((phone) => sendWhatsAppWbiz({ phone, msg, whatsappClient: null })));
  const sent = results.filter((r) => r.status === 1).length;

  return res.status(200).json({ ok: true, sent, of: recipients.length });
}
