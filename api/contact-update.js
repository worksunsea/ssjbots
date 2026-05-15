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

    // Insert referral record
    await sb.from("bullion_referrals").insert({
      tenant_id: lead.tenant_id,
      referrer_lead_id: lead.id,
      referred_phone: refPhone,
      status: "pending",
    });

    // Send WA to friend
    const friendName = ref.name ? `${ref.name.trim()}, ` : "";
    const msg = [
      `🎁 ${friendName}${referrerName} has gifted you *50mg FREE gold* from Sun Sea Jewellers, Karol Bagh!`,
      ``,
      `Download the Sun Sea Jewellers app and register to claim your gift:`,
      `📱 Android: ${APP_ANDROID}`,
      `🍎 iOS: ${APP_IOS}`,
      ``,
      `T&C: Gift redeemable after 6 months of app usage. Valid at Sun Sea Jewellers, Karol Bagh.`,
      ``,
      `- Sun Sea Jewellers, Karol Bagh`,
    ].join("\n");

    const wa = await sendWhatsAppWbiz({ phone: refPhone, msg, whatsappClient: null });
    const status = wa.status === 1 ? "wa_sent" : "pending";
    await sb.from("bullion_referrals").update({
      status,
      ...(wa.status === 1 ? { wa_sent_at: new Date().toISOString() } : {}),
    }).eq("referrer_lead_id", lead.id).eq("referred_phone", refPhone);

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
      .select("id, name, phone, email, city, bday, anniversary, form_token")
      .eq("phone", phone)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();
    if (!lead) return res.status(200).json({ ok: true, lead: null, family: [], isNew: true });
    const { data: family } = await sb
      .from("family_members")
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

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // ── POST — parse body ──────────────────────────────────────────
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let lead;

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

  // ── Update lead fields ─────────────────────────────────────────
  const update = {};
  if (body.name)        update.name        = String(body.name).slice(0, 100);
  if (body.email)       update.email       = String(body.email).slice(0, 200);
  if (body.city)        update.city        = String(body.city).slice(0, 100);
  if (body.bday)        update.bday        = String(body.bday).slice(0, 20);
  if (body.anniversary) update.anniversary = String(body.anniversary).slice(0, 20);
  if (Object.keys(update).length) {
    await sb.from("bullion_leads").update(update).eq("id", lead.id);
    if (update.name) lead.name = update.name;
  }

  // ── Upsert family members ──────────────────────────────────────
  const members = Array.isArray(body.family) ? body.family : [];
  for (const m of members) {
    if (!m.relationship) continue;
    const row = {
      lead_id: lead.id,
      tenant_id: lead.tenant_id,
      relationship: String(m.relationship).slice(0, 50),
      name:         m.name   ? String(m.name).slice(0, 100)   : null,
      dob:          m.dob    ? String(m.dob).slice(0, 20)     : null,
      mobile:       m.mobile ? String(m.mobile).slice(0, 20)  : null,
    };
    if (m.id) {
      await sb.from("family_members").update(row).eq("id", m.id).eq("lead_id", lead.id);
    } else {
      await sb.from("family_members").insert(row);
    }
  }
  if (Array.isArray(body.deletedFamilyIds) && body.deletedFamilyIds.length > 0) {
    await sb.from("family_members").delete()
      .in("id", body.deletedFamilyIds).eq("lead_id", lead.id);
  }

  // ── Referrals — send WA to each referred friend ────────────────
  const referrals = Array.isArray(body.referrals) ? body.referrals : [];
  const referralResults = referrals.length > 0
    ? await sendReferralMessages(sb, lead, referrals)
    : [];

  return res.status(200).json({ ok: true, referrals: referralResults });
}
