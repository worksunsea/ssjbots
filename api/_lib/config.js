// Shared constants + env readers for Vercel Functions.
// All server-side code reads creds from process.env so nothing leaks to browser.

export const SUPABASE_URL = process.env.SUPABASE_URL || "https://uppyxzellmuissdlxsmy.supabase.co";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Switched from Anthropic to OpenAI (2026-07-09) — see api/_lib/ai.js.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxGazdRhKxkjOLkqxN4kPoInDuBnlWy5Azmzq-FX9mt5OIfZLbhqfFEO0AufrOWE6n49Q/exec";
export const TENANT_ID = process.env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
export const OPENAI_MODEL_ESCALATION = process.env.OPENAI_MODEL_ESCALATION || "gpt-4o-mini";

// WbizTool — used for all outbound messages except bot replies (which use Baileys).
export const WBIZTOOL_API_KEY = process.env.WBIZTOOL_API_KEY || "";
// Default WbizTool client = 7560 (8860866000 production number).
export const WBIZTOOL_DEFAULT_CLIENT = process.env.WBIZTOOL_DEFAULT_CLIENT || "7560";
// Safety cap — bot is paused only if this many exchanges happen with no manual pause.
// Set high since we no longer have escalation; staff monitor and pause manually.
export const HARD_EXCHANGE_CAP = Number(process.env.HARD_EXCHANGE_CAP || 100);
export const OWNER_ALERT_PHONE = process.env.OWNER_ALERT_PHONE || "8860866000";

// Saurav's personal number — the ONLY sender trusted to issue WhatsApp task
// commands (webhook.js does a strict equality check against this single
// number). Must stay a single number, never comma-joined — use
// DIGEST_EXTRA_RECIPIENTS below to add more people to the digest ping only.
export const OWNER_PHONE = process.env.OWNER_PHONE || "";
// Additional people who should also receive the morning/evening digest ping
// (comma-separated), without being trusted for owner WA commands.
export const DIGEST_EXTRA_RECIPIENTS = process.env.DIGEST_EXTRA_RECIPIENTS || "";
export const DIGEST_CRON_SECRET = process.env.DIGEST_CRON_SECRET || process.env.CRON_SECRET || "";
export const REPORTING_URL = process.env.REPORTING_URL || "https://hr.gemtre.in/reporting";

// wa-service's bare /send route falls back to a "default"/"main" session that
// doesn't exist — the live session is named "Reception" (confirmed via
// GET /clients). Proactive sends (no inbound message to inherit a client
// from) must pass this explicitly or wa-service 502s.
export const WA_SESSION_CLIENT_ID = process.env.WA_SESSION_CLIENT_ID || "Reception";

// Only these WA numbers run the bot (reply to inbound messages).
// Other numbers (birthday/anniversary) are send-only.
export const BOT_NUMBERS = (process.env.BOT_NUMBERS || "8860866000,9312839912")
  .split(",").map((n) => n.trim()).filter(Boolean);

// Secret shared between CRM frontend and these API functions.
// Set VITE_CRM_SECRET (frontend) + CRM_SECRET (Vercel env) to the same value.
export const CRM_SECRET = process.env.CRM_SECRET || "";

// WA JID localparts include a device index ("918860866000:19") — strip it before normalizing
// so wa_number stored in funnels never contains the suffix (which breaks BOT_NUMBERS matching).
export const normalizePhone = (p) =>
  String(p || "").replace(/:\d+$/, "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");

// Returns a 401 response object if the x-crm-secret header is missing/wrong.
// Returns null if the request is allowed.
export function checkCrmSecret(req, res) {
  if (!CRM_SECRET) return null; // secret not configured = open (dev mode)
  const header = req.headers["x-crm-secret"] || "";
  if (header !== CRM_SECRET) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return res;
  }
  return null;
}

export function requireEnv() {
  const missing = [];
  if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.WA_SERVICE_URL) missing.push("WA_SERVICE_URL");
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
}
