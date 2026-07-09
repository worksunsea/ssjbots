// Signed staff session tokens — HMAC-SHA256, no external JWT dependency.
//
// Why this exists: login previously happened entirely in the browser
// (`sb.from("staff").select("*").eq("password", p)` — a direct anon-key
// Supabase query, comparing plaintext passwords client-side). Nothing
// server-side ever verified "this request really came from staff member X" —
// every API route that read a staffId just trusted whatever the client sent.
// `api/login.js` now does the password check server-side (service role) and
// issues one of these tokens; sensitive routes (demand-queue.js, log-call.js)
// verify it and derive the real staff identity from the token, not from
// query params/body the browser could freely edit.
//
// This does NOT fix RLS (Supabase policies still only check tenant_id, not
// staff/role) — closing that fully needs a Supabase Auth migration, a bigger
// separate project. This closes the two concretely-identified API holes.

import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "";
const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days — matches the existing forced-reauth window

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function signSession({ staffId, tenantId, role }) {
  if (!SECRET) throw new Error("SESSION_SECRET not configured");
  const payload = { staffId, tenantId, role, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

// Returns the verified payload, or null if missing/malformed/expired/tampered.
export function verifySession(token) {
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
  return payload;
}

// Reads "Authorization: Bearer <token>" (or x-staff-token as a fallback),
// verifies it, and returns { staffId, tenantId, role } — or sends a 401 and
// returns null. Use like checkCrmSecret: `const s = requireStaffSession(req,res); if (!s) return;`
export function requireStaffSession(req, res) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.headers["x-staff-token"] || "");
  const payload = verifySession(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "invalid_or_missing_session" });
    return null;
  }
  return payload;
}
