// GET  /api/contact-update?t=TOKEN  — fetch lead data for pre-fill
// POST /api/contact-update?t=TOKEN  — save updated details + family members
//
// TOKEN = form_token UUID on bullion_leads. No auth needed — token IS the auth.

import { supa } from "./_lib/supabase.js";

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = req.query.t;
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    return res.status(400).json({ ok: false, error: "invalid_token" });
  }

  const sb = supa();

  // ── GET — return lead data for pre-fill ────────────────────
  if (req.method === "GET") {
    const { data: lead, error } = await sb
      .from("bullion_leads")
      .select("id, name, phone, email, city, bday, anniversary, wa_display_name")
      .eq("form_token", token)
      .maybeSingle();

    if (error || !lead) return res.status(404).json({ ok: false, error: "not_found" });

    const { data: family } = await sb
      .from("family_members")
      .select("id, relationship, name, dob, mobile")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true });

    return res.status(200).json({ ok: true, lead, family: family || [] });
  }

  // ── POST — save updates ─────────────────────────────────────
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { data: lead, error } = await sb
      .from("bullion_leads")
      .select("id, tenant_id")
      .eq("form_token", token)
      .maybeSingle();

    if (error || !lead) return res.status(404).json({ ok: false, error: "not_found" });

    // Update lead fields (only safe customer-facing fields)
    const update = {};
    if (body.name)        update.name        = String(body.name).slice(0, 100);
    if (body.email)       update.email       = String(body.email).slice(0, 200);
    if (body.city)        update.city        = String(body.city).slice(0, 100);
    if (body.bday)        update.bday        = String(body.bday).slice(0, 20);
    if (body.anniversary) update.anniversary = String(body.anniversary).slice(0, 20);

    if (Object.keys(update).length) {
      await sb.from("bullion_leads").update(update).eq("id", lead.id);
    }

    // Upsert family members
    const members = Array.isArray(body.family) ? body.family : [];
    for (const m of members) {
      if (!m.relationship) continue;
      const row = {
        lead_id: lead.id,
        tenant_id: lead.tenant_id,
        relationship: String(m.relationship).slice(0, 50),
        name: m.name ? String(m.name).slice(0, 100) : null,
        dob: m.dob ? String(m.dob).slice(0, 20) : null,
        mobile: m.mobile ? String(m.mobile).slice(0, 20) : null,
      };
      if (m.id) {
        await sb.from("family_members").update(row).eq("id", m.id).eq("lead_id", lead.id);
      } else {
        await sb.from("family_members").insert(row);
      }
    }

    // Delete removed members
    if (Array.isArray(body.deletedFamilyIds) && body.deletedFamilyIds.length > 0) {
      await sb.from("family_members").delete()
        .in("id", body.deletedFamilyIds).eq("lead_id", lead.id);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
