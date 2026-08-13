// POST /api/client-auth — public, no auth (CORS open like bridal-lead.js).
// WhatsApp-OTP login for ssj-website customers (Phase 1 of the client
// platform). Wraps api/_lib/clientAuth.js.
//
// Body (action=request-otp): { phone, name? }
// Body (action=verify-otp):  { phone, code }
// Header (action=me):        Authorization: Bearer <client session token>

import { requestOtp, verifyOtp, requireClientSession, signClientSession } from "./_lib/clientAuth.js";
import { supa } from "./_lib/supabase.js";
import { verifyFirebaseIdToken } from "./_lib/firebaseAdmin.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";

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

  // purpose defaults to client_login; associate portal login passes
  // purpose="associate_login" explicitly (same OTP mechanism, separate
  // otp_codes row so a client code can't be replayed as an associate one).
  const purpose = body.purpose === "associate_login" ? "associate_login" : "client_login";

  if (action === "request-otp") {
    const result = await requestOtp({ phone: body.phone, purpose, name: body.name });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  }

  if (action === "verify-otp") {
    const result = await verifyOtp({ phone: body.phone, code: body.code, purpose });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  }

  // Google / phone-via-Firebase sign-in — added alongside WA-OTP, not
  // replacing it. Client sends the Firebase ID token from either provider;
  // we verify it server-side (never trust client-supplied identity) and
  // find-or-create the SAME bullion_leads-by-phone row the WA-OTP flow
  // uses, so every phone-keyed feature (kitty, price-alerts, WA reminders)
  // keeps working unchanged regardless of which login method was used.
  //
  // Phone sign-in gives us a verified phone_number directly. Google
  // sign-in only gives email — this platform is phone-centric throughout
  // (WhatsApp is the messaging backbone), so a first-time Google sign-in
  // must also pass body.phone (collected once in the UI) to anchor the
  // lead; returning users are matched by a stored firebase_uid instead
  // once one exists... but since bullion_leads has no such column and
  // changing that core, heavily-relied-on table's shape is out of scope
  // here, the UI simply asks for phone every time on the Google path —
  // simplest, zero schema risk, consistent with the rest of the CRM.
  if (action === "firebase-login") {
    const identity = await verifyFirebaseIdToken(body.idToken);
    if (!identity) return res.status(401).json({ ok: false, error: "invalid_firebase_token" });

    const phone = normalizePhone(identity.phoneNumber || body.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

    const sb = supa();
    const { data: existingLead } = await sb.from("bullion_leads")
      .select("id").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

    let leadId = existingLead?.id;
    if (!leadId) {
      const { data: inserted, error } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name: identity.name || body.name || null,
        email: identity.email || null, source: "ssj_website_login_firebase",
        status: "new", stage: "greeting",
      }).select("id").single();
      if (error) return res.status(500).json({ ok: false, error: error.message });
      leadId = inserted.id;
    }

    const token = signClientSession({ leadId, phone, purpose });
    return res.status(200).json({ ok: true, token, leadId });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
