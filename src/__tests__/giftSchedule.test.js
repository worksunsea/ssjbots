import { describe, it, expect } from "vitest";
import { isoDate, tomorrowIso, buildDeliveryRows, groupByEmployee, giftTotals, buildDaySheetHtml, UNASSIGNED } from "../giftSchedule.js";

const lead = (id, pin, extra = {}) => ({ id, name: `C${id}`, phone: "98", address_house: `H-${id}`, address_pincode: pin, ...extra });
const del = (id, who, pin, item, extra = {}) => ({ id: `d${id}`, assigned_to: who, gift_item: item, lead: lead(id, pin), ...extra });

describe("dates", () => {
  it("formats the local date and rolls to tomorrow across a month end", () => {
    expect(isoDate(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
    expect(tomorrowIso(new Date(2026, 9, 31, 10, 0))).toBe("2026-11-01");
  });
});

describe("buildDeliveryRows", () => {
  const leads = [lead("1", "110005"), lead("2", "110005"), lead("3", "110005")];
  const base = { leads, date: "2026-10-20", employee: "Ramesh", giftItem: "Silver coin", tenantId: "t", createdBy: "Saurav" };
  it("creates one planned row per client with the default gift and allows per-client overrides", () => {
    const { rows } = buildDeliveryRows({ ...base, perLeadItem: { 2: "Sweets box" } });
    expect(rows.map((r) => r.gift_item)).toEqual(["Silver coin", "Sweets box", "Silver coin"]);
    expect(rows.every((r) => r.status === "planned" && r.assigned_to === "Ramesh" && r.planned_date === "2026-10-20")).toBe(true);
  });
  it("skips clients who are already booked unless asked to re-book", () => {
    const booked = new Set(["2"]);
    expect(buildDeliveryRows({ ...base, alreadyBooked: booked }).skipped.map((l) => l.id)).toEqual(["2"]);
    expect(buildDeliveryRows({ ...base, alreadyBooked: booked, rebook: true }).rows).toHaveLength(3);
  });
  it("stores a blank gift as null", () => {
    expect(buildDeliveryRows({ ...base, giftItem: "  " }).rows[0].gift_item).toBeNull();
  });
});

describe("groupByEmployee", () => {
  it("groups, puts unassigned last and orders each employee's stops by pincode", () => {
    const g = groupByEmployee([del("1", "Ramesh", "110009", "A"), del("2", null, "110001", "A"), del("3", "Ramesh", "110005", "A"), del("4", "Amit", "110016", "B")]);
    expect(g.map((x) => x.employee)).toEqual(["Amit", "Ramesh", UNASSIGNED]);
    expect(g[1].stops.map((s) => s.lead.id)).toEqual(["3", "1"]);
  });
});

describe("giftTotals", () => {
  it("counts each gift for packing", () => {
    expect(giftTotals([{ gift_item: "Coin" }, { gift_item: "Coin" }, { gift_item: "Sweets" }, { gift_item: null }])).toBe("Coin ×2, Sweets ×1, Gift (not specified) ×1");
  });
});

describe("buildDaySheetHtml", () => {
  it("shows who gets what and escapes client text", () => {
    const html = buildDaySheetHtml(groupByEmployee([del("1", "Ramesh", "110005", "Silver <coin>", { notes: "call first" })]), { date: "2026-10-20" });
    expect(html).toContain("Ramesh");
    expect(html).toContain("Silver &lt;coin&gt;");
    expect(html).toContain("call first");
    expect(html).toContain("Pack:");
    expect(html).not.toContain("<coin>");
  });
  it("says so when nothing is scheduled", () => {
    expect(buildDaySheetHtml([])).toContain("Nothing is scheduled");
  });
});
