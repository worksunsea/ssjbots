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
//
// ── Webhook source mode ──────────────────────────────────────────────────────
// GET  /api/lead?token=<webhook_token>  — Facebook hub.challenge verification
// POST /api/lead?token=<webhook_token>  — Receive lead from a configured source
//   (bullion_lead_sources table). No service-secret needed — token is the auth.
//   Supports: facebook, indiamart, justdial, 99acres, housing, sulekha,
//             magicbricks, generic

import { supa } from "./_lib/supabase.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { TENANT_ID as DEFAULT_TENANT_ID, normalizePhone } from "./_lib/config.js";

const ALLOWED_SECRETS = [
  process.env.WA_SERVICE_SECRET,
  process.env.WEBHOOK_SECRET,
  process.env.IMPORT_SECRET,
].filter(Boolean);

// ── Inbound source extractors ─────────────────────────────────────────────────

function extractFacebook(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.find((c) => c.field === "leadgen");
  const lead = change?.value;
  if (!lead) return null;
  const fields = {};
  for (const f of lead.field_data || []) {
    fields[f.name] = f.values?.[0] || "";
  }
  return {
    phone: fields["phone_number"] || fields["phone"] || fields["mobile"] || "",
    name: fields["full_name"] || fields["name"] || "",
    email: fields["email"] || "",
    city: fields["city"] || fields["location"] || "",
    notes: `FB Lead ID: ${lead.leadgen_id || ""}`,
  };
}

function extractIndiamart(body) {
  return {
    phone: body.SENDER_MOBILE || body.sender_mobile || "",
    name: body.SENDER_NAME || body.sender_name || "",
    email: body.SENDER_EMAIL || body.sender_email || "",
    city: body.SENDER_CITY || body.sender_city || "",
    notes: body.SUBJECT || body.subject || body.PRODUCT_NAME || "",
  };
}

function extractJustdial(body) {
  return {
    phone: body.phone || body.mobile || body.contact || "",
    name: body.name || body.leadname || "",
    email: body.email || "",
    city: body.city || body.area || "",
  };
}

function extractGoogleAds(body) {
  // Google Ads Lead Form webhook: user_column_data array of {column_name, string_value}
  const cols = {};
  for (const col of body.user_column_data || []) {
    cols[col.column_name?.toUpperCase()] = col.string_value || "";
  }
  return {
    phone: cols["PHONE_NUMBER"] || cols["PHONE"] || "",
    name: cols["FULL_NAME"] || cols["NAME"] || "",
    email: cols["EMAIL"] || "",
    city: cols["CITY"] || cols["LOCATION"] || "",
    notes: `Google Lead ID: ${body.lead_id || ""}`,
  };
}

function extractFlat(body, fieldMap) {
  const OUR_FIELDS = ["phone", "name", "email", "city", "bday", "anniversary", "source", "notes"];
  const result = {};
  if (fieldMap && Object.keys(fieldMap).length) {
    for (const [theirKey, ourKey] of Object.entries(fieldMap)) {
      if (OUR_FIELDS.includes(ourKey) && body[theirKey] != null) {
        result[ourKey] = String(body[theirKey]);
      }
    }
  }
  for (const k of OUR_FIELDS) {
    if (!result[k] && body[k] != null) result[k] = String(body[k]);
  }
  if (!result.phone) {
    result.phone = body.mobile || body.Mobile || body.contact || body.Contact || body.phone_number || "";
  }
  if (!result.name) {
    result.name = body.full_name || body.fullname || body.lead_name || "";
  }
  return result;
}

// ── Webhook-source (token-auth) handler ───────────────────────────────────────

async function handleSourceWebhook(req, res, token) {
  const sb = supa();

  const { data: source, error: srcErr } = await sb
    .from("bullion_lead_sources")
    .select("*")
    .eq("webhook_token", token)
    .maybeSingle();

  if (srcErr || !source) return res.status(401).json({ ok: false, error: "invalid_token" });
  if (!source.active) return res.status(403).json({ ok: false, error: "source_inactive" });

  // Facebook GET verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = req.query["hub.verify_token"];
    if (mode === "subscribe" && verifyToken === token) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ ok: false, error: "verification_failed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let raw;
  switch (source.source_type) {
    case "facebook":
    case "instagram": raw = extractFacebook(body); break;  // Instagram = same Meta webhook
    case "indiamart":  raw = extractIndiamart(body); break;
    case "justdial":   raw = extractJustdial(body); break;
    case "googleads":  raw = extractGoogleAds(body); break;
    default:           raw = extractFlat(body, source.field_map); break;
  }

  if (!raw) return res.status(200).json({ ok: true, skipped: true, reason: "no_lead_data" });

  const phone = normalizePhone(raw.phone);
  if (!phone) return res.status(200).json({ ok: true, skipped: true, reason: "no_phone" });

  const funnelId = source.default_funnel_id || null;

  const { data: leadRow, error: upsertErr } = await sb.rpc("bullion_upsert_lead", {
    p_tenant_id: source.tenant_id,
    p_phone: phone,
    p_name: raw.name || "",
    p_funnel_id: funnelId,
    p_body: `[webhook — ${source.name}]`,
  });
  if (upsertErr) return res.status(500).json({ ok: false, error: upsertErr.message });

  const extras = {};
  for (const k of ["email", "city", "bday", "anniversary", "notes"]) {
    if (raw[k]) extras[k] = raw[k];
  }
  extras.source = raw.source || source.name;
  await sb.from("bullion_leads").update(extras).eq("id", leadRow.id);

  if (source.enroll_drip && funnelId) {
    const { data: funnel } = await sb.from("funnels").select("*").eq("id", funnelId).maybeSingle();
    if (funnel?.active) {
      await enrollLeadInDrip({ lead: { ...leadRow, ...extras }, funnel }).catch(() => {});
    }
  }

  const now = new Date().toISOString();
  await sb.from("bullion_imports").insert({
    tenant_id: source.tenant_id,
    started_at: now,
    finished_at: now,
    file: `webhook:${source.source_type}`,
    sheet: source.name,
    rows_in: 1,
    rows_created: 1,
    rows_merged: 0,
    rows_skipped: 0,
  });

  return res.status(200).json({ ok: true, lead_id: leadRow.id, phone });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS — required for embed.js cross-origin requests from client websites
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-service-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Webhook-source path: token param present
  const token = req.query?.token || "";
  if (token) return handleSourceWebhook(req, res, token);

  // Service-secret path: existing behaviour
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const secret = req.headers["x-service-secret"] || req.query?.secret || "";
  if (ALLOWED_SECRETS.length && !ALLOWED_SECRETS.includes(secret)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const phone = normalizePhone(body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

  const sb = supa();

  let tenantId = body.tenant_id || null;
  if (!tenantId && body.funnel_id) {
    const { data: f } = await sb.from("funnels").select("tenant_id").eq("id", body.funnel_id).maybeSingle();
    tenantId = f?.tenant_id || null;
  }
  tenantId = tenantId || DEFAULT_TENANT_ID;

  const { data: leadRow, error } = await sb.rpc("bullion_upsert_lead", {
    p_tenant_id: tenantId,
    p_phone: phone,
    p_name: body.name || "",
    p_funnel_id: body.funnel_id || null,
    p_body: body.source ? `[imported — source: ${body.source}]` : "[imported lead]",
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const extras = {};
  for (const k of ["city", "email", "bday", "anniversary", "source"]) {
    if (body[k]) extras[k] = body[k];
  }
  if (Object.keys(extras).length) {
    await sb.from("bullion_leads").update(extras).eq("id", leadRow.id);
  }

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
