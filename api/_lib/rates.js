// Pull live bullion rates from the Apps Script proxy (Google Sheet "new" tab).
// Cached for 60s per function instance to avoid slamming Apps Script on bursty traffic.

import { APPS_SCRIPT_URL } from "./config.js";

let cache = { ts: 0, data: null };
const TTL_MS = 60_000;

export async function getRates() {
  const now = Date.now();
  if (cache.data && now - cache.ts < TTL_MS) return cache.data;
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=rates`, { redirect: "follow" });
    const data = await res.json();
    if (data?.ok) {
      cache = { ts: now, data: data.rates || [] };
      return cache.data;
    }
  } catch {
    /* swallow — bot will continue without rates */
  }
  return cache.data || [];
}

export function ratesSnippet(rates, limit = 10) {
  if (!rates?.length) return "(no rates available)";
  return rates
    .slice(0, limit)
    .map((r) =>
      Object.entries(r)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")
    )
    .join("\n");
}
