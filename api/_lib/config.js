// Shared constants + env readers for Vercel Functions.
// All server-side code reads creds from process.env so nothing leaks to browser.

export const SUPABASE_URL = process.env.SUPABASE_URL || "https://uppyxzellmuissdlxsmy.supabase.co";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Switched from Anthropic to OpenAI (2026-07-09) — see api/_lib/ai.js.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// fal.ai — used by the Solitaire Jewellery AI Design Generator for image
// generation (flux-pro/v1.1 text-to-image, flux-pro/kontext for
// reference-based edits) instead of OpenAI gpt-image-1.
export const FAL_KEY = process.env.FAL_KEY || "";
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

// Saurav's personal number — kept as the single primary owner number for
// send-only flows (digest-ping, connection-alert, schedule-reminders) that
// predate the multi-SA rollout below.
export const OWNER_PHONE = process.env.OWNER_PHONE || "";

// Numbers trusted to issue internal owner WA commands (create_task,
// get_report, search_resources, edit_contact/add_contact, dev_task, etc —
// see ownerCommand.js). webhook.js checks membership in this list, not
// strict equality against OWNER_PHONE, so all 3 SA accounts can command the
// bot. Only 8860866000 (see BOT_NUMBERS) actually replies — these numbers
// are senders-to-bot, not bot numbers themselves.
export const OWNER_PHONES = (process.env.OWNER_PHONES || "9811464488,9810442333,9990942333")
  .split(",").map((n) => n.trim()).filter(Boolean);
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

// Session for KRA/task/internal-working messages to staff. Meant to be the
// dedicated 8448271248 number: pair it in wa-service (POST /clients with a
// new client_id, scan QR from that phone) and set TASKS_WA_CLIENT_ID to that
// client id. Until then it falls back to the Reception session.
export const TASKS_WA_CLIENT_ID = process.env.TASKS_WA_CLIENT_ID || WA_SESSION_CLIENT_ID;

// Dedicated number for ALL Kitty Schemes communication — payment reminders,
// unclaimed-benefit nudges, batch-rollover nudges, redemption codes/
// confirmations, and anything else the kitty module sends. New connection,
// number 9205065375 (owner instruction, 2026-08-25): pair it in wa-service
// (POST /clients with a new client_id, scan QR from that phone) and set
// KITTY_WA_CLIENT_ID to that client id. Until then it falls back to the
// Reception session — same pattern as TASKS_WA_CLIENT_ID above.
export const KITTY_WA_CLIENT_ID = process.env.KITTY_WA_CLIENT_ID || WA_SESSION_CLIENT_ID;

// Only these WA numbers run the bot (reply to inbound messages).
// Other numbers (birthday/anniversary) are send-only.
// Hardcoded to 8860866000 only (2026-07-15) — 9312839912 was replying too, unwanted.
export const BOT_NUMBERS = ["8860866000"];

// Secret shared between CRM frontend and these API functions.
// Set VITE_CRM_SECRET (frontend) + CRM_SECRET (Vercel env) to the same value.
export const CRM_SECRET = process.env.CRM_SECRET || "";

// WA JID localparts include a device index ("918860866000:19") — strip it before normalizing
// so wa_number stored in funnels never contains the suffix (which breaks BOT_NUMBERS matching).
export const normalizePhone = (p) =>
  String(p || "").replace(/:\d+$/, "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");

// Supabase/Cloudflare occasionally return an HTML error page (e.g. a 522
// "Connection timed out" during a Supabase-side outage) instead of a JSON
// error — supabase-js then surfaces that raw HTML as error.message. Sending
// a multi-KB HTML page as a WhatsApp reply is unreadable and looks broken.
// Confirmed for real: 2026-07-09, a Supabase edge outage produced exactly
// this in a "Couldn't queue that — <!DOCTYPE html>..." WA message.
export function sanitizeErrorForWA(err) {
  const raw = String(err?.message || err || "");
  if (/<html|<!DOCTYPE/i.test(raw)) return "the database/hosting service is temporarily unreachable — try again in a few minutes.";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

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
