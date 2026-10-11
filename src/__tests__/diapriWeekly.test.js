import { describe, it, expect } from "vitest";
import {
  istParts, weekKey, stateForWeek, shouldStop, listingUnchanged, dateAdvanced, shouldAlertMissing, listIsCurrent,
} from "../../api/_lib/diapriWeekly.js";

// 2026-10-09 is a Friday. 04:30 UTC = 10:00 IST.
const FRI_10AM_IST = new Date("2026-10-09T04:30:00Z");

describe("istParts / weekKey", () => {
  it("converts UTC to IST hour and date", () => {
    expect(istParts(FRI_10AM_IST)).toEqual({ ymd: "2026-10-09", dow: 5, hour: 10 });
    expect(istParts(new Date("2026-10-09T19:00:00Z")).ymd).toBe("2026-10-10"); // 00:30 IST Saturday
  });
  it("keys a Friday and the days after it to that Friday", () => {
    expect(weekKey(FRI_10AM_IST)).toBe("2026-10-09");
    expect(weekKey(new Date("2026-10-11T09:00:00Z"))).toBe("2026-10-09"); // Sunday
    expect(weekKey(new Date("2026-10-15T09:00:00Z"))).toBe("2026-10-09"); // Thursday
    expect(weekKey(new Date("2026-10-16T04:30:00Z"))).toBe("2026-10-16"); // next Friday
  });
});

describe("stateForWeek / shouldStop", () => {
  it("starts fresh in a new week but remembers the last seen file", () => {
    const prev = { week: "2026-10-09", loaded: true, alertedLoaded: true, alertedMissing: false, last_seen: { id: "a", modified: "m" } };
    const next = stateForWeek(prev, "2026-10-16");
    expect(next).toMatchObject({ week: "2026-10-16", loaded: false, alertedLoaded: false, alertedMissing: false, last_seen: { id: "a", modified: "m" } });
  });
  it("keeps the same week's state and stops once loaded", () => {
    const prev = { week: "2026-10-09", loaded: true };
    expect(stateForWeek(prev, "2026-10-09").loaded).toBe(true);
    expect(shouldStop(prev)).toBe(true);
    expect(shouldStop(stateForWeek(null, "2026-10-09"))).toBe(false);
  });
});

describe("listingUnchanged / dateAdvanced", () => {
  const listed = { id: "f1", modified: "2026-10-11T09:00:57Z" };
  it("skips when the newest file is the same one seen before", () => {
    expect(listingUnchanged(listed, { ...listed })).toBe(true);
    expect(listingUnchanged(listed, { id: "f1", modified: "2026-10-12T00:00:00Z" })).toBe(false);
    expect(listingUnchanged(listed, { id: "f2", modified: listed.modified })).toBe(false);
    expect(listingUnchanged(listed, null)).toBe(false);
  });
  it("counts a list as new only when its printed date is later", () => {
    expect(dateAdvanced("2026-10-16", "2026-10-09")).toBe(true);
    expect(dateAdvanced("2026-10-09", "2026-10-09")).toBe(false);
    expect(dateAdvanced("2026-10-02", "2026-10-09")).toBe(false);
    expect(dateAdvanced(null, "2026-10-09")).toBe(false);
    expect(dateAdvanced("2026-10-09", null)).toBe(true);
  });
});

describe("shouldAlertMissing", () => {
  it("alerts once, only from 18:00 IST, and never after loading", () => {
    const s = stateForWeek(null, "2026-10-09");
    expect(shouldAlertMissing(s, 17)).toBe(false);
    expect(shouldAlertMissing(s, 18)).toBe(true);
    expect(shouldAlertMissing({ ...s, alertedMissing: true }, 20)).toBe(false);
    expect(shouldAlertMissing({ ...s, loaded: true }, 20)).toBe(false);
  });
});

describe("listIsCurrent", () => {
  it("treats stored data dated on or after this week's Friday as this week's list", () => {
    expect(listIsCurrent("2026-10-09", "2026-10-09")).toBe(true);
    expect(listIsCurrent("2026-10-16", "2026-10-09")).toBe(true);
    expect(listIsCurrent("2026-10-02", "2026-10-09")).toBe(false);
    expect(listIsCurrent(null, "2026-10-09")).toBe(false);
  });
});
