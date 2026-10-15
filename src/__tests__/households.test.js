import { describe, it, expect } from "vitest";
import { addressKey, suggestHouseholds, collapseHouseholds, pickBestAddress } from "../households.js";

const c = (id, extra = {}) => ({ id: String(id), name: `N${id}`, phone: `98100000${id}0`, address_house: "B-12, Model Town", address_pincode: "110009", ...extra });

describe("addressKey", () => {
  it("ignores punctuation and case but needs pincode and a house number", () => {
    expect(addressKey(c(1))).toBe(addressKey(c(2, { address_house: "b 12 model town!" })));
    expect(addressKey({ address_house: "Delhi", address_pincode: "110009" })).toBe("");
    expect(addressKey({ address_house: "B-12 Model Town", address_pincode: "" })).toBe("");
  });
});

describe("suggestHouseholds", () => {
  it("groups people at the same address", () => {
    const out = suggestHouseholds([c(1), c(2), c(3, { address_house: "Z-9 Elsewhere Road" })]);
    expect(out).toHaveLength(1);
    expect(out[0].ids.sort()).toEqual(["1", "2"]);
    expect(out[0].reasons).toContain("same address");
  });
  it("joins spouses through partner links and spouse numbers, even at different addresses", () => {
    const rows = [c(1, { partner_lead_id: "2" }), c(2, { address_house: "Other 55 Lane" }), c(3, { address_house: "Q 7 Park", spouse_mobile: "+91 98100000 40" }), c(4, { phone: "9810000040", address_house: "R 8 Park" })];
    const out = suggestHouseholds(rows);
    expect(out.map((g) => g.ids.sort())).toEqual(expect.arrayContaining([["1", "2"], ["3", "4"]]));
  });
  it("skips groups that are already one household and giant groups", () => {
    const linked = [c(1, { household_id: "h" }), c(2, { household_id: "h" })];
    expect(suggestHouseholds(linked)).toEqual([]);
    const crowd = Array.from({ length: 10 }, (_, i) => c(i + 1));
    expect(suggestHouseholds(crowd)).toEqual([]);
  });
  it("offers to extend an existing household instead of starting a new one", () => {
    const out = suggestHouseholds([c(1, { household_id: "h" }), c(2)]);
    expect(out[0].existingHouseholdId).toBe("h");
  });
});

describe("collapseHouseholds", () => {
  it("turns household members into one stop with joined names and phones", () => {
    const rows = [c(1, { household_id: "h", name: "Ravi" }), c(2, { household_id: "h", name: "Meena", address_locality: "Model Town", city: "Delhi" }), c(3)];
    const stops = collapseHouseholds(rows);
    expect(stops).toHaveLength(2);
    expect(stops[0].name).toBe("Ravi / Meena");
    expect(stops[0].phone).toBe("9810000010, 9810000020");
    expect(stops[0].address_locality).toBe("Model Town");   // fuller address wins
    expect(stops[1].name).toBe("N3");
  });
});

describe("pickBestAddress", () => {
  it("takes the member with the most address parts", () => {
    expect(pickBestAddress([{ address_house: "A" }, { address_house: "A", city: "X", address_pincode: "110005" }]).city).toBe("X");
  });
});
