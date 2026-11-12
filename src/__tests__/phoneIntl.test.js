import { describe, it, expect } from "vitest";
import { normalizePhone, split, join, validate, toWaNumber, toStoredPhone, displayPhone } from "../phoneIntl.js";
import { normalizePhone as serverNormalize } from "../../api/_lib/config.js";
import { normalizePhone as fieldsNormalize } from "../utils/contact-fields.js";
import { normalizeCardPhone } from "../../api/_lib/cardScan.js";

describe("normalizePhone - Indian inputs unchanged", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["0919876543210", "9876543210"],
    ["00919876543210", "9876543210"],
    ["+91 09876543210", "9876543210"],
    ["918860866000:19", "8860866000"],
    [null, ""],
    [undefined, ""],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it("does not mangle a 10-digit Indian number that starts with 91", () => {
    expect(normalizePhone("9123456789")).toBe("9123456789");
    expect(normalizePhone("919123456789")).toBe("9123456789");
  });
});

describe("normalizePhone - international is not mangled", () => {
  it.each([
    ["971501234567", "971501234567"],
    ["+971 50 123 4567", "971501234567"],
    ["00971501234567", "971501234567"],
    ["14155552671", "14155552671"],
    ["+44 7700 900123", "447700900123"],
    ["8801712345678", "8801712345678"],
    ["971501234567:7", "971501234567"],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it("server and contact-fields copies behave identically", () => {
    const samples = ["9876543210", "+919876543210", "09876543210", "971501234567", "9123456789", "919123456789",
      "+91 09876543210", "918860866000:19", "", null, "14155552671", "00447700900123", "91", "9198", "919876543210123"];
    for (const s of samples) {
      expect(serverNormalize(s)).toBe(normalizePhone(s));
      expect(fieldsNormalize(s)).toBe(normalizePhone(s));
    }
  });
});

describe("split / join round trip", () => {
  it("Indian stays plain 10 digits", () => {
    expect(split("9876543210")).toEqual({ cc: "91", national: "9876543210" });
    expect(join("91", "9876543210")).toBe("9876543210");
    expect(join("91", "+91 98765 43210")).toBe("9876543210");
    expect(join("91", "09876543210")).toBe("9876543210");
  });
  it.each([
    ["971", "501234567", "971501234567"],
    ["1", "4155552671", "14155552671"],
    ["44", "7700900123", "447700900123"],
    ["880", "1712345678", "8801712345678"],
    ["977", "9841234567", "9779841234567"],
  ])("cc %s + %s <-> %s", (cc, national, stored) => {
    expect(join(cc, national)).toBe(stored);
    expect(split(stored)).toEqual({ cc, national });
  });
  it("strips a trunk 0 from the national part", () => {
    expect(join("44", "07700900123")).toBe("447700900123");
  });
  it("unknown country code round-trips via empty cc", () => {
    const { cc, national } = split("819012345678");
    expect(join(cc, national)).toBe("819012345678");
  });
  it("empty input defaults to India", () => {
    expect(split("")).toEqual({ cc: "91", national: "" });
  });
});

describe("validate", () => {
  it("India needs exactly 10 digits starting 6-9", () => {
    expect(validate("91", "9876543210")).toBe("");
    expect(validate("91", "919876543210")).toBe("");
    expect(validate("91", "5876543210")).not.toBe("");
    expect(validate("91", "98765")).not.toBe("");
    expect(validate("91", "98765432101")).not.toBe("");
  });
  it("international 6-14 digits", () => {
    expect(validate("971", "501234567")).toBe("");
    expect(validate("971", "12345")).not.toBe("");
    expect(validate("971", "123456789012345")).not.toBe("");
    expect(validate("", "501234567")).not.toBe("");
    expect(validate("1234", "501234567")).not.toBe("");
  });
  it("rejects combos that total 10 digits (clash with Indian numbers)", () => {
    expect(validate("65", "91234567")).not.toBe("");
  });
  it("empty is an error", () => {
    expect(validate("91", "")).not.toBe("");
  });
});

describe("toWaNumber / toStoredPhone / displayPhone", () => {
  it("India -> 91 + 10 digits, intl as stored", () => {
    expect(toWaNumber("9876543210")).toBe("919876543210");
    expect(toWaNumber("+91 98765 43210")).toBe("919876543210");
    expect(toWaNumber("971501234567")).toBe("971501234567");
    expect(toWaNumber("")).toBe("");
  });
  it("toStoredPhone lenient check", () => {
    expect(toStoredPhone("98765 43210")).toBe("9876543210");
    expect(toStoredPhone("+971501234567")).toBe("971501234567");
    expect(toStoredPhone("5876543210")).toBe("");
    expect(toStoredPhone("12345")).toBe("");
    expect(toStoredPhone("")).toBe("");
  });
  it("displayPhone adds + only for international", () => {
    expect(displayPhone("9876543210")).toBe("9876543210");
    expect(displayPhone("971501234567")).toBe("+971501234567");
  });
});

describe("normalizeCardPhone international", () => {
  it("keeps explicit +cc numbers, still rejects junk", () => {
    expect(normalizeCardPhone("+971 50 123 4567")).toBe("971501234567");
    expect(normalizeCardPhone("+91 98100 12345")).toBe("9810012345");
    expect(normalizeCardPhone("1234567890")).toBe("");
    expect(normalizeCardPhone("50 123 4567")).toBe("");
  });
});
