// Thin wrapper around the self-hosted wa-service running on Synology.
// Replaces the old WbizTool sendWhatsApp now that we handle the WA channel
// ourselves via Baileys.

import { normalizePhone } from "./config.js";

const WA_SERVICE_URL = process.env.WA_SERVICE_URL || "";
const WA_SERVICE_SECRET = process.env.WA_SERVICE_SECRET || "";

// Returns WbizTool-compatible shape so call sites don't need changes:
//   { status: 1 on success | 0 on failure, msg_id, message }
// Accepts either a raw JID (e.g. "abc@lid" or "91...@s.whatsapp.net") or a
// bare phone number in `phone`.
// client = wbiztool_client / session ID for multi-number setups (optional).
// When client is provided, uses /clients/:id/send (multi-session).
// When omitted, falls back to /send (default session).
// Send a media file (image/video/document) from a URL.
// Returns same shape as sendWhatsApp: { status: 1|0, msg_id, message }
export async function sendWhatsAppMedia({ phone, mediaUrl, mediaType = "image", caption = "", filename, client }) {
  if (!WA_SERVICE_URL) return { status: 0, message: "wa_service_not_configured" };
  if (!phone || !mediaUrl) return { status: 0, message: "missing_phone_or_mediaUrl" };
  const base = WA_SERVICE_URL.replace(/\/+$/, "");
  const target = String(phone).includes("@") ? String(phone) : normalizePhone(phone);
  const payload = { message: caption, mediaUrl, mediaType, filename, ...(target.includes("@") ? { jid: target } : { phone: target }) };
  const url = client ? `${base}/clients/${encodeURIComponent(client)}/send-media` : `${base}/send-media`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-secret": WA_SERVICE_SECRET },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) return { status: 1, msg_id: String(data.msgId || ""), message: "sent" };
    return { status: 0, message: data.error || `http_${r.status}` };
  } catch (err) {
    return { status: 0, message: String(err.message || err) };
  }
}

export async function sendWhatsApp({ phone, msg, client }) {
  if (!WA_SERVICE_URL) {
    return { status: 0, message: "wa_service_not_configured" };
  }
  if (!phone || !msg) {
    return { status: 0, message: "missing_phone_or_msg" };
  }
  const base = WA_SERVICE_URL.replace(/\/+$/, "");
  // If it already contains "@", it's a JID — pass through unchanged.
  // Otherwise, strip non-digits so wa-service can build the JID.
  const target = String(phone).includes("@") ? String(phone) : normalizePhone(phone);
  const payload = target.includes("@") ? { jid: target, message: msg } : { phone: target, message: msg };
  // Use per-session endpoint when a client ID is supplied
  const url = client ? `${base}/clients/${encodeURIComponent(client)}/send` : `${base}/send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-secret": WA_SERVICE_SECRET,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      return { status: 1, msg_id: String(data.msgId || ""), message: "sent" };
    }
    return { status: 0, message: data.error || `http_${r.status}` };
  } catch (err) {
    return { status: 0, message: String(err.message || err) };
  }
}
