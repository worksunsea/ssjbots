// Shared send-or-queue helper for every Kitty WhatsApp message (reminders,
// rate-cut notices, redemption codes, draw results, etc). A plain
// sendWhatsApp(...).catch(() => ({status:0})) — the old pattern used
// everywhere in api/kitty.js and api/kitty-cron.js — silently dropped the
// message on any failure (WA session down, number invalid, whatever). This
// queues it into kitty_message_queue instead, so staff can see what's
// pending and retry from Kitty Admin ("Send Now" — one at a time or all,
// paced).
import { sendWhatsApp } from "./wa.js";
import { KITTY_WA_CLIENT_ID } from "./config.js";

// Attempts the send; on failure, inserts a pending row. Returns
// { sent: boolean, queued: boolean }. Never throws.
export async function sendKittyWA(sb, { tenantId, leadId, phone, msg, context = {} }) {
  if (!phone) return { sent: false, queued: false };
  try {
    const wa = await sendWhatsApp({ phone, msg, client: KITTY_WA_CLIENT_ID });
    if (wa?.status === 1) return { sent: true, queued: false };
    await queueKittyMessage(sb, { tenantId, leadId, phone, msg, context, error: `send_status_${wa?.status ?? "unknown"}` });
    return { sent: false, queued: true };
  } catch (err) {
    await queueKittyMessage(sb, { tenantId, leadId, phone, msg, context, error: String(err?.message || err) });
    return { sent: false, queued: true };
  }
}

async function queueKittyMessage(sb, { tenantId, leadId, phone, msg, context, error }) {
  try {
    await sb.from("kitty_message_queue").insert({
      tenant_id: tenantId, lead_id: leadId || null, phone, message: msg,
      context, status: "pending", last_error: error || null,
    });
  } catch { /* best-effort — never let queueing itself break the caller */ }
}
