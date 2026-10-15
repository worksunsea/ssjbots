import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import GiftList from "../GiftList.jsx";

const rows = [
  { id: "1", name: "Asha", phone: "9810000001", city: "Delhi", tags: ["VIP"], address_house: "B-1", address_pincode: "110005" },
  { id: "2", name: "Bharat", phone: "9810000002", city: "Noida", tags: [], address_house: "", address_pincode: "" },
];

/** Minimal stand-in for the supabase query builder: chainable and awaitable. */
function fakeSb() {
  const updates = [];
  const builder = (table, result) => {
    const b = {
      select: () => b, eq: () => b, is: () => b, order: () => b, range: () => b, or: () => b,
      contains: () => b, overlaps: () => b, ilike: () => b, gte: () => b, insert: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      update: (patch) => ({ eq: (_c, id) => { updates.push({ id, patch }); return Promise.resolve({ error: null }); } }),
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
    return b;
  };
  return {
    updates,
    from: (table) => builder(table, table === "bullion_tags"
      ? { data: [{ name: "VIP", category: "segment", color: "#eee" }], error: null }
      : { data: rows, error: null }),
  };
}

describe("GiftList", () => {
  beforeEach(() => { localStorage.clear(); });

  it("lists contacts and flags the one with an incomplete address", async () => {
    render(React.createElement(GiftList, { sb: fakeSb(), tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    expect(screen.getByText("Bharat")).toBeTruthy();
    expect(screen.getByText(/1 with full address/)).toBeTruthy();
  });

  it("removes a tag from one contact right on the page", async () => {
    const sb = fakeSb();
    render(React.createElement(GiftList, { sb, tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    fireEvent.click(screen.getByText("VIP ×"));
    await waitFor(() => expect(sb.updates).toEqual([{ id: "1", patch: { tags: [] } }]));
  });

  it("prints an area-wise sheet with only complete addresses", async () => {
    const written = [];
    vi.spyOn(window, "open").mockReturnValue({ document: { open() {}, write: (h) => written.push(h), close() {} }, focus() {}, print() {} });
    render(React.createElement(GiftList, { sb: fakeSb(), tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    fireEvent.click(screen.getByText("🖨 Print by area"));
    fireEvent.click(await screen.findByText(/^Print 1 stops$/));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain("Asha");
    expect(written[0]).not.toContain("Bharat");
    expect(written[0]).toContain("Central / Old Delhi");
  });

  it("marks several selected contacts as sent in one go", async () => {
    const sb = fakeSb();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(GiftList, { sb, tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    const header = screen.getAllByRole("checkbox")[2]; // after "Clients only" and "Hide DND"
    fireEvent.click(header);
    fireEvent.click(await screen.findByText("🎁 Mark sent"));
    await waitFor(() => expect(sb.updates).toHaveLength(2));
    expect(sb.updates.every((u) => u.patch.tags.includes("Diwali 2026 Gift Sent"))).toBe(true);
    expect(within(document.body).getAllByText("🎁 Sent").length).toBe(2);
  });
});
