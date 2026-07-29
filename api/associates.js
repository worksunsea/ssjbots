// /api/associates — Sun Sea Brand Associate program.
//
// Public:
//   POST action=apply       { name, phone } — interest form → lead + WA nurture funnel
// Staff (x-crm-secret):
//   GET  action=applicants  — applicants not yet approved
//   POST action=approve     { leadId, displayName, headline? } — creates bullion_associates row
// Associate (Authorization: Bearer <client-auth token>, purpose=associate_login):
//   GET  action=dashboard   — their referral code, visit count, commissions

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID, checkCrmSecret } from "./_lib/config.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { requireClientSession } from "./_lib/clientAuth.js";

function generateReferralCode(name) {
  const base = String(name || "assoc").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10) || "assoc";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query.action || (req.body && req.body.action);
  const sb = supa();

  if (action === "apply") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const phone = normalizePhone(body.phone);
    const name = String(body.name || "").trim().slice(0, 100);
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const { data: existing } = await sb.from("bullion_leads")
      .select("id, extra_fields").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

    let leadId;
    if (existing) {
      leadId = existing.id;
      await sb.from("bullion_leads").update({
        name,
        extra_fields: { ...(existing.extra_fields || {}), associate_applicant: true },
      }).eq("id", leadId);
    } else {
      const { data: inserted, error } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name, source: "associate_recruitment",
        status: "new", stage: "greeting",
        extra_fields: { associate_applicant: true },
      }).select("id").single();
      if (error) return res.status(500).json({ ok: false, error: error.message });
      leadId = inserted.id;
    }

    const { data: funnel } = await sb.from("funnels").select("*").eq("id", "associate_recruitment").maybeSingle();
    if (funnel) {
      await enrollLeadInDrip({ lead: { id: leadId }, funnel }).catch(() => {});
    }

    return res.status(200).json({ ok: true, leadId });
  }

  if (action === "track-visit") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const code = String(body.code || "").trim();
    if (!code) return res.status(400).json({ ok: false, error: "missing_code" });
    const { data: assoc } = await sb.from("bullion_associates").select("id, display_name, headline").eq("referral_code", code).eq("status", "active").maybeSingle();
    if (!assoc) return res.status(200).json({ ok: true, tracked: false });
    await sb.from("bullion_referral_visits").insert({
      tenant_id: TENANT_ID, associate_id: assoc.id, landing_path: body.path || "/",
    }).catch(() => {});
    return res.status(200).json({ ok: true, tracked: true, associate: { displayName: assoc.display_name, headline: assoc.headline } });
  }

  if (action === "applicants") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    if (checkCrmSecret(req, res)) return;
    const { data: applicants, error } = await sb.from("bullion_leads")
      .select("id, name, phone, created_at, extra_fields")
      .eq("tenant_id", TENANT_ID)
      .contains("extra_fields", { associate_applicant: true })
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    const { data: alreadyAssociates } = await sb.from("bullion_associates").select("lead_id");
    const approvedIds = new Set((alreadyAssociates || []).map((a) => a.lead_id));
    return res.status(200).json({ ok: true, applicants: (applicants || []).filter((a) => !approvedIds.has(a.id)) });
  }

  if (action === "approve") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    if (checkCrmSecret(req, res)) return;
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { leadId, displayName, headline } = body;
    if (!leadId || !displayName) return res.status(400).json({ ok: false, error: "missing_leadId_or_displayName" });

    const { data: lead, error: leadErr } = await sb.from("bullion_leads").select("phone").eq("id", leadId).maybeSingle();
    if (leadErr || !lead) return res.status(404).json({ ok: false, error: "lead_not_found" });

    let referralCode = generateReferralCode(displayName);
    for (let i = 0; i < 5; i++) {
      const { data: clash } = await sb.from("bullion_associates").select("id").eq("referral_code", referralCode).maybeSingle();
      if (!clash) break;
      referralCode = generateReferralCode(displayName);
    }

    const { data: assoc, error } = await sb.from("bullion_associates").insert({
      tenant_id: TENANT_ID, lead_id: leadId, phone: lead.phone,
      display_name: displayName, headline: headline || "Sun Sea Brand Associate",
      status: "active", referral_code: referralCode,
      approved_by: "staff", approved_at: new Date().toISOString(),
    }).select("id, referral_code").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, associateId: assoc.id, referralCode: assoc.referral_code });
  }

  if (action === "dashboard") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const session = requireClientSession(req, res);
    if (!session) return;
    if (session.purpose !== "associate_login") return res.status(403).json({ ok: false, error: "not_an_associate_session" });

    const { data: assoc } = await sb.from("bullion_associates")
      .select("id, display_name, headline, referral_code, status")
      .eq("lead_id", session.leadId).maybeSingle();
    if (!assoc || assoc.status !== "active") return res.status(403).json({ ok: false, error: "not_an_active_associate" });

    const { count: visitCount } = await sb.from("bullion_referral_visits")
      .select("*", { count: "exact", head: true }).eq("associate_id", assoc.id);
    const { data: commissions } = await sb.from("bullion_commissions")
      .select("id, order_reference, amount, status, created_at").eq("associate_id", assoc.id).order("created_at", { ascending: false });

    return res.status(200).json({
      ok: true,
      associate: { displayName: assoc.display_name, headline: assoc.headline, referralCode: assoc.referral_code },
      visitCount: visitCount || 0,
      commissions: commissions || [],
    });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
