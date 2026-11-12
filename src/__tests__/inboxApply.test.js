import { describe, it, expect } from "vitest";
import { buildLeadWrite, personProblems, inboxCounts } from "../inboxApply.js";

describe("buildLeadWrite", () => {
  const existing = { id: "a", tags: ["VIP"], extra_fields: { gift: "Old", company_name: "X" } };
  it("update keeps existing data, ignores blanks, merges tags and extra", () => {
    const w = buildLeadWrite({ fields: { name: "Sudhir Kumar Arora", email: "", city: "New Delhi" }, extra: { gift: "5 Elements Basket", misc: "" }, tags: ["Diwali 2026 Gift"] }, existing, "T");
    expect(w.action).toBe("update");
    expect(w.row).toEqual({ name: "Sudhir Kumar Arora", city: "New Delhi", tags: ["VIP", "Diwali 2026 Gift"], extra_fields: { gift: "5 Elements Basket", company_name: "X" } });
  });
  it("insert sets tenant, status, funnel", () => {
    const w = buildLeadWrite({ fields: { name: "A", phone: "9810000000" }, tags: ["Diwali 2026 Gift"] }, null, "T");
    expect(w.row).toMatchObject({ tenant_id: "T", status: "new", funnel_id: "bullion", tags: ["Diwali 2026 Gift"] });
  });
});

describe("personProblems", () => {
  it("new contact needs phone and name; bad pincode flagged; skipped is fine", () => {
    expect(personProblems({ fields: { name: "A" } }, null)).toContain("New contact needs a phone number.");
    expect(personProblems({ fields: { name: "A", phone: "9810000000", address_pincode: "1100" } }, null)).toContain("Pincode should be 6 digits.");
    expect(personProblems({ skip: true, fields: {} }, null)).toEqual([]);
    expect(personProblems({ fields: { phone: "9810000000" } }, { id: "x" })).toEqual([]);
  });
});

describe("inboxCounts", () => {
  it("counts by status", () => {
    expect(inboxCounts([{ status: "new" }, { status: "proposed" }, { status: "proposed" }])).toEqual({ new: 1, proposed: 2, final: 0, rejected: 0 });
  });
});
