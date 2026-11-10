import { describe, it, expect } from "vitest";
import { allColumns, buildTable, toCsv, toPrintHtml, addressOf, PRESETS } from "../contactExport.js";

const cols = allColumns([{ key: "gift", label: "Gift" }, { key: "gift_received", label: "Gift Received" }]);
const people = [
  { id: 1, name: "Ediza Jiménez", phone: "9810000001", address_house: "B-42", city: "New Delhi", address_pincode: "110005", extra_fields: { gift: "Free Gift" }, tags: ["A", "B"] },
  { id: 2, name: 'Say "Hi", Ltd', phone: "9810000002", extra_fields: { gift: "5 Elements Basket", gift_received: "Yes" } },
];

describe("addressOf", () => {
  it("joins only the parts that exist", () => {
    expect(addressOf(people[0])).toBe("B-42, New Delhi, 110005");
    expect(addressOf({})).toBe("");
  });
});

describe("buildTable", () => {
  it("keeps only chosen columns, in the offered order, with custom fields", () => {
    const t = buildTable(people, cols, ["cf_gift", "name"]);
    expect(t.header).toEqual(["Name", "Gift"]);
    expect(t.rows).toEqual([["Ediza Jiménez", "Free Gift"], ['Say "Hi", Ltd', "5 Elements Basket"]]);
  });
  it("adds blank Done / Signature columns on request", () => {
    const t = buildTable(people, cols, ["name"], { tick: true, sign: true });
    expect(t.header).toEqual(["Name", "Done", "Signature"]);
    expect(t.rows[0]).toEqual(["Ediza Jiménez", "", ""]);
  });
  it("gift-list preset resolves to real columns", () => {
    const keys = PRESETS.find((p) => p.label === "Gift list").keys;
    expect(buildTable(people, cols, keys).header).toEqual(["Name", "Phone", "Address", "Gift", "Gift Received"]);
  });
});

describe("toCsv", () => {
  it("starts with a BOM and escapes quotes and commas", () => {
    const csv = toCsv({ header: ["Name"], rows: [['Say "Hi", Ltd']] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Say ""Hi"", Ltd"');
  });
});

describe("toPrintHtml", () => {
  it("escapes client text so a name cannot inject HTML", () => {
    const html = toPrintHtml("T", { header: ["Name"], rows: [["<script>x</script>"]] });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
