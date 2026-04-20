// Thin wrapper around the self-hosted wa-service running on Synology.
// Replaces the old WbizTool sendWhatsApp now that we handle the WA channel
// ourselves via Baileys.

import { normalizePhone } from "./config.js";

const WA_SERVICE_URL = process.env.WA_SERVICE_URL || "";
const WA_SERVICE_SECRET = process.env.WA_SERVICE_SECRET || "";

// Returns WbizTool-compatible shape so call sites don't need changes:
//   { status: 1 on success | 0 on failure, msg_id, message }
export async function sendWhatsApp({ phone, msg }) {
  if (!WA_SERVICE_URL) {
    return { status: 0, message: "wa_service_not_configured" };
  }
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || !msg) {
    return { status: 0, message: "missing_phone_or_msg" };
  }
  try {
    const r = await fetch(`${WA_SERVICE_URL.replace(/\/+$/, "")}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-secret": WA_SERVICE_SECRET,
      },
      body: JSON.stringify({ phone: cleanPhone, message: msg }),
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
