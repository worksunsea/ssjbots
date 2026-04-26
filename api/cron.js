// GET /api/cron — fired every minute by cron-job.org.
// Responsibilities:
//   1. Flush due rows from bullion_scheduled_messages (drip campaigns).
//   2. Auto-transition leads whose current funnel has exhausted to next_on_exhaust.
//   3. Daily-ish: enroll leads with bday/anniversary this month into
//      calendar funnels (birthday / anniversary).
//
// Protected by CRON_SECRET. Idempotent.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp, sendWhatsAppMedia } from "./_lib/wa.js";
import { transitionLeadToFunnel, enrollLeadInDrip } from "./_lib/drip.js";
import { askClaude } from "./_lib/claude.js";
import { getFaqs, faqsForPrompt } from "./_lib/faqs.js";
import { OWNER_ALERT_PHONE, CLAUDE_MODEL_ESCALATION } from "./_lib/config.js";

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET || "";
const BATCH = 20;

export default async function handler(req, res) {
  const header = req.headers["x-vercel-cron"] || req.headers["x-cron-secret"] || "";
  const queryToken = (req.query && req.query.secret) || "";
  const hasVercelSignature = Boolean(req.headers["x-vercel-cron"]);
  if (CRON_SECRET && !hasVercelSignature && header !== CRON_SECRET && queryToken !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const sb = supa();
  const nowIso = new Date().toISOString();
  const stats = { considered: 0, sent: 0, canceled: 0, failed: 0, transitioned: 0, calendarEnrolled: 0 };

  // ── 1. Flush due drip messages ──────────────────────────────────
  const { data: due } = await sb
    .from("bullion_scheduled_messages")
    .select(`
      id, lead_id, funnel_id, body, edited_body, send_at, tenant_id, is_reminder, reminder_phone,
      step:bullion_funnel_steps(id,use_ai_message,message_template,step_type,link_type,link_url,link_label),
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
          msg: `🔔 Lead replied during drip — ${lead.name || lead.phone} on ${funnel.name}. Pending follow-ups canceled. Open CRM: https://ssjbots.vercel.app`,
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
        if (lf?.form_token) resolvedLink = { url: `https://ssjbots.vercel.app/update?t=${lf.form_token}`, label: row.step.link_label || "update your details" };
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
          ...(resolvedLink ? [
            `Include this link naturally — ${resolvedLink.label}: ${resolvedLink.url}`,
            "Do not alter the URL. Place it at the end before the signature.",
          ] : []),
          `Context: ${funnel.goal || "Stay in touch and nurture the relationship."}`,
          faqs?.length ? `Store info & links (use when relevant):\n${faqsForPrompt(faqs)}` : "",
          "Template hint (do NOT copy verbatim, just use as context):",
          row.body,
        ].filter(Boolean).join("\n");
        const claude = await askClaude({
          system: aiSystem,
          messages: [{ role: "user", content: "Write the personalized message now." }],
          maxTokens: 150,
          model: CLAUDE_MODEL_ESCALATION,
        });
        if (claude?.text?.trim()) msgBody = claude.text.trim();
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
      // Send media (image/video/document) with caption = msgBody
      wa = await sendWhatsAppMedia({ phone: lead.phone, mediaUrl, mediaType, caption: msgBody, client: waClient });
      // If media fails, fall back to text-only
      if (wa.status !== 1) {
        wa = await sendWhatsApp({ phone: lead.phone, msg: msgBody, client: waClient });
      }
    } else {
      wa = await sendWhatsApp({ phone: lead.phone, msg: msgBody, client: waClient });
    }

    if (wa.status !== 1) {
      await sb.from("bullion_scheduled_messages").update({ status: "failed", error: wa.message }).eq("id", row.id);
      stats.failed++; continue;
    }

    await sb.from("bullion_messages").insert({
      tenant_id: row.tenant_id, lead_id: lead.id, phone: lead.phone, funnel_id: funnel.id,
      wbiztool_msg_id: String(wa.msg_id || ""), direction: "out", body: msgBody,
      stage: "drip", claude_action: "DRIP", status: "sent",
    });
    await sb.from("bullion_scheduled_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
    await sb.from("bullion_leads").update({ last_msg: msgBody, last_msg_at: new Date().toISOString() }).eq("id", lead.id);
    stats.sent++;
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
    .lte("wedding_date", new Date().toISOString().slice(0, 10))
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
      step:bullion_funnel_steps(id,use_ai_message,link_type,link_url,link_label),
      lead:bullion_leads(id,name,city),
      funnel:funnels(id,name,goal,kind)`)
    .eq("status", "pending").eq("approved", false).is("edited_body", null)
    .order("send_at", { ascending: true }).limit(20);

  const calendarRows = (previewPool || []).filter((r) => ["birthday", "anniversary"].includes(r.funnel?.kind));
  const dripRows = (previewPool || []).filter((r) => !["birthday", "anniversary"].includes(r.funnel?.kind));
  const needsPreview = [...calendarRows.slice(0, 10), ...dripRows.slice(0, 3)];

  for (const row of needsPreview || []) {
    if (!row.step?.use_ai_message) continue;
    const lead = row.lead; const funnel = row.funnel;
    if (!lead || !funnel) continue;
    let resolvedLink = null;
    if (row.step?.link_type && row.step.link_type !== "none") {
      if (row.step.link_type === "profile_update") {
        const { data: lf } = await sb.from("bullion_leads").select("form_token").eq("id", lead.id).maybeSingle();
        if (lf?.form_token) resolvedLink = { url: `https://ssjbots.vercel.app/update?t=${lf.form_token}`, label: row.step.link_label || "update your details" };
      } else if (row.step.link_url) { resolvedLink = { url: row.step.link_url, label: row.step.link_label || row.step.link_type }; }
    }
    try {
      const faqs = await getFaqs(row.tenant_id);
      const isBirthdayFunnel = ["birthday","anniversary"].includes(funnel.kind);
      const aiSystem = [
        "You are a warm WhatsApp assistant for Sun Sea Jewellers, Karol Bagh.",
        "Write a short, personalized WhatsApp message. 2–4 lines max. Warm and genuine. No markdown. Plain text only.",
        lead.name ? `Customer first name: ${lead.name.trim().split(/\s+/)[0]}` : "Name unknown — do NOT use Sir/Madam. Start naturally.",
        `City: ${lead.city || ""}`,
        "Always end with '- Sun Sea Jewellers, Karol Bagh' on a new line.",
        ...(isBirthdayFunnel ? [`OFFER: ${funnel.goal || "Free gift on store visit + up to 70% off making charges for 25 days."}`, "Mention only in pre/post event messages. Wish warmly on the actual day."] : []),
        ...(resolvedLink ? [`Include naturally — ${resolvedLink.label}: ${resolvedLink.url}`] : []),
        `Context: ${funnel.goal || "Stay in touch."}`,
        faqs?.length ? `Store info:\n${faqsForPrompt(faqs)}` : "",
        "Template hint (do NOT copy verbatim):", row.body,
      ].filter(Boolean).join("\n");
      const claude = await askClaude({ system: aiSystem, messages: [{ role: "user", content: "Write the message now." }], maxTokens: 200, model: CLAUDE_MODEL_ESCALATION });
      if (claude?.text?.trim()) await sb.from("bullion_scheduled_messages").update({ edited_body: claude.text.trim() }).eq("id", row.id);
    } catch (e) { console.error("preview_gen failed", row.id, e.message); }
  }

  return res.status(200).json({ ok: true, ts: nowIso, stats });
}
