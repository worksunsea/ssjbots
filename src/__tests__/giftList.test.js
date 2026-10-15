import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import GiftList from "../GiftList.jsx";

const rows = [
  { id: "1", name: "Asha", phone: "9810000001", city: "Delhi", tags: ["VIP"], address_house: "B-1", address_pincode: "110005", address_zone: "Central Delhi" },
  { id: "2", name: "Bharat", phone: "9810000002", city: "Noida", tags: [], address_house: "", address_pincode: "" },
];

/** Minimal stand-in for the supabase query builder: chainable and awaitable. */
function fakeSb() {
  const updates = [];
  const inserts = [];
  const builder = (table, result) => {
    const b = {
      select: () => b, eq: () => b, is: () => b, order: () => b, range: () => b, or: () => b,
      contains: () => b, overlaps: () => b, ilike: () => b, gte: () => b, in: () => b, neq: () => b, limit: () => b,
      insert: (rows) => { inserts.push({ table, rows }); return Promise.resolve({ error: null }); },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      update: (patch) => ({ eq: (_c, id) => { updates.push({ id, patch }); return Promise.resolve({ error: null }); } }),
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
    return b;
  };
  return {
    updates, inserts,
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
    expect(written[0]).toContain("Central Delhi");
  });

  it("edits a client address on the page and works out the zone from the pincode", async () => {
    const sb = fakeSb();
    render(React.createElement(GiftList, { sb, tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    fireEvent.click(screen.getAllByText("✎ Edit address")[0]);
    fireEvent.change(screen.getByLabelText("Pincode"), { target: { value: "110009" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(sb.updates).toHaveLength(1));
    expect(sb.updates[0].patch).toMatchObject({ address_pincode: "110009", city: "New Delhi", address_zone: "North Delhi" });
  });

  it("refuses a pincode that is not 6 digits", async () => {
    const sb = fakeSb();
    render(React.createElement(GiftList, { sb, tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    fireEvent.click(screen.getAllByText("✎ Edit address")[0]);
    fireEvent.change(screen.getByLabelText("Pincode"), { target: { value: "1100" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Pincode must be 6 digits.")).toBeTruthy();
    expect(sb.updates).toHaveLength(0);
  });

  it("schedules the ticked clients for a day with an employee and gift", async () => {
    const sb = fakeSb();
    render(React.createElement(GiftList, { sb, tenantId: "t1" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    fireEvent.click(await screen.findByText("📅 Schedule delivery"));
    fireEvent.change(await screen.findByPlaceholderText(/Silver coin/), { target: { value: "Silver coin 10 g" } });
    fireEvent.click(await screen.findByText(/^Schedule 2$/));
    await waitFor(() => expect(sb.inserts.some((i) => i.table === "gift_deliveries")).toBe(true));
    const rows = sb.inserts.find((i) => i.table === "gift_deliveries").rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.gift_item === "Silver coin 10 g" && r.status === "planned")).toBe(true);
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
