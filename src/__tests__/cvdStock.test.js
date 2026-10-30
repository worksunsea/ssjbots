import { describe, it, expect } from "vitest";
import {
  classifyFile, fileDateFromName, pickLatestFiles, extractTable, normaliseStone,
  priceStone, buildStones, planReconcile, withGst, PUBLIC_COLUMNS,
} from "../../api/_lib/cvdStock.js";

const HEADER = ["STOCK", "AVAILABILITY", "Shape", "Weight", "Color", "Clarity", "Report #", "Final Price", "Price Per Carat", "CertFile"];
const row = (stock, avail, report, finalUsd, carat = "1.10") =>
  [stock, avail, "Round Brilliant", carat, "D", "VVS2", report, finalUsd, "126.50", "https://igi/x"];

describe("classifyFile", () => {
  it("maps supplier file names to kinds and skips non-certified", () => {
    expect(classifyFile("CERTI STOCK FILE 29-10-26")).toBe("white");
    expect(classifyFile("CERTI FANCY COLOR STOCK FILE 29-10-26.xlsx")).toBe("fancy");
    expect(classifyFile("NON CERTI STOCK FILE 29-10-26.xlsx")).toBeNull();
    expect(classifyFile("notes.docx")).toBeNull();
  });
});

describe("pickLatestFiles", () => {
  it("takes the newest dated file per kind", () => {
    const files = [
      { id: "a", name: "CERTI STOCK FILE 28-10-26", modifiedTime: "2026-10-28T10:00:00Z" },
      { id: "b", name: "CERTI STOCK FILE 29-10-26", modifiedTime: "2026-10-29T10:00:00Z" },
      { id: "c", name: "CERTI FANCY COLOR STOCK FILE 29-10-26.xlsx", modifiedTime: "2026-10-29T10:45:00Z" },
      { id: "d", name: "NON CERTI STOCK FILE 29-10-26.xlsx", modifiedTime: "2026-10-29T10:45:00Z" },
    ];
    const latest = pickLatestFiles(files);
    expect(latest.white.id).toBe("b");
    expect(latest.fancy.id).toBe("c");
    expect(Object.keys(latest)).toHaveLength(2);
  });
  it("orders by date in name before modifiedTime", () => {
    expect(fileDateFromName("X 05-11-26")).toBeGreaterThan(fileDateFromName("X 29-10-26"));
  });
});

describe("extractTable", () => {
  it("skips the totals row and reads the count from it", () => {
    const aoa = [[2, "", "", 3.0], HEADER, row("RS-1", "YES", "111", "139.15"), row("RS-2", "HOLD", "222", "100"), []];
    const t = extractTable(aoa);
    expect(t.totalsCount).toBe(2);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]["Report #"]).toBe("111");
  });
  it("errors when the header is missing", () => {
    expect(extractTable([["a", "b"]]).error).toBe("header_row_not_found");
  });
});

describe("normaliseStone", () => {
  const r = (v) => ({ STOCK: "RS-1", AVAILABILITY: "YES", Shape: "Round", Weight: "1.10", "Report #": "111", "Final Price": "139.15", ...v });
  it("maps availability to status", () => {
    expect(normaliseStone(r({}), "white").status).toBe("listed");
    expect(normaliseStone(r({ AVAILABILITY: "HOLD" }), "white").status).toBe("reserved");
    expect(normaliseStone(r({ AVAILABILITY: "ON MEMO" }), "white").status).toBe("reserved");
    expect(normaliseStone(r({ AVAILABILITY: "NO" }), "white")).toBeNull();
  });
  it("rejects rows without report number or price", () => {
    expect(normaliseStone(r({ "Report #": "" }), "white")).toBeNull();
    expect(normaliseStone(r({ "Final Price": "" }), "white")).toBeNull();
  });
  it("builds the SKU from the IGI report number", () => {
    expect(normaliseStone(r({}), "fancy").sku).toBe("CVD-111");
  });
});

describe("priceStone", () => {
  it("adds 50 paise to USD/INR, doubles purchase, rounds to ₹100", () => {
    const p = priceStone(139.15, 88);
    expect(p.usd_inr_used).toBe(88.5);
    expect(p.purchase_inr).toBe(12315);       // 139.15 * 88.5
    expect(p.price_inr).toBe(24600);          // 12315 * 2 = 24630 -> 24600
  });
});

describe("withGst", () => {
  it("adds 1.5% GST", () => {
    expect(withGst(24600)).toEqual({ price_inr: 24600, gst_pct: 1.5, gst_inr: 369, total_inr: 24969 });
  });
});

describe("buildStones", () => {
  it("dedupes by report number and flags a count mismatch vs totals row", () => {
    const t = extractTable([[3], HEADER, row("A", "YES", "1", "10"), row("B", "YES", "1", "10"), row("C", "YES", "2", "20")]);
    const { stones, skipped, countMismatch } = buildStones(t, "white", 88);
    expect(stones.map((s) => s.sku)).toEqual(["CVD-1", "CVD-2"]);
    expect(skipped).toBe(1);
    expect(countMismatch).toBe(false);
    const t2 = extractTable([[5], HEADER, row("A", "YES", "1", "10")]);
    expect(buildStones(t2, "white", 88).countMismatch).toBe(true);
  });
});

describe("planReconcile", () => {
  const ex = (sku, status = "listed", price_inr = 100) => ({ sku, status, price_inr });
  const inc = (sku, price_inr = 100) => ({ sku, price_inr });
  it("finds added, gone, returned and price-changed stones", () => {
    const plan = planReconcile(
      [ex("A"), ex("B"), ex("C", "delisted"), ex("D")],
      [inc("A", 200), inc("C"), inc("D"), inc("E")],
    );
    expect(plan.added.map((s) => s.sku)).toEqual(["E"]);
    expect(plan.gone.map((s) => s.sku)).toEqual(["B"]);
    expect(plan.returned.map((s) => s.sku)).toEqual(["C"]);
    expect(plan.priceChanged.map((s) => s.sku)).toEqual(["A"]);
    expect(plan.shrunk).toBe(false);
  });
  it("flags a file that shrank below 70% of stored stones", () => {
    const stored = Array.from({ length: 10 }, (_, i) => ex(`S${i}`));
    expect(planReconcile(stored, [inc("S0"), inc("S1")]).shrunk).toBe(true);
    expect(planReconcile(stored, stored.slice(0, 8).map((s) => inc(s.sku))).shrunk).toBe(false);
  });
});

describe("PUBLIC_COLUMNS", () => {
  it("never exposes purchase price or raw data", () => {
    expect(PUBLIC_COLUMNS.some((c) => /purchase|raw|usd_inr/.test(c))).toBe(false);
  });
});
