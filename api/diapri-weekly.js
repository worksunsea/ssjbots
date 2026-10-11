// GET /api/diapri-weekly — scheduled weekly Diapri price-list loader.
//
// Vercel cron: Friday 10:00 IST, then hourly until a new list is loaded
// (see vercel.json). Once a list is loaded for the week every later run exits
// immediately. A run that finds nothing new costs one cheap file-list call.
//
// Auth: Authorization: Bearer <CRON_SECRET> (Vercel cron) or DIGEST_CRON_SECRET.

import { SUPABASE_URL, SUPABASE_SERVICE_KEY, TENANT_ID, CRON_SECRET, DIGEST_CRON_SECRET, OWNER_PHONE, DIGEST_EXTRA_RECIPIENTS, WA_SESSION_CLIENT_ID } from "./_lib/config.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { fetchExistingRapData } from "./_lib/rapSeed.js";
import { pushToDiapriApp } from "./_lib/diapriFeed.js";
import { resolveFiles, runDriveSync } from "./rapaport-sync.js";
import { istParts, weekKey, stateForWeek, shouldStop, listingUnchanged, shouldAlertMissing, listIsCurrent } from "./_lib/diapriWeekly.js";

// A full load takes ~70 s (Apps Script download + PDF parse).
export const config = { maxDuration: 300 };

const STATE_FIELD = "diapri_weekly_state";
const sbHeaders = () => ({
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
});

async function loadState() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.${STATE_FIELD}&tenant_id=eq.${TENANT_ID}&select=value&limit=1`, { headers: sbHeaders() });
    const rows = r.ok ? await r.json() : [];
    return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
  } catch {
    return null;
  }
}

async function saveState(state) {
  const h = sbHeaders();
  await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.${STATE_FIELD}&tenant_id=eq.${TENANT_ID}`, { method: "DELETE", headers: h });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns`, {
    method: "POST",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ field: STATE_FIELD, value: JSON.stringify(state), tenant_id: TENANT_ID }),
  });
  if (!r.ok) throw new Error(`state save failed: ${r.status}`);
}

async function notifyOwner(msg) {
  const phones = [OWNER_PHONE, ...DIGEST_EXTRA_RECIPIENTS.split(",")].map((p) => p.trim()).filter(Boolean);
  const results = await Promise.all(phones.map((phone) => sendWhatsApp({ phone, msg, client: WA_SESSION_CLIENT_ID })));
  return results.some((r) => r.status === 1);
}

function isAuthorized(req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(bearer) && (bearer === CRON_SECRET || bearer === DIGEST_CRON_SECRET);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: "SUPABASE_SERVICE_KEY not configured" });

  const now = new Date();
  const week = weekKey(now);
  const { hour } = istParts(now);
  const state = stateForWeek(await loadState(), week);

  // Already in (e.g. uploaded by hand before this job ran): nothing to fetch and nothing to warn about.
  if (!state.loaded) {
    const stored = await fetchExistingRapData();
    if (listIsCurrent(stored?.date, week)) {
      Object.assign(state, { loaded: true, loaded_date: stored.date, alertedLoaded: true });
      await saveState(state).catch(() => {});
    }
  }

  if (shouldStop(state)) {
    // A "loaded" WhatsApp that failed earlier is retried on the next run.
    if (!state.alertedLoaded) {
      state.alertedLoaded = await notifyOwner(`✅ Diapri price list dated ${state.loaded_date} has been loaded.`);
      await saveState(state).catch(() => {});
    }
    return res.status(200).json({ ok: true, action: "stop", reason: "list already loaded this week", week, loaded_date: state.loaded_date });
  }

  let action = "nothing_new";
  let detail = {};
  try {
    const resolved = await resolveFiles();
    const newest = [...resolved.files].sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0];
    const listed = newest ? { id: newest.id, modified: newest.modifiedTime } : null;

    if (!listed) {
      detail = { note: "folder is empty" };
    } else if (listingUnchanged(listed, state.last_seen)) {
      detail = { note: "same newest file as last check" };
    } else {
      const out = await runDriveSync({ onlyIfNewer: true, resolved });
      if (out.status === 200 && out.body.ok && !out.body.skipped) {
        action = "loaded";
        state.loaded = true;
        state.loaded_date = out.body.date;
        state.last_seen = listed;
        detail = { date: out.body.date, file: out.body.rounds_file };
        // Republishing to the standalone app is opt-in (DIAPRI_FEED_ENABLED) and never blocks the CRM load.
        const feed = await pushToDiapriApp(await fetchExistingRapData());
        if (feed.pushed || feed.reason !== "feed disabled") detail.feed = feed;
      } else if (out.status === 200 && out.body.skipped) {
        state.last_seen = listed; // a file was added/re-saved but its printed date is not newer
        detail = { note: "newest file is not a newer list", date: out.body.date, stored_date: out.body.stored_date };
      } else {
        action = "error";
        detail = { status: out.status, error: out.body.error }; // last_seen unchanged ⇒ retried next hour
      }
    }
  } catch (e) {
    action = "error";
    detail = { status: e.status || 500, error: e.body?.error || String(e) };
  }

  const notes = [];
  if (state.loaded && !state.alertedLoaded) {
    state.alertedLoaded = await notifyOwner(`✅ Diapri price list dated ${state.loaded_date} has been loaded.`);
    notes.push(state.alertedLoaded ? "owner notified" : "owner WhatsApp failed");
  } else if (shouldAlertMissing(state, hour)) {
    state.alertedMissing = await notifyOwner("⚠️ This week's Diapri price list has not been uploaded to Drive yet. The calculator is still showing last week's prices. Checking again every hour.");
    notes.push(state.alertedMissing ? "missing-list alert sent" : "missing-list WhatsApp failed");
  }

  try {
    await saveState(state);
  } catch (e) {
    notes.push(String(e));
  }

  return res.status(200).json({ ok: action !== "error", action, week, hourIST: hour, ...detail, ...(notes.length ? { notes } : {}) });
}
