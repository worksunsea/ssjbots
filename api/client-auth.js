// POST /api/client-auth — public, no auth (CORS open like bridal-lead.js).
// WhatsApp-OTP login for ssj-website customers (Phase 1 of the client
// platform). Wraps api/_lib/clientAuth.js.
//
// Body (action=request-otp): { phone, name? }
// Body (action=verify-otp):  { phone, code }
// Header (action=me):        Authorization: Bearer <client session token>

import { requestOtp, verifyOtp, requireClientSession } from "./_lib/clientAuth.js";
import { supa } from "./_lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query.action || (req.body && req.body.action);

  if (action === "me") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const session = requireClientSession(req, res);
    if (!session) return;
    const { data: lead, error } = await supa()
      .from("bullion_leads")
      .select("id, name, phone, city, address_house, address_locality, address_state, address_pincode, extra_fields")
      .eq("id", session.leadId)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, lead });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (action === "request-otp") {
    const result = await requestOtp({ phone: body.phone, purpose: "client_login", name: body.name });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  }

  if (action === "verify-otp") {
    const result = await verifyOtp({ phone: body.phone, code: body.code, purpose: "client_login" });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
