// POST /api/lead  (service-secret protected)
// External systems (Meta Lead Forms, Google Forms, Zapier, CSV imports,
// hand-entered CRM form) can push a lead here. We upsert on (tenant_id, phone)
// via the bullion_upsert_lead RPC and optionally enroll the lead in a funnel's
// drip right away.
//
// Body:
//   { phone, name?, city?, email?, bday?, anniversary?, source?,
//     funnel_id?, enroll?: boolean }
// Headers:
//   x-service-secret: <WA_SERVICE_SECRET or WEBHOOK_SECRET — any shared one>
//
// Idempotent: calling twice with same phone just updates the same lead.

import { supa } from "./_lib/supabase.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { TENANT_ID as DEFAULT_TENANT_ID, normalizePhone } from "./_lib/config.js";

const ALLOWED_SECRETS = [
  process.env.WA_SERVICE_SECRET,
  process.env.WEBHOOK_SECRET,
  process.env.IMPORT_SECRET,
].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const token = req.headers["x-service-secret"] || req.query?.secret || "";
  if (ALLOWED_SECRETS.length && !ALLOWED_SECRETS.includes(token)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const phone = normalizePhone(body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

  const sb = supa();

  // Caller can specify tenant explicitly, else we try to resolve from funnel,
  // else fall back to SSJ default. Never guess silently across tenants.
  let tenantId = body.tenant_id || null;
  if (!tenantId && body.funnel_id) {
    const { data: f } = await sb.from("funnels").select("tenant_id").eq("id", body.funnel_id).maybeSingle();
    tenantId = f?.tenant_id || null;
  }
  tenantId = tenantId || DEFAULT_TENANT_ID;

  // Use the RPC (handles re-entry + funnel_history properly)
  const { data: leadRow, error } = await sb.rpc("bullion_upsert_lead", {
    p_tenant_id: tenantId,
    p_phone: phone,
    p_name: body.name || "",
    p_funnel_id: body.funnel_id || null,
    p_body: body.source ? `[imported — source: ${body.source}]` : "[imported lead]",
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Patch any extra fields the caller provided
  const extras = {};
  for (const k of ["city", "email", "bday", "anniversary", "source"]) {
    if (body[k]) extras[k] = body[k];
  }
  if (Object.keys(extras).length) {
    await sb.from("bullion_leads").update(extras).eq("id", leadRow.id);
  }

  // Optionally kick off the drip
  if (body.enroll && body.funnel_id) {
    const { data: funnel } = await sb
      .from("funnels")
      .select("*")
      .eq("id", body.funnel_id)
      .single();
    if (funnel?.active) {
      await enrollLeadInDrip({ lead: { ...leadRow, ...extras }, funnel }).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true, lead_id: leadRow.id, phone });
}
