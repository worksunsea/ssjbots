// GET /api/cron — fired every minute by cron-job.org.
// Responsibilities:
//   1. Flush due rows from bullion_scheduled_messages (drip campaigns).
//   2. Auto-transition leads whose current funnel has exhausted to next_on_exhaust.
//   3. Daily-ish: enroll leads with bday/anniversary this month into
//      calendar funnels (birthday / anniversary).
//
// Protected by CRON_SECRET. Idempotent.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp, sendWhatsAppWbiz, sendWhatsAppMediaWbiz } from "./_lib/wa.js";
import { transitionLeadToFunnel, enrollLeadInDrip } from "./_lib/drip.js";
import { askAI } from "./_lib/ai.js";
import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { OWNER_ALERT_PHONE, OPENAI_MODEL, CRM_SECRET, TENANT_ID } from "./_lib/config.js";

export const config = { maxDuration: 300 };

const CRON_SECRET = process.env.CRON_SECRET || "";
const BATCH = 5; // send max 5 per cron tick — anti-ban, each has a delay below
const SEND_DELAY_MS = 4000; // 4s gap between sends (~15/min max)

const PREVIEW_SELECT = `id, lead_id, funnel_id, body, tenant_id,
  step:bullion_funnel_steps(id,use_ai_message,link_type,link_url,link_label,name),
  lead:bullion_leads(id,name,city),
  funnel:funnels(id,name,goal,kind)`;

async function generatePreview(sb, row) {
  if (!row?.step?.use_ai_message || !row.lead || !row.funnel) return false;
  const { lead, funnel } = row;
  let resolvedLink = null;
  if (row.step?.link_type && row.step.link_type !== "none") {
    if (row.step.link_type === "profile_update") {
      const { data: lf } = await sb.from("bullion_leads").select("form_token").eq("id", lead.id).maybeSingle();
      if (lf?.form_token) resolvedLink = { url: `https://ssjbot.gemtre.in/update?t=${lf.form_token}`, label: row.step.link_label || "update your details" };
    } else if (row.step.link_url) { resolvedLink = { url: row.step.link_url, label: row.step.link_label || row.step.link_type }; }
  }
  const faqs = await getFaqs(row.tenant_id);
  const isBirthdayFunnel = ["birthday","anniversary"].includes(funnel.kind);
  const eventLabel = funnel.kind === "anniversary" ? "anniversary" : "birthday";
  const stepName = (row.step?.name || "").toLowerCase();
  const isBirthdayWishStep = isBirthdayFunnel && stepName.includes("wish");
  const { count: remainingAfterPreview } = await sb.from("bullion_scheduled_messages")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", lead.id).eq("funnel_id", row.funnel_id).eq("status", "pending")
    .gt("send_at", row.send_at);
  const isLastStep = remainingAfterPreview === 0;
  const aiSystem = [
    "You are a warm WhatsApp assistant for Sun Sea Jewellers, Karol Bagh.",
    "Write a short, personalized WhatsApp message. 2–4 lines max. Warm and genuine. No markdown. Plain text only.",
    lead.name ? `Customer first name: ${lead.name.trim().split(/\s+/)[0]}` : "Name unknown — do NOT use Sir/Madam. Start naturally.",
    `City: ${lead.city || ""}`,
    "Always end with '- Sun Sea Jewellers, Karol Bagh' on a new line.",
    ...(isBirthdayFunnel ? [
      `Event type: ${eventLabel}`,
      `OFFER: ${funnel.goal || "Free gift on store visit + up to 70% off making charges for 25 days."}`,
      "Mention offer ONLY in pre/post event messages. For the actual wish: just wish warmly, no selling.",
    ] : []),
    ...(isBirthdayWishStep ? [`BIRTHDAY/ANNIVERSARY WISH INSTRUCTION: Just wish them warmly and genuinely on their special day. Naturally mention that a special surprise free gift awaits them when they visit Sun Sea Jewellers this week. Keep it warm and exciting — no hard sell.`] : []),
    ...(isBirthdayFunnel && isLastStep ? [`POST-EVENT GIFT CTA (7 days after): Tell them to fill their profile form and download the Sun Sea Jewellers app to claim their FREE birthday gift of 50mg gold worth ₹1,500. Profile form: https://ssjbot.gemtre.in/profile  App Android: https://ssjbot.gemtre.in/app  App iOS: https://ssjbot.gemtre.in/ios  Make it sound warm and exciting.`] : []),
    ...(resolvedLink ? [`Include naturally — ${resolvedLink.label}: ${resolvedLink.url}`] : []),
    `Context: ${funnel.goal || "Stay in touch."}`,
    faqs?.length ? `Store info:\n${faqsForPrompt(faqs)}` : "",
    "Template hint (do NOT copy verbatim):", row.body,
  ].filter(Boolean).join("\n");
  const ai = await askAI({ system: aiSystem, messages: [{ role: "user", content: "Write the message now." }], maxTokens: 200, model: OPENAI_MODEL });
  if (ai?.text?.trim()) {
    await sb.from("bullion_scheduled_messages").update({ edited_body: ai.text.trim() }).eq("id", row.id);
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  const header = req.headers["x-vercel-cron"] || req.headers["x-cron-secret"] || "";
  const queryToken = (req.query && req.query.secret) || "";
  const hasVercelSignature = Boolean(req.headers["x-vercel-cron"]);
  // Accept: Vercel cron signature, CRON_SECRET header/query, or CRM dashboard secret
  const cronCrmSecret = (CRM_SECRET || "").trim();
  const hasCrmAuth = cronCrmSecret && (req.headers["x-crm-secret"] || "").trim() === cronCrmSecret;
  if (CRON_SECRET && !hasVercelSignature && header !== CRON_SECRET && queryToken !== CRON_SECRET && !hasCrmAuth) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // Fast path: generate preview for a single message (called from approvals card)
  if (req.query?.gen_id) {
    try {
      const sb = supa();
      const { data: row } = await sb.from("bullion_scheduled_messages")
        .select(PREVIEW_SELECT).eq("id", req.query.gen_id).is("edited_body", null).maybeSingle();
      const generated = await generatePreview(sb, row).catch(() => false);
      return res.status(200).json({ ok: true, generated: generated ? 1 : 0 });
    } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }

  // Manual calendar enrollment from Upcoming Events screen
  if (req.query?.action === "enroll_calendar") {
    try {
      const { leadId, funnelType } = req.body || {};
      if (!leadId || !funnelType) return res.status(400).json({ ok: false, error: "leadId and funnelType required" });
      const sb = supa();
      const tid = TENANT_ID;
      const { data: lead } = await sb.from("bullion_leads").select("*").eq("id", leadId).maybeSingle();
      if (!lead) return res.status(404).json({ ok: false, error: "lead not found" });
      const { data: funnel } = await sb.from("funnels").select("*").eq("tenant_id", tid).eq("id", funnelType).maybeSingle();
      if (!funnel) return res.status(404).json({ ok: false, error: `funnel '${funnelType}' not found` });
      // Compute next occurrence of the event
      const raw = funnelType === "birthday" ? lead.bday : lead.anniversary;
      let eventDateMs = null;
      if (raw) {
        const p = raw.split("-").map(Number);
        let mo, dy;
        if (p.length === 3) {
          if (p[0] > 31) { mo = p[1] - 1; dy = p[2]; }
          else if (p[0] >= 1 && p[0] <= 12) { mo = p[0] - 1; dy = p[1]; }
          else { mo = p[1] - 1; dy = p[0]; }
        } else if (p.length === 2) {
          if (p[0] >= 1 && p[0] <= 12) { mo = p[0] - 1; dy = p[1]; }
          else { mo = p[1] - 1; dy = p[0]; }
        }
        if (mo != null && dy != null && !isNaN(mo) && !isNaN(dy)) {
          const today = new Date(); today.setHours(0,0,0,0);
          let ev = new Date(today.getFullYear(), mo, dy);
          if (ev.getTime() < today.getTime()) ev = new Date(today.getFullYear() + 1, mo, dy);
          eventDateMs = ev.getTime();
        }
      }
      const result = await enrollLeadInDrip({ lead, funnel, eventDateMs });
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Bulk catch-up: enroll every non-DND lead with a bday/anniversary that
  // isn't in a calendar drip yet, ignoring the normal 40-day-before-event
  // cron window. For backfilling existing data in one shot.
  if (req.query?.action === "enroll_calendar_bulk") {
    try {
      const sb = supa();
      const tid = TENANT_ID;
      const nowMs = Date.now();
      const yearNow = new Date(nowMs + 5.5 * 3600000).getUTCFullYear();
      const stats = { considered: 0, enrolled: 0, skipped: {} };

      function parseEventDate(raw, year) {
        if (!raw) return null;
        const p = String(raw).split("-").map(Number);
        let m, d;
        if (p.length === 3) {
          if (p[0] > 31) { m = p[1]; d = p[2]; }
          else if (p[0] >= 1 && p[0] <= 12) { m = p[0]; d = p[1]; }
          else { m = p[1]; d = p[0]; }
        } else if (p.length === 2) {
          if (p[0] >= 1 && p[0] <= 12) { m = p[0]; d = p[1]; }
          else { m = p[1]; d = p[0]; }
        }
        if (!m || !d || isNaN(m) || isNaN(d)) return null;
        const dt = new Date(Date.UTC(year, m - 1, d));
        return isNaN(dt) ? null : dt.getTime();
      }

      for (const [field, kind] of [["bday", "birthday"], ["anniversary", "anniversary"]]) {
        const { data: funnel } = await sb.from("funnels")
          .select("*").eq("tenant_id", tid).eq("kind", kind).eq("active", true).maybeSingle();
        if (!funnel) continue;

        const { data: leads } = await sb.from("bullion_leads")
          .select("id,name,phone,bday,anniversary,tenant_id")
          .eq("tenant_id", tid).eq("dnd", false).not(field, "is", null).limit(2000);

        for (const lead of leads || []) {
          stats.considered++;
          let eventMs = parseEventDate(lead[field], yearNow);
          if (eventMs && eventMs < nowMs - 6 * 86400000) eventMs = parseEventDate(lead[field], yearNow + 1);
          if (!eventMs) { stats.skipped.bad_date = (stats.skipped.bad_date || 0) + 1; continue; }

          const result = await enrollLeadInDrip({ lead, funnel, eventDateMs: eventMs });
          if (result.ok && result.enrolled) stats.enrolled++;
          else if (result.skipped) stats.skipped[result.skipped] = (stats.skipped[result.skipped] || 0) + 1;
        }
      }
      return res.status(200).json({ ok: true, stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Report every lead who has opted out (dnd=true), with the message that
  // triggered it and when.
  if (req.query?.action === "dnd_report") {
    try {
      const sb = supa();
      const tid = TENANT_ID;
      const { data: leads, error } = await sb.from("bullion_leads")
        .select("id,name,phone,dnd_reason,dnd_at")
        .eq("tenant_id", tid).eq("dnd", true)
        .order("dnd_at", { ascending: false });
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, count: leads?.length || 0, leads });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // One-off diagnostic: current custom-field defs (bullion_dropdowns) vs
  // what keys actually appear in bullion_leads.extra_fields — reveals
  // custom fields whose values survived but whose definition got lost.
  if (req.query?.action === "field_audit") {
    try {
      const sb = supa();
      const tid = TENANT_ID;
      const { data: defs } = await sb.from("bullion_dropdowns")
        .select("field,value,updated_at").eq("tenant_id", tid).in("field", ["contact_custom_fields", "contact_field_order"]);

      const keyCounts = {};
      const sampleValues = {};
      let offset = 0;
      const PAGE = 1000;
      for (;;) {
        const { data: leads } = await sb.from("bullion_leads")
          .select("id,name,phone,extra_fields")
          .eq("tenant_id", tid).not("extra_fields", "is", null)
          .range(offset, offset + PAGE - 1);
        if (!leads?.length) break;
        for (const l of leads) {
          for (const [k, v] of Object.entries(l.extra_fields || {})) {
            if (v === "" || v == null) continue;
            keyCounts[k] = (keyCounts[k] || 0) + 1;
            if (!sampleValues[k]) sampleValues[k] = [];
            if (sampleValues[k].length < 5) sampleValues[k].push({ id: l.id, name: l.name, phone: l.phone, value: v });
          }
        }
        if (leads.length < PAGE) break;
        offset += PAGE;
      }

      return res.status(200).json({ ok: true, dropdown_defs: defs, extra_field_keys_in_use: keyCounts, samples: sampleValues });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // One-off repair: re-seed contact_custom_fields defs so keys already
  // present in extra_fields data (found by field_audit) show up in the UI
  // again. Refuses to overwrite if defs already exist — pass body.fields.
  if (req.query?.action === "field_restore") {
    try {
      const { fields } = req.body || {};
      if (!Array.isArray(fields) || !fields.length) return res.status(400).json({ ok: false, error: "fields[] required" });
      const sb = supa();
      const tid = TENANT_ID;
      const { data: ex } = await sb.from("bullion_dropdowns").select("id,value").eq("tenant_id", tid).eq("field", "contact_custom_fields").maybeSingle();
      if (ex?.value && JSON.parse(ex.value).length) {
        return res.status(409).json({ ok: false, error: "defs already exist — not overwriting", existing: JSON.parse(ex.value) });
      }
      const value = JSON.stringify(fields);
      if (ex?.id) await sb.from("bullion_dropdowns").update({ value, active: true }).eq("id", ex.id);
      else await sb.from("bullion_dropdowns").insert({ tenant_id: tid, field: "contact_custom_fields", value, active: true, sort_order: 0 });
      return res.status(200).json({ ok: true, restored: fields });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  try {
  const sb = supa();
  const nowIso = new Date().toISOString();
  const stats = { considered: 0, sent: 0, canceled: 0, failed: 0, transitioned: 0, calendarEnrolled: 0, previewsGenerated: 0 };

  // ── 1. Flush due drip messages ──────────────────────────────────
  const { data: due } = await sb
    .from("bullion_scheduled_messages")
    .select(`
      id, lead_id, funnel_id, body, edited_body, send_at, tenant_id, is_reminder, reminder_phone,
      step:bullion_funnel_steps(id,use_ai_message,message_template,step_type,link_type,link_url,link_label,name),
      lead:bullion_leads!inner(id,phone,name,status,bot_paused,dnd,last_msg_at,funnel_id,funnel_history,tenant_id,city),
      funnel:funnels!inner(id,name,active,wbiztool_client,next_on_convert,next_on_exhaust,tenant_id,goal,kind)
    `)
    .eq("status", "pending")
    .eq("approved", true)
    .lte("send_at", nowIso)
    .order("send_at", { ascending: true })
    .limit(BATCH);

  stats.considered = due?.length || 0;

  for (const row of due || []) {
    const lead = row.lead;
    const funnel = row.funnel;

    // Atomic claim — the external pinger can (and has) fired this endpoint
    // twice in close succession (retry after a slow response, overlapping
    // schedules), and the old code just SELECTed status='pending' then sent
    // then updated to 'sent' at the very end — a classic TOCTOU race where
    // two concurrent runs both pick up the same still-pending row before
    // either marks it sent. Real case: Meena Mehta's birthday message sent
    // twice, 2m24s apart, two distinct WhatsApp message ids (2026-07-11).
    // This UPDATE...WHERE status='pending' is atomic at the DB level — only
    // one concurrent request can win it 0 rows affected means another
    // process already claimed this row; skip instead of double-sending.
    const { data: claimed } = await sb.from("bullion_scheduled_messages")
      .update({ status: "processing" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed || claimed.length === 0) { continue; }

    // Guards
    if (!funnel?.active) {
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "funnel_inactive" }).eq("id", row.id);
      stats.canceled++; continue;
    }
    if (lead.dnd) {
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "dnd" }).eq("id", row.id);
      stats.canceled++; continue;
    }
    if (lead.status === "converted" || lead.status === "dead") {
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: `lead_${lead.status}` }).eq("id", row.id);
      stats.canceled++; continue;
    }
    if (lead.bot_paused) {
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "bot_paused" }).eq("id", row.id);
      stats.canceled++; continue;
    }

    // Reply-during-drip guard
    const { data: recentIn } = await sb
      .from("bullion_messages")
      .select("id,created_at")
      .eq("lead_id", lead.id)
      .eq("direction", "in")
      .gt("created_at", new Date(Date.parse(row.send_at) - 1000 * 60 * 60 * 24).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const hasRecentReply = recentIn?.length > 0 && new Date(recentIn[0].created_at) > new Date(row.send_at);
    if (hasRecentReply) {
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "lead_replied" }).eq("id", row.id);
      await sb.from("bullion_scheduled_messages").update({ status: "canceled", canceled_reason: "lead_replied" }).eq("lead_id", lead.id).eq("status", "pending");
      await sb.from("bullion_leads").update({ status: "handoff" }).eq("id", lead.id);
      if (OWNER_ALERT_PHONE) {
        await sendWhatsApp({
          phone: OWNER_ALERT_PHONE,
          msg: `🔔 Lead replied during drip — ${lead.name || lead.phone} on ${funnel.name}. Pending follow-ups canceled. Open CRM: https://ssjbot.gemtre.in`,
        }).catch(() => {});
      }
      stats.canceled++; continue;
    }

    // Occasion reminder → send WA to owner, not to lead
    if (row.is_reminder) {
      const alertPhone = row.reminder_phone || OWNER_ALERT_PHONE;
      if (alertPhone) {
        await sendWhatsApp({ phone: alertPhone, msg: row.body }).catch(() => {});
      }
      await sb.from("bullion_scheduled_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
      stats.sent++; continue;
    }

    // Resolve step link if configured
    let resolvedLink = null;
    if (row.step?.link_type && row.step.link_type !== "none") {
      if (row.step.link_type === "profile_update") {
        const { data: lf } = await sb.from("bullion_leads").select("form_token").eq("id", lead.id).maybeSingle();
        if (lf?.form_token) resolvedLink = { url: `https://ssjbot.gemtre.in/update?t=${lf.form_token}`, label: row.step.link_label || "update your details" };
      } else if (row.step.link_type === "save_contact") {
        resolvedLink = { url: "https://ssjbot.gemtre.in/contact.vcf", label: row.step.link_label || "tap to save our number in your contacts" };
      } else if (row.step.link_url) {
        resolvedLink = { url: row.step.link_url, label: row.step.link_label || row.step.link_type };
      }
    }

    // Check if this is first or last pending message for this lead in this funnel
    const { count: remainingAfter } = await sb.from("bullion_scheduled_messages")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id).eq("funnel_id", funnel.id).eq("status", "pending")
      .gt("send_at", row.send_at);
    const isLastStep = remainingAfter === 0;
    const { count: sentBefore } = await sb.from("bullion_scheduled_messages")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id).eq("funnel_id", funnel.id).eq("status", "sent");
    const isFirstStep = sentBefore === 0;

    // AI-generated message step — call Claude to write personalized message
    // Use edited_body if staff manually edited during approval
    let msgBody = row.edited_body || row.body;
    if (row.step?.use_ai_message) {
      try {
        const faqs = await getFaqs(row.tenant_id);
        const isBirthdayFunnel = ["birthday", "anniversary"].includes(funnel.kind);
        const eventLabel = funnel.kind === "anniversary" ? "anniversary" : "birthday";
        const stepName = (row.step?.name || "").toLowerCase();
        const isBirthdayWishStep = isBirthdayFunnel && stepName.includes("wish");
        const aiSystem = [
          "You are a warm WhatsApp assistant for Sun Sea Jewellers, Karol Bagh.",
          "Write a short, personalized WhatsApp message. 2–4 lines max.",
          "Warm, genuine, premium jewellery tone — NOT corporate or stiff.",
          "Write in simple English. No markdown. No bullet points. Plain text only.",
          lead.name ? `Customer first name: ${lead.name.trim().split(/\s+/)[0]}` : "Customer name unknown — do NOT use Sir/Madam or any placeholder. Start naturally.",
          `City: ${lead.city || ""}`,
          "IMPORTANT: Always end the message with '- Sun Sea Jewellers, Karol Bagh' on a new line so the customer knows who is messaging them.",
          isFirstStep ? "This is the FIRST message to this customer from this campaign. At the end, naturally ask them to save this number as 'Sun Sea Jewellers' for future updates." : "",
          isLastStep ? "This is the LAST message in this sequence. End with: 'Reply STOP anytime if you prefer not to receive updates from us.'" : "",
          ...(isBirthdayFunnel ? [
            `Event type: ${eventLabel}`,
            `OFFER TO MENTION: ${funnel.goal || "Free gift on store visit this special month + up to 70% off on making charges for next 25 days."}`,
            "Mention the offer ONLY in pre-event and post-event messages. For the actual wish: just wish warmly, no selling.",
          ] : []),
          ...(isBirthdayWishStep ? [`BIRTHDAY/ANNIVERSARY WISH INSTRUCTION: Just wish them warmly and genuinely on their special day. Naturally mention that a special surprise free gift awaits them when they visit Sun Sea Jewellers this week. Keep it warm and exciting — no hard sell.`] : []),
          ...(isBirthdayFunnel && isLastStep ? [`POST-EVENT GIFT CTA (7 days after): Tell them to fill their profile form and download the Sun Sea Jewellers app to claim their FREE gift of 50mg gold worth ₹1,500. Profile form: https://ssjbot.gemtre.in/profile  App Android: https://ssjbot.gemtre.in/app  App iOS: https://ssjbot.gemtre.in/ios  Make it sound warm and exciting.`] : []),
          ...(resolvedLink ? [
            `Include this link naturally — ${resolvedLink.label}: ${resolvedLink.url}`,
            "Do not alter the URL. Place it at the end before the signature.",
          ] : []),
          `Context: ${funnel.goal || "Stay in touch and nurture the relationship."}`,
          faqs?.length ? `Store info & links (use when relevant):\n${faqsForPrompt(faqs)}` : "",
          "Template hint (do NOT copy verbatim, just use as context):",
          row.body,
        ].filter(Boolean).join("\n");
        const ai = await askAI({
          system: aiSystem,
          messages: [{ role: "user", content: "Write the personalized message now." }],
          maxTokens: 150,
          model: OPENAI_MODEL,
        });
        if (ai?.text?.trim()) msgBody = ai.text.trim();
      } catch (e) {
        console.error("AI message generation failed, using template", e);
      }
    }

    // Send — if this scheduled message has a media attachment, send as media first
    const mediaUrl = row.media_url || row.step?.media_url || null;
    const mediaType = row.media_type || row.step?.media_type || "image";
    const waClient = funnel.wbiztool_client || undefined;

    let wa;
    if (mediaUrl) {
      wa = await sendWhatsAppMediaWbiz({ phone: lead.phone, mediaUrl, mediaType, caption: msgBody, whatsappClient: waClient });
      if (wa.status !== 1) {
        wa = await sendWhatsAppWbiz({ phone: lead.phone, msg: msgBody, whatsappClient: waClient });
      }
    } else {
      wa = await sendWhatsAppWbiz({ phone: lead.phone, msg: msgBody, whatsappClient: waClient });
    }

    if (wa.status !== 1) {
      await sb.from("bullion_scheduled_messages").update({ status: "failed", error: wa.message }).eq("id", row.id);
      stats.failed++; continue;
    }

    await sb.from("bullion_messages").insert({
      tenant_id: row.tenant_id, lead_id: lead.id, phone: lead.phone, funnel_id: funnel.id,
      wbiztool_msg_id: String(wa.msg_id || ""), direction: "out", body: msgBody,
      stage: "drip", claude_action: "DRIP", status: "sent",
      wa_client: waClient || null,
    });
    await sb.from("bullion_scheduled_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
    await sb.from("bullion_leads").update({ last_msg: msgBody, last_msg_at: new Date().toISOString() }).eq("id", lead.id);
    stats.sent++;
    await new Promise((r) => setTimeout(r, SEND_DELAY_MS)); // anti-ban gap
  }

  // ── 2. On-exhaust transitions ──────────────────────────────────
  // Find leads whose CURRENT funnel has next_on_exhaust set, status is not
  // converted/dead/dnd, and they have zero pending scheduled messages in this
  // funnel. Those are candidates to roll into the next funnel.
  const { data: exhaustCandidates } = await sb
    .from("bullion_leads")
    .select(`
      id, phone, funnel_id, status, dnd, bot_paused, updated_at, tenant_id,
      funnel:funnels!inner(id, next_on_exhaust, active, tenant_id)
    `)
    .not("funnel.next_on_exhaust", "is", null)
    .not("status", "in", "(converted,dead)")
    .eq("dnd", false)
    .eq("bot_paused", false)
    .limit(30);

  for (const lead of exhaustCandidates || []) {
    // Are there still pending drips for this lead in the current funnel?
    const { count: pendingCount } = await sb
      .from("bullion_scheduled_messages")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id)
      .eq("funnel_id", lead.funnel_id)
      .eq("status", "pending");
    if (pendingCount && pendingCount > 0) continue;

    // Was there EVER a scheduled message for this lead+funnel? If yes and none
    // pending, drip fully ran — safe to transition. If never enrolled, skip
    // (lead never showed QUOTE_SENT).
    const { count: everCount } = await sb
      .from("bullion_scheduled_messages")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id)
      .eq("funnel_id", lead.funnel_id);
    if (!everCount) continue;

    const next = lead.funnel?.next_on_exhaust;
    if (!next) continue;

    await transitionLeadToFunnel({ leadId: lead.id, newFunnelId: next, reason: "exhausted" }).catch(() => {});
    stats.transitioned++;
  }

  // ── 3. Calendar enrollments (bday + anniversary) ────────────────
  // Enroll leads whose event is within 25 days (so the -20 day step fires on time).
  // Idempotency: skip if already enrolled in this funnel in last 11 months.

  function parseEventDate(raw, year) {
    if (!raw) return null;
    const p = raw.split("-");
    let m, d;
    if (p.length === 3) {
      // YYYY-MM-DD or YYYY-DD-MM
      const a = parseInt(p[1], 10), b = parseInt(p[2], 10);
      if (a >= 1 && a <= 12) { m = a; d = b; } else { m = b; d = a; }
    } else if (p.length === 2) {
      const a = parseInt(p[0], 10), b = parseInt(p[1], 10);
      if (a >= 1 && a <= 12) { m = a; d = b; } else { m = b; d = a; }
    }
    if (!m || !d) return null;
    const dt = new Date(Date.UTC(year, m - 1, d));
    return isNaN(dt) ? null : dt.getTime();
  }

  const nowMs = Date.now();
  const todayIST = new Date(nowMs + 5.5 * 3600000);
  const yearNow = todayIST.getUTCFullYear();

  // Track stagger per event date (ms → count of already-scheduled messages that day)
  const staggerMap = new Map();

  for (const [field, kind] of [["bday", "birthday"], ["anniversary", "anniversary"]]) {
    const { data: calendarFunnels } = await sb.from("funnels")
      .select("*, persona:personas(*)")
      .eq("kind", kind).eq("active", true);
    if (!calendarFunnels?.length) continue;
    const funnelByTenant = new Map(calendarFunnels.map((f) => [f.tenant_id, f]));

    // Fetch all leads with this event field set (limit 500)
    const { data: allLeads } = await sb.from("bullion_leads")
      .select("id, phone, name, funnel_id, funnel_history, tenant_id, bday, anniversary")
      .eq("dnd", false).not(field, "is", null).limit(500);
    if (!allLeads?.length) continue;

    // Batch idempotency: get all lead_ids already enrolled in any calendar funnel
    // of this kind in the last 11 months (one query, not N queries)
    const calendarFunnelIds = calendarFunnels.map((f) => f.id);
    const elevenMonthsAgo = new Date(nowMs - 335 * 86400000).toISOString();
    const { data: alreadyEnrolled } = await sb.from("bullion_scheduled_messages")
      .select("lead_id")
      .in("funnel_id", calendarFunnelIds)
      .in("status", ["pending", "sent"])
      .gte("created_at", elevenMonthsAgo);
    const enrolledSet = new Set((alreadyEnrolled || []).map((r) => r.lead_id));

    for (const lead of allLeads) {
      const funnel = funnelByTenant.get(lead.tenant_id);
      if (!funnel) continue;

      // Resolve event date (this year, or next year if already passed)
      let eventMs = parseEventDate(lead[field], yearNow);
      if (!eventMs) continue;
      if (eventMs < nowMs - 6 * 86400000) {
        eventMs = parseEventDate(lead[field], yearNow + 1);
      }
      if (!eventMs) continue;

      // Enroll up to 40 days before event so messages appear in the approval queue well in advance.
      const daysUntil = (eventMs - nowMs) / 86400000;
      if (daysUntil > 40 || daysUntil < -5) continue;

      // Skip if already enrolled
      if (enrolledSet.has(lead.id)) continue;

      // Stagger: 7 min per person per event day
      const dayKey = Math.floor(eventMs / 86400000);
      const staggerIndex = staggerMap.get(dayKey) || 0;
      staggerMap.set(dayKey, staggerIndex + 1);
      const staggerMs = staggerIndex * 7 * 60000;

      await enrollLeadInDrip({ lead, funnel, eventDateMs: eventMs, staggerMs }).catch(() => {});
      stats.calendarEnrolled++;
    }
  }

  // ── 4. After-marriage funnel enrollment ─────────────────────
  // Enroll leads whose wedding_date has arrived and haven't been enrolled yet.
  const { data: weddingLeads } = await sb
    .from("bullion_leads")
    .select("id, phone, name, funnel_id, funnel_history, tenant_id")
    .not("wedding_date", "is", null)
    .is("post_wedding_enrolled_at", null)
    .lte("wedding_date", new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)) // IST
    .eq("dnd", false)
    .limit(10);

  for (const lead of weddingLeads || []) {
    const { data: afterMarriageFunnel } = await sb
      .from("funnels")
      .select("*")
      .eq("id", "after_marriage")
      .eq("tenant_id", lead.tenant_id)
      .eq("active", true)
      .maybeSingle();
    if (!afterMarriageFunnel) continue;

    await enrollLeadInDrip({ lead, funnel: afterMarriageFunnel }).catch(() => {});
    await sb.from("bullion_leads")
      .update({ post_wedding_enrolled_at: new Date().toISOString() })
      .eq("id", lead.id);
    stats.calendarEnrolled++;
  }

  // ── 5. Pre-generate AI previews ──
  // Fetch the next 20 pending-preview messages ordered by send_at.
  // Sort so birthday/anniversary messages come first (they need previews earliest).
  // Process up to 10 calendar + 3 regular per tick.
  const { data: previewPool } = await sb
    .from("bullion_scheduled_messages")
    .select(`id, lead_id, funnel_id, body, tenant_id,
      step:bullion_funnel_steps(id,use_ai_message,link_type,link_url,link_label,name),
      lead:bullion_leads(id,name,city),
      funnel:funnels(id,name,goal,kind)`)
    .eq("status", "pending").eq("approved", false).is("edited_body", null)
    .order("send_at", { ascending: true }).limit(20);

  const calendarRows = (previewPool || []).filter((r) => ["birthday", "anniversary"].includes(r.funnel?.kind));
  const dripRows = (previewPool || []).filter((r) => !["birthday", "anniversary"].includes(r.funnel?.kind));
  const needsPreview = [...calendarRows.slice(0, 10), ...dripRows.slice(0, 3)];

  for (const row of needsPreview || []) {
    try {
      const ok = await generatePreview(sb, row);
      if (ok) stats.previewsGenerated++;
    } catch (e) { console.error("preview_gen failed", row.id, e.message); }
  }

  return res.status(200).json({ ok: true, ts: nowIso, stats: { ...stats } });
  } catch (err) {
    console.error("cron top-level error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
