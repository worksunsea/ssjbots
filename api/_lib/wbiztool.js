// WbizTool send wrapper. msg_type 0 = text.

import { WBIZTOOL_API_KEY, WBIZTOOL_CLIENT_ID, normalizePhone } from "./config.js";

export async function sendWhatsApp({ phone, msg, whatsappClient }) {
  if (!phone || !whatsappClient) {
    return { status: 0, message: "Missing phone or whatsappClient" };
  }
  const cleanPhone = normalizePhone(phone);
  const res = await fetch("https://wbiztool.com/api/v1/send_msg/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: WBIZTOOL_CLIENT_ID,
      api_key: WBIZTOOL_API_KEY,
      whatsapp_client: String(whatsappClient),
      msg_type: 0,
      phone: cleanPhone,
      country_code: "91",
      msg,
    }),
  });
  try {
    return await res.json();
  } catch {
    return { status: 0, message: `Non-JSON response (${res.status})` };
  }
}
