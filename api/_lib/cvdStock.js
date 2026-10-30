// Pure logic for the daily CVD (lab-grown) stock sync: classify Drive files,
// parse the supplier's stock sheet, price stones, and plan add/update/delist
// against what is already stored. No I/O here so it is fully unit-testable;
// api/cvd-sync.js does the Drive + Supabase work around it.
import * as XLSX from "xlsx";

export const MARKUP_MULTIPLIER = 2;       // 100% markup on purchase price
export const USD_INR_MARGIN = 0.5;        // +50 paise on the Rates-tab USD/INR
export const GST_PCT = 1.5;               // loose diamonds
export const PRICE_ROUND_TO = 100;        // selling price rounded to nearest ₹100
export const MIN_KEEP_RATIO = 0.7;        // abort delisting if a file shrinks below this vs stored

const norm = (v) => String(v ?? "").trim();
const titleCase = (v) => norm(v).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

// "CERTI FANCY COLOR STOCK FILE 29-10-26.xlsx" -> "fancy"; non-certified and
// anything unrecognised -> null (not synced).
export function classifyFile(name) {
  const n = norm(name).toUpperCase();
  if (!n.includes("STOCK")) return null;
  if (n.includes("NON CERTI") || n.includes("NON-CERTI")) return null;
  if (n.includes("FANCY")) return "fancy";
  if (n.includes("CERTI")) return "white";
  return null;
}

// Date embedded in the file name (dd-mm-yy or dd-mm-yyyy) as a sortable
// number, 0 when absent so callers fall back to modifiedTime.
export function fileDateFromName(name) {
  const m = norm(name).match(/(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})/);
  if (!m) return 0;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return y * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

// Picks the newest file per kind from a Drive listing [{id,name,modifiedTime}].
export function pickLatestFiles(files) {
  const best = {};
  for (const f of files || []) {
    const kind = classifyFile(f.name);
    if (!kind) continue;
    const key = [fileDateFromName(f.name), Date.parse(f.modifiedTime) || 0];
    const cur = best[kind];
    if (!cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && key[1] > cur.key[1])) best[kind] = { file: f, key };
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.file]));
}

// Rows of arrays (sheet_to_json header:1) -> { totalsCount, headers, rows }.
// The supplier puts a totals row (count, total ct, avg $/ct, total $) above
// the header row that starts with STOCK, AVAILABILITY.
export function extractTable(aoa) {
  const hi = aoa.findIndex((r) => norm(r[0]).toUpperCase() === "STOCK" && norm(r[1]).toUpperCase() === "AVAILABILITY");
  if (hi < 0) return { error: "header_row_not_found" };
  const headers = aoa[hi].map(norm);
  const totalsCount = hi > 0 ? num(aoa[hi - 1][0]) : null;
  const rows = aoa.slice(hi + 1).filter((r) => norm(r[0]) !== "").map((r) => {
    const o = {};
    headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; });
    return o;
  });
  return { headers, totalsCount, rows };
}

export function workbookToTable(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return extractTable(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }));
}

const STATUS_BY_AVAILABILITY = { YES: "listed", HOLD: "reserved", "ON MEMO": "reserved" };

// One sheet row -> stone record, or null when it can't be listed (no report
// number, no price, availability not YES/HOLD/ON MEMO).
export function normaliseStone(row, kind) {
  const reportNo = norm(row["Report #"]);
  const finalUsd = num(row["Final Price"]);
  const carat = num(row["Weight"]);
  const status = STATUS_BY_AVAILABILITY[norm(row["AVAILABILITY"]).toUpperCase()];
  if (!reportNo || !finalUsd || !carat || !status) return null;
  return {
    sku: `CVD-${reportNo}`, report_no: reportNo, stock_no: norm(row["STOCK"]), source_file_kind: kind, status,
    shape: norm(row["Shape"]), carat, color: norm(row["Color"]), clarity: norm(row["Clarity"]),
    cut: norm(row["Cut"]), polish: norm(row["Polish"]), symmetry: norm(row["Symmetry"]),
    fluorescence: norm(row["Fluorescence Intensity"]), measurements: norm(row["Measurements"]),
    lab: norm(row["LAB"]), fancy_color: titleCase(row["Fancy Color"]), fancy_intensity: titleCase(row["Fancy Color Intensity"]),
    fancy_overtone: titleCase(row["Fancy Color Overtone"]), depth_pct: num(row["Depth %"]), table_pct: num(row["Table %"]),
    cert_url: norm(row["CertFile"]), video_url: norm(row["Diamond Video"]), image_url: norm(row["Diamond Image"]),
    purchase_usd: finalUsd,
  };
}

// Purchase USD -> selling INR (ex-GST). Rate = Rates-tab USD/INR + ₹0.50.
export function priceStone(purchaseUsd, usdInr) {
  const rate = Number((usdInr + USD_INR_MARGIN).toFixed(2));
  const purchaseInr = Math.round(purchaseUsd * rate);
  const priceInr = Math.round((purchaseInr * MARKUP_MULTIPLIER) / PRICE_ROUND_TO) * PRICE_ROUND_TO;
  return { usd_inr_used: rate, purchase_inr: purchaseInr, price_inr: priceInr };
}

// Builds stone records from a parsed table and checks the count against the
// sheet's own totals row. Returns { stones, skipped, countMismatch }.
export function buildStones(table, kind, usdInr) {
  const stones = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of table.rows) {
    const s = normaliseStone(row, kind);
    if (!s || seen.has(s.report_no)) { skipped++; continue; }
    seen.add(s.report_no);
    stones.push({ ...s, ...priceStone(s.purchase_usd, usdInr) });
  }
  const countMismatch = table.totalsCount != null && Math.abs(table.rows.length - table.totalsCount) > 0;
  return { stones, skipped, countMismatch };
}

// Compares the latest file's stones with stored rows of the same kind.
// existing: [{sku,status,price_inr}] (all non-delisted + delisted of this kind)
export function planReconcile(existing, incoming) {
  const byInc = new Map(incoming.map((s) => [s.sku, s]));
  const byEx = new Map(existing.map((s) => [s.sku, s]));
  const added = incoming.filter((s) => !byEx.has(s.sku));
  const returned = incoming.filter((s) => byEx.get(s.sku)?.status === "delisted");
  const gone = existing.filter((s) => s.status !== "delisted" && !byInc.has(s.sku));
  const priceChanged = incoming.filter((s) => byEx.has(s.sku) && byEx.get(s.sku).price_inr !== s.price_inr);
  const liveStored = existing.filter((s) => s.status !== "delisted").length;
  const shrunk = liveStored > 0 && incoming.length < liveStored * MIN_KEEP_RATIO;
  return { added, returned, gone, priceChanged, shrunk, liveStored };
}

// Public (customer-facing) shape: never includes purchase price or raw data.
export const PUBLIC_COLUMNS = [
  "sku", "status", "shape", "carat", "color", "clarity", "cut", "polish", "symmetry", "fluorescence",
  "measurements", "lab", "fancy_color", "fancy_intensity", "fancy_overtone", "depth_pct", "table_pct",
  "cert_url", "video_url", "image_url", "price_inr", "source_file_kind",
];

// Selling-price breakup for display. price_per_ct is the ex-GST stone price per carat.
export function withGst(priceInr, carat) {
  const gst = Math.round((priceInr * GST_PCT) / 100);
  const perCt = carat > 0 ? Math.round(priceInr / carat) : null;
  return { price_inr: priceInr, gst_pct: GST_PCT, gst_inr: gst, total_inr: priceInr + gst, price_per_ct: perCt };
}
