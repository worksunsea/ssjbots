// POST /api/send
// Used by the CRM when the operator types a manual reply. The browser can't
// call wa-service directly (CORS + public URL), so the request routes
// through this function which holds the WA_SERVICE_SECRET.

import { sendWhatsApp } from "./_lib/wa.js";
import { supa } from "./_lib/supabase.js";
import { normalizePhone } from "./_lib/config.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { phone, message, leadId, funnelId, client } = body;
  if (!phone || !message) return res.status(400).json({ ok: false, error: "phone_and_message_required" });

  const wa = await sendWhatsApp({ phone, msg: message, client: client || undefined });
  if (wa.status !== 1) {
    return res.status(502).json({ ok: false, error: wa.message });
  }

  // Best-effort log. If CRM didn't pass leadId, we skip logging (CRM usually has it).
  if (leadId) {
    const sb = supa();
    // Discover tenant from the lead so we stay tenant-correct.
    const { data: leadRow } = await sb.from("bullion_leads")
      .select("tenant_id")
      .eq("id", leadId)
      .maybeSingle();
    const tenantId = leadRow?.tenant_id;
    if (tenantId) {
      await sb.from("bullion_messages").insert({
        tenant_id: tenantId,
        lead_id: leadId,
        phone: normalizePhone(phone),
        funnel_id: funnelId || null,
        wbiztool_msg_id: wa.msg_id || "",
        direction: "out",
        body: message,
        status: "sent",
      });
      await sb
        .from("bullion_leads")
        .update({
          last_msg: message,
          last_msg_at: new Date().toISOString(),
          bot_paused: true,
          status: "handoff",
        })
        .eq("id", leadId);
    }
  }

  return res.status(200).json({ ok: true, msg_id: wa.msg_id });
}
