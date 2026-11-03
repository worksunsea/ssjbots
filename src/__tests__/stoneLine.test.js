import { describe, it, expect } from "vitest";
import { isFlatUnit, unitBase, unitLabel, weightToGrams, lineValue, nextUnit } from "../utils/stoneLine.js";

describe("stoneLine units", () => {
  it("reads base unit and flat flag", () => {
    expect(unitBase("ct_flat")).toBe("ct");
    expect(unitBase("g_flat")).toBe("g");
    expect(unitBase("g")).toBe("g");
    expect(isFlatUnit("g_flat")).toBe(true);
    expect(isFlatUnit("ct")).toBe(false);
    expect(unitLabel("ct_flat")).toBe("ct flat");
  });
  it("deducts weight in grams for every unit", () => {
    expect(weightToGrams("0.38", "ct")).toBeCloseTo(0.076);
    expect(weightToGrams("0.38", "ct_flat")).toBeCloseTo(0.076);
    expect(weightToGrams("0.54", "g_flat")).toBeCloseTo(0.54);
    expect(weightToGrams("", "g")).toBe(0);
  });
  it("per-unit = weight x rate, flat = rate once", () => {
    expect(lineValue("0.38", "15000", "ct")).toBeCloseTo(5700);
    expect(lineValue("0.54", "500", "g_flat")).toBe(500);
    expect(lineValue("", "500", "g_flat")).toBe(0);
  });
  it("cycles ct -> g -> ct_flat -> g_flat -> ct", () => {
    expect(["ct", "g", "ct_flat", "g_flat"].map(nextUnit)).toEqual(["g", "ct_flat", "g_flat", "ct"]);
  });
});
