import { describe, it, expect } from "vitest";
import { normalizeCardDate, normalizeCardPhone, normalizeRelation, sanitizeCardFields } from "../../api/_lib/cardScan.js";

describe("normalizeCardDate", () => {
  it("returns an ISO date when the year is written in full", () => {
    expect(normalizeCardDate("25/04/1985")).toBe("1985-04-25");
  });
  it("keeps day-month only when there is no year", () => {
    expect(normalizeCardDate("5 / 4")).toBe("05-04");
  });
  it("expands two-digit years sensibly", () => {
    expect(normalizeCardDate("15-11-05")).toBe("2005-11-15");
    expect(normalizeCardDate("01-02-68")).toBe("1968-02-01");
  });
  it("rejects impossible days and months", () => {
    expect(normalizeCardDate("32/01/1990")).toBe("");
    expect(normalizeCardDate("10/13/1990")).toBe("");
    expect(normalizeCardDate("hello")).toBe("");
    expect(normalizeCardDate("")).toBe("");
  });
});

describe("normalizeCardPhone", () => {
  it("strips country code, zero and spaces", () => {
    expect(normalizeCardPhone("+91 98100 12345")).toBe("9810012345");
    expect(normalizeCardPhone("09810012345")).toBe("9810012345");
  });
  it("rejects short or non-mobile numbers", () => {
    expect(normalizeCardPhone("98100")).toBe("");
    expect(normalizeCardPhone("1234567890")).toBe("");
  });
});

describe("normalizeRelation", () => {
  it("maps common spellings onto the CRM list", () => {
    expect(normalizeRelation("Wife")).toBe("spouse");
    expect(normalizeRelation("Papa")).toBe("father");
    expect(normalizeRelation("Son")).toBe("son");
    expect(normalizeRelation("uncle")).toBe("other");
    expect(normalizeRelation("")).toBe("");
  });
});

describe("sanitizeCardFields", () => {
  const read = {
    name: "  Rohit   Sharma ", phone: "98100 12345", email: "ROHIT@Example.com",
    bday: "25/04/1985", anniversary: "15-11", address_house: "B-12 Sector 5",
    city: "New Delhi", address_state: "Delhi", address_pincode: "110005",
    family: [
      { relationship: "wife", name: "Neha", dob: "02/09/1988", mobile: "" },
      { relationship: "son", name: "", dob: "", mobile: "" },
      { relationship: "daughter", name: "Aanya", dob: "11/11/2015", mobile: "98111 11111" },
    ],
    referrals: [{ name: "Amit", phone: "9999900000" }, { name: "No number", phone: "" }],
  };

  it("produces CRM-shaped values", () => {
    const out = sanitizeCardFields(read);
    expect(out.fields).toMatchObject({
      name: "Rohit Sharma", phone: "9810012345", email: "rohit@example.com",
      bday: "1985-04-25", anniversary: "15-11", address_pincode: "110005",
    });
    expect(out.warnings).toEqual([]);
  });
  it("drops empty family rows and referrals without a number", () => {
    const out = sanitizeCardFields(read);
    expect(out.family.map((m) => m.name)).toEqual(["Neha", "Aanya"]);
    expect(out.family[0].relationship).toBe("spouse");
    expect(out.referrals).toEqual([{ name: "Amit", phone: "9999900000" }]);
  });
  it("warns instead of guessing when the mobile or pincode is unreadable", () => {
    const out = sanitizeCardFields({ name: "A", phone: "98x", address_pincode: "1100" });
    expect(out.fields.phone).toBe("");
    expect(out.fields.address_pincode).toBe("");
    expect(out.warnings.join(" ")).toMatch(/Mobile/);
    expect(out.warnings.join(" ")).toMatch(/Pincode/);
  });
  it("copes with garbage input", () => {
    expect(sanitizeCardFields(null).family).toEqual([]);
    expect(sanitizeCardFields("x").fields.name).toBe("");
  });
});
