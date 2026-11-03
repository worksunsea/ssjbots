import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  classifyFile, classifyVibFile, pickLatestVibFiles, extractTable, normaliseStone, parseCombinedColour,
} from "../../api/_lib/cvdStock.js";
import { runCvdSync } from "../../api/_lib/cvdSyncRun.js";

// ── Sheet parsing ───────────────────────────────────────────────────────────
describe("extractTable - supplier layout changes", () => {
  const HEADER = ["STOCK", "AVAILABILITY", "Shape", "Weight", "Report #"];
  it("finds the header when a leading P-NO column was added (31-10 files) and reads the count from the totals row", () => {
    const aoa = [["", "2.00", "", 3.0], ["P-NO", ...HEADER], ["12-Oct", "RS-1", "YES", "Round", "1.1", "111"], ["12-Oct", "RS-2", "YES", "Round", "1.2", "222"]];
    const t = extractTable(aoa);
    expect(t.totalsCount).toBe(2);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]["Report #"]).toBe("111");
  });
  it("still reads the old layout (count in first cell, STOCK first)", () => {
    const t = extractTable([[1, "", "", 3.0], HEADER, ["RS-1", "YES", "Round", "1.1", "111"], []]);
    expect(t.totalsCount).toBe(1);
    expect(t.rows).toHaveLength(1);
  });
  it("maps Vibgyor column names onto the standard ones", () => {
    const t = extractTable([["STOCK ID", "Availability", "Carat", "Certificate No", "SYM", "Flou"], ["A", "YES", 1.2, "555", "EX", "NONE"]]);
    expect(t.totalsCount).toBeNull();
    expect(t.rows[0]).toMatchObject({ STOCK: "A", AVAILABILITY: "YES", Weight: 1.2, "Report #": "555", Symmetry: "EX" });
  });
});

describe("Vibgyor files", () => {
  it("classifies by name; non-Vibgyor files are ignored by both classifiers", () => {
    expect(classifyVibFile("VIBGYOR DIAMONDS FANCY COLOR 03-11-2026..xlsx")).toBe("fancy");
    expect(classifyVibFile("VIBGYOR DIAMOND D TO H COLOR 03-11-2026..xlsx")).toBe("white");
    expect(classifyVibFile("CERTI STOCK FILE 31-10-26.xlsx")).toBeNull();
    expect(classifyFile("VIBGYOR DIAMOND D TO H COLOR 03-11-2026..xlsx")).toBeNull();
  });
  it("picks the newest Vibgyor file per kind by the date in the name", () => {
    const f = [
      { id: "a", name: "VIBGYOR DIAMOND D TO H COLOR 01-11-2026..xlsx", modifiedTime: "2026-11-01T00:00:00Z" },
      { id: "b", name: "VIBGYOR DIAMOND D TO H COLOR 03-11-2026..xlsx", modifiedTime: "2026-11-03T00:00:00Z" },
    ];
    expect(pickLatestVibFiles(f).white.id).toBe("b");
  });
  it("splits the single colour cell into grade / intensity / overtone / colour", () => {
    expect(parseCombinedColour("N")).toEqual({ color: "N" });
    expect(parseCombinedColour("FANCY INTENSE  PINK")).toEqual({ fancy_color: "Pink", fancy_intensity: "Intense", fancy_overtone: "" });
    expect(parseCombinedColour("FANCY VIVID YELLOWISH GREEN")).toEqual({ fancy_color: "Green", fancy_intensity: "Vivid", fancy_overtone: "Yellowish" });
    expect(parseCombinedColour("FANCY GREY")).toMatchObject({ fancy_color: "Gray", fancy_intensity: "Fancy" });
  });
  it("normaliseStone builds VIB-<cert> with expanded codes and an IGI link", () => {
    const s = normaliseStone({ STOCK: "X", AVAILABILITY: "YES", Shape: "ROUND", Weight: 1, "Report #": "77", "Final Price": 10, Color: "D", Clarity: "VS 1", Polish: "EX", Symmetry: "VG", "Fluorescence Intensity": "STG", LAB: "IGI" }, "white", { supplier: "vib" });
    expect(s).toMatchObject({ sku: "VIB-77", shape: "Round Brilliant", clarity: "VS1", polish: "Excellent", symmetry: "Very Good", fluorescence: "Strong", color: "D", source_file_kind: "white", cert_url: "https://www.igi.org/Verify-Your-Report/?r=77" });
  });
});

// ── Full run with a Vibgyor group ───────────────────────────────────────────
const MAIN_HEADER = ["STOCK", "AVAILABILITY", "Shape", "Weight", "Color", "Clarity", "Report #", "Final Price", "CertFile"];
const VIB_HEADER = ["STOCK ID", "Availability", "Shape", "Carat", "Clarity", "Color", "Cut", "Polish", "SYM", "Flou", "Final Price", "Lab", "Certificate No", "Video", "Image"];
const vibRow = (n, color = "FANCY VIVID  PINK", price = 100) => [`V-${n}`, "YES", "ROUND", 1.01, "VS 1", color, "", "EX", "VG", "STG", price, "IGI", `9${n}`, "http://v", "http://i"];
const book = (aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};
const mainBook = (count) => book([[count], MAIN_HEADER, ...Array.from({ length: count }, (_, i) => [`S-${i + 1}`, "YES", "Round", "1.00", "D", "VS1", `R${i + 1}`, "100", "u"])]);

const files = [
  { id: "w", name: "CERTI STOCK FILE 31-10-26.xlsx", modifiedTime: "2026-10-31T10:00:00Z" },
  { id: "f", name: "CERTI FANCY COLOR STOCK FILE 31-10-26.xlsx", modifiedTime: "2026-10-31T10:00:00Z" },
];
const vibFiles = [
  { id: "vf", name: "VIBGYOR DIAMONDS FANCY COLOR 03-11-2026..xlsx", modifiedTime: "2026-11-03T06:00:00Z" },
  { id: "vw", name: "VIBGYOR DIAMOND D TO H COLOR 03-11-2026..xlsx", modifiedTime: "2026-11-03T06:00:00Z" },
];
const download = async (f) => {
  if (f.id === "vf") return book([VIB_HEADER, vibRow(1), vibRow(2, "N"), vibRow(3, "FANCY INTENSE YELLOWISH GREEN"), vibRow(4, "FANCY VIVID PINK", 0)]);
  if (f.id === "vw") return book([VIB_HEADER, vibRow(5, "D"), vibRow(6, "E")]);
  return mainBook(f.id === "w" ? 20 : 10);
};
function fakeStore({ vib = [], mainReports = [] } = {}) {
  const log = { upserts: [], delisted: [] };
  return {
    log,
    loadExisting: async (kind, prefix) => (prefix === "VIB" ? vib : []),
    loadReportNos: async () => new Set(mainReports),
    upsert: async (rows) => { log.upserts.push(...rows); },
    delist: async (skus) => { log.delisted.push(...skus); },
  };
}
const vibIn = (store) => store.log.upserts.filter((s) => s.sku.startsWith("VIB-"));

describe("runCvdSync - Vibgyor group", () => {
  it("adds VIB- stones, decides white/fancy per row, skips zero-price rows", async () => {
    const store = fakeStore();
    const r = await runCvdSync({ listFiles: async () => [...files, ...vibFiles], download, usdInr: 88, store });
    expect(r.status).toBe("ok");
    const vib = vibIn(store);
    expect(vib.map((s) => s.sku).sort()).toEqual(["VIB-91", "VIB-92", "VIB-93", "VIB-95", "VIB-96"]);
    expect(vib.find((s) => s.report_no === "91").source_file_kind).toBe("fancy");
    expect(vib.find((s) => s.report_no === "92").source_file_kind).toBe("white");
    expect(vib.find((s) => s.report_no === "93")).toMatchObject({ fancy_color: "Green", fancy_overtone: "Yellowish", fancy_intensity: "Intense" });
    expect(store.log.upserts.filter((s) => s.sku.startsWith("CVD-"))).toHaveLength(30);
  });

  it("delists VIB- stones missing from the new files and never touches CVD- stones", async () => {
    const store = fakeStore({ vib: ["91", "92", "93", "95", "96", "97"].map((n) => ({ sku: `VIB-${n}`, status: "listed", price_inr: 0 })) });
    await runCvdSync({ listFiles: async () => [...files, ...vibFiles], download, usdInr: 88, store });
    expect(store.log.delisted).toEqual(["VIB-97"]);
  });

  it("a certificate the main stock already lists stays under its CVD- SKU", async () => {
    const store = fakeStore({ mainReports: ["91"] });
    const r = await runCvdSync({ listFiles: async () => [...files, ...vibFiles], download, usdInr: 88, store });
    expect(vibIn(store).some((s) => s.sku === "VIB-91")).toBe(false);
    expect(r.files.find((f) => f.kind === "vib").overlap_with_main).toBe(1);
  });

  it("a broken Vibgyor file errors only the vib group; main stock still syncs and nothing is delisted", async () => {
    const store = fakeStore({ vib: [{ sku: "VIB-91", status: "listed", price_inr: 0 }] });
    const bad = async (f) => (f.id === "vf" ? Buffer.from("not a spreadsheet") : download(f));
    const r = await runCvdSync({ listFiles: async () => [...files, ...vibFiles], download: bad, usdInr: 88, store });
    expect(r.files.find((f) => f.kind === "vib").status).toBe("error");
    expect(store.log.upserts.filter((s) => s.sku.startsWith("CVD-"))).toHaveLength(30);
    expect(vibIn(store)).toHaveLength(0);
    expect(store.log.delisted).toHaveLength(0);
  });

  it("no Vibgyor files in the folder leaves Vibgyor stock untouched and raises no error", async () => {
    const store = fakeStore({ vib: [{ sku: "VIB-91", status: "listed", price_inr: 0 }] });
    const r = await runCvdSync({ listFiles: async () => files, download, usdInr: 88, store });
    expect(r.status).toBe("ok");
    expect(store.log.delisted).toHaveLength(0);
  });
});
