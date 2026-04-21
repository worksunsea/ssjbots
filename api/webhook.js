// POST /api/webhook
// WbizTool incoming message webhook → Claude → WbizTool reply.
// Runs synchronously end-to-end (30–45s delay included).
//
// WbizTool webhook URL should be:
//   https://<your-vercel-domain>/api/webhook?secret=<WEBHOOK_SECRET>
//
// We always return 200 so WbizTool doesn't retry on our errors.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { askClaude, parseBotJson } from "./_lib/claude.js";
import { getRates, ratesSnippet } from "./_lib/rates.js";
import { buildSystemPrompt, buildMessages } from "./_lib/prompt.js";
import {
  TENANT_ID,
  normalizePhone,
  OWNER_ALERT_PHONE,
  SUPABASE_SERVICE_KEY,
  ANTHROPIC_API_KEY,
} from "./_lib/config.js";

export const config = { maxDuration: 120 }; // Fluid Compute default is 300; 120 is plenty.

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = () => 30_000 + Math.floor(Math.random() * 15_000); // 30–45s

function extractIncoming(body) {
  // Prefer raw JID (works for LID senders post-2024 WA privacy update).
  // Fall back to a "phone" extracted from common field names for older shapes.
  const jid = String(body.jid || "");
  const phoneRaw = body.from || body.phone || body.sender || body.msisdn || "";
  const phone = jid || normalizePhone(phoneRaw);
  const msg = body.body || body.message || body.msg || body.text || body.content || "";
  const waClient = String(body.whatsapp_client || body.client || body.to || "");
  const name = body.name || body.sender_name || body.pushname || "";
  const msgId = String(body.msg_id || body.id || body.message_id || "");
  return { phone, msg, waClient, name, msgId };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, ping: true });
  }

  // Optional shared-secret gate (recommended).
  if (WEBHOOK_SECRET && req.query.secret !== WEBHOOK_SECRET) {
    return res.status(200).json({ ok: false, reason: "bad_secret" });
  }

  if (!SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    console.error("Missing env: SUPABASE_SERVICE_KEY or ANTHROPIC_API_KEY");
    return res.status(200).json({ ok: false, reason: "missing_env" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { phone, msg, waClient, name, msgId } = extractIncoming(body);
  if (!phone || !msg) {
    console.warn("webhook: ignoring payload without phone/msg", { body });
    return res.status(200).json({ ok: false, reason: "no_phone_or_msg" });
  }

  const sb = supa();

  try {
    // 1. Resolve active funnel from wa_client (or fall back to wa_number)
    let funnel = null;
    if (waClient) {
      const { data } = await sb
        .from("funnels")
        .select("*, persona:personas(*)")
        .eq("tenant_id", TENANT_ID)
        .eq("wbiztool_client", waClient)
        .eq("active", true)
        .maybeSingle();
      funnel = data;
    }
    if (!funnel) {
      // fall back: any active funnel (if only one is running)
      const { data } = await sb
        .from("funnels")
        .select("*, persona:personas(*)")
        .eq("tenant_id", TENANT_ID)
        .eq("active", true)
        .limit(1);
      funnel = data?.[0] || null;
    }

    if (!funnel) {
      console.warn("webhook: no active funnel for wa_client", waClient);
      return res.status(200).json({ ok: false, reason: "no_active_funnel" });
    }

    // 2. Upsert lead
    const { data: leadRow, error: upsertErr } = await sb.rpc("bullion_upsert_lead", {
      p_tenant_id: TENANT_ID,
      p_phone: phone,
      p_name: name || "",
      p_funnel_id: funnel.id,
      p_body: msg,
    });
    if (upsertErr) {
      console.error("upsert_lead failed", upsertErr);
      return res.status(200).json({ ok: false, reason: "upsert_failed" });
    }

    // 3. Log inbound
    await sb.from("bullion_messages").insert({
      tenant_id: TENANT_ID,
      lead_id: leadRow.id,
      phone,
      funnel_id: funnel.id,
      wbiztool_msg_id: msgId,
      direction: "in",
      body: msg,
      stage: leadRow.stage,
      status: "received",
    });

    // 4. Bail if bot is paused on this lead (owner took over)
    if (leadRow.bot_paused) {
      return res.status(200).json({ ok: true, skipped: "bot_paused" });
    }

    // 5. Build prompt context
    const maxExchanges = funnel.max_exchanges_before_handoff || 3;
    const forceHandoff = (leadRow.exchanges_count || 0) >= maxExchanges;

    const [{ data: history }, rates] = await Promise.all([
      sb
        .from("bullion_messages")
        .select("direction,body,created_at,stage")
        .eq("tenant_id", TENANT_ID)
        .eq("lead_id", leadRow.id)
        .order("created_at", { ascending: false })
        .limit(20),
      getRates(),
    ]);

    const chronological = (history || []).slice().reverse();
    // Drop the just-inserted inbound — we add it explicitly below
    const priorMessages = chronological.slice(0, -1);

    const system = buildSystemPrompt({
      persona: funnel.persona,
      funnel,
      ratesText: ratesSnippet(rates),
      maxExchanges,
    });
    const messages = buildMessages({ history: priorMessages, inboundBody: msg });

    // 6. Ask Claude (unless we're already at handoff threshold)
    let parsed;
    if (forceHandoff) {
      parsed = {
        reply: "Thanks! Let me connect you to someone from our team who'll help personally. 🙏",
        action: "HANDOFF",
        stage: "handoff",
        product_interest: leadRow.product_interest || "unknown",
        qty_grams: leadRow.qty_grams || 0,
      };
    } else {
      let claude;
      try {
        claude = await askClaude({ system, messages });
      } catch (err) {
        console.error("Claude call failed", err);
        parsed = {
          reply: "Thanks for your message! Our team will get back to you shortly. 🙏",
          action: "HANDOFF",
          stage: "handoff",
          product_interest: "unknown",
          qty_grams: 0,
        };
      }
      if (claude) {
        parsed = parseBotJson(claude.text) || {
          reply: claude.text.slice(0, 300) || "Thanks! Will get back shortly.",
          action: "CONTINUE",
          stage: leadRow.stage || "qualifying",
          product_interest: "unknown",
          qty_grams: 0,
        };
      }
    }

    // 7. Human-feeling delay (30–45s) before sending
    await sleep(randDelay());

    // 8. Send via self-hosted wa-service (Baileys)
    const wa = await sendWhatsApp({ phone, msg: parsed.reply });
    const sent = wa.status === 1;

    // 9. Log outbound + update lead
    await sb.from("bullion_messages").insert({
      tenant_id: TENANT_ID,
      lead_id: leadRow.id,
      phone,
      funnel_id: funnel.id,
      wbiztool_msg_id: String(wa.msg_id || ""),
      direction: "out",
      body: parsed.reply,
      stage: parsed.stage,
      claude_action: parsed.action,
      status: sent ? "sent" : "failed",
    });

    const nextStatus =
      parsed.action === "HANDOFF" ? "handoff" :
      parsed.action === "CONVERTED" ? "converted" :
      "active";

    await sb
      .from("bullion_leads")
      .update({
        stage: parsed.stage,
        status: nextStatus,
        product_interest: parsed.product_interest || leadRow.product_interest,
        qty_grams: parsed.qty_grams || leadRow.qty_grams,
        last_msg: parsed.reply,
        last_msg_at: new Date().toISOString(),
        exchanges_count: (leadRow.exchanges_count || 0) + 1,
        bot_paused: parsed.action === "HANDOFF" ? true : leadRow.bot_paused,
      })
      .eq("id", leadRow.id);

    // 10. Alert owner on HANDOFF
    if (parsed.action === "HANDOFF" && OWNER_ALERT_PHONE) {
      await sendWhatsApp({
        phone: OWNER_ALERT_PHONE,
        msg: `🤖 Handoff needed — ${name || phone} on ${funnel.name}. Last msg: "${msg.slice(0, 120)}"`,
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, action: parsed.action, sent });
  } catch (err) {
    console.error("webhook handler error", err);
    return res.status(200).json({ ok: false, reason: "handler_error", error: String(err) });
  }
}
