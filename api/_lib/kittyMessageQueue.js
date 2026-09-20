// Shared send-or-queue helper for every Kitty WhatsApp message (reminders,
// rate-cut notices, redemption codes, draw results, etc). A plain
// sendWhatsApp(...).catch(() => ({status:0})) — the old pattern used
// everywhere in api/kitty.js and api/kitty-cron.js — silently dropped the
// message on any failure (WA session down, number invalid, whatever).
//
// Now: tries the dedicated Kitty number first, automatically falls back to
// the Clientmessage number if that fails (session down/logged out is a real
// recurring failure mode here), and logs every attempt — success or
// failure — into kitty_message_queue so staff has a full record of who got
// what (Kitty Admin > Message Log), not just the failures. Only a send that
// fails on BOTH numbers gets queued as retryable ("Send Now").
import { sendWhatsApp } from "./wa.js";
import { KITTY_WA_CLIENT_ID, KITTY_WA_FALLBACK_CLIENT_ID } from "./config.js";

// Returns { sent: boolean, queued: boolean, clientUsed?: string }. Never throws.
export async function sendKittyWA(sb, { tenantId, leadId, phone, msg, context = {} }) {
  if (!phone) return { sent: false, queued: false };
  const clients = [KITTY_WA_CLIENT_ID, KITTY_WA_FALLBACK_CLIENT_ID].filter((c, i, arr) => c && arr.indexOf(c) === i);
  let lastError = null;
  for (const client of clients) {
    try {
      const wa = await sendWhatsApp({ phone, msg, client });
      if (wa?.status === 1) {
        await logKittyMessage(sb, { tenantId, leadId, phone, msg, context, status: "sent", clientUsed: client });
        return { sent: true, queued: false, clientUsed: client };
      }
      lastError = `send_status_${wa?.status ?? "unknown"} via ${client}`;
    } catch (err) {
      lastError = `${String(err?.message || err)} via ${client}`;
    }
  }
  await logKittyMessage(sb, { tenantId, leadId, phone, msg, context, status: "pending", error: lastError });
  return { sent: false, queued: true };
}

async function logKittyMessage(sb, { tenantId, leadId, phone, msg, context, status, error, clientUsed }) {
  try {
    await sb.from("kitty_message_queue").insert({
      tenant_id: tenantId, lead_id: leadId || null, phone, message: msg,
      context, status, last_error: error || null, client_used: clientUsed || null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
  } catch { /* best-effort — never let logging itself break the caller */ }
}
