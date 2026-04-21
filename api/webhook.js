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
import { getRates, ratesForPrompt } from "./_lib/rates.js";
import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { buildSystemPrompt, buildMessages } from "./_lib/prompt.js";
import { enrollLeadInDrip, cancelPendingForLead } from "./_lib/drip.js";
import {
  TENANT_ID,
  normalizePhone,
  OWNER_ALERT_PHONE,
  SUPABASE_SERVICE_KEY,
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL,
  CLAUDE_MODEL_ESCALATION,
  HARD_EXCHANGE_CAP,
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

    // 2. Upsert lead. We intentionally DO NOT pass the WhatsApp pushName as
    //    the lead's real name — it's just a display hint and users want to be
    //    asked properly during onboarding. We store pushName separately in
    //    wa_display_name.
    const { data: leadRow, error: upsertErr } = await sb.rpc("bullion_upsert_lead", {
      p_tenant_id: TENANT_ID,
      p_phone: phone,
      p_name: "",
      p_funnel_id: funnel.id,
      p_body: msg,
    });
    if (upsertErr) {
      console.error("upsert_lead failed", upsertErr);
      return res.status(200).json({ ok: false, reason: "upsert_failed" });
    }

    // 2b. Stash the WhatsApp display name so the operator has context even
    //     though the bot will still ask for the real name.
    if (name && leadRow.wa_display_name !== name) {
      await sb.from("bullion_leads")
        .update({ wa_display_name: name })
        .eq("id", leadRow.id);
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

    // 3b. Lead replied — cancel any pending drip messages (don't let cold-nurture
    //     fire when the lead is actively engaged).
    await cancelPendingForLead(leadRow.id, "lead_replied_inbound").catch(() => {});

    // 4. Bail if bot is paused on this lead (agent took over in CRM)
    if (leadRow.bot_paused) {
      return res.status(200).json({ ok: true, skipped: "bot_paused" });
    }

    // 4b. Hard cap — prevent runaway costs if a lead loops endlessly.
    if ((leadRow.exchanges_count || 0) >= HARD_EXCHANGE_CAP) {
      await sb.from("bullion_leads").update({
        bot_paused: true,
        status: "handoff",
      }).eq("id", leadRow.id);
      if (OWNER_ALERT_PHONE) {
        await sendWhatsApp({
          phone: OWNER_ALERT_PHONE,
          msg: `🚨 Hard cap reached — ${name || phone} on ${funnel.name} hit ${HARD_EXCHANGE_CAP} exchanges. Bot paused. Pick up now: https://ssjbots.vercel.app`,
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, reason: "hard_cap_reached" });
    }

    // 5. Build prompt context
    const maxExchanges = funnel.max_exchanges_before_handoff || 3;
    // Escalation = already handed off previously, OR past max exchanges this turn.
    // In escalation we upgrade model to Sonnet and soften the prompt. Bot keeps
    // replying until an agent sends a manual reply (which sets bot_paused=true).
    const inEscalation =
      leadRow.status === "handoff" ||
      (leadRow.exchanges_count || 0) >= maxExchanges;

    const [{ data: history }, rates, faqs] = await Promise.all([
      sb
        .from("bullion_messages")
        .select("direction,body,created_at,stage")
        .eq("tenant_id", TENANT_ID)
        .eq("lead_id", leadRow.id)
        .order("created_at", { ascending: false })
        .limit(20),
      getRates(),
      getFaqs(),
    ]);

    const chronological = (history || []).slice().reverse();
    // Drop the just-inserted inbound — we add it explicitly below
    const priorMessages = chronological.slice(0, -1);

    const system = buildSystemPrompt({
      persona: funnel.persona,
      funnel,
      ratesText: ratesForPrompt(rates),
      faqsText: faqsForPrompt(faqs),
      maxExchanges,
      isEscalation: inEscalation,
      lead: leadRow,
    });
    const messages = buildMessages({ history: priorMessages, inboundBody: msg });
    const model = inEscalation ? CLAUDE_MODEL_ESCALATION : CLAUDE_MODEL;

    // 6. Ask Claude — always (even in escalation, since a human hasn't picked up).
    let parsed;
    let claude;
    try {
      claude = await askClaude({ system, messages, model });
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

    // In escalation, stay in "handoff" status even if Claude returns CONTINUE
    // (until an agent actually replies in CRM and flips bot_paused=true).
    const nextStatus =
      parsed.action === "CONVERTED" ? "converted" :
      parsed.action === "HANDOFF" || inEscalation ? "handoff" :
      "active";

    // Merge any details Claude extracted from the user's message — only fill
    // fields that are currently empty (don't overwrite manual edits / earlier
    // captures).
    const ex = parsed.extracted || {};
    const captureOnlyIfEmpty = (currentVal, newVal) =>
      currentVal ? currentVal : (newVal && String(newVal).trim() ? String(newVal).trim() : null);

    const extractedPatch = {
      name: captureOnlyIfEmpty(leadRow.name, ex.name),
      city: captureOnlyIfEmpty(leadRow.city, ex.city),
      email: captureOnlyIfEmpty(leadRow.email, ex.email),
      bday: captureOnlyIfEmpty(leadRow.bday, ex.bday),
      anniversary: captureOnlyIfEmpty(leadRow.anniversary, ex.anniversary),
    };
    // Only include keys that are actually filled (avoids nulling out columns)
    const patchToApply = Object.fromEntries(
      Object.entries(extractedPatch).filter(([, v]) => v != null && v !== "")
    );

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
        // IMPORTANT: bot_paused is ONLY set by manual agent replies from the
        // CRM (via /api/send). We never auto-pause here — the bot keeps the
        // lead warm in escalation until a human takes over.
        bot_paused: leadRow.bot_paused,
        ...patchToApply,
      })
      .eq("id", leadRow.id);

    // 9b. If Claude marked this as QUOTE_SENT, enroll the lead in the funnel's
    //     drip sequence so we don't lose them if they go cold.
    if (parsed.action === "QUOTE_SENT") {
      await enrollLeadInDrip({ lead: leadRow, funnel }).catch((e) => console.error("enroll failed", e));
    }

    // 10. Alert owner on FIRST transition into handoff (not every subsequent reply)
    const justEnteredHandoff = !inEscalation && (parsed.action === "HANDOFF" || nextStatus === "handoff");
    if (justEnteredHandoff && OWNER_ALERT_PHONE) {
      const lastBotReply = priorMessages.slice().reverse().find((m) => m.direction === "out")?.body || "(none)";
      const alert = [
        `🤖 *Handoff* — lead needs you`,
        `👤 ${name || "(no name)"} · ${phone}`,
        `🎯 Funnel: ${funnel.name}`,
        `📍 Stage: ${parsed.stage} · Exchanges: ${(leadRow.exchanges_count || 0) + 1}`,
        ``,
        `*Last user msg:* ${msg.slice(0, 180)}`,
        `*Bot's last reply:* ${String(lastBotReply).slice(0, 180)}`,
        ``,
        `Open in CRM: https://ssjbots.vercel.app`,
      ].join("\n");
      await sendWhatsApp({ phone: OWNER_ALERT_PHONE, msg: alert }).catch(() => {});
    }

    return res.status(200).json({ ok: true, action: parsed.action, sent });
  } catch (err) {
    console.error("webhook handler error", err);
    return res.status(200).json({ ok: false, reason: "handler_error", error: String(err) });
  }
}
