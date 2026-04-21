// GET /api/cron — fired every minute by cron-job.org.
// Responsibilities:
//   1. Flush due rows from bullion_scheduled_messages (drip campaigns).
//   2. Auto-transition leads whose current funnel has exhausted to next_on_exhaust.
//   3. Daily-ish: enroll leads with bday/anniversary this month into
//      calendar funnels (birthday / anniversary).
//
// Protected by CRON_SECRET. Idempotent.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { transitionLeadToFunnel, enrollLeadInDrip } from "./_lib/drip.js";
import { OWNER_ALERT_PHONE } from "./_lib/config.js";

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
      id, lead_id, funnel_id, body, send_at, tenant_id,
      lead:bullion_leads!inner(id,phone,name,status,bot_paused,dnd,last_msg_at,funnel_id,funnel_history,tenant_id),
      funnel:funnels!inner(id,name,active,wbiztool_client,next_on_convert,next_on_exhaust,tenant_id)
    `)
    .eq("status", "pending")
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

    // Send
    const wa = await sendWhatsApp({ phone: lead.phone, msg: row.body });
    if (wa.status !== 1) {
      await sb.from("bullion_scheduled_messages").update({ status: "failed", error: wa.message }).eq("id", row.id);
      stats.failed++; continue;
    }

    await sb.from("bullion_messages").insert({
      tenant_id: row.tenant_id, lead_id: lead.id, phone: lead.phone, funnel_id: funnel.id,
      wbiztool_msg_id: String(wa.msg_id || ""), direction: "out", body: row.body,
      stage: "drip", claude_action: "DRIP", status: "sent",
    });
    await sb.from("bullion_scheduled_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
    await sb.from("bullion_leads").update({ last_msg: row.body, last_msg_at: new Date().toISOString() }).eq("id", lead.id);
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
  // Idempotency: we only enroll if the lead has NO scheduled messages in the
  // target calendar funnel in the last 11 months.
  const monthNow = new Date().toISOString().slice(5, 7); // "MM"

  for (const [field, funnelId] of [["bday", "birthday"], ["anniversary", "anniversary"]]) {
    // Fetch active calendar funnels across all tenants (same slug, different tenants)
    const { data: calendarFunnels } = await sb
      .from("funnels")
      .select("*, persona:personas(*)")
      .eq("id", funnelId)
      .eq("active", true);
    if (!calendarFunnels?.length) continue;
    const funnelByTenant = new Map(calendarFunnels.map((f) => [f.tenant_id, f]));

    // Fetch candidate leads across ALL tenants with a matching month
    const { data: matches } = await sb
      .from("bullion_leads")
      .select("id, phone, name, funnel_id, funnel_history, tenant_id")
      .eq("dnd", false)
      .not(field, "is", null)
      .or(`${field}.like.${monthNow}-%,${field}.like.%-${monthNow}-%`);

    for (const lead of matches || []) {
      const funnel = funnelByTenant.get(lead.tenant_id);
      if (!funnel) continue; // tenant has no calendar funnel — skip

      // Idempotency: skip if already enrolled in this calendar funnel in the last 11 months
      const elevenMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 335).toISOString();
      const { count: recent } = await sb
        .from("bullion_scheduled_messages")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("funnel_id", funnel.id)
        .gte("created_at", elevenMonthsAgo);
      if (recent && recent > 0) continue;

      await enrollLeadInDrip({ lead, funnel }).catch(() => {});
      stats.calendarEnrolled++;
    }
  }

  return res.status(200).json({ ok: true, ts: nowIso, stats });
}
