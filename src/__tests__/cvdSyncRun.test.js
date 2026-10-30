import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { runCvdSync, summaryLine } from "../../api/_lib/cvdSyncRun.js";

const HEADER = ["STOCK", "AVAILABILITY", "Shape", "Weight", "Color", "Clarity", "Report #", "Final Price", "CertFile"];
const stoneRow = (n, avail = "YES") => [`S-${n}`, avail, "Round", "1.00", "D", "VS1", `R${n}`, "100", "u"];

function xlsxBuffer(count, { totals = count, start = 1 } = {}) {
  const aoa = [[totals], HEADER];
  for (let i = start; i < start + count; i++) aoa.push(stoneRow(i, i % 10 === 0 ? "HOLD" : "YES"));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function fakeStore(initial = {}) {
  const data = { white: [...(initial.white || [])], fancy: [...(initial.fancy || [])] };
  const log = { upserts: [], delisted: [] };
  return {
    log,
    loadExisting: async (kind) => data[kind],
    upsert: async (rows) => { log.upserts.push(...rows); },
    delist: async (skus) => { log.delisted.push(...skus); },
  };
}

const files = [
  { id: "w", name: "CERTI STOCK FILE 29-10-26", modifiedTime: "2026-10-29T10:00:00Z" },
  { id: "f", name: "CERTI FANCY COLOR STOCK FILE 29-10-26.xlsx", modifiedTime: "2026-10-29T10:00:00Z" },
  { id: "n", name: "NON CERTI STOCK FILE 29-10-26.xlsx", modifiedTime: "2026-10-29T10:00:00Z" },
];
const stored = (n, kind) => Array.from({ length: n }, (_, i) => ({ sku: `CVD-R${i + 1}`, status: "listed", price_inr: 0, source_file_kind: kind }));

describe("runCvdSync", () => {
  it("adds new stones and ignores the non-certified file", async () => {
    const store = fakeStore();
    const r = await runCvdSync({ listFiles: async () => files, download: async (f) => xlsxBuffer(f.id === "w" ? 20 : 10), usdInr: 88, store });
    expect(r.status).toBe("ok");
    expect(r.added).toBe(30);
    expect(store.log.upserts).toHaveLength(30);
    expect(store.log.upserts[0].status).toBeTruthy();
  });

  it("delists stones missing from the latest sheet", async () => {
    const store = fakeStore({ white: stored(20, "white"), fancy: [] });
    const r = await runCvdSync({ listFiles: async () => files, download: async (f) => xlsxBuffer(f.id === "w" ? 18 : 5), usdInr: 88, store });
    expect(r.delisted).toBe(2);
    expect(store.log.delisted.sort()).toEqual(["CVD-R19", "CVD-R20"]);
  });

  it("refuses to delist when the file shrank below 70% but still upserts", async () => {
    const store = fakeStore({ white: stored(100, "white"), fancy: [] });
    const r = await runCvdSync({ listFiles: async () => files, download: async (f) => xlsxBuffer(f.id === "w" ? 10 : 5), usdInr: 88, store });
    expect(r.status).toBe("partial");
    expect(store.log.delisted).toHaveLength(0);
    expect(r.files[0].error).toMatch(/delisting skipped/);
  });

  it("a half-written file (count != totals row) writes nothing for that kind, other kind still syncs", async () => {
    const store = fakeStore();
    const dl = async (f) => (f.id === "w" ? xlsxBuffer(10, { totals: 50 }) : xlsxBuffer(7));
    const r = await runCvdSync({ listFiles: async () => files, download: dl, usdInr: 88, store });
    expect(r.status).toBe("partial");
    expect(r.files.find((f) => f.kind === "white").status).toBe("error");
    expect(store.log.upserts).toHaveLength(7);
  });

  it("dry run writes nothing", async () => {
    const store = fakeStore({ white: stored(5, "white") });
    const r = await runCvdSync({ listFiles: async () => files, download: async () => xlsxBuffer(8), usdInr: 88, store, dry: true });
    expect(r.dry).toBe(true);
    expect(store.log.upserts).toHaveLength(0);
    expect(r.added).toBeGreaterThan(0);
  });

  it("fails cleanly with no rate or no files", async () => {
    expect((await runCvdSync({ listFiles: async () => files, download: async () => xlsxBuffer(1), usdInr: null, store: fakeStore() })).status).toBe("error");
    const r = await runCvdSync({ listFiles: async () => [], download: async () => xlsxBuffer(1), usdInr: 88, store: fakeStore() });
    expect(r.status).toBe("error");
  });
});

describe("summaryLine", () => {
  it("includes issues", () => {
    const line = summaryLine({ status: "partial", added: 3, delisted: 1, price_changed: 2, files: [{ kind: "white", error: "boom" }] });
    expect(line).toContain("PARTIAL");
    expect(line).toContain("white: boom");
  });
});
