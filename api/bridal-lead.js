// POST /api/bridal-lead — public, no auth (same open pattern as
// corporate-gifting.js / solitaire-designs.js action=lead). Landing page
// for bridal jewellery ads — captures the lead with source tagging so ad
// performance is attributable, distinct from organic/WA leads.
//
// Body: { name, phone, weddingDate?, budget?, city?, notes? }

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { attributeReferral } from "./_lib/referralAttribution.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const phone = normalizePhone(body.phone);
  const name = String(body.name || "").trim().slice(0, 100);
  if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
  if (!name) return res.status(400).json({ ok: false, error: "name_required" });

  const sb = supa();

  const { data: existing } = await sb.from("bullion_leads")
    .select("id, extra_fields").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

  const bridalFields = {
    bridal_wedding_date: body.weddingDate || "",
    bridal_budget: body.budget || "",
    bridal_city: body.city || "",
    bridal_notes: body.notes || "",
    bridal_enquired_at: new Date().toISOString(),
  };

  let leadId;
  if (existing) {
    leadId = existing.id;
    await sb.from("bullion_leads").update({
      name,
      extra_fields: { ...(existing.extra_fields || {}), ...bridalFields },
    }).eq("id", leadId);
  } else {
    const { data: inserted, error } = await sb.from("bullion_leads").insert({
      tenant_id: TENANT_ID,
      phone,
      name,
      source: "bridal_jewellery_landing",
      status: "new",
      stage: "greeting",
      city: body.city || null,
      extra_fields: bridalFields,
    }).select("id").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    leadId = inserted.id;
  }

  await sendPushNotification({
    userId: "admin",
    title: "💍 Bridal Jewellery Enquiry",
    body: `${name}${body.weddingDate ? ` — wedding ${body.weddingDate}` : ""}${body.budget ? ` — budget ${body.budget}` : ""}`,
    url: "/",
  }).catch(() => {});

  await attributeReferral({ refCode: body.ref_code, leadId, orderReference: "bridal jewellery enquiry" }).catch(() => {});

  return res.status(200).json({ ok: true, leadId });
}
