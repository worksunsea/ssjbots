// WhatsApp-OTP auth for customer-facing (non-staff) logins on ssj-website.
// Mirrors api/_lib/session.js (HMAC-signed tokens) but issues a separate
// "client" scope so a client token can never be mistaken for a staff one.
//
// Flow: requestOtp(phone, purpose) generates+hashes a 6-digit code, stores it
// in bullion_otp_codes, sends it via the same WA send layer staff-otp-send.js
// uses. verifyOtp(phone, code, purpose) checks the hash+expiry, consumes the
// row, and returns a signed session token scoped to that phone.

import crypto from "crypto";
import { supa } from "./supabase.js";
import { sendWhatsApp } from "./wa.js";
import { normalizePhone, WA_SESSION_CLIENT_ID, TENANT_ID } from "./config.js";

const SECRET = process.env.SESSION_SECRET || "";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLIENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

// purpose: "client_login" | "associate_login"
export async function requestOtp({ phone, purpose, name }) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return { ok: false, error: "invalid_phone" };

  const code = generateOtpCode();
  const { error } = await supa().from("bullion_otp_codes").insert({
    phone: cleanPhone,
    code_hash: hashCode(code),
    purpose,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  const msg = `🔐 ${name ? `Hi ${name}, your` : "Your"} Sun Sea Jewellers verification code: ${code}\nValid for 10 minutes. Do not share this code.`;
  const wa = await sendWhatsApp({ phone: cleanPhone, msg, client: WA_SESSION_CLIENT_ID });
  if (wa.status !== 1) return { ok: false, error: wa.message };
  return { ok: true };
}

export async function verifyOtp({ phone, code, purpose }) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || !code) return { ok: false, error: "missing_phone_or_code" };

  const { data: row, error } = await supa()
    .from("bullion_otp_codes")
    .select("id, code_hash, expires_at, consumed_at")
    .eq("phone", cleanPhone)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "no_pending_otp" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "otp_expired" };
  if (hashCode(code) !== row.code_hash) return { ok: false, error: "otp_mismatch" };

  await supa().from("bullion_otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

  // Find-or-create the bullion_leads row for this phone (same upsert-by-phone
  // pattern as bridal-lead.js / corporate-gifting.js).
  const { data: existingLead } = await supa()
    .from("bullion_leads")
    .select("id, name")
    .eq("tenant_id", TENANT_ID)
    .eq("phone", cleanPhone)
    .maybeSingle();

  let leadId = existingLead?.id;
  if (!leadId) {
    const { data: newLead, error: insertErr } = await supa()
      .from("bullion_leads")
      .insert({ tenant_id: TENANT_ID, phone: cleanPhone, source: "ssj_website_login", status: "new", stage: "greeting" })
      .select("id")
      .single();
    if (insertErr) return { ok: false, error: insertErr.message };
    leadId = newLead.id;
  }

  const token = signClientSession({ leadId, phone: cleanPhone, purpose });
  return { ok: true, token, leadId };
}

export function signClientSession({ leadId, phone, purpose }) {
  if (!SECRET) throw new Error("SESSION_SECRET not configured");
  const payload = { scope: "client", leadId, phone, purpose, iat: Date.now(), exp: Date.now() + CLIENT_TOKEN_TTL_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

// Returns the verified payload, or null if missing/malformed/expired/tampered/wrong-scope.
export function verifyClientSession(token) {
  if (!SECRET || !token || typeof token !== "string") return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  if (payload.scope !== "client") return null;
  return payload;
}

// Reads "Authorization: Bearer <token>", verifies it, and returns the client
// session payload — or sends a 401 and returns null.
export function requireClientSession(req, res) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyClientSession(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "invalid_or_missing_session" });
    return null;
  }
  return payload;
}
