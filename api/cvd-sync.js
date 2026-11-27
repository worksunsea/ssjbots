// GET|POST /api/cvd-sync — daily CVD stock sync (Vercel cron, 15:00 IST).
//
// Reads the newest certified-white and certified-fancy stock files from the
// Drive folder "Cvdapp", prices every stone (purchase USD x (Rates-tab USD/INR
// + ₹0.50) x 2), and adds / updates / delists stones in cvd_stones so the
// website always mirrors the latest sheet. See api/_lib/cvdSyncRun.js for the
// guard rules (count vs totals row, shrunk-file, per-kind isolation).
//
// Auth: Authorization: Bearer <CRON_SECRET|DIGEST_CRON_SECRET> (Vercel cron)
//       or x-crm-secret (staff "Run now").
// Query: ?dry=1  parse + plan only, write nothing.

import { supa } from "./_lib/supabase.js";
import { TENANT_ID, CRON_SECRET, DIGEST_CRON_SECRET, CRM_SECRET, OWNER_PHONE } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { listStockFiles, downloadStockFile, driveProvider } from "./_lib/cvdDrive.js";
import { runCvdSync, summaryLine } from "./_lib/cvdSyncRun.js";
import { NAT_PREFIX, DEFAULT_MARKUP_DISC, MARKUP_SETTING, priceNaturalStone } from "./_lib/cvdNatural.js";

export const config = { maxDuration: 300 };

const PAGE = 1000;     // PostgREST default max rows per request
const CHUNK = 200;     // rows per upsert

function authorized(req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (bearer && (bearer === CRON_SECRET || bearer === DIGEST_CRON_SECRET)) return true;
  return Boolean(CRM_SECRET) && req.headers["x-crm-secret"] === CRM_SECRET;
}

function makeStore(sb) {
  return {
    // kind null = any kind. prefix scopes to one supplier's SKUs (CVD- main, VIB- Vibgyor).
    async loadExisting(kind, prefix = "CVD") {
      const out = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from("cvd_stones").select("sku,status,price_inr").eq("tenant_id", TENANT_ID).like("sku", `${prefix}-%`);
        if (kind) q = q.eq("source_file_kind", kind);
        const { data, error } = await q.order("sku").range(from, from + PAGE - 1);
        if (error) throw new Error(`load existing: ${error.message}`);
        out.push(...data.map((r) => ({ ...r, price_inr: Number(r.price_inr) })));
        if (data.length < PAGE) return out;
      }
    },
    async loadReportNos(prefix = "CVD") {
      const out = new Set();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from("cvd_stones").select("report_no")
          .eq("tenant_id", TENANT_ID).like("sku", `${prefix}-%`).order("sku").range(from, from + PAGE - 1);
        if (error) throw new Error(`load report numbers: ${error.message}`);
        data.forEach((r) => out.add(r.report_no));
        if (data.length < PAGE) return out;
      }
    },
    async upsert(stones) {
      const now = new Date().toISOString();
      for (let i = 0; i < stones.length; i += CHUNK) {
        const rows = stones.slice(i, i + CHUNK).map((s) => ({ ...s, tenant_id: TENANT_ID, last_seen_at: now, updated_at: now, delisted_at: null }));
        const { error } = await sb.from("cvd_stones").upsert(rows, { onConflict: "tenant_id,sku" });
        if (error) throw new Error(`upsert: ${error.message}`);
      }
    },
    async delist(skus) {
      const now = new Date().toISOString();
      for (let i = 0; i < skus.length; i += CHUNK) {
        const { error } = await sb.from("cvd_stones").update({ status: "delisted", delisted_at: now, updated_at: now })
          .eq("tenant_id", TENANT_ID).in("sku", skus.slice(i, i + CHUNK));
        if (error) throw new Error(`delist: ${error.message}`);
      }
    },
  };
}


// ── Natural solitaires: backend Rapaport table + the website markup (points off the supplier discount) ──
async function loadRapData(sb) {
  const { data } = await sb.from("bullion_dropdowns").select("value").eq("tenant_id", TENANT_ID).eq("field", "rapaport_data")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch { return null; }
}

async function loadMarkup(sb) {
  const { data } = await sb.from("bullion_dropdowns").select("value").eq("tenant_id", TENANT_ID).eq("field", MARKUP_SETTING).maybeSingle();
  const n = Number(data?.value);
  return data?.value !== undefined && data?.value !== "" && Number.isFinite(n) ? n : DEFAULT_MARKUP_DISC;
}

async function saveMarkup(sb, value) {
  const { data: ex } = await sb.from("bullion_dropdowns").select("id").eq("tenant_id", TENANT_ID).eq("field", MARKUP_SETTING).maybeSingle();
  const row = { value: String(value), active: true };
  const { error } = ex?.id
    ? await sb.from("bullion_dropdowns").update(row).eq("id", ex.id)
    : await sb.from("bullion_dropdowns").insert({ ...row, tenant_id: TENANT_ID, field: MARKUP_SETTING, sort_order: 0 });
  if (error) throw new Error(error.message);
}

// Re-price every live natural stone from its stored sheet values (no Drive needed): new markup, new Rapaport, live USD/INR.
async function repriceNatural(sb, { usdInr, markupDisc, rapData }) {
  const { data, error } = await sb.from("cvd_stones")
    .select("sku,carat,color,clarity,shape,rap_usd,supplier_disc_pct,purchase_usd,price_inr")
    .eq("tenant_id", TENANT_ID).eq("stone_type", "natural").neq("status", "delisted").limit(5000);
  if (error) throw new Error(error.message);
  let changed = 0;
  const now = new Date().toISOString();
  for (const r of data) {
    const p = priceNaturalStone({ rapData, rapSheet: Number(r.rap_usd), discSheet: Number(r.supplier_disc_pct), carat: Number(r.carat), color: r.color, clarity: r.clarity, shape: r.shape, usdInr, markupDisc });
    if (!p) continue;
    if (p.price_inr !== Number(r.price_inr)) changed++;
    const { error: e } = await sb.from("cvd_stones").update({ price_inr: p.price_inr, sell_disc_pct: p.sell_disc_pct, usd_inr_used: usdInr, purchase_inr: Math.round(Number(r.purchase_usd) * usdInr), updated_at: now })
      .eq("tenant_id", TENANT_ID).eq("sku", r.sku);
    if (e) throw new Error(e.message);
  }
  return { stones: data.length, changed };
}

async function settingsAction(req, res, sb) {
  const usdInr = (await getRates().catch(() => null))?.usdInr ?? null;
  if (req.method === "POST") {
    const v = Number(req.body?.markup_disc);
    if (!Number.isFinite(v) || v < -50 || v > 50) return res.status(400).json({ ok: false, error: "markup_disc must be a number between -50 and 50" });
    await saveMarkup(sb, v);
  }
  const markup = await loadMarkup(sb);
  const out = { ok: true, markup_disc: markup, usd_inr: usdInr, prefix: NAT_PREFIX };
  if (req.method === "POST") {
    if (!usdInr) return res.status(500).json({ ...out, ok: false, error: "USD/INR unavailable, markup saved but prices not updated" });
    out.repriced = await repriceNatural(sb, { usdInr, markupDisc: markup, rapData: await loadRapData(sb) });
  }
  return res.status(200).json(out);
}

async function alertOwner(msg) {
  if (!OWNER_PHONE) return;
  try { await sendWhatsAppWbiz({ phone: OWNER_PHONE, msg, whatsappClient: null }); } catch { /* alert is best-effort */ }
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!driveProvider()) {
    return res.status(501).json({ ok: false, error: "no_drive_access", hint: "Set CVD_APPS_SCRIPT_URL + CVD_APPS_SCRIPT_TOKEN (see apps-script/CvdFolder.gs) or GOOGLE_SERVICE_ACCOUNT_JSON" });
  }
  if (req.query.action === "settings") {
    try { return await settingsAction(req, res, supa()); } catch (e) { return res.status(500).json({ ok: false, error: String(e.message || e) }); }
  }
  const dry = req.query.dry === "1" || req.query.dry === "true";
  const sb = supa();
  const trigger = req.headers.authorization ? "cron" : "manual";

  let usdInr = null;
  try { usdInr = (await getRates())?.usdInr ?? null; } catch { /* handled below */ }

  const { data: run } = dry ? { data: null } : await sb.from("cvd_sync_runs").insert({ tenant_id: TENANT_ID, trigger }).select("id").single();
  let result;
  try {
    result = await runCvdSync({ listFiles: listStockFiles, download: downloadStockFile, usdInr, store: makeStore(sb), dry, rapData: await loadRapData(sb), naturalMarkup: await loadMarkup(sb) });
  } catch (e) {
    result = { status: "error", error: String(e.message || e), files: [], dry };
  }

  if (run) {
    await sb.from("cvd_sync_runs").update({
      finished_at: new Date().toISOString(), status: result.status, usd_inr: result.usd_inr ?? null, files: result.files,
      added: result.added || 0, delisted: result.delisted || 0, price_changed: result.price_changed || 0, error: result.error || null,
    }).eq("id", run.id);
  }
  const line = result.error && !result.files.length ? `CVD stock sync FAILED — ${result.error}` : summaryLine(result);
  if (!dry && (result.status !== "ok" || result.added || result.delisted)) await alertOwner(line);
  return res.status(result.status === "error" ? 500 : 200).json({ ok: result.status !== "error", summary: line, ...result });
}
