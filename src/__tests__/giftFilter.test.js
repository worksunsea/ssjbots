import { describe, it, expect } from "vitest";
import { hasCompleteAddress, addressLine, applyGiftFilters, editTags, giftCsv, DEFAULT_SENT_TAG } from "../giftFilter.js";

const full = { id: 1, name: "A", phone: "9810012345", city: "Delhi", address_house: "B-12", address_pincode: "110005", tags: ["VIP"] };
const noPin = { id: 2, name: "B", phone: "9810012346", city: "Delhi", address_house: "C-3", address_pincode: "1100", tags: [] };
const sent = { ...full, id: 3, tags: ["VIP", DEFAULT_SENT_TAG] };
const dnd = { ...full, id: 4, dnd: true, tags: ["Blocked"] };
const list = [full, noPin, sent, dnd];
const ids = (l) => l.map((c) => c.id);

describe("hasCompleteAddress", () => {
  it("needs street, 6-digit pincode and city", () => {
    expect(hasCompleteAddress(full)).toBe(true);
    expect(hasCompleteAddress(noPin)).toBe(false);
    expect(hasCompleteAddress({ ...full, city: "" })).toBe(false);
    expect(hasCompleteAddress({})).toBe(false);
  });
});

describe("addressLine", () => {
  it("joins the parts that exist", () => {
    expect(addressLine({ address_house: "B-12", city: "Delhi", address_pincode: "110005" })).toBe("B-12, Delhi, 110005");
  });
});

describe("applyGiftFilters", () => {
  it("excludes contacts carrying any excluded tag", () => {
    expect(ids(applyGiftFilters(list, { excludeTags: ["Blocked", DEFAULT_SENT_TAG] }))).toEqual([1, 2]);
  });
  it("filters by address quality", () => {
    expect(ids(applyGiftFilters(list, { address: "complete" }))).toEqual([1, 3, 4]);
    expect(ids(applyGiftFilters(list, { address: "incomplete" }))).toEqual([2]);
  });
  it("filters by gift status using the sent tag", () => {
    expect(ids(applyGiftFilters(list, { gift: "sent" }))).toEqual([3]);
    expect(ids(applyGiftFilters(list, { gift: "unsent" }))).toEqual([1, 2, 4]);
  });
  it("filters by pincode prefix and DND", () => {
    expect(ids(applyGiftFilters(list, { pincodePrefix: "1100" }))).toEqual([1, 2, 3, 4]);
    expect(ids(applyGiftFilters(list, { pincodePrefix: "110005" }))).toEqual([1, 3, 4]);
    expect(ids(applyGiftFilters(list, { hideDnd: true }))).toEqual([1, 2, 3]);
  });
  it("returns everything with no filters", () => {
    expect(applyGiftFilters(list)).toHaveLength(4);
  });
});

describe("editTags", () => {
  it("adds and removes several tags at once without duplicates", () => {
    expect(editTags(["a", "b"], { add: ["b", "c", "d"], remove: ["a", "d"] })).toEqual(["b", "c"]);
  });
  it("handles missing current tags", () => {
    expect(editTags(null, { add: ["x"] })).toEqual(["x"]);
  });
  it("does not change the input array", () => {
    const cur = ["a"]; editTags(cur, { add: ["b"], remove: ["a"] });
    expect(cur).toEqual(["a"]);
  });
});

describe("giftCsv", () => {
  it("quotes cells and flags address and sent status", () => {
    const csv = giftCsv([{ ...full, name: 'Ravi "R" Kumar' }, sent]);
    const rows = csv.split("\r\n");
    expect(rows[0]).toContain('"Pincode"');
    expect(rows[1]).toContain('"Ravi ""R"" Kumar"');
    expect(rows[1]).toContain('"yes","no"');
    expect(rows[2]).toContain('"yes","yes"');
  });
});
