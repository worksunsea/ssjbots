// Natural (mined) solitaires from the Narola stock sheet. Pure logic, no I/O (see cvdSyncRun.js).
// Price = the backend Calculator's solitaire formula: Rapaport $/ct x (1 - sellDisc/100) x USD/INR x carat,
// where sellDisc = the discount we get from the supplier minus the website markup (default 9 points).
import * as XLSX from "xlsx";

export const NAT_PREFIX = "NAR";
export const DEFAULT_MARKUP_DISC = 9;
export const MARKUP_SETTING = "cvd_natural_markup_disc";
const PRICE_ROUND_TO = 100;

const norm = (v) => String(v ?? "").trim();
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
const titleCase = (v) => norm(v).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, s, c) => s + c.toUpperCase());

// Rapaport lookup: same tables/logic as the Calculator (rapaport_data, [clarity][colour], hundreds of $ per ct).
export const RAP_CLARITIES = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"];
export const RAP_COLORS = ["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
const RAP_WEIGHT_RANGES = ["0.30", "0.40", "0.50", "0.70", "0.90", "1.00", "1.50", "2.00", "3.00", "4.00", "5.00"];
const RAP_RANGE_MINS = [0.30, 0.40, 0.50, 0.70, 0.90, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00];

export function rapLookup(rapData, weight, color, clarity, isRound) {
  const tables = isRound ? rapData?.rounds : rapData?.fancy;
  if (!tables) return null;
  const w = Math.min(weight, 5.0);
  let bracket = RAP_WEIGHT_RANGES[0];
  for (let i = 0; i < RAP_RANGE_MINS.length; i++) if (w >= RAP_RANGE_MINS[i]) bracket = RAP_WEIGHT_RANGES[i];
  const table = tables[bracket];
  if (!table) return null;
  const ci = RAP_CLARITIES.indexOf(clarity === "FL" ? "IF" : clarity);
  const ki = RAP_COLORS.indexOf(color);
  if (ci < 0 || ki < 0 || !table[ci]) return null;
  return table[ci][ki] ?? null;
}

// "narola80pointer", "NAROLA 80 POINTER 27-11-26.xlsx" -> true. Newest wins (date in name, else Drive modified).
export const classifyNarolaFile = (name) => /NAROLA/i.test(norm(name));
const nameDate = (n) => {
  const m = norm(n).match(/(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})/);
  return m ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
};
export function pickLatestNarolaFile(files) {
  let best = null;
  for (const f of files || []) {
    if (!classifyNarolaFile(f.name)) continue;
    const key = [nameDate(f.name), Date.parse(f.modifiedTime) || 0];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { f, key };
  }
  return best?.f || null;
}

// Sheet -> { rows } where each row is { <HEADER>: value, _links: { <HEADER>: url } }.
// The supplier puts the photo / 360 video / certificate links on the COLOR / CLARITY / LAB cells.
export function narolaWorkbookToTable(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  const hi = aoa.findIndex((r) => { const c = r.map((x) => norm(x).toUpperCase()); return c.includes("STONE ID") && c.includes("CARAT"); });
  if (hi < 0) return { error: "header_row_not_found" };
  const origin = XLSX.utils.decode_range(ws["!ref"] || "A1").s;
  const headers = aoa[hi].map((h) => norm(h).toUpperCase());
  const idIdx = headers.indexOf("STONE ID");
  const rows = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    if (norm(aoa[r][idIdx]) === "") continue;
    const o = { _links: {} };
    headers.forEach((h, c) => {
      if (!h || h in o) return;
      o[h] = aoa[r][c] ?? "";
      const cell = ws[XLSX.utils.encode_cell({ r: r + origin.r, c: c + origin.c })];
      if (cell?.l?.Target) o._links[h] = cell.l.Target;
    });
    rows.push(o);
  }
  return { headers, rows };
}

const GRADE_WORDS = { EX: "Excellent", VG: "Very Good", G: "Good", GD: "Good", F: "Fair", FR: "Fair", P: "Poor", ID: "Ideal" };
const FLUOR_WORDS = { NON: "None", NONE: "None", FNT: "Faint", VSL: "Very Slight", SL: "Slight", MED: "Medium", STG: "Strong", VST: "Very Strong" };
const word = (map, v) => { const t = norm(v); return t ? (map[t.toUpperCase()] || titleCase(t)) : ""; };
const STATUS = { AVAILABLE: "listed", "ON MEMO": "reserved", HOLD: "reserved" };
const igiUrl = (r) => `https://www.igi.org/Verify-Your-Report/?r=${r}`;
const isHttp = (u) => /^https?:\/\//i.test(u || "");

// Selling price for one natural stone, using the Calculator's solitaire maths.
// rapSheet = supplier sheet Rap $/ct, used only if the stored Rapaport table has no cell for this stone.
export function priceNaturalStone({ rapData, rapSheet, discSheet, carat, color, clarity, shape, usdInr, markupDisc }) {
  const rap100 = rapData ? rapLookup(rapData, carat, color, clarity, /^round/i.test(shape || "")) : null;
  const rapUsd = rap100 != null ? rap100 * 100 : rapSheet;
  if (!rapUsd || !usdInr || !Number.isFinite(discSheet)) return null;
  const sellDisc = Number((discSheet - markupDisc).toFixed(2));
  const perCtInr = rapUsd * (1 - sellDisc / 100) * usdInr;
  const priceInr = Math.round((perCtInr * carat) / PRICE_ROUND_TO) * PRICE_ROUND_TO;
  return { price_inr: priceInr, sell_disc_pct: sellDisc, rap_from_table: rap100 != null, rap_used_usd: rapUsd };
}

export function normaliseNaturalStone(row) {
  const reportNo = norm(row["REPORT NO"]);
  const carat = num(row["CARAT"]);
  const status = STATUS[norm(row["STONESTATUS"]).toUpperCase()];
  const rate = num(row["RATE $/CT"]);
  if (!reportNo || !carat || !status || !rate) return null;
  const L = row._links || {};
  const lab = norm(row["LAB"]);
  return {
    sku: `${NAT_PREFIX}-${reportNo}`, report_no: reportNo, stock_no: norm(row["STONE ID"]), status, carat, lab,
    stone_type: "natural", source_file_kind: "white",
    shape: titleCase(row["SHAPE"]), color: norm(row["COLOR"]).toUpperCase(), clarity: norm(row["CLARITY"]).toUpperCase(),
    cut: word(GRADE_WORDS, row["CUT"]), polish: word(GRADE_WORDS, row["POL"]), symmetry: word(GRADE_WORDS, row["SYM"]),
    fluorescence: word(FLUOR_WORDS, row["FLO"]), measurements: norm(row["MEASUREMENT"]),
    depth_pct: num(row["DEPTH%"]), table_pct: num(row["TABLE%"]),
    cert_url: isHttp(L["LAB"]) ? L["LAB"] : lab.toUpperCase() === "IGI" ? igiUrl(reportNo) : "",
    image_url: isHttp(L["COLOR"]) ? L["COLOR"] : "", video_url: isHttp(L["CLARITY"]) ? L["CLARITY"] : "",
    purchase_usd: Math.round(rate * carat * 100) / 100, rap_usd: num(row["RAP $/CT"]), supplier_disc_pct: num(row["DISC %"]),
    fancy_color: "", fancy_intensity: "", fancy_overtone: "",
  };
}

// Returns { stones, skipped, rapFallbacks }. Stones carry price_inr, purchase_inr, usd_inr_used, sell_disc_pct.
export function buildNaturalStones(table, { usdInr, rapData, markupDisc }) {
  const stones = [];
  const seen = new Set();
  let skipped = 0, rapFallbacks = 0;
  for (const row of table.rows) {
    const s = normaliseNaturalStone(row);
    const p = s && priceNaturalStone({ rapData, rapSheet: s.rap_usd, discSheet: s.supplier_disc_pct, carat: s.carat, color: s.color, clarity: s.clarity, shape: s.shape, usdInr, markupDisc });
    if (!s || !p || seen.has(s.report_no)) { skipped++; continue; }
    seen.add(s.report_no);
    if (!p.rap_from_table) rapFallbacks++;
    stones.push({ ...s, price_inr: p.price_inr, sell_disc_pct: p.sell_disc_pct, usd_inr_used: usdInr, purchase_inr: Math.round(s.purchase_usd * usdInr) });
  }
  return { stones, skipped, rapFallbacks };
}
