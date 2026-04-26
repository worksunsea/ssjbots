// POST /api/webhook
// WbizTool incoming message webhook → Claude → WbizTool reply.
// Runs synchronously end-to-end (30–45s delay included).
//
// WbizTool webhook URL should be:
//   https://<your-vercel-domain>/api/webhook?secret=<WEBHOOK_SECRET>
//
// We always return 200 so WbizTool doesn't retry on our errors.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp, sendWhatsAppMedia } from "./_lib/wa.js";
import { askClaude, parseBotJson } from "./_lib/claude.js";
import { getRates, ratesForPrompt } from "./_lib/rates.js";
import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { buildSystemPrompt, buildMessages } from "./_lib/prompt.js";
import { enrollLeadInDrip, cancelPendingForLead, transitionLeadToFunnel } from "./_lib/drip.js";
import { matchFunnelByKeywords } from "./_lib/funnel-match.js";
import {
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
// Supabase query builders are PromiseLike (have .then) but not full Promises (no .catch).
// qx wraps them so we can fire-and-forget without crashing.
const qx = (q, onErr) => Promise.resolve(q).catch(onErr || (() => {}));
const daysUntil = (d) => Math.round((new Date(d) - new Date()) / 86400000);
const randDelay = () => 4_000 + Math.floor(Math.random() * 4_000); // 4–8s — human-feeling without risking wa-service retry

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

  // Shared-secret gate — required. WEBHOOK_SECRET must be set in Vercel env.
  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
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
  console.log("webhook:incoming", JSON.stringify({ phone, msg: msg.slice(0, 80), waClient, name, msgId, rawKeys: Object.keys(body) }));

  if (!phone || !msg) {
    console.warn("webhook: ignoring payload without phone/msg", { body });
    return res.status(200).json({ ok: false, reason: "no_phone_or_msg" });
  }

  // Never process messages from the owner's own number — prevents reply loops.
  if (OWNER_ALERT_PHONE && normalizePhone(phone) === normalizePhone(OWNER_ALERT_PHONE)) {
    console.log("webhook: skipping owner number", phone);
    return res.status(200).json({ ok: true, skipped: "owner_number" });
  }

  // Dedup is now enforced at the DB level via unique index on (wbiztool_msg_id, direction='in').
  // The insert at step 3 will fail with code 23505 if the same msgId arrives twice.
  // No SELECT needed here — that had a race condition anyway.

  // Gate 1 is applied AFTER funnel load (we need the funnel to know if it's send-only).
  // See below after allFunnels is loaded.

  const sb = supa();

  try {
    // 1. Load ALL active funnels across ALL tenants. Keyword match + session
    //    client picks one; that funnel's tenant_id drives the rest of the request.
    const { data: allFunnels } = await sb
      .from("funnels")
      .select("*, persona:personas(*)")
      .eq("active", true);

    if (!allFunnels?.length) {
      console.warn("webhook: no active funnels across tenants");
      return res.status(200).json({ ok: false, reason: "no_active_funnel" });
    }

    // Gate 1: only 8860866000 runs the bot (replies to inbound messages).
    // Every other number is send-only — used for drip, birthday wishes, broadcasts.
    // If an inbound message arrives on any other session, drop it silently.
    if (waClient) {
      const matchedFunnel = allFunnels.find((f) => String(f.wbiztool_client) === String(waClient));
      if (matchedFunnel) {
        const funnelPhone = normalizePhone(matchedFunnel.wa_number);
        if (!BOT_NUMBERS.includes(funnelPhone)) {
          console.log("webhook:gate1:dropped non-bot number", funnelPhone, matchedFunnel.id);
          return res.status(200).json({ ok: true, skipped: "non_bot_number" });
        }
      }
    }

    // 1b. Look up any existing lead for this phone (for funnel routing).
    const { data: existingLeads } = await sb
      .from("bullion_leads")
      .select("id,funnel_id,tenant_id")
      .eq("phone", phone)
      .limit(2);
    const existingLead = (existingLeads && existingLeads[0]) || null;

    // 2. Pick the funnel for THIS message:
    //    - Strong keyword match against any funnel → that funnel (a new campaign entry).
    //    - Else, if existing lead → stay in their current funnel.
    //    - Else, fallback: match by wbiztool_client if provided, else first active funnel.
    const keywordMatch = matchFunnelByKeywords(msg, allFunnels);
    let funnel = null;
    if (keywordMatch) {
      funnel = keywordMatch;
    } else if (existingLead?.funnel_id) {
      funnel = allFunnels.find((f) => f.id === existingLead.funnel_id) || null;
    }
    if (!funnel && waClient) {
      funnel = allFunnels.find((f) => String(f.wbiztool_client) === String(waClient)) || null;
    }
    if (!funnel) funnel = allFunnels[0];

    // Tenant comes from the resolved funnel. Everything downstream uses this.
    const tenantId = funnel.tenant_id;

    // 2. Upsert lead (lead already exists at this point).
    const { data: leadRow, error: upsertErr } = await sb.rpc("bullion_upsert_lead", {
      p_tenant_id: tenantId,
      p_phone: phone,
      p_name: "",
      p_funnel_id: funnel.id,
      p_body: msg,
    });
    if (upsertErr) {
      console.error("upsert_lead failed", upsertErr);
      return res.status(200).json({ ok: false, reason: "upsert_failed" });
    }
    console.log("webhook:lead_upserted", { leadId: leadRow.id, funnelId: funnel.id, phone });

    // 2b. Stash the WhatsApp display name.
    if (name && leadRow.wa_display_name !== name) {
      await sb.from("bullion_leads")
        .update({ wa_display_name: name })
        .eq("id", leadRow.id);
    }

    // 2c. Ensure a demand row exists for this lead so it appears in the Demands screen.
    //     One demand per lead (inbound enquiry). If already exists, leave it alone.
    const { data: existingDemand } = await sb.from("bullion_demands")
      .select("id")
      .eq("lead_id", leadRow.id)
      .limit(1)
      .maybeSingle();
    if (!existingDemand) {
      await qx(sb.from("bullion_demands").insert({
        tenant_id: tenantId,
        lead_id: leadRow.id,
        funnel_id: funnel.id,
        bot_active: true,
      }), (e) => console.error("demand_create failed", e));
    }

    // 3. Log inbound — insert first, check for duplicate via unique index on (wbiztool_msg_id, direction).
    // If two webhook calls race for the same msgId, the second insert fails here and we stop immediately.
    const { error: inboundInsertErr } = await sb.from("bullion_messages").insert({
      tenant_id: tenantId,
      lead_id: leadRow.id,
      phone,
      funnel_id: funnel.id,
      wbiztool_msg_id: msgId,
      direction: "in",
      body: msg,
      stage: leadRow.stage,
      status: "received",
    });
    if (inboundInsertErr) {
      // Unique constraint violation = duplicate message already being processed
      if (inboundInsertErr.code === "23505") {
        console.log("webhook: duplicate blocked by unique index", msgId);
        return res.status(200).json({ ok: true, skipped: "duplicate_db" });
      }
      console.error("webhook: inbound insert failed", inboundInsertErr);
    }

    // 3b. Lead replied — cancel any pending drip messages (don't let cold-nurture
    //     fire when the lead is actively engaged).
    await cancelPendingForLead(leadRow.id, "lead_replied_inbound").catch(() => {});

    // 4. Bail if bot is paused on this lead (agent took over in CRM)
    if (leadRow.bot_paused) {
      return res.status(200).json({ ok: true, skipped: "bot_paused" });
    }

    // 4a. DND — user opted out / got angry. Stay silent.
    if (leadRow.dnd) {
      return res.status(200).json({ ok: true, skipped: "dnd" });
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

    const [{ data: history }, rates, faqs, { data: activeDemands }] = await Promise.all([
      sb
        .from("bullion_messages")
        .select("direction,body,created_at,stage")
        .eq("tenant_id", tenantId)
        .eq("lead_id", leadRow.id)
        .order("created_at", { ascending: false })
        .limit(20),
      getRates(),
      getFaqs(tenantId),
      // Load the most recent active demand for this lead
      sb
        .from("bullion_demands")
        .select("*")
        .eq("lead_id", leadRow.id)
        .eq("bot_active", true)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const activeDemand = activeDemands?.[0] || null;
    // activeDemand injected into prompt for context if present; not a gate.

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
      demand: activeDemand,
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
    // Use the session that received the message for the reply (waClient).
    // Fall back to funnel.wbiztool_client for outbound-only contexts.
    const replyClient = waClient || funnel.wbiztool_client || undefined;
    const wa = await sendWhatsApp({ phone, msg: parsed.reply, client: replyClient });
    const sent = wa.status === 1;

    // 9. Log outbound + update lead
    await sb.from("bullion_messages").insert({
      tenant_id: tenantId,
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
      parsed.action === "DND" ? "dead" :
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

    const isDnd = parsed.action === "DND";
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
        bot_paused: isDnd ? true : leadRow.bot_paused,
        dnd: isDnd ? true : leadRow.dnd,
        dnd_reason: isDnd ? (msg || "").slice(0, 200) : leadRow.dnd_reason,
        dnd_at: isDnd ? new Date().toISOString() : leadRow.dnd_at,
        ...patchToApply,
      })
      .eq("id", leadRow.id);

    // Cancel any pending drip messages immediately on DND
    if (isDnd) {
      await cancelPendingForLead(leadRow.id, "dnd").catch(() => {});
    }

    // 9a-bis. Handle demand_update from Claude
    const du = parsed.demand_update;
    if (du && activeDemand) {
      const demandPatch = {};
      if (du.product_type)       demandPatch.product_category = du.product_type;
      if (du.occasion)           demandPatch.occasion = du.occasion;
      if (du.occasion_date)      demandPatch.occasion_date = du.occasion_date;
      if (du.for_whom)           demandPatch.for_whom = du.for_whom;
      if (du.budget_confirmed != null) demandPatch.budget_confirmed = du.budget_confirmed;
      if (du.ai_summary)         demandPatch.ai_summary = du.ai_summary;
      if (du.needs_qualified)    demandPatch.needs_qualified = true;
      if (Object.keys(demandPatch).length) {
        demandPatch.updated_at = new Date().toISOString();
        await qx(sb.from("bullion_demands").update(demandPatch).eq("id", activeDemand.id));
      }

      // Wedding life event detected
      if (du.wedding_date) {
        await qx(sb.from("bullion_leads").update({
          wedding_date: du.wedding_date,
          wedding_family_member: du.wedding_family_member || null,
        }).eq("id", leadRow.id));

        // Schedule a reminder for the owner on the wedding date
        if (du.wedding_date) {
          const weddingTs = new Date(du.wedding_date).getTime();
          if (!isNaN(weddingTs) && weddingTs > Date.now()) {
            const reminderBody = `📅 Wedding day — ${leadRow.name || phone}${du.wedding_family_member ? ` (${du.wedding_family_member})` : ""}. Wish them today! CRM: https://ssjbots.vercel.app`;
            await qx(sb.from("bullion_scheduled_messages").insert({
              tenant_id: tenantId,
              lead_id: leadRow.id,
              funnel_id: funnel.id,
              send_at: new Date(weddingTs).toISOString(),
              body: reminderBody,
              status: "pending",
              is_reminder: true,
            }));
          }
        }
      }

      // Non-gold fully qualified → handoff to sales team
      const NON_GOLD = ["diamond","polki","kundan","gemstone","solitaire","lab_diamond","other"];
      if (du.needs_qualified && NON_GOLD.includes((activeDemand.product_category || "").toLowerCase())) {
        // Alert the sales team if not already notified
        if (!activeDemand.sales_notified_at && OWNER_ALERT_PHONE) {
          const demandRow = { ...activeDemand, ...demandPatch };
          const urgencyLine = demandRow.occasion_date
            ? `\n📅 Occasion: ${demandRow.occasion || "wedding/event"} on ${demandRow.occasion_date} (${daysUntil(demandRow.occasion_date)} days)`
            : "";
          const alert = [
            `🔔 *Qualified Demand — Action Required*`,
            `👤 ${leadRow.name || phone} · ${phone}`,
            `💎 Product: ${demandRow.product_category || "custom jewellery"}`,
            `📝 ${demandRow.description || "see CRM"}`,
            demandRow.for_whom ? `👥 For: ${demandRow.for_whom}` : "",
            demandRow.budget ? `💰 Budget: ₹${Number(demandRow.budget).toLocaleString("en-IN")}` : "",
            urgencyLine,
            demandRow.ai_summary ? `\n📋 Summary: ${demandRow.ai_summary}` : "",
            `\nOpen CRM: https://ssjbots.vercel.app`,
          ].filter(Boolean).join("\n");
          await sendWhatsApp({ phone: OWNER_ALERT_PHONE, msg: alert }).catch(() => {});
          await qx(sb.from("bullion_demands").update({ sales_notified_at: new Date().toISOString() }).eq("id", activeDemand.id));
        }
      }
    }

    // 9a-ter. Handle visit_update from Claude
    const vu = parsed.visit_update;
    if (vu && activeDemand) {
      // Client confirmed the visit
      if (vu.visit_confirmed && !activeDemand.visit_confirmed) {
        await qx(sb.from("bullion_demands").update({ visit_confirmed: true }).eq("id", activeDemand.id));
      }

      // New or rescheduled visit date given
      if (vu.visit_date) {
        const visitTs = Date.parse(vu.visit_date);
        if (!isNaN(visitTs) && visitTs > Date.now()) {
          // Cancel existing visit reminder messages for this lead
          await qx(sb.from("bullion_scheduled_messages")
            .update({ status: "canceled", canceled_reason: vu.rescheduled ? "rescheduled" : "replaced" })
            .eq("lead_id", leadRow.id)
            .in("message_type", ["visit_reminder", "visit_day"])
            .eq("status", "pending")
            );

          const visitTime = new Date(visitTs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
          const visitDateStr = new Date(visitTs).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
          const clientName = leadRow.name || "Sir/Ma'am";

          // D-1 reminder (24h before)
          const d1ts = visitTs - 24 * 60 * 60 * 1000;
          if (d1ts > Date.now()) {
            await qx(sb.from("bullion_scheduled_messages").insert({
              tenant_id: tenantId, lead_id: leadRow.id, funnel_id: funnel.id,
              send_at: new Date(d1ts).toISOString(),
              body: `Hi ${clientName}, just confirming your visit to Sun Sea Jewellers tomorrow (${visitDateStr}) at ${visitTime}. Looking forward to meeting you! Please reply YES to confirm. 🙏`,
              status: "pending",
              message_type: "visit_reminder",
            }));
          }

          // D-0 morning reminder (9 AM on visit day IST)
          const visitDay9am = new Date(visitTs);
          visitDay9am.setUTCHours(3, 30, 0, 0); // 9 AM IST = 3:30 AM UTC
          if (visitDay9am > new Date()) {
            await qx(sb.from("bullion_scheduled_messages").insert({
              tenant_id: tenantId, lead_id: leadRow.id, funnel_id: funnel.id,
              send_at: visitDay9am.toISOString(),
              body: `Good morning ${clientName}! 🙏 A warm reminder — your visit to Sun Sea Jewellers is today at ${visitTime}, Karol Bagh. We look forward to welcoming you!`,
              status: "pending",
              message_type: "visit_day",
            }));
          }

          // Update demand
          const visitPatch = {
            visit_scheduled_at: new Date(visitTs).toISOString(),
            visit_confirmed: false,
            updated_at: new Date().toISOString(),
          };
          if (vu.rescheduled) {
            visitPatch.visit_rescheduled_count = (activeDemand.visit_rescheduled_count || 0) + 1;
          }
          await qx(sb.from("bullion_demands").update(visitPatch).eq("id", activeDemand.id));
        }
      }
    }

    // 9a-quater. Send authority assets to brand-new leads (first real exchange)
    if ((leadRow.exchanges_count || 0) === 0 && parsed.action !== "DND") {
      const { data: assets } = await sb
        .from("bullion_media_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq("send_to_new_leads", true)
        .order("sort_order", { ascending: true })
        .limit(3);
      for (const asset of assets || []) {
        if (!asset.url) continue;
        await sleep(3000);
        // Send as WA media attachment if it's an image/video/pdf; fall back to text link
        const mediaTypes = ["image","video","pdf","document"];
        if (mediaTypes.includes(asset.asset_type)) {
          const mediaType = asset.asset_type === "pdf" ? "document" : asset.asset_type;
          const wa2 = await sendWhatsAppMedia({ phone, mediaUrl: asset.url, mediaType, caption: asset.caption || "", client: replyClient }).catch(() => ({ status: 0 }));
          if (wa2.status === 1) continue; // sent as media, skip fallback
        }
        // Fallback: text message with URL
        const assetMsg = [asset.caption || "", asset.url].filter(Boolean).join("\n");
          await sendWhatsApp({ phone, msg: assetMsg }).catch(() => {});
        }
      }
    }

    // 9b. If Claude marked this as QUOTE_SENT, enroll the lead in the funnel's
    //     drip sequence so we don't lose them if they go cold.
    if (parsed.action === "QUOTE_SENT") {
      await enrollLeadInDrip({ lead: leadRow, funnel }).catch((e) => console.error("enroll failed", e));
    }

    // 9c. On CONVERTED, auto-transition to the funnel's next_on_convert target
    //     (e.g. after_sales). The lead's captured fields (name, city, bday)
    //     come along automatically.
    if (parsed.action === "CONVERTED" && funnel.next_on_convert) {
      await transitionLeadToFunnel({
        leadId: leadRow.id,
        newFunnelId: funnel.next_on_convert,
        reason: "converted",
      }).catch((e) => console.error("transition on convert failed", e));
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
