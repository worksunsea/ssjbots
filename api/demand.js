// POST /api/demand
// Create a new demand record, find/create the lead, generate an AI-personalized
// opening message, and send it via WhatsApp to activate the bot.
//
// Body: {
//   phone, name?, description, productCategory, budget?,
//   occasion?, occasionDate?, forWhom?, imageUrls?,
//   funnelId?, tenantId?, createdBy?, leadId?
// }

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { askClaude } from "./_lib/claude.js";
import { normalizePhone, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, CLAUDE_MODEL_ESCALATION } from "./_lib/config.js";

export const config = { maxDuration: 60 };

const NON_GOLD = ["diamond", "polki", "kundan", "gemstone", "solitaire", "lab_diamond", "other"];
const CATEGORY_TO_FUNNEL = {
  gold:        "bullion",
  silver:      "bullion",
  gold_coin:   "bullion",
  silver_coin: "bullion",
  diamond:     "solitaire",
  polki:       "antique",
  kundan:      "antique",
  gemstone:    "gemstone",
  solitaire:   "solitaire",
  lab_diamond: "lab_diamond",
  other:       "non_gold_qualify",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: "missing_env" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const rawPhone = body.phone || "";
  const phone = normalizePhone(rawPhone);
  if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

  const tenantId = body.tenantId || process.env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
  const sb = supa();

  try {
    // 1. Find or create the lead (contact record)
    let lead;
    if (body.leadId) {
      const { data } = await sb.from("bullion_leads").select("*").eq("id", body.leadId).eq("tenant_id", tenantId).single();
      lead = data;
      if (!lead) return res.status(403).json({ ok: false, error: "lead_not_found_or_unauthorized" });
    }
    if (!lead) {
      // Upsert by phone
      const { data: upserted } = await sb.rpc("bullion_upsert_lead", {
        p_tenant_id: tenantId,
        p_phone: phone,
        p_name: body.name || "",
        p_funnel_id: pickFunnel(body.productCategory),
        p_body: body.description || "",
      });
      lead = upserted;
    }
    if (!lead) return res.status(500).json({ ok: false, error: "lead_upsert_failed" });

    // Update name if provided and not yet set
    if (body.name && !lead.name) {
      await sb.from("bullion_leads").update({ name: body.name }).eq("id", lead.id);
      lead.name = body.name;
    }

    // Duplicate guard: if there's already an active demand for this lead and
    // the caller hasn't explicitly set allowDuplicate=true, return the existing one.
    if (!body.allowDuplicate) {
      const { data: existing } = await sb.from("bullion_demands")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("bot_active", true)
        .limit(1)
        .maybeSingle();
      if (existing) {
        return res.status(200).json({ ok: false, error: "duplicate_demand", existingDemandId: existing.id, leadId: lead.id });
      }
    }

    // 2. Pick funnel
    const funnelId = body.funnelId || pickFunnel(body.productCategory);
    const { data: funnel } = await sb.from("funnels").select("*").eq("id", funnelId).single();
    const activeFunnel = funnel || null;

    // 3. Get first step of the funnel (for fms_step_id)
    const { data: firstStep } = await sb
      .from("bullion_funnel_steps")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("funnel_id", funnelId)
      .eq("active", true)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    // 4. Create demand record
    const occasionDateVal = body.occasionDate || null;
    const visitScheduledAt = body.visitScheduledAt ? new Date(body.visitScheduledAt).toISOString() : null;
    const { data: demand, error: demandErr } = await sb
      .from("bullion_demands")
      .insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        funnel_id: funnelId,
        description: body.description || null,
        product_category: body.productCategory || "other",
        budget: body.budget ? Number(body.budget) : null,
        image_urls: body.imageUrls || [],
        occasion: body.occasion || null,
        occasion_date: occasionDateVal,
        for_whom: body.forWhom || null,
        visit_scheduled_at: visitScheduledAt,
        fms_step_id: firstStep?.id || null,
        assigned_to: body.assignedTo || null,
        created_by: body.createdBy || null,
        bot_active: false,
      })
      .select()
      .single();

    if (demandErr) {
      console.error("demand insert failed", demandErr);
      return res.status(500).json({ ok: false, error: demandErr.message });
    }

    // 5. Generate personalized AI opening message
    const clientName = lead.name || body.name || "";
    const isNonGold = NON_GOLD.includes(body.productCategory || "");

    const openingSystem = [
      "You are a warm WhatsApp assistant for Sun Sea Jewellers, a premium jewellery house in Karol Bagh, New Delhi.",
      "Write a short, personalized opening WhatsApp message to start a conversation about a customer's jewellery enquiry.",
      "Rules:",
      "- Address the client by name (use 'Sir [name]' or 'Ma'am [name]' if name is known; otherwise 'Sir/Ma'am')",
      "- Be warm and professional — premium jewellery house tone",
      "- Mention the product/occasion briefly to show you understand their enquiry",
      "- If occasion date is NOT known, naturally ask when they need it by",
      "- Keep it to 2–3 sentences max",
      "- No markdown, no bullet points, just the message text",
      "- Do NOT quote prices in this opening message",
      isNonGold
        ? "- Since this is a custom/design enquiry (not bullion), let them know an expert will personally assist and ask for a few more details"
        : "- Offer to share product options and rates",
    ].join("\n");

    const openingContext = [
      clientName ? `Client name: ${clientName}` : "Client name: not known",
      `Product enquiry: ${body.productCategory || "jewellery"}`,
      body.description ? `Description: ${body.description}` : "",
      body.occasion ? `Occasion: ${body.occasion}` : "",
      body.occasionDate ? `Occasion date: ${body.occasionDate}` : "Occasion date: not known yet",
      body.forWhom ? `For: ${body.forWhom}` : "",
      body.budget ? `Budget: ₹${Number(body.budget).toLocaleString("en-IN")}` : "",
    ].filter(Boolean).join("\n");

    let openingMsg = "";
    try {
      const claude = await askClaude({
        system: openingSystem,
        messages: [{ role: "user", content: `Write the opening WhatsApp message for this demand:\n\n${openingContext}` }],
        maxTokens: 200,
        model: CLAUDE_MODEL_ESCALATION,
      });
      openingMsg = (claude?.text || "").trim();
    } catch (e) {
      console.error("Claude opening message failed", e);
    }

    // Fallback if Claude fails
    if (!openingMsg) {
      const name = clientName ? `Sir/Ma'am ${clientName}` : "Sir/Ma'am";
      openingMsg = `Hello ${name}, thank you for reaching out to Sun Sea Jewellers! I'm here to assist with your enquiry. Could you share a bit more about what you're looking for?`;
    }

    const skipBot = body.skipBot === true;
    let sent = false;
    let openingMsgSent = "";
    let waLastErr = null;

    if (!skipBot) {
      // 6. Send opening message via WhatsApp (use funnel's WA session)
      const waClient = activeFunnel?.wbiztool_client || null;
      const wa = await sendWhatsApp({ phone, msg: openingMsg, client: waClient });
      sent = wa.status === 1;
      if (!sent) { waLastErr = wa.message || "unknown"; console.error("WA send failed", { phone, client: waClient, waResponse: wa }); }
      openingMsgSent = openingMsg;

      // 7. Log to bullion_messages
      await sb.from("bullion_messages").insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        phone,
        funnel_id: funnelId,
        wbiztool_msg_id: String(wa.msg_id || ""),
        direction: "out",
        body: openingMsg,
        stage: "greeting",
        claude_action: "DEMAND_OPENED",
        status: sent ? "sent" : "failed",
      });

      // 7a. Schedule visit reminders if visit date was provided upfront
      if (visitScheduledAt) {
        const visitTs = new Date(visitScheduledAt).getTime();
        const vName = lead.name || body.name || "Sir/Ma'am";
        const visitTime = new Date(visitTs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
        const visitDateStr = new Date(visitTs).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
        const d1ts = visitTs - 24 * 60 * 60 * 1000;
        if (d1ts > Date.now()) {
          const { error: e1 } = await sb.from("bullion_scheduled_messages").insert({
            tenant_id: tenantId, lead_id: lead.id, funnel_id: funnelId,
            send_at: new Date(d1ts).toISOString(),
            body: `Hi ${vName}, just confirming your visit to Sun Sea Jewellers tomorrow (${visitDateStr}) at ${visitTime}. Looking forward to meeting you! Please reply YES to confirm. 🙏`,
            status: "pending", message_type: "visit_reminder",
          });
          if (e1) console.error("visit_reminder insert", e1);
        }
        const visitDay9am = new Date(visitTs);
        visitDay9am.setUTCHours(3, 30, 0, 0);
        if (visitDay9am > new Date()) {
          const { error: e2 } = await sb.from("bullion_scheduled_messages").insert({
            tenant_id: tenantId, lead_id: lead.id, funnel_id: funnelId,
            send_at: visitDay9am.toISOString(),
            body: `Good morning ${vName}! 🙏 A warm reminder — your visit to Sun Sea Jewellers is today at ${visitTime}, Karol Bagh. We look forward to welcoming you!`,
            status: "pending", message_type: "visit_day",
          });
          if (e2) console.error("visit_day insert", e2);
        }
      }

      // 7b. Send authority assets to this new lead (brochure / intro video)
      const { data: assets } = await sb
        .from("bullion_media_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq("send_to_new_leads", true)
        .order("sort_order", { ascending: true })
        .limit(3);
      for (const asset of assets || []) {
        const assetMsg = [asset.caption || "", asset.url].filter(Boolean).join("\n");
        if (assetMsg.trim()) {
          await new Promise((r) => setTimeout(r, 2000));
          try { await sendWhatsApp({ phone, msg: assetMsg }); } catch {}
          await sb.from("bullion_messages").insert({
            tenant_id: tenantId, lead_id: lead.id, phone, funnel_id: funnelId,
            direction: "out", body: assetMsg,
            stage: "greeting", claude_action: "AUTHORITY_ASSET", status: "sent",
          });
        }
      }

      // 8. Activate bot on lead + demand
      await sb.from("bullion_leads").update({
        status: "active",
        bot_paused: false,
        funnel_id: funnelId,
        last_msg: openingMsg,
        last_msg_at: new Date().toISOString(),
      }).eq("id", lead.id);

      await sb.from("bullion_demands").update({
        bot_active: true,
        updated_at: new Date().toISOString(),
      }).eq("id", demand.id);
    }

    return res.status(200).json({ ok: true, demandId: demand.id, leadId: lead.id, sent, waError: sent ? null : (waLastErr || null), waNumber: activeFunnel?.wa_number || null, openingMsg: openingMsgSent, botActivated: !skipBot });
  } catch (err) {
    console.error("demand handler error", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

function pickFunnel(productCategory) {
  if (!productCategory) return "bullion";
  return CATEGORY_TO_FUNNEL[productCategory.toLowerCase()] || "non_gold_qualify";
}
