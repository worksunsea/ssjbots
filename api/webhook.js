// POST /api/webhook
// Inbound WA message → Claude FAQ responder → reply.
// No funnel context. Bot answers using SSJ FAQs + rates.
// Funnels/demands are assigned manually by telecallers in CRM.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp, sendWhatsAppMedia } from "./_lib/wa.js";
import { askAI, parseBotJson } from "./_lib/ai.js";
import { getRates, ratesForPrompt } from "./_lib/rates.js";
import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { buildSystemPrompt, buildMessages } from "./_lib/prompt.js";
import { handleOwnerMessage } from "./_lib/ownerCommand.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import {
  normalizePhone,
  BOT_NUMBERS,
  OWNER_ALERT_PHONE,
  OWNER_PHONE,
  WA_SESSION_CLIENT_ID,
  SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  HARD_EXCHANGE_CAP,
  TENANT_ID,
} from "./_lib/config.js";

export const config = { maxDuration: 120 };

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qx = (q, onErr) => Promise.resolve(q).catch(onErr || (() => {}));
const randDelay = () => 4_000 + Math.floor(Math.random() * 4_000);

function extractIncoming(body) {
  const jid = String(body.jid || "");
  const senderPn = String(body.sender_pn || "");
  const phoneRaw = body.from || body.phone || body.sender || body.msisdn || "";
  const normPn = normalizePhone(senderPn);
  const normFrom = normalizePhone(phoneRaw);
  let phone = "";
  if (normPn && normPn.length >= 8) phone = normPn;
  else if (normFrom && normFrom.length >= 8) phone = normFrom;
  else if (jid.endsWith("@s.whatsapp.net")) phone = normalizePhone(jid.split("@")[0]);
  else phone = jid || normFrom;
  const msg = body.body || body.message || body.msg || body.text || body.content || "";
  const waClient = String(body.whatsapp_client || body.client || body.to || "");
  const name = body.name || body.sender_name || body.pushname || "";
  const msgId = String(body.msg_id || body.id || body.message_id || "");
  return { phone, msg, waClient, name, msgId, jid };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, ping: true });
  }

  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
    return res.status(200).json({ ok: false, reason: "bad_secret" });
  }

  if (!SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
    console.error("Missing env: SUPABASE_SERVICE_KEY or OPENAI_API_KEY");
    return res.status(200).json({ ok: false, reason: "missing_env" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { phone, msg, waClient, name, msgId, jid } = extractIncoming(body);
  console.log("webhook:incoming", JSON.stringify({ phone, msg: msg.slice(0, 80), waClient, name, msgId }));

  // ── Missed call auto-reply ───────────────────────────────────────────────────
  const isMissedCall = body.event_type === "call_missed" || (body.type === "call" && body.status === "missed");
  if (isMissedCall && phone) {
    try {
      const sb = supa();
      const { data: configs } = await sb.from("bullion_dropdowns").select("field,value").eq("tenant_id", TENANT_ID).eq("field", "missed_call_auto_reply");
      const template = configs?.[0]?.value || "Hi! You tried calling Sun Sea Jewellers. We're sorry we missed you! Our team will call you back shortly. 💎";
      await sendWhatsApp({ phone: jid || phone, msg: template, client: waClient || null });
    } catch (e) { console.error("missed_call_reply failed", e); }
    return res.status(200).json({ ok: true, handled: "missed_call_reply" });
  }

  if (!phone || !msg) return res.status(200).json({ ok: false, reason: "no_phone_or_msg" });

  // ── Owner WhatsApp commands: task assignment, on-demand report, resource search ──
  // Only Saurav's own number reaches this branch; everyone else falls through
  // to the normal lead/FAQ bot below.
  if (OWNER_PHONE && normalizePhone(phone) === normalizePhone(OWNER_PHONE)) {
    try {
      const sb = supa();
      const { replyText, mediaUrl, mediaType, filename, caption, items } = await handleOwnerMessage(sb, msg);
      const sendTarget = jid || phone;
      const client = waClient || WA_SESSION_CLIENT_ID;
      if (items?.length) {
        // Multiple matches (e.g. 3 bank accounts for one entity) — send each,
        // small gap between so WhatsApp doesn't collapse/reorder them.
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.mediaUrl) {
            await sendWhatsAppMedia({ phone: sendTarget, mediaUrl: it.mediaUrl, mediaType: it.mediaType || "image", filename: it.filename, caption: it.caption || "", client });
          } else if (it.text) {
            await sendWhatsApp({ phone: sendTarget, msg: it.text, client });
          }
          if (i < items.length - 1) await sleep(1200);
        }
      } else if (mediaUrl) {
        await sendWhatsAppMedia({ phone: sendTarget, mediaUrl, mediaType: mediaType || "image", filename, caption: caption || "", client });
      } else if (replyText) {
        await sendWhatsApp({ phone: sendTarget, msg: replyText, client });
      }
    } catch (err) {
      console.error("webhook: owner command failed", err);
    }
    return res.status(200).json({ ok: true, handled: "owner_command" });
  }

  // Skip the owner's own number — prevents loops
  if (OWNER_ALERT_PHONE && normalizePhone(phone) === normalizePhone(OWNER_ALERT_PHONE)) {
    return res.status(200).json({ ok: true, skipped: "owner_number" });
  }

  const sb = supa();

  try {
    // ── Resolve effective bot numbers: DB config first, env var fallback ────────
    const { data: botNumCfg } = await sb.from("bullion_dropdowns")
      .select("value").eq("tenant_id", TENANT_ID).eq("field", "bot_numbers").eq("active", true).maybeSingle();
    const effectiveBotNumbers = botNumCfg?.value
      ? botNumCfg.value.split(",").map((n) => normalizePhone(n.trim())).filter(Boolean)
      : BOT_NUMBERS;

    // ── Gate 1: only reply on sessions whose ACTUAL phone is in bot numbers ─────
    // session_phone is the real connected phone sent by wa-service — use it as
    // the authoritative check so secondary sessions (skg, etc.) never bot-reply
    // even if they're assigned as wbiztool_client on a funnel.
    if (waClient) {
      const sessionPhone = body.session_phone
        ? normalizePhone(String(body.session_phone).replace(/[:@].*/, ""))
        : null;

      if (sessionPhone) {
        if (!effectiveBotNumbers.includes(sessionPhone)) {
          console.log("webhook:gate1:dropped non-bot session_phone", sessionPhone, "client", waClient);
          return res.status(200).json({ ok: true, skipped: "non_bot_session" });
        }
      } else {
        // No session_phone — fall back to funnel wa_number lookup
        const { data: sessionFunnels } = await sb.from("funnels").select("wa_number,wbiztool_client").eq("active", true);
        const matched = (sessionFunnels || []).find((f) => String(f.wbiztool_client) === String(waClient));
        if (!matched) {
          console.log("webhook:gate1:dropped unknown session", waClient);
          return res.status(200).json({ ok: true, skipped: "unknown_session" });
        }
        if (!effectiveBotNumbers.includes(normalizePhone(matched.wa_number || ""))) {
          console.log("webhook:gate1:dropped non-bot number", matched.wa_number, "session", waClient);
          return res.status(200).json({ ok: true, skipped: "non_bot_number" });
        }
      }
    }

    // ── Upsert inbox lead (no funnel) ─────────────────────────────────────────
    // One inbox lead per phone — partial unique index ensures no duplicates.
    // Find lead by phone — one lead per phone (unique constraint on tenant_id+phone).
    // Bot works on whatever lead exists, regardless of which funnel it's in.
    let leadRow;
    const { data: existing } = await sb.from("bullion_leads")
      .select("*").eq("tenant_id", TENANT_ID).eq("phone", phone).maybeSingle();

    if (existing) {
      await qx(sb.from("bullion_leads").update({
        last_msg: msg,
        last_msg_at: new Date().toISOString(),
        ...(name && name !== existing.wa_display_name ? { wa_display_name: name } : {}),
      }).eq("id", existing.id));
      leadRow = existing;
    } else {
      const { data: inserted, error: insertErr } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID,
        phone,
        funnel_id: null,
        name: name || "",
        wa_display_name: name || "",
        last_msg: msg,
        last_msg_at: new Date().toISOString(),
        stage: "greeting",
        status: "active",
        bot_paused: false,
      }).select().single();
      if (insertErr) {
        const { data: refetch } = await sb.from("bullion_leads")
          .select("*").eq("tenant_id", TENANT_ID).eq("phone", phone).maybeSingle();
        leadRow = refetch;
      } else {
        leadRow = inserted;
        sendPushNotification({
          userId: "admin",
          title: "🆕 New Lead",
          body: `${name || phone} messaged in — unassigned, no funnel yet.`,
          url: "/",
        }).catch(() => {});
      }
    }

    if (!leadRow) {
      console.error("webhook: could not upsert inbox lead", phone);
      return res.status(200).json({ ok: false, reason: "lead_upsert_failed" });
    }

    console.log("webhook:lead", { leadId: leadRow.id, phone, exchanges: leadRow.exchanges_count });

    // ── Skip if manually paused by staff ─────────────────────────────────────
    if (leadRow.bot_paused) {
      console.log("webhook:skipped bot_paused", leadRow.id);
      return res.status(200).json({ ok: true, skipped: "bot_paused" });
    }

    if (leadRow.dnd) {
      return res.status(200).json({ ok: true, skipped: "dnd" });
    }

    // Hard safety cap (absolute last resort)
    if ((leadRow.exchanges_count || 0) >= HARD_EXCHANGE_CAP) {
      await qx(sb.from("bullion_leads").update({ bot_paused: true }).eq("id", leadRow.id));
      console.log("webhook:hard_cap_reached", leadRow.id);
      return res.status(200).json({ ok: true, reason: "hard_cap" });
    }

    // ── Log inbound message ───────────────────────────────────────────────────
    const { error: inboundErr } = await sb.from("bullion_messages").insert({
      tenant_id: TENANT_ID,
      lead_id: leadRow.id,
      phone,
      wbiztool_msg_id: msgId,
      direction: "in",
      body: msg,
      stage: leadRow.stage || "greeting",
      status: "received",
      wa_client: waClient || null,
    });
    if (inboundErr?.code === "23505") {
      console.log("webhook:duplicate", msgId);
      return res.status(200).json({ ok: true, skipped: "duplicate" });
    }

    // ── Build prompt + call Claude ────────────────────────────────────────────
    const [{ data: history }, rates, faqs] = await Promise.all([
      sb.from("bullion_messages")
        .select("direction,body,created_at").eq("lead_id", leadRow.id)
        .order("created_at", { ascending: false }).limit(20),
      getRates(),
      getFaqs(TENANT_ID),
    ]);

    const priorMessages = (history || []).slice().reverse().slice(0, -1);
    const system = buildSystemPrompt({ ratesText: ratesForPrompt(rates), faqsText: faqsForPrompt(faqs), lead: leadRow });
    const messages = buildMessages({ history: priorMessages, inboundBody: msg });

    console.log("webhook:ai_model", OPENAI_MODEL);
    let parsed;
    try {
      const ai = await askAI({ system, messages, model: OPENAI_MODEL });
      parsed = parseBotJson(ai.text) || { reply: ai.text.slice(0, 300) || "Thanks! Will get back shortly.", action: "CONTINUE" };
    } catch (err) {
      console.error("webhook:ai_err", String(err?.message || err));
      parsed = { reply: "Thanks for your message! Our team will get back to you shortly. 🙏", action: "CONTINUE" };
    }

    // ── Human-feeling delay ───────────────────────────────────────────────────
    await sleep(randDelay());

    // ── Send reply ────────────────────────────────────────────────────────────
    const sendTarget = jid || phone;
    const wa = await sendWhatsApp({ phone: sendTarget, msg: parsed.reply, client: waClient || undefined });
    const sent = wa.status === 1;

    // ── Log outbound + update lead ────────────────────────────────────────────
    await qx(sb.from("bullion_messages").insert({
      tenant_id: TENANT_ID,
      lead_id: leadRow.id,
      phone,
      wbiztool_msg_id: String(wa.msg_id || ""),
      direction: "out",
      body: parsed.reply,
      stage: parsed.stage || leadRow.stage || "greeting",
      claude_action: parsed.action,
      status: sent ? "sent" : "failed",
      wa_client: waClient || null,
    }));

    // Extract any volunteered details (name, city, bday, anniversary)
    const ex = parsed.extracted || {};
    const patch = {};
    if (ex.name && !leadRow.name) patch.name = String(ex.name).trim();
    if (ex.city && !leadRow.city) patch.city = String(ex.city).trim();
    if (ex.email && !leadRow.email) patch.email = String(ex.email).trim();
    if (ex.bday && !leadRow.bday) patch.bday = String(ex.bday).trim();
    if (ex.anniversary && !leadRow.anniversary) patch.anniversary = String(ex.anniversary).trim();

    const isDnd = parsed.action === "DND";
    await qx(sb.from("bullion_leads").update({
      exchanges_count: (leadRow.exchanges_count || 0) + 1,
      stage: parsed.stage || leadRow.stage || "greeting",
      dnd: isDnd ? true : leadRow.dnd,
      dnd_reason: isDnd ? msg.slice(0, 200) : leadRow.dnd_reason,
      dnd_at: isDnd ? new Date().toISOString() : leadRow.dnd_at,
      updated_at: new Date().toISOString(),
      ...patch,
    }).eq("id", leadRow.id));

    // ── Auto-create demand when Claude has enough info ─────────────────────────
    // Telecaller then assigns a funnel in CRM and takes over.
    if (parsed.create_demand && (leadRow.name || ex.name) && parsed.demand_summary) {
      const { data: existingDemand } = await sb.from("bullion_demands")
        .select("id").eq("lead_id", leadRow.id).is("funnel_id", null).maybeSingle();
      if (!existingDemand) {
        await qx(sb.from("bullion_demands").insert({
          tenant_id: TENANT_ID,
          lead_id: leadRow.id,
          funnel_id: null,
          product_category: parsed.product_category || "other",
          ai_summary: parsed.demand_summary,
          bot_active: false,
          created_by: "bot",
        }), (e) => console.error("demand create failed", e));
        console.log("webhook:demand_created", { leadId: leadRow.id, summary: parsed.demand_summary });
        sendPushNotification({
          userId: "admin",
          title: "📇 New Demand",
          body: `${leadRow.name || leadRow.phone} — ${parsed.demand_summary} (unassigned)`,
          url: "/",
        }).catch(() => {});
      }
    }

    return res.status(200).json({ ok: true, action: parsed.action, sent });
  } catch (err) {
    console.error("webhook handler error", err);
    return res.status(200).json({ ok: false, reason: "handler_error", error: String(err) });
  }
}
