// GET /api/kitty-client?action=list — client-session gated (Authorization:
// Bearer <token from api/client-auth>), CORS open for ssj-website. Returns
// the logged-in lead's kitty enrollments + installment schedule + claim
// status, for the "My Kitty" section on ssj-website's ClientAccount page.
// Mirrors api/price-alerts.js's client-scoped GET/action pattern.

import { supa } from "./_lib/supabase.js";
import { requireClientSession } from "./_lib/clientAuth.js";
import { TENANT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireClientSession(req, res);
  if (!session) return;

  const action = req.query.action;
  const sb = supa();

  if (action === "list") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const { data, error } = await sb.from("kitty_enrollments")
      .select("id,status,is_legacy,legacy_scheme_name,start_date,claim_status,claimed_at,created_at,member_number,scheme:kitty_schemes(name,monthly_amount,duration_months,perks),installments:kitty_installments(month_number,due_date,amount,status,paid_at,paid_amount,rate_locked),redemptions:kitty_redemptions(redemption_type,item_description,value,redeemed_at)")
      .eq("tenant_id", TENANT_ID).eq("lead_id", session.leadId).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });

    // Per-enrollment totals: how much paid in, and — for anything with a
    // locked rate (Golden Sparkle's 20th-of-month rate lock, or gullak
    // gram purchases) — how many grams that adds up to, so the client can
    // see real accumulated gold, not just rupees paid.
    const enrollments = (data || []).map((e) => {
      const paid = (e.installments || []).filter((i) => i.status === "paid" || i.status === "free");
      const totalPaid = paid.reduce((sum, i) => sum + Number(i.paid_amount ?? i.amount ?? 0), 0);
      const totalGrams = paid.reduce((sum, i) => (i.rate_locked ? sum + Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : sum), 0);
      return { ...e, totalPaid, totalGrams: totalGrams > 0 ? Number(totalGrams.toFixed(3)) : 0 };
    });

    const summary = {
      totalPaidAllSchemes: enrollments.reduce((s, e) => s + e.totalPaid, 0),
      totalGramsAllSchemes: Number(enrollments.reduce((s, e) => s + e.totalGrams, 0).toFixed(3)),
    };

    let todaysRate = null;
    if (summary.totalGramsAllSchemes > 0) {
      const rates = await getRates().catch(() => null);
      todaysRate = rates?.spot?.gold24kt || null;
    }

    return res.status(200).json({ ok: true, enrollments, summary, todaysGoldRate: todaysRate });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
