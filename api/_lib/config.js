// Shared constants + env readers for Vercel Functions.
// All server-side code reads creds from process.env so nothing leaks to browser.

export const SUPABASE_URL = process.env.SUPABASE_URL || "https://uppyxzellmuissdlxsmy.supabase.co";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const WBIZTOOL_API_KEY = process.env.WBIZTOOL_API_KEY || "0be8d83d92aceaef87";
export const WBIZTOOL_CLIENT_ID = process.env.WBIZTOOL_CLIENT_ID || "13004";
export const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxGazdRhKxkjOLkqxN4kPoInDuBnlWy5Azmzq-FX9mt5OIfZLbhqfFEO0AufrOWE6n49Q/exec";
export const TENANT_ID = process.env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
export const OWNER_ALERT_PHONE = process.env.OWNER_ALERT_PHONE || "8860866000";
export const OWNER_ALERT_WA_CLIENT = process.env.OWNER_ALERT_WA_CLIENT || "7560";

export const normalizePhone = (p) =>
  String(p || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");

export function requireEnv() {
  const missing = [];
  if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
  if (!ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
}
