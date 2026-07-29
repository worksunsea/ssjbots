// POST /api/kitty-interest — public, no auth. "Register interest" capture
// for the future Monthly Kitty / gold savings scheme (Phase 6 — interest
// only, no scheme mechanics yet). Same upsert-by-phone pattern as
// bridal-lead.js.
//
// Body: { name, phone }

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { sendPushNotification } from "./_lib/pushNotify.js";

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

  let leadId;
  if (existing) {
    leadId = existing.id;
    await sb.from("bullion_leads").update({
      name,
      extra_fields: { ...(existing.extra_fields || {}), kitty_interest: true },
    }).eq("id", leadId);
  } else {
    const { data: inserted, error } = await sb.from("bullion_leads").insert({
      tenant_id: TENANT_ID, phone, name, source: "kitty_scheme_interest",
      status: "new", stage: "greeting",
      extra_fields: { kitty_interest: true },
    }).select("id").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    leadId = inserted.id;
  }

  await sendPushNotification({
    userId: "admin",
    title: "🪙 Kitty Scheme Interest",
    body: name,
    url: "/",
  }).catch(() => {});

  return res.status(200).json({ ok: true, leadId });
}
