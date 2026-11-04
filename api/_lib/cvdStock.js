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
  return pickLatestBy(files, classifyFile);
}

// Vibgyor (second supplier) files: "VIBGYOR DIAMONDS FANCY COLOR 03-11-2026..xlsx",
// "VIBGYOR DIAMOND D TO H COLOR 03-11-2026..xlsx". Their stones get SKU VIB-<cert>.
export const VIB_PREFIX = "VIB";
export const MAIN_PREFIX = "CVD";

export function classifyVibFile(name) {
  const n = norm(name).toUpperCase();
  if (!n.includes("VIBGYOR") || n.includes("NON CERTI") || n.includes("NON-CERTI")) return null;
  return n.includes("FANCY") ? "fancy" : "white";
}

// Newest file per kind for one supplier; classify(name) -> kind|null.
export function pickLatestBy(files, classify) {
  const best = {};
  for (const f of files || []) {
    const kind = classify(f.name);
    if (!kind) continue;
    const key = [fileDateFromName(f.name), Date.parse(f.modifiedTime) || 0];
    const cur = best[kind];
    if (!cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && key[1] > cur.key[1])) best[kind] = { file: f, key };
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.file]));
}

export const pickLatestVibFiles = (files) => pickLatestBy(files, classifyVibFile);

// Supplier column names that differ from the main sheets -> the names used below.
const HEADER_ALIASES = {
  "stock id": "STOCK", stock: "STOCK", availability: "AVAILABILITY",
  carat: "Weight", weight: "Weight", "certificate no": "Report #", "report #": "Report #",
  sym: "Symmetry", flou: "Fluorescence Intensity", video: "Diamond Video", image: "Diamond Image",
  depth: "Depth %", table: "Table %", lab: "LAB", certfile: "CertFile",
};
const canonHeader = (v) => { const t = norm(v); return HEADER_ALIASES[t.toLowerCase()] ?? t; };

// Rows of arrays (sheet_to_json header:1) -> { totalsCount, headers, rows }.
// The header row is the one holding STOCK + AVAILABILITY in any column (the
// supplier has added leading columns such as P-NO before). The row above it,
// when present, is a totals row whose first filled cell is the stone count.
export function extractTable(aoa) {
  const isHeader = (r) => { const c = r.map((x) => canonHeader(x).toUpperCase()); return c.includes("STOCK") && c.includes("AVAILABILITY"); };
  const hi = aoa.findIndex(isHeader);
  if (hi < 0) return { error: "header_row_not_found" };
  const headers = aoa[hi].map(canonHeader);
  const stockIdx = headers.indexOf("STOCK");
  const firstFilled = hi > 0 ? aoa[hi - 1].find((c) => norm(c) !== "") : undefined;
  const totalsCount = firstFilled !== undefined ? num(firstFilled) : null;
  const rows = aoa.slice(hi + 1).filter((r) => norm(r[stockIdx]) !== "").map((r) => {
    const o = {};
    headers.forEach((h, i) => { if (h && (norm(o[h]) === "")) o[h] = r[i] ?? ""; });
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

// ── Vibgyor sheet vocabulary -> the wording the main sheets (and site) use ──
const GRADE_WORDS = { EX: "Excellent", VG: "Very Good", G: "Good", GD: "Good", F: "Fair", FR: "Fair", P: "Poor" };
const FLUOR_WORDS = {
  NONE: "None", NON: "None", FNT: "Faint", F: "Faint", FAINT: "Faint", VSL: "Very Slight", VSLT: "Very Slight", VSLG: "Very Slight",
  SL: "Slight", SLT: "Slight", SLG: "Slight", MED: "Medium", M: "Medium", MEDIUM: "Medium",
  STG: "Strong", ST: "Strong", STRONG: "Strong", VST: "Very Strong", VSTG: "Very Strong",
};
const word = (map, v) => { const t = norm(v); return map[t.toUpperCase()] || titleCase(t); };

const FANCY_INTENSITIES = ["FANCY DEEP", "FANCY DARK", "FANCY INTENSE", "FANCY VIVID", "FANCY LIGHT", "VERY LIGHT", "FAINT", "LIGHT", "FANCY"];

// Vibgyor puts the whole colour in one cell: "N" (white grade) or
// "FANCY INTENSE  PINK" / "FANCY VIVID YELLOWISH GREEN". Returns
// { color } for white grades or { fancy_color, fancy_intensity, fancy_overtone }.
export function parseCombinedColour(raw) {
  const up = norm(raw).toUpperCase().replace(/\s+/g, " ");
  if (!up) return {};
  if (/^[D-Z]([-–][D-Z])?$/.test(up)) return { color: up };
  const lead = FANCY_INTENSITIES.find((i) => up === i || up.startsWith(`${i} `));
  const rest = (lead ? up.slice(lead.length) : up).trim().split(" ").filter(Boolean);
  const isOvertone = (t) => t.endsWith("ISH") || t === "ORANGY" || t === "ORANGEY";
  const overtone = rest.filter(isOvertone);
  const base = rest.filter((t) => !isOvertone(t)).map((t) => (t === "GREY" ? "GRAY" : t));
  const colour = (base.length ? base : overtone).join(" ");
  const intensity = !lead ? "" : lead === "FANCY" ? "Fancy" : lead.replace(/^FANCY /, "");
  return { fancy_color: titleCase(colour), fancy_intensity: titleCase(intensity), fancy_overtone: base.length ? titleCase(overtone.join(" ")) : "" };
}

// Stones we never list, even though the vendor sheet has them (IGI report numbers).
// They are left out of the snapshot, so the sync delists them and keeps them off.
// 836601023: cert says white M, but the vendor's photo/video shows a pink stone.
export const EXCLUDED_REPORTS = new Set(["836601023"]);

const igiUrl = (reportNo) => `https://www.igi.org/Verify-Your-Report/?r=${reportNo}`;

// One sheet row -> stone record, or null when it can't be listed (no report
// number, no price, availability not YES/HOLD/ON MEMO).
// opts.supplier "vib" = Vibgyor sheet: SKU VIB-<cert>, codes expanded to words,
// colour parsed from the single Color cell, kind decided per row.
export function normaliseStone(row, kind, opts = {}) {
  const vib = opts.supplier === "vib";
  const reportNo = norm(row["Report #"]);
  const finalUsd = num(row["Final Price"]);
  const carat = num(row["Weight"]);
  const status = STATUS_BY_AVAILABILITY[norm(row["AVAILABILITY"]).toUpperCase()];
  if (!reportNo || !finalUsd || !carat || !status || EXCLUDED_REPORTS.has(reportNo)) return null;

  const lab = norm(row["LAB"]);
  const common = {
    sku: `${vib ? VIB_PREFIX : MAIN_PREFIX}-${reportNo}`, report_no: reportNo, stock_no: norm(row["STOCK"]), status, carat, lab,
    depth_pct: num(row["Depth %"]), table_pct: num(row["Table %"]), measurements: norm(row["Measurements"]),
    video_url: norm(row["Diamond Video"]), image_url: norm(row["Diamond Image"]), purchase_usd: finalUsd,
  };
  if (!vib) {
    return {
      ...common, source_file_kind: kind, shape: norm(row["Shape"]), color: norm(row["Color"]), clarity: norm(row["Clarity"]),
      cut: norm(row["Cut"]), polish: norm(row["Polish"]), symmetry: norm(row["Symmetry"]), fluorescence: norm(row["Fluorescence Intensity"]),
      fancy_color: titleCase(row["Fancy Color"]), fancy_intensity: titleCase(row["Fancy Color Intensity"]),
      fancy_overtone: titleCase(row["Fancy Color Overtone"]), cert_url: norm(row["CertFile"]),
    };
  }
  const colour = parseCombinedColour(row["Color"]);
  const shape = norm(row["Shape"]).toUpperCase() === "ROUND" ? "Round Brilliant" : titleCase(row["Shape"]);
  return {
    ...common, source_file_kind: colour.fancy_color ? "fancy" : "white", shape,
    color: colour.color || "", clarity: norm(row["Clarity"]).replace(/\s+/g, "").toUpperCase(), cut: word(GRADE_WORDS, row["Cut"]),
    polish: word(GRADE_WORDS, row["Polish"]), symmetry: word(GRADE_WORDS, row["Symmetry"]), fluorescence: word(FLUOR_WORDS, row["Fluorescence Intensity"]),
    fancy_color: colour.fancy_color || "", fancy_intensity: colour.fancy_intensity || "", fancy_overtone: colour.fancy_overtone || "",
    cert_url: norm(row["CertFile"]) || (lab.toUpperCase() === "IGI" ? igiUrl(reportNo) : ""),
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
export function buildStones(table, kind, usdInr, opts = {}) {
  const stones = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of table.rows) {
    const s = normaliseStone(row, kind, opts);
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
