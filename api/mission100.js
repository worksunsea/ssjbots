// /api/mission100 — public, no auth (?action= dispatch, mirrors api/kitty.js's
// shape rather than kitty-enroll.js's single-POST shape, since this needs 3
// distinct public operations and must work for anonymous/no-login visitors
// — many Mission 100 members are walk-ins/friends without CRM accounts).
//
// GET  ?action=leaderboard&inviteCode=&viewerMemberId=  — group + masked member list
// POST ?action=start-group  — body: { name, phone, groupLabel, size }
// POST ?action=join-group   — body: { name, phone, inviteCode, refMemberId? }
//
// Purchases and the online-payment flow live elsewhere (staff-logged via
// api/kitty.js's add-installment through the normal Enrollments tab, or
// self-pay via api/mission100-payment.js) — this file only handles group
// formation/joining and the public read-only leaderboard.

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";
import { gramsForInstallments } from "./_lib/kittyGrams.js";
import { generateInviteCode } from "./_lib/mission100.js";

const GULLAK_STALE_DAYS = 45; // mirrors src/KittyAdmin.jsx's existing stale-purchase threshold

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

async function upsertLead(sb, { phone, name }) {
  const { data: existing } = await sb.from("bullion_leads").select("*").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();
  if (existing) {
    await sb.from("bullion_leads").update({ name }).eq("id", existing.id);
    return { ...existing, name };
  }
  const { data: inserted, error } = await sb.from("bullion_leads").insert({
    tenant_id: TENANT_ID, phone, name, source: "mission100_signup", status: "new", stage: "greeting",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return inserted;
}

async function getMission100Scheme(sb) {
  const { data } = await sb.from("kitty_schemes").select("id,name,perks").eq("tenant_id", TENANT_ID).eq("slug", "mission-100").maybeSingle();
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  if (req.method === "POST" && action === "start-group") {
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    const name = String(body.name || "").trim().slice(0, 100);
    const size = Number(body.size);
    const groupLabel = String(body.groupLabel || "").trim().slice(0, 100) || `${name}'s Mission 100`;
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (size !== 10 && size !== 20) return res.status(400).json({ ok: false, error: "size_must_be_10_or_20" });

    const scheme = await getMission100Scheme(sb);
    if (!scheme) return res.status(500).json({ ok: false, error: "mission100_scheme_not_configured" });

    let lead;
    try { lead = await upsertLead(sb, { phone, name }); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

    const { data: enrollment, error: enrollErr } = await sb.from("kitty_enrollments").insert({
      tenant_id: TENANT_ID, lead_id: lead.id, scheme_id: scheme.id, status: "active", start_date: new Date().toISOString().slice(0, 10),
    }).select("id").single();
    if (enrollErr) return res.status(500).json({ ok: false, error: enrollErr.message });

    let group, groupErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = generateInviteCode();
      ({ data: group, error: groupErr } = await sb.from("mission100_groups").insert({
        tenant_id: TENANT_ID, scheme_id: scheme.id, group_label: groupLabel, invite_code: inviteCode, size, formed_by: "self_signup",
      }).select().single());
      if (!groupErr) break;
      if (!String(groupErr.message || "").includes("duplicate")) return res.status(500).json({ ok: false, error: groupErr.message });
    }
    if (groupErr) return res.status(500).json({ ok: false, error: "could_not_generate_unique_invite_code" });

    const { data: member, error: memberErr } = await sb.from("mission100_group_members").insert({
      tenant_id: TENANT_ID, group_id: group.id, enrollment_id: enrollment.id, joined_via: "invite_link",
    }).select("id").single();
    if (memberErr) return res.status(500).json({ ok: false, error: memberErr.message });

    await logKittyAudit({ entityType: "mission100_group", entityId: group.id, action: "self_start", actor: `online:${phone}`, details: { label: groupLabel, size } });
    return res.status(200).json({ ok: true, inviteCode: group.invite_code, enrollmentId: enrollment.id, memberId: member.id });
  }

  if (req.method === "POST" && action === "join-group") {
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    const name = String(body.name || "").trim().slice(0, 100);
    const inviteCode = String(body.inviteCode || "").trim().toUpperCase();
    if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!inviteCode) return res.status(400).json({ ok: false, error: "inviteCode_required" });

    const { data: group } = await sb.from("mission100_groups").select("*").eq("tenant_id", TENANT_ID).eq("invite_code", inviteCode).maybeSingle();
    if (!group) return res.status(404).json({ ok: false, error: "group_not_found" });
    if (!["forming", "racing"].includes(group.status)) return res.status(400).json({ ok: false, error: "group_not_joinable" });
    const { count: memberCount } = await sb.from("mission100_group_members").select("*", { count: "exact", head: true }).eq("group_id", group.id);
    if ((memberCount || 0) >= group.size) return res.status(409).json({ ok: false, error: "group_full" });

    let referredByMemberId = null;
    if (body.refMemberId) {
      const { data: refMember } = await sb.from("mission100_group_members").select("id").eq("tenant_id", TENANT_ID).eq("id", body.refMemberId).maybeSingle();
      if (refMember) referredByMemberId = refMember.id;
    }

    let lead;
    try { lead = await upsertLead(sb, { phone, name }); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

    const { data: enrollment, error: enrollErr } = await sb.from("kitty_enrollments").insert({
      tenant_id: TENANT_ID, lead_id: lead.id, scheme_id: group.scheme_id, status: "active", start_date: new Date().toISOString().slice(0, 10),
    }).select("id").single();
    if (enrollErr) return res.status(500).json({ ok: false, error: enrollErr.message });

    const { data: member, error: memberErr } = await sb.from("mission100_group_members").insert({
      tenant_id: TENANT_ID, group_id: group.id, enrollment_id: enrollment.id, joined_via: "invite_link", referred_by_member_id: referredByMemberId,
    }).select("id").single();
    if (memberErr) {
      if (String(memberErr.message || "").includes("duplicate")) return res.status(409).json({ ok: false, error: "already_joined" });
      return res.status(500).json({ ok: false, error: memberErr.message });
    }

    const newCount = (memberCount || 0) + 1;
    if (newCount >= group.size && group.status === "forming") {
      await sb.from("mission100_groups").update({ status: "racing", started_at: new Date().toISOString() }).eq("id", group.id);
    }

    await logKittyAudit({ entityType: "mission100_group", entityId: group.id, action: "join", actor: `online:${phone}`, details: { referredByMemberId } });
    return res.status(200).json({ ok: true, inviteCode: group.invite_code, enrollmentId: enrollment.id, memberId: member.id });
  }

  if (req.method === "GET" && action === "leaderboard") {
    const inviteCode = String(req.query.inviteCode || "").trim().toUpperCase();
    const viewerMemberId = req.query.viewerMemberId || null;
    if (!inviteCode) return res.status(400).json({ ok: false, error: "inviteCode_required" });

    const { data: group } = await sb.from("mission100_groups")
      .select("*, scheme:kitty_schemes(perks), checkpointWins:mission100_checkpoint_wins(checkpoint_grams, winner_member_id, awarded_at)")
      .eq("tenant_id", TENANT_ID).eq("invite_code", inviteCode).maybeSingle();
    if (!group) return res.status(404).json({ ok: false, error: "group_not_found" });

    const { data: members } = await sb.from("mission100_group_members")
      .select("id, finished_at, finish_rank, last_purchase_at, enrollment:kitty_enrollments(id, lead:bullion_leads(name), installments:kitty_installments(status,paid_amount,amount,rate_locked))")
      .eq("group_id", group.id);

    const ranked = (members || [])
      .map((m) => ({ ...m, ...gramsForInstallments(m.enrollment?.installments) }))
      .sort((a, b) => b.totalGrams - a.totalGrams);

    const staleThreshold = Date.now() - GULLAK_STALE_DAYS * 86400000;
    const publicMembers = ranked.map((m, idx) => {
      const isViewer = viewerMemberId && m.id === viewerMemberId;
      const initial = (m.enrollment?.lead?.name || "?").trim().charAt(0).toUpperCase();
      const inactive = m.last_purchase_at ? new Date(m.last_purchase_at).getTime() < staleThreshold : false;
      const base = { memberId: m.id, rank: idx + 1, initial, inactive, finished: !!m.finished_at };
      if (isViewer) return { ...base, isViewer: true, name: m.enrollment?.lead?.name || null, totalGrams: m.totalGrams, finishRank: m.finish_rank };
      return base;
    });

    return res.status(200).json({
      ok: true,
      group: {
        label: group.group_label, status: group.status, size: group.size, memberCount: (members || []).length,
        tripPrizeDescription: group.scheme?.perks?.trip_prize_description || null,
        winnerDeclaredAt: group.winner_declared_at, prizeStatus: group.prize_status,
        checkpointWins: group.checkpointWins || [],
      },
      members: publicMembers,
    });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
