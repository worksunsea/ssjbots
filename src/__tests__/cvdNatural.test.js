import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { narolaWorkbookToTable, buildNaturalStones, priceNaturalStone, pickLatestNarolaFile, rapLookup } from "../../api/_lib/cvdNatural.js";

const HEAD = ["SRNO", "STONE ID", "SHAPE", "COLOR", "CLARITY", "CARAT", "RAP $/CT", "DISC %", "RATE $/CT", "TOTAL $", "CUT", "POL", "SYM", "FLO", "LAB", "REPORT NO", "STONESTATUS"];
function sheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet([["NAROLA STOCK LIST"], ["", "", "", "", "", 1.0], HEAD, ...rows]);
  const link = (cell, url) => { ws[cell].l = { Target: url }; };
  link("D4", "https://img.example/1.jpg"); link("E4", "https://vid.example/1"); link("O4", "https://cert.example/1.pdf");
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const row = ["1", "492129", "ROUND", "I", "VS1", 0.84, 2000, 50, 1000, 840, "EX", "EX", "EX", "NON", "IGI", "852625083", "AVAILABLE"];

describe("narola natural stones", () => {
  it("reads photo / video / certificate links off the colour, clarity and lab cells", () => {
    const t = narolaWorkbookToTable(sheet([row]));
    const { stones } = buildNaturalStones(t, { usdInr: 88, rapData: null, markupDisc: 9 });
    expect(stones[0]).toMatchObject({ sku: "NAR-852625083", image_url: "https://img.example/1.jpg", video_url: "https://vid.example/1", cert_url: "https://cert.example/1.pdf", stone_type: "natural" });
  });
  it("sells at supplier discount minus markup, on the live USD rate", () => {
    const p = priceNaturalStone({ rapData: null, rapSheet: 2000, discSheet: 50, carat: 0.84, color: "I", clarity: "VS1", shape: "Round", usdInr: 88, markupDisc: 9 });
    expect(p.sell_disc_pct).toBe(41);
    expect(p.price_inr).toBe(87200); // 2000 x 0.59 x 88 x 0.84 -> nearest 100
  });
  it("a bigger markup lowers the discount and raises nothing else; the Rapaport table wins over the sheet rap", () => {
    const rapData = { rounds: { "0.70": Array.from({ length: 10 }, () => Array(11).fill(30)) } };
    expect(rapLookup(rapData, 0.84, "I", "VS1", true)).toBe(30);
    const p = priceNaturalStone({ rapData, rapSheet: 2000, discSheet: 50, carat: 0.84, color: "I", clarity: "VS1", shape: "Round", usdInr: 100, markupDisc: 10 });
    expect(p.rap_from_table).toBe(true);
    expect(p.price_inr).toBe(151200); // 3000 x 0.60 x 100 x 0.84
  });
  it("skips unavailable or priceless rows and picks the newest Narola file", () => {
    const t = narolaWorkbookToTable(sheet([row, [...row.slice(0, 16), "SOLD"]]));
    expect(buildNaturalStones(t, { usdInr: 88, rapData: null, markupDisc: 9 })).toMatchObject({ skipped: 1 });
    expect(pickLatestNarolaFile([{ name: "narola 01-11-26.xlsx" }, { name: "narola 27-11-26.xlsx" }, { name: "CERTI STOCK FILE 29-11-26.xlsx" }]).name).toBe("narola 27-11-26.xlsx");
  });
});
