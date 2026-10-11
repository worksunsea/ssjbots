import { describe, it, expect } from "vitest";
import { splitRapText } from "../../api/_lib/rapPdf.js";

const ROUND = "RAPAPORT : (.30 - .39 CT.) :ROUNDSRAPAPORT : (.40 - .49 CT.) :\n27 23 21";
const PEAR = "PEAR SHAPES\nRAPAPORT : (.30 - .39 CT.) :\nPEARS\n23 21 19";
const PARCEL = "ROUNDS0.01 - 0.02 ct\nParcel Prices in US$/Ct. for Round\n99 98";

describe("splitRapText", () => {
  it("splits a combined PDF into round and pear sections and drops parcel pages", () => {
    const { rounds, fancy } = splitRapText(`${ROUND}\n${PEAR}\n${PARCEL}`);
    expect(rounds).toContain("ROUNDS");
    expect(rounds).not.toContain("PEARS");
    expect(fancy).toContain("PEARS");
    expect(fancy).not.toContain("Parcel Prices");
  });
  it("recognises a round-only PDF", () => {
    expect(splitRapText(ROUND)).toEqual({ rounds: ROUND, fancy: null });
  });
  it("recognises a pear-only PDF", () => {
    const { rounds, fancy } = splitRapText(PEAR);
    expect(rounds).toBeNull();
    expect(fancy).toBe(PEAR);
  });
  it("ignores PDFs that are not Rapaport lists", () => {
    expect(splitRapText("Invoice 123 total 500")).toEqual({ rounds: null, fancy: null });
    expect(splitRapText(null)).toEqual({ rounds: null, fancy: null });
  });
});
