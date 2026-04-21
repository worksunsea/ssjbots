// GET /api/cron — fired by Vercel Cron (or external pinger) every minute.
// Flushes due rows from bullion_scheduled_messages, sends via wa-service,
// cancels rows where the lead has replied since the step was scheduled.
//
// Protected by CRON_SECRET — set the same value in vercel.json cron header
// OR pass ?secret=... when pinging externally.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { TENANT_ID, OWNER_ALERT_PHONE } from "./_lib/config.js";

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET || "";
const BATCH = 20;

export default async function handler(req, res) {
  // Auth
  const header = req.headers["x-vercel-cron"] || req.headers["x-cron-secret"] || "";
  const queryToken = (req.query && req.query.secret) || "";
  const hasVercelSignature = Boolean(req.headers["x-vercel-cron"]);
  if (CRON_SECRET && !hasVercelSignature && header !== CRON_SECRET && queryToken !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const sb = supa();
  const nowIso = new Date().toISOString();

  // 1. Find due pending rows, with lead + funnel joined.
  const { data: due, error } = await sb
    .from("bullion_scheduled_messages")
    .select(`
      id, lead_id, funnel_id, body, send_at,
      lead:bullion_leads!inner(id,phone,name,status,bot_paused,last_msg_at),
      funnel:funnels!inner(id,name,active,wbiztool_client)
    `)
    .eq("tenant_id", TENANT_ID)
    .eq("status", "pending")
    .lte("send_at", nowIso)
    .order("send_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("cron fetch failed", error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  const stats = { considered: due?.length || 0, sent: 0, canceled: 0, failed: 0 };

  for (const row of due || []) {
    const lead = row.lead;
    const funnel = row.funnel;

    // Guards: if funnel is off, or lead is converted/dead/paused, cancel.
    if (!funnel || !funnel.active) {
      await sb.from("bullion_scheduled_messages")
        .update({ status: "canceled", canceled_reason: "funnel_inactive" })
        .eq("id", row.id);
      stats.canceled++;
      continue;
    }
    if (lead.status === "converted" || lead.status === "dead") {
      await sb.from("bullion_scheduled_messages")
        .update({ status: "canceled", canceled_reason: `lead_${lead.status}` })
        .eq("id", row.id);
      stats.canceled++;
      continue;
    }
    if (lead.bot_paused) {
      await sb.from("bullion_scheduled_messages")
        .update({ status: "canceled", canceled_reason: "bot_paused" })
        .eq("id", row.id);
      stats.canceled++;
      continue;
    }

    // Reply-during-drip: if the lead sent an inbound message since this step
    // was scheduled, cancel + flag for agent.
    const sentinelTs = row.send_at; // scheduled cutoff
    const { data: recentIn } = await sb
      .from("bullion_messages")
      .select("id,created_at")
      .eq("lead_id", lead.id)
      .eq("direction", "in")
      .gt("created_at", new Date(Date.parse(sentinelTs) - 1000 * 60 * 60 * 24).toISOString()) // look back 24h
      .order("created_at", { ascending: false })
      .limit(1);

    const hasRecentReply = recentIn?.length > 0 && new Date(recentIn[0].created_at) > new Date(sentinelTs);

    if (hasRecentReply) {
      await sb.from("bullion_scheduled_messages")
        .update({ status: "canceled", canceled_reason: "lead_replied" })
        .eq("id", row.id);
      // Also cancel any OTHER pending rows for this lead
      await sb.from("bullion_scheduled_messages")
        .update({ status: "canceled", canceled_reason: "lead_replied" })
        .eq("lead_id", lead.id)
        .eq("status", "pending");
      // Flag lead for agent
      await sb.from("bullion_leads")
        .update({ status: "handoff" })
        .eq("id", lead.id);
      if (OWNER_ALERT_PHONE) {
        await sendWhatsApp({
          phone: OWNER_ALERT_PHONE,
          msg: `🔔 Lead replied during drip — ${lead.name || lead.phone} on ${funnel.name}. Pending follow-ups canceled. Open CRM: https://ssjbots.vercel.app`,
        }).catch(() => {});
      }
      stats.canceled++;
      continue;
    }

    // OK to send
    const wa = await sendWhatsApp({ phone: lead.phone, msg: row.body });
    if (wa.status !== 1) {
      await sb.from("bullion_scheduled_messages")
        .update({ status: "failed", error: wa.message })
        .eq("id", row.id);
      stats.failed++;
      continue;
    }

    // Log outbound + mark sent + bump last_msg_at on lead
    await sb.from("bullion_messages").insert({
      tenant_id: TENANT_ID,
      lead_id: lead.id,
      phone: lead.phone,
      funnel_id: funnel.id,
      wbiztool_msg_id: String(wa.msg_id || ""),
      direction: "out",
      body: row.body,
      stage: "drip",
      claude_action: "DRIP",
      status: "sent",
    });
    await sb.from("bullion_scheduled_messages")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id);
    await sb.from("bullion_leads")
      .update({ last_msg: row.body, last_msg_at: new Date().toISOString() })
      .eq("id", lead.id);

    stats.sent++;
  }

  return res.status(200).json({ ok: true, ts: nowIso, stats });
}
