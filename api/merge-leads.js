// POST /api/merge-leads
// Manager merges two lead records for the same person.
// All demands, messages, scheduled messages, and call logs from the secondary
// lead are re-pointed to the primary. Non-null fields from secondary fill
// any gaps on primary. Secondary is soft-deleted and aliased.
//
// Body: { primaryLeadId, secondaryLeadId }

import { supa } from "./_lib/supabase.js";
import { SUPABASE_SERVICE_KEY } from "./_lib/config.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: "missing_env" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { primaryLeadId, secondaryLeadId } = body;
  if (!primaryLeadId || !secondaryLeadId || primaryLeadId === secondaryLeadId) {
    return res.status(400).json({ ok: false, error: "primaryLeadId and secondaryLeadId required and must differ" });
  }

  const sb = supa();

  // Load both leads
  const [{ data: primary }, { data: secondary }] = await Promise.all([
    sb.from("bullion_leads").select("*").eq("id", primaryLeadId).single(),
    sb.from("bullion_leads").select("*").eq("id", secondaryLeadId).single(),
  ]);
  if (!primary) return res.status(404).json({ ok: false, error: "primary_not_found" });
  if (!secondary) return res.status(404).json({ ok: false, error: "secondary_not_found" });

  // Re-point all child rows from secondary → primary
  const reassignTables = [
    { table: "bullion_demands",           col: "lead_id" },
    { table: "bullion_messages",          col: "lead_id" },
    { table: "bullion_scheduled_messages",col: "lead_id" },
    { table: "bullion_call_logs",         col: "lead_id" },
    { table: "bullion_funnel_history",    col: "lead_id" },
  ];
  for (const { table, col } of reassignTables) {
    const { error } = await sb.from(table).update({ [col]: primaryLeadId }).eq(col, secondaryLeadId);
    if (error && !error.message.includes("does not exist")) {
      console.error(`merge: reassign ${table} failed`, error.message);
    }
  }

  // Copy non-null fields from secondary to primary where primary has null
  const fillFields = ["name","city","email","bday","anniversary","client_rating","wedding_date",
    "wedding_family_member","wa_display_name","source","discovery_source"];
  const fillPatch = {};
  for (const f of fillFields) {
    if (!primary[f] && secondary[f]) fillPatch[f] = secondary[f];
  }
  // Merge tags arrays
  const mergedTags = Array.from(new Set([...(primary.tags || []), ...(secondary.tags || [])]));
  if (mergedTags.length > (primary.tags || []).length) fillPatch.tags = mergedTags;

  if (Object.keys(fillPatch).length > 0) {
    await sb.from("bullion_leads").update(fillPatch).eq("id", primaryLeadId);
  }

  // Register secondary phone as an alias so future inbound from that number routes here
  if (secondary.phone) {
    await sb.from("bullion_lead_aliases").insert({
      tenant_id: secondary.tenant_id,
      alias_phone: secondary.phone,
      lead_id: primaryLeadId,
      created_by: "merge_leads",
    }).then(() => {}, () => {}); // ignore conflict if alias already exists
  }

  // Soft-delete secondary
  await sb.from("bullion_leads").update({
    status: "dead",
    bot_paused: true,
    name: `[MERGED → ${primaryLeadId.slice(0, 8)}] ${secondary.name || secondary.phone}`,
  }).eq("id", secondaryLeadId);

  return res.status(200).json({ ok: true, primaryLeadId, secondaryLeadId, filledFields: Object.keys(fillPatch) });
}
