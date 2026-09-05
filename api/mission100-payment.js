// /api/mission100-payment — client-session gated (Authorization: Bearer
// <token from api/client-auth>), CORS open. Powers Mission 100's online
// self-pay flow: quote a purchase, create a Razorpay order for it. This is
// the ONE place Mission 100 asks for login — browsing/joining/starting a
// group stays fully anonymous elsewhere (api/mission100.js) — because real
// payment requires knowing who's receiving the gold.
//
// No daily cap, no subscription/auto-debit here (unlike Swarn Suraksha) —
// Mission 100 purchases are one-off top-ups at whatever coin size the
// member picks (1/2/5/10g), any time.
//
// payment.captured is handled by the EXISTING api/razorpay-webhook.js with
// zero changes — it already matches any kitty_installments row by
// razorpay_order_id/status:'awaiting_payment', with no scheme-specific
// filtering in that path.
//
// Also serves the client's own dashboard (?action=dashboard): their
// standing across every Mission 100 group they're in, plus their referral
// network (who they've referred, who's already past 25g, who's still
// short so they can personally chase them) and referral bonus earned so
// far. General investment/P&L across ALL kitty schemes (not just Mission
// 100) is served by the existing api/kitty-client.js — the frontend calls
// both with the same session token.

import { supa } from "./_lib/supabase.js";
import { requireClientSession } from "./_lib/clientAuth.js";
import { TENANT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { razorpayConfigured, createOrder } from "./_lib/razorpay.js";
import { logKittyAudit } from "./_lib/kittyAudit.js";
import { gramsForInstallments } from "./_lib/kittyGrams.js";
import { CHECKPOINTS_G } from "./_lib/mission100.js";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireClientSession(req, res);
  if (!session) return;

  const sb = supa();
  const action = req.query?.action;

  // GET ?action=quote&grams=<n> — live rate × grams, no cap.
  if (req.method === "GET" && action === "quote") {
    const grams = Number(req.query.grams);
    if (!grams || grams <= 0) return res.status(400).json({ ok: false, error: "grams_required" });
    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });
    const amount = Math.round(grams * ratePerGram * 100) / 100;
    return res.status(200).json({ ok: true, ratePerGram, amount });
  }

  // POST ?action=create-order — body { enrollmentId, grams }.
  if (req.method === "POST" && action === "create-order") {
    if (!razorpayConfigured()) return res.status(400).json({ ok: false, error: "razorpay_not_configured" });
    const body = req.body || {};
    const grams = Number(body.grams);
    if (!body.enrollmentId || !grams || grams <= 0) return res.status(400).json({ ok: false, error: "enrollmentId_grams_required" });

    const { data: enrollment } = await sb.from("kitty_enrollments")
      .select("*, scheme:kitty_schemes(perks)").eq("tenant_id", TENANT_ID).eq("id", body.enrollmentId).eq("lead_id", session.leadId).maybeSingle();
    if (!enrollment) return res.status(404).json({ ok: false, error: "enrollment_not_found" });
    if (!enrollment.scheme?.perks?.mission100) return res.status(400).json({ ok: false, error: "not_a_mission100_enrollment" });

    const rates = await getRates();
    const ratePerGram = rates?.spot?.gold24kt;
    if (!ratePerGram) return res.status(503).json({ ok: false, error: "rate_unavailable" });

    // Never trust a client-sent amount — always re-derive from the live
    // rate server-side, same rule api/kitty-payment.js follows.
    const amount = Math.round(grams * ratePerGram * 100) / 100;
    const amountPaise = Math.round(amount * 100);

    let order;
    try {
      order = await createOrder({ amountPaise, receipt: `mission100-${enrollment.id}-${Date.now()}`, notes: { enrollmentId: enrollment.id, leadId: session.leadId, grams } });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }

    const { data: nextMonthRow } = await sb.from("kitty_installments").select("month_number").eq("enrollment_id", enrollment.id).order("month_number", { ascending: false }).limit(1);
    const nextMonth = (nextMonthRow?.[0]?.month_number || 0) + 1;

    const { data: installment, error } = await sb.from("kitty_installments").insert({
      tenant_id: TENANT_ID, enrollment_id: enrollment.id, month_number: nextMonth, due_date: todayIST(),
      amount, status: "awaiting_payment", rate_locked: ratePerGram, grams_purchased: grams,
      source: "online_self_pay", razorpay_order_id: order.id,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    await logKittyAudit({ entityType: "installment", entityId: installment.id, action: "mission100_order_created", actor: session.phone, details: { enrollmentId: enrollment.id, grams, amount } });

    return res.status(200).json({ ok: true, orderId: order.id, amountPaise, razorpayKeyId: process.env.RAZORPAY_KEY_ID || "", enrollmentId: enrollment.id, installmentId: installment.id });
  }

  // GET ?action=dashboard — the logged-in client's own Mission 100
  // standing across every group they're in, plus their referral network:
  // who they've referred, who's already qualified (25g — the referral
  // bonus bar), who's still short so they can personally nudge them, and
  // how much referral bonus gold they've earned so far.
  if (req.method === "GET" && action === "dashboard") {
    // Start from kitty_enrollments (already filtered to this lead) rather
    // than filtering on an embedded resource — more predictable across
    // PostgREST versions than .eq() on a joined column.
    const { data: myEnrollments } = await sb.from("kitty_enrollments")
      .select("id, scheme:kitty_schemes(perks), installments:kitty_installments(status,paid_amount,amount,rate_locked), member:mission100_group_members(id, finished_at, referral_bonus_tier_awarded, group:mission100_groups(id, group_label, invite_code, status, size, winner_enrollment_id))")
      .eq("tenant_id", TENANT_ID).eq("lead_id", session.leadId);

    const rates = await getRates().catch(() => null);
    const todaysRate = rates?.spot?.gold24kt || null;

    const myMembers = (myEnrollments || [])
      .filter((e) => e.scheme?.perks?.mission100 && e.member)
      .map((e) => ({ ...(Array.isArray(e.member) ? e.member[0] : e.member), enrollment: e }));

    const missions = myMembers.map((m) => {
      const { totalGrams } = gramsForInstallments(m.enrollment?.installments);
      const checkpointsReached = CHECKPOINTS_G.filter((cp) => totalGrams >= cp);
      return {
        memberId: m.id, groupLabel: m.group?.group_label, inviteCode: m.group?.invite_code, status: m.group?.status,
        size: m.group?.size, totalGrams, checkpointsReached, finished: !!m.finished_at,
        isWinner: m.group?.winner_enrollment_id === m.enrollment?.id,
      };
    });

    const myMemberIds = (myMembers || []).map((m) => m.id);
    let referrals = [];
    if (myMemberIds.length) {
      const { data: referredRows } = await sb.from("mission100_group_members")
        .select("id, referred_by_member_id, enrollment:kitty_enrollments(lead:bullion_leads(name,phone), installments:kitty_installments(status,paid_amount,amount,rate_locked))")
        .in("referred_by_member_id", myMemberIds);
      referrals = (referredRows || []).map((r) => {
        const { totalGrams } = gramsForInstallments(r.enrollment?.installments);
        return { name: r.enrollment?.lead?.name || "—", phone: r.enrollment?.lead?.phone || null, totalGrams, qualifying: totalGrams >= 25 };
      });
    }

    const referralBonusGrams = (myMembers || []).reduce((sum, m) => sum + (m.referral_bonus_tier_awarded || 0), 0);

    return res.status(200).json({
      ok: true, missions, referrals, referralBonusGrams, todaysGoldRate: todaysRate,
      referralsQualified: referrals.filter((r) => r.qualifying).length,
      referralsBehind: referrals.filter((r) => !r.qualifying),
    });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
