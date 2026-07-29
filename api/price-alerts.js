// POST/GET /api/price-alerts — client-session gated (Authorization: Bearer
// <client token from api/client-auth>), CORS open for ssj-website.
//
// action=set    (POST) { metal, direction, target_rate } — creates an active alert
// action=list   (GET)  — this client's alerts
// action=cancel (POST) { id } — cancels one of this client's own alerts
//
// Actual triggering happens in api/cron.js (step 0c), checked every tick.

import { supa } from "./_lib/supabase.js";
import { requireClientSession } from "./_lib/clientAuth.js";
import { TENANT_ID } from "./_lib/config.js";

const METALS = new Set(["gold", "silver"]);
const DIRECTIONS = new Set(["buy_below", "sell_above"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireClientSession(req, res);
  if (!session) return;

  const action = req.query.action || (req.body && req.body.action);
  const sb = supa();

  if (action === "list") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const { data, error } = await sb.from("bullion_price_alerts")
      .select("id, metal, direction, target_rate, status, triggered_at, created_at")
      .eq("lead_id", session.leadId).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, alerts: data || [] });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (action === "set") {
    const metal = String(body.metal || "").trim();
    const direction = String(body.direction || "").trim();
    const targetRate = Number(body.target_rate);
    if (!METALS.has(metal)) return res.status(400).json({ ok: false, error: "invalid_metal" });
    if (!DIRECTIONS.has(direction)) return res.status(400).json({ ok: false, error: "invalid_direction" });
    if (!targetRate || targetRate <= 0) return res.status(400).json({ ok: false, error: "invalid_target_rate" });

    const { data, error } = await sb.from("bullion_price_alerts").insert({
      tenant_id: TENANT_ID,
      lead_id: session.leadId,
      metal,
      direction,
      target_rate: targetRate,
      status: "active",
    }).select("id").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, id: data.id });
  }

  if (action === "cancel") {
    const id = body.id;
    if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
    const { error } = await sb.from("bullion_price_alerts")
      .update({ status: "cancelled" })
      .eq("id", id).eq("lead_id", session.leadId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
