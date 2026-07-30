// GET  /api/contact-update?t=TOKEN   — fetch lead by token for pre-fill
// GET  /api/contact-update?phone=... — fetch lead by phone (generic profile page)
// POST /api/contact-update?t=TOKEN   — save updates + family members + referrals
// POST /api/contact-update           — register new lead by phone + referrals
//
// TOKEN = form_token UUID on bullion_leads. Phone lookup requires no token.

import { supa } from "./_lib/supabase.js";
import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";

export const config = { maxDuration: 30 };

const APP_ANDROID = "https://ssjbot.gemtre.in/app";
const APP_IOS     = "https://ssjbot.gemtre.in/ios";

async function sendReferralMessages(sb, lead, referrals) {
  const referrerName = (lead.name || "").trim().split(" ")[0] || "A friend";
  const results = [];
  for (const ref of referrals) {
    const refPhone = normalizePhone(ref.phone);
    if (!refPhone || refPhone.length < 10) continue;

    // Skip if already referred by this person
    const { data: existing } = await sb.from("bullion_referrals")
      .select("id, status")
      .eq("referrer_lead_id", lead.id)
      .eq("referred_phone", refPhone)
      .maybeSingle();
    if (existing) { results.push({ phone: refPhone, status: "already_referred" }); continue; }

    // Insert referral record — get the new UUID so we can embed it in the link
    const { data: newRef } = await sb.from("bullion_referrals").insert({
      tenant_id: lead.tenant_id,
      referrer_lead_id: lead.id,
      referred_phone: refPhone,
      status: "pending",
    }).select("id").single();

    const refId = newRef?.id || "";
    const profileLink = `https://ssjbot.gemtre.in/profile${refId ? `?ref=${refId}` : ""}`;

    // Send WA to friend
    const friendName = ref.name ? `${ref.name.trim()}, ` : "";
    const msg = [
      `🎁 ${friendName}${referrerName} has gifted you *50mg FREE gold* from Sun Sea Jewellers, Karol Bagh!`,
      ``,
      `To claim your gift, fill in your details here:`,
      `👉 ${profileLink}`,
      ``,
      `Also download the Sun Sea Jewellers app:`,
      `📱 Android: ${APP_ANDROID}`,
      `🍎 iOS: ${APP_IOS}`,
      ``,
      `- Sun Sea Jewellers, Karol Bagh`,
    ].join("\n");

    const wa = await sendWhatsAppWbiz({ phone: refPhone, msg, whatsappClient: null });
    if (refId) {
      await sb.from("bullion_referrals").update({
        status: wa.status === 1 ? "wa_sent" : "pending",
        ...(wa.status === 1 ? { wa_sent_at: new Date().toISOString() } : {}),
      }).eq("id", refId);
    }

    results.push({ phone: refPhone, status });
  }
  return results;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const token = req.query.t;
  const rawPhone = req.query.phone;

  // ── GET by phone — generic profile page lookup ─────────────────
  if (req.method === "GET" && rawPhone) {
    const phone = normalizePhone(rawPhone);
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
    const { data: lead } = await sb
      .from("bullion_leads")
      .select("id, name, phone, email, city, address_house, address_locality, address_state, address_pincode, address_country, bday, anniversary, form_token")
      .eq("phone", phone)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();
    if (!lead) return res.status(200).json({ ok: true, lead: null, family: [], isNew: true });
    const { data: family } = await sb
      .from("bullion_family_members")
      .select("id, relationship, name, dob, mobile")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true });
    return res.status(200).json({ ok: true, lead, family: family || [], isNew: false });
  }

  // ── GET by token — existing personalised link ──────────────────
  if (req.method === "GET" && token) {
    if (!/^[0-9a-f-]{36}$/.test(token)) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }
    const { data: lead, error } = await sb
      .from("bullion_leads")
      .select("id, name, phone, email, city, address_house, address_locality, address_state, address_pincode, address_country, bday, anniversary, wa_display_name")
      .eq("form_token", token)
      .maybeSingle();
    if (error || !lead) return res.status(404).json({ ok: false, error: "not_found" });
    const { data: family } = await sb
      .from("bullion_family_members")
      .select("id, relationship, name, dob, mobile")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true });
    return res.status(200).json({ ok: true, lead, family: family || [] });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // ── POST — parse body ──────────────────────────────────────────
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let lead;
  let leadJustCreated = false;

  // ── POST: new lead registration by phone (no token) ───────────
  if (!token && body.phone) {
    const phone = normalizePhone(body.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });

    // Upsert lead
    const { data: existing } = await sb.from("bullion_leads")
      .select("id, tenant_id, name")
      .eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

    if (existing) {
      lead = existing;
    } else {
      leadJustCreated = true;
      const ins = {
        tenant_id: TENANT_ID,
        phone,
        status: "new",
        source: "profile_form",
      };
      if (body.name) ins.name = String(body.name).slice(0, 100);
      const { data: newLead } = await sb.from("bullion_leads").insert(ins).select("id, tenant_id, name").single();
      lead = newLead;
    }
    if (!lead) return res.status(500).json({ ok: false, error: "lead_save_failed" });

    // ── Track referral: if friend came via a referral link, mark them as registered ──
    const referralId = body.referralId;
    if (referralId && /^[0-9a-f-]{36}$/.test(referralId)) {
      await sb.from("bullion_referrals").update({
        referred_lead_id: lead.id,
        status: "registered",
        registered_at: new Date().toISOString(),
      }).eq("id", referralId).is("referred_lead_id", null); // only if not already linked
    }
  }

  // ── POST: update by token ──────────────────────────────────────
  if (!lead && token) {
    if (!/^[0-9a-f-]{36}$/.test(token)) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }
    const { data, error } = await sb.from("bullion_leads")
      .select("id, tenant_id, name")
      .eq("form_token", token)
      .maybeSingle();
    if (error || !data) return res.status(404).json({ ok: false, error: "not_found" });
    lead = data;
  }

  if (!lead) return res.status(400).json({ ok: false, error: "token_or_phone_required" });

  const FIELD_LIMITS = {
    name: 100, email: 200, city: 100, address_house: 300, address_locality: 200,
    address_state: 100, address_pincode: 10, address_country: 100, bday: 20, anniversary: 20,
  };
  const proposedFields = {};
  for (const key of Object.keys(FIELD_LIMITS)) {
    if (body[key]) proposedFields[key] = String(body[key]).slice(0, FIELD_LIMITS[key]);
  }
  const submittedFamily = Array.isArray(body.family) ? body.family : [];
  const familyAdditions = submittedFamily.filter((m) => m.relationship && !m.id).map((m) => ({
    relationship: String(m.relationship).slice(0, 50),
    name: m.name ? String(m.name).slice(0, 100) : null,
    dob: m.dob ? String(m.dob).slice(0, 20) : null,
    mobile: m.mobile ? String(m.mobile).slice(0, 20) : null,
  }));
  const familyEdits = submittedFamily.filter((m) => m.relationship && m.id).map((m) => ({
    id: m.id,
    relationship: String(m.relationship).slice(0, 50),
    name: m.name ? String(m.name).slice(0, 100) : null,
    dob: m.dob ? String(m.dob).slice(0, 20) : null,
    mobile: m.mobile ? String(m.mobile).slice(0, 20) : null,
  }));
  const deletedFamilyIds = Array.isArray(body.deletedFamilyIds) ? body.deletedFamilyIds : [];

  let staged = false;

  if (leadJustCreated) {
    // Brand-new lead in this same request — nothing pre-existing to protect,
    // apply directly (matches the original behaviour for first-time signups).
    if (Object.keys(proposedFields).length) {
      await sb.from("bullion_leads").update(proposedFields).eq("id", lead.id);
      if (proposedFields.name) lead.name = proposedFields.name;
    }
    for (const add of familyAdditions) {
      await sb.from("bullion_family_members").insert({ ...add, lead_id: lead.id, tenant_id: lead.tenant_id });
    }
  } else if (Object.keys(proposedFields).length || familyAdditions.length || familyEdits.length || deletedFamilyIds.length) {
    // Existing lead editing their own saved data — stage for staff review
    // instead of writing directly, so old data is never silently
    // overwritten or deleted (see migration 0096_lead_edit_requests.sql).
    const { data: currentLead } = await sb.from("bullion_leads")
      .select("name, email, city, address_house, address_locality, address_state, address_pincode, address_country, bday, anniversary")
      .eq("id", lead.id).maybeSingle();

    await sb.from("bullion_lead_edit_requests").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      status: "pending",
      proposed_fields: proposedFields,
      current_snapshot: currentLead || {},
      family_additions: familyAdditions,
      family_edits: familyEdits,
      deleted_family_ids: deletedFamilyIds,
    });
    staged = true;
  }

  // ── Referrals — send WA to each referred friend (not "their own data",
  // applied immediately regardless of staging) ────────────────────
  const referrals = Array.isArray(body.referrals) ? body.referrals : [];
  const referralResults = referrals.length > 0
    ? await sendReferralMessages(sb, lead, referrals)
    : [];

  return res.status(200).json({ ok: true, referrals: referralResults, staged });
}
