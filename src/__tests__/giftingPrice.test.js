import { describe, it, expect } from "vitest";
import { computePrice } from "../../api/_lib/giftingPrice.js";

const rates = { spot: { gold24kt: 15000, silverPerGram: 200 }, giftingCoins: [] };

describe("computePrice (corp gifting)", () => {
  it("gold markup: (weight x rate + making) x (1 + tax) + adjustment", () => {
    const p = { price_mode: "live_gold_markup", weight_grams: 10, making_charge: 1000, tax_percent: 3, price_diff: -500 };
    expect(computePrice(p, rates)).toBe(Math.round((150000 + 1000) * 1.03 - 500));
  });
  it("changing the adjustment moves the price by the same amount", () => {
    const base = { price_mode: "live_silver_markup", weight_grams: 50, making_charge: 200, tax_percent: 3, price_diff: 0 };
    expect(computePrice({ ...base, price_diff: 250 }, rates) - computePrice(base, rates)).toBe(250);
  });
  it("manual mode uses manual_price", () => {
    expect(computePrice({ price_mode: "manual", manual_price: 999 }, rates)).toBe(999);
  });
});
