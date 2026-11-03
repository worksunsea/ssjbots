import { describe, it, expect } from "vitest";
import { parseMeasurements, normShape, settingShape, pairScore, findPairs } from "../../api/_lib/cvdPairs.js";

const white = (o = {}) => ({ sku: "A", shape: "Oval", carat: 1.0, color: "G", clarity: "VS1", fancy_color: "", measurements: "7.80-5.50-3.40", ...o });
const fancy = (o = {}) => ({ sku: "A", shape: "Pear Brilliant", carat: 1.0, color: "", clarity: "VS1", fancy_color: "Pink", fancy_intensity: "Vivid", fancy_overtone: "", measurements: "8.00-5.50x3.40", ...o });

describe("cvdPairs helpers", () => {
  it("parses both measurement styles", () => {
    expect(parseMeasurements("20.28-15.86x9.54")).toEqual({ l: 20.28, w: 15.86, d: 9.54 });
    expect(parseMeasurements("21.9-15.47-9.47")).toEqual({ l: 21.9, w: 15.47, d: 9.47 });
    expect(parseMeasurements("")).toBeNull();
  });
  it("normalises shapes and maps to a setting shape", () => {
    expect(normShape("Oval Brilliant")).toBe(normShape("OVAL"));
    expect(normShape("Heart Modified")).not.toBe(normShape("Heart Brilliant"));
    expect(settingShape("Princess Cut")).toBe("Princess");
    expect(settingShape("SQUARE CUSHION")).toBe("Cushion");
    expect(settingShape("Round Brilliant")).toBe("Round");
    expect(settingShape("ROSE ROUND")).toBeNull();
    expect(settingShape("Lily")).toBeNull();
  });
});

describe("pairScore", () => {
  it("pairs near-identical white stones", () => {
    expect(pairScore(white(), white({ sku: "B", measurements: "7.90-5.45-3.30", carat: 1.03 }))).not.toBeNull();
  });
  it("rejects: different colour, size gap, carat gap, clarity > 2 grades (VS1 vs SI2), other shape, missing size", () => {
    expect(pairScore(white(), white({ sku: "B", color: "H" }))).toBeNull();
    expect(pairScore(white(), white({ sku: "B", measurements: "8.10-5.50-3.40" }))).toBeNull();
    expect(pairScore(white(), white({ sku: "B", measurements: "7.80-5.50-3.80" }))).toBeNull();
    expect(pairScore(white(), white({ sku: "B", carat: 1.08 }))).toBeNull();
    expect(pairScore(white(), white({ sku: "B", clarity: "SI2" }))).toBeNull();
    expect(pairScore(white({ clarity: "VVS1" }), white({ sku: "B", clarity: "VS1" }))).not.toBeNull();
    expect(pairScore(white(), white({ sku: "B", shape: "Pear" }))).toBeNull();
    expect(pairScore(white(), white({ sku: "B", measurements: "" }))).toBeNull();
    expect(pairScore(white(), white())).toBeNull();
  });
  it("fancy stones need the same fancy colour and intensity", () => {
    expect(pairScore(fancy(), fancy({ sku: "B" }))).not.toBeNull();
    expect(pairScore(fancy(), fancy({ sku: "B", fancy_color: "Blue" }))).toBeNull();
    expect(pairScore(fancy(), fancy({ sku: "B", fancy_intensity: "Intense" }))).toBeNull();
    expect(pairScore(fancy(), white({ sku: "B", shape: "Pear" }))).toBeNull();
  });
  it("findPairs sorts the closest match first", () => {
    const far = white({ sku: "F", measurements: "7.95-5.60-3.50" });
    const near = white({ sku: "N", measurements: "7.80-5.50-3.40" });
    expect(findPairs(white(), [far, near]).map((s) => s.sku)).toEqual(["N", "F"]);
  });
});
