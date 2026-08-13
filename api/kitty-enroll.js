// POST /api/kitty-enroll — public, no auth. Online "I want to join this
// scheme" submission from ssj.in's Kitty Schemes page. Creates/updates the
// bullion_leads row (same upsert-by-phone pattern as kitty-interest.js /
// bridal-lead.js) plus a kitty_enrollments row in status=pending_confirmation
// — staff confirms in person (first payment + start date happen in-store,
// no payment gateway here) via the CRM Kitty Admin screen.
//
// Body: { name, phone, schemeId, batchId?, memberNumber? }
// batchId/memberNumber are required for lucky-draw schemes (Golden
// Bliss/Bloom) — the client picks a number from api/kitty.js's
// ?action=available-numbers first. A client can submit this endpoint
// multiple times for the same scheme — each call is a separate numbered
// entry, not a dedup-by-phone upsert (only the contact record is upserted).

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { enrollLeadInDrip } from "./_lib/drip.js";

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
  const schemeId = body.schemeId;
  if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
  if (!name) return res.status(400).json({ ok: false, error: "name_required" });
  if (!schemeId) return res.status(400).json({ ok: false, error: "schemeId_required" });

  const sb = supa();

  const { data: scheme } = await sb.from("kitty_schemes").select("id,name,funnel_id,perks").eq("tenant_id", TENANT_ID).eq("id", schemeId).eq("active", true).maybeSingle();
  if (!scheme) return res.status(400).json({ ok: false, error: "scheme_not_found_or_inactive" });
  if (scheme.perks?.lucky_draw && (!body.batchId || !body.memberNumber)) {
    return res.status(400).json({ ok: false, error: "batchId_memberNumber_required_for_lucky_draw_scheme" });
  }

  // Contacts rule: reuse the existing bullion_leads record for this phone if
  // one already exists, otherwise create a new contact — never a duplicate.
  const { data: existingLead } = await sb.from("bullion_leads")
    .select("*").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

  let lead = existingLead;
  if (lead) {
    await sb.from("bullion_leads").update({ name }).eq("id", lead.id);
    lead = { ...lead, name };
  } else {
    const { data: inserted, error } = await sb.from("bullion_leads").insert({
      tenant_id: TENANT_ID, phone, name, source: "kitty_scheme_enrollment",
      status: "new", stage: "greeting",
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    lead = inserted;
  }

  const { data: enrollment, error: enrollErr } = await sb.from("kitty_enrollments").insert({
    tenant_id: TENANT_ID, lead_id: lead.id, scheme_id: scheme.id, status: "pending_confirmation",
    batch_id: scheme.perks?.lucky_draw ? body.batchId : null,
    member_number: scheme.perks?.lucky_draw ? Number(body.memberNumber) : null,
  }).select("id").single();
  if (enrollErr) {
    // Unique (batch_id, member_number) violation — someone else grabbed
    // that number in the moment between the client fetching available
    // numbers and submitting. Ask them to pick again rather than a bare 500.
    if (enrollErr.code === "23505") return res.status(409).json({ ok: false, error: "number_just_taken" });
    return res.status(500).json({ ok: false, error: enrollErr.message });
  }

  // Attach to this scheme's WA drip funnel (set per-scheme in the CRM Kitty
  // Admin screen) so the member starts getting that message sequence right
  // away — same funnel mechanism the rest of the CRM's drip campaigns use.
  if (scheme.funnel_id) {
    const { data: funnel } = await sb.from("funnels").select("*").eq("tenant_id", TENANT_ID).eq("id", scheme.funnel_id).eq("active", true).maybeSingle();
    if (funnel) await enrollLeadInDrip({ lead, funnel }).catch(() => {});
  }

  await sendPushNotification({
    userId: "admin",
    title: "🪙 New Kitty Scheme Enrollment",
    body: `${name} — ${scheme.name}`,
    url: "/",
  }).catch(() => {});

  return res.status(200).json({ ok: true, enrollmentId: enrollment.id });
}
