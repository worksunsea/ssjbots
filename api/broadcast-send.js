// POST /api/broadcast-send
// Enrolls all matching leads into a broadcast funnel's message.
// Messages are staggered so WA doesn't flag the number as spam.
//
// Pace guide (for Baileys / unofficial WA):
//   safe   → 1 per 12s (~5/min) — recommended for numbers < 3 months old
//   normal → 1 per  8s (~7/min) — good for established numbers
//   fast   → 1 per  5s (~12/min) — only for WA Business API numbers
//
// Body: {
//   funnelId,          // funnel with kind="broadcast"
//   sendAt,            // ISO datetime for first message
//   pace,              // "safe" | "normal" | "fast" (default: "safe")
//   filter: {
//     tags,            // string[] — leads that have ANY of these tags
//     city,            // string — partial match
//     statuses,        // string[] — e.g. ["active","handoff","converted"]
//     productInterest, // string[] — e.g. ["24K","silver"]
//   }
// }

import { supa } from "./_lib/supabase.js";
import { SUPABASE_SERVICE_KEY, checkCrmSecret } from "./_lib/config.js";

// Clamp a timestamp to IST business hours 9 AM–8 PM (UTC 03:30–14:30).
// If outside window, push to 9:30 AM IST next valid day.
function clampToIST(ms) {
  const IST_OFFSET = 330 * 60000; // UTC+5:30 in ms
  const ist = new Date(ms + IST_OFFSET);
  const istMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = 9 * 60;   // 9:00 AM IST
  const close = 20 * 60; // 8:00 PM IST
  if (istMinutes >= open && istMinutes < close) return ms;
  // Push to 9:30 AM IST next day
  const next = new Date(ms + IST_OFFSET);
  if (istMinutes >= close) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(4, 0, 0, 0); // 9:30 AM IST = 04:00 UTC
  return next.getTime() - IST_OFFSET;
}

export const config = { maxDuration: 60 };

const BATCH_SIZE = 500;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const block = checkCrmSecret(req, res);
  if (block) return;
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: "missing_env" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { funnelId, sendAt, pace = "safe", filter = {}, includeAll = false, mediaUrl = null, mediaType = null, createdBy = null } = body;
  if (!funnelId) return res.status(400).json({ ok: false, error: "funnelId required" });
  if (!sendAt) return res.status(400).json({ ok: false, error: "sendAt required" });

  const sendAtMs = Date.parse(sendAt);
  if (isNaN(sendAtMs)) return res.status(400).json({ ok: false, error: "invalid sendAt" });

  // Interval between each message (ms). Add ±20% random jitter to avoid patterns.
  const BASE_INTERVAL_MS = pace === "fast" ? 5000 : pace === "normal" ? 8000 : 12000;

  const sb = supa();

  // 1. Load the funnel + its first active step
  const { data: funnel } = await sb.from("funnels").select("*").eq("id", funnelId).maybeSingle();
  if (!funnel) return res.status(404).json({ ok: false, error: "funnel not found" });

  const { data: step } = await sb.from("bullion_funnel_steps")
    .select("*")
    .eq("funnel_id", funnelId)
    .eq("tenant_id", funnel.tenant_id)
    .eq("active", true)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!step) return res.status(400).json({ ok: false, error: "broadcast funnel has no active steps — add a message step first" });

  // 2. Load already-enrolled leads for idempotency
  const { data: alreadyEnrolled } = await sb.from("bullion_scheduled_messages")
    .select("lead_id")
    .eq("funnel_id", funnelId)
    .in("status", ["pending", "sent"]);
  const enrolledSet = new Set((alreadyEnrolled || []).map((r) => r.lead_id));

  // 3. Query matching leads
  let q = sb.from("bullion_leads")
    .select("id, phone, name, city, tags, product_interest")
    .eq("tenant_id", funnel.tenant_id)
    .eq("dnd", false)
    .neq("status", "dead")
    .not("phone", "is", null)
    .limit(BATCH_SIZE);

  if (filter.tags?.length) q = q.overlaps("tags", filter.tags);
  if (filter.city?.trim()) q = q.ilike("city", `%${filter.city.trim()}%`);
  // includeAll = true → send to every non-DND, non-dead contact regardless of status (cold contacts included)
  if (!includeAll && filter.statuses?.length) q = q.in("status", filter.statuses);
  if (filter.productInterest?.length) q = q.in("product_interest", filter.productInterest);

  const { data: leads } = await q;
  if (!leads?.length) return res.status(200).json({ ok: true, created: 0, skipped: 0, reason: "no matching leads" });

  // 4. Build insert rows
  function render(tpl, ctx) {
    return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (ctx[k] == null ? "" : String(ctx[k])));
  }

  const rows = [];
  let skipped = 0;
  let slotMs = sendAtMs; // first message fires at sendAt, rest are staggered forward

  for (const lead of leads) {
    if (enrolledSet.has(lead.id)) { skipped++; continue; }
    const ctx = { name: lead.name || "", phone: lead.phone || "", city: lead.city || "", funnel_name: funnel.name || "" };

    // Snap to IST business hours (9 AM–8 PM). If stagger pushes into night, jump to next morning.
    const slotClamped = clampToIST(slotMs);

    rows.push({
      tenant_id: funnel.tenant_id,
      lead_id: lead.id,
      step_id: step.id,
      funnel_id: funnelId,
      send_at: new Date(slotClamped).toISOString(),
      body: render(step.message_template, ctx),
      status: "pending",
      approved: true,
      ...(mediaUrl ? { media_url: mediaUrl, media_type: mediaType || "image" } : {}),
    });

    // Advance slot by interval + ±20% jitter so messages don't land on exact same second
    const jitter = BASE_INTERVAL_MS * 0.2 * (Math.random() * 2 - 1);
    slotMs = slotClamped + BASE_INTERVAL_MS + Math.round(jitter);
  }

  if (!rows.length) return res.status(200).json({ ok: true, created: 0, skipped, reason: "all leads already enrolled" });

  // 5. Batch insert
  const { error } = await sb.from("bullion_scheduled_messages").insert(rows);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Log this broadcast send for history
  await sb.from("bullion_broadcast_sends").insert({
    tenant_id: funnel.tenant_id,
    funnel_id: funnelId,
    message_text: step.message_template,
    media_url: mediaUrl || null,
    media_type: mediaType || null,
    filter_json: { ...filter, includeAll, pace },
    recipient_count: rows.length,
    skipped_count: skipped,
    created_by: createdBy || null,
  }).catch(() => {}); // non-critical, don't fail the request

  return res.status(200).json({ ok: true, created: rows.length, skipped });
}
