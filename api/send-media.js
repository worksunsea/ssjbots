// POST /api/send-media
// Sends a media file (e.g. an estimate/quotation PDF already uploaded to
// Supabase storage) on WhatsApp via the Baileys wa-service. Mirrors
// api/send.js but for media instead of plain text.

import { sendWhatsAppMedia } from "./_lib/wa.js";
import { checkCrmSecret } from "./_lib/config.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const block = checkCrmSecret(req, res);
  if (block) return;

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { phone, mediaUrl, mediaType = "document", caption = "", filename, client } = body;
  if (!phone || !mediaUrl) return res.status(400).json({ ok: false, error: "phone_and_mediaUrl_required" });

  const wa = await sendWhatsAppMedia({ phone, mediaUrl, mediaType, caption, filename, client: client || undefined });
  if (wa.status !== 1) {
    return res.status(502).json({ ok: false, error: wa.message });
  }

  return res.status(200).json({ ok: true, msg_id: wa.msg_id });
}
