// GET /api/catalogue-backup — nightly mirror of catalogue images + a JSON
// snapshot of the catalogue tables onto the NAS media-service, as a backup
// alongside the live Supabase Storage copy. Triggered by cron-job.org (same
// pattern as digest-ping.js) or Vercel Cron.
//
// Looks back a generous 26h window rather than tracking a "last run"
// cursor — idempotent, since media-service overwrites same-named files.

import { supa } from "./_lib/supabase.js";
import { CRON_SECRET, TENANT_ID } from "./_lib/config.js";

export const config = { maxDuration: 60 };

const MEDIA_SERVICE_URL = (process.env.MEDIA_SERVICE_URL || "").replace(/\/+$/, "");
const MEDIA_SERVICE_SECRET = process.env.MEDIA_SERVICE_SECRET || "";
const LOOKBACK_MS = 26 * 60 * 60 * 1000;

function checkAuth(req) {
  if (!CRON_SECRET) return true; // dev mode
  const header = req.headers["x-cron-secret"] || "";
  const query = req.query?.secret || "";
  return header === CRON_SECRET || query === CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

async function mediaServiceCall(path, body) {
  const r = await fetch(`${MEDIA_SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(MEDIA_SERVICE_SECRET ? { "x-service-secret": MEDIA_SERVICE_SECRET } : {}) },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: `http_${r.status}` }));
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!MEDIA_SERVICE_URL) return res.status(200).json({ ok: false, error: "MEDIA_SERVICE_URL not configured" });

  const sb = supa();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10); // IST
  const results = { imagesMirrored: 0, imageErrors: [], snapshotUrl: null };

  try {
    // ── Mirror recently-added images ──────────────────────────────────
    const { data: images } = await sb.from("catalogue_product_images")
      .select("id, url, storage_backend, product_id, catalogue_products(sku)")
      .eq("storage_backend", "supabase")
      .gte("created_at", since);

    for (const img of images || []) {
      const sku = img.catalogue_products?.sku || img.product_id;
      const ext = (img.url.split(".").pop() || "jpg").split("?")[0];
      const filename = `${today}_${sku}_${img.id.slice(0, 8)}.${ext}`;
      const out = await mediaServiceCall("/upload-url", { url: img.url, folder: "catalogue-backup", filename });
      if (out.ok) results.imagesMirrored++;
      else results.imageErrors.push({ imageId: img.id, error: out.error });
    }

    // ── JSON snapshot of the catalogue tables ─────────────────────────
    const tenantTables = ["catalogue_item_types", "catalogue_materials", "catalogue_styles", "catalogue_products", "catalogue_product_images", "catalogue_shares"];
    const joinTables = ["catalogue_product_collections", "catalogue_share_products"]; // no tenant_id column
    const snapshot = { tenant_id: TENANT_ID, generated_at: new Date().toISOString() };
    for (const t of tenantTables) {
      const { data } = await sb.from(t).select("*").eq("tenant_id", TENANT_ID).limit(5000);
      snapshot[t] = data || [];
    }
    for (const t of joinTables) {
      const { data } = await sb.from(t).select("*").limit(5000);
      snapshot[t] = data || [];
    }
    const snapOut = await mediaServiceCall("/upload-json", {
      folder: "backups", filename: `catalogue_${today}.json`, content: snapshot,
    });
    if (snapOut.ok) results.snapshotUrl = snapOut.url;

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err), ...results });
  }
}
