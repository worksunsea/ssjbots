import { describe, it, expect } from "vitest";
import { parsePincodes, zoneForPincode, groupByZone, buildTrips, routeCompare, buildRoutePrintHtml, escapeHtml, UNZONED } from "../giftZones.js";

const zones = [
  { name: "North Delhi", pincodes: ["110007", "110009"] },
  { name: "South Delhi", pincodes: ["110016", "110017"] },
];
const c = (id, pincode, extra = {}) => ({ id, name: `C${id}`, phone: "98", address_pincode: pincode, ...extra });

describe("parsePincodes", () => {
  it("accepts commas, spaces and newlines and ignores junk and duplicates", () => {
    expect(parsePincodes("110007, 110009\n110007 abc 12345")).toEqual(["110007", "110009"]);
  });
});

describe("zoneForPincode", () => {
  it("finds the zone or falls back to the catch-all", () => {
    expect(zoneForPincode(zones, "110016")).toBe("South Delhi");
    expect(zoneForPincode(zones, "201301")).toBe(UNZONED);
    expect(zoneForPincode(zones, "")).toBe(UNZONED);
  });
});

describe("groupByZone", () => {
  it("groups, orders by pincode then locality, drops empty zones and keeps the catch-all last", () => {
    const rows = [c(1, "110017"), c(2, "110007", { address_locality: "Model Town" }), c(3, "110007", { address_locality: "Kamla Nagar" }), c(4, "201301")];
    const out = groupByZone(rows, zones);
    expect(out.map((g) => g.zone)).toEqual(["North Delhi", "South Delhi", UNZONED]);
    expect(out[0].rows.map((r) => r.id)).toEqual([3, 2]);
  });
  it("does not reorder the caller's array", () => {
    const rows = [c(2, "110009"), c(1, "110007")];
    groupByZone(rows, zones);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("routeCompare", () => {
  it("sorts house numbers naturally within a locality", () => {
    const a = c(1, "110007", { address_house: "B-2" });
    const b = c(2, "110007", { address_house: "B-10" });
    expect(routeCompare(a, b)).toBeLessThan(0);
  });
});

describe("buildTrips", () => {
  it("splits a zone into trips of the requested size", () => {
    const groups = [{ zone: "North Delhi", rows: [1, 2, 3, 4, 5].map((i) => c(i, "110007")) }];
    const trips = buildTrips(groups, 2);
    expect(trips.map((t) => [t.trip, t.trips, t.rows.length])).toEqual([[1, 3, 2], [2, 3, 2], [3, 3, 1]]);
  });
  it("falls back to 25 for a nonsense size", () => {
    expect(buildTrips([{ zone: "Z", rows: [c(1, "110007")] }], 0)).toHaveLength(1);
  });
});

describe("buildRoutePrintHtml", () => {
  it("escapes client-supplied text", () => {
    const html = buildRoutePrintHtml([{ zone: "North Delhi", trip: 1, trips: 1, rows: [c(1, "110007", { name: "<script>x</script>", address_house: 'A "1"' })] }]);
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Trip 1 of 1");
  });
  it("says so when there is nothing to print", () => {
    expect(buildRoutePrintHtml([])).toContain("No contacts to print");
  });
  it("escapeHtml handles null", () => {
    expect(escapeHtml(null)).toBe("");
  });
});
