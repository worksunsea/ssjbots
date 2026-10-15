// Day sheets: which gift goes to whom, carried by which employee, on a given day.
// Pure functions — unit-tested.

import { addressLine } from "./giftFilter";
import { routeCompare, escapeHtml } from "./giftZones";

export const STATUS_LABEL = { planned: "To deliver", delivered: "Delivered", not_home: "Not home", returned: "Returned", cancelled: "Cancelled" };
export const UNASSIGNED = "(not assigned)";

/** Local calendar date as YYYY-MM-DD (not UTC — a 6 pm run must not roll over to tomorrow). */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function tomorrowIso(from = new Date()) {
  const d = new Date(from); d.setDate(d.getDate() + 1); return isoDate(d);
}

/** Rows to insert for a schedule request, one per client; skips clients already booked unless told otherwise. */
export function buildDeliveryRows({ leads, date, employee, giftItem, tenantId, createdBy, perLeadItem = {}, alreadyBooked = new Set(), rebook = false }) {
  const rows = []; const skipped = [];
  leads.forEach((l) => {
    if (alreadyBooked.has(l.id) && !rebook) { skipped.push(l); return; }
    rows.push({
      tenant_id: tenantId, lead_id: l.id, planned_date: date, assigned_to: employee || null,
      gift_item: (perLeadItem[l.id] ?? giftItem ?? "").trim() || null, status: "planned", created_by: createdBy || null,
    });
  });
  return { rows, skipped };
}

/** Deliveries -> [{ employee, stops[] }] with stops in route order; unassigned last. */
export function groupByEmployee(deliveries) {
  const by = new Map();
  deliveries.forEach((d) => {
    const key = d.assigned_to || UNASSIGNED;
    by.set(key, [...(by.get(key) || []), d]);
  });
  return [...by.entries()]
    .map(([employee, stops]) => ({ employee, stops: [...stops].sort((a, b) => routeCompare(a.lead || {}, b.lead || {})) }))
    .sort((a, b) => (a.employee === UNASSIGNED) - (b.employee === UNASSIGNED) || a.employee.localeCompare(b.employee));
}

/** "Silver coin ×12, Sweets ×3" — what the employee has to pack. */
export function giftTotals(stops) {
  const counts = new Map();
  stops.forEach((s) => { const k = (s.gift_item || "Gift (not specified)").trim(); counts.set(k, (counts.get(k) || 0) + 1); });
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(", ");
}

export function buildDaySheetHtml(groups, { date, title = "Gift delivery sheet" } = {}) {
  const day = date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }) : "";
  const pages = groups.map((g) => {
    const rows = g.stops.map((s, i) => {
      const l = s.lead || {};
      return `<tr>
        <td class="n">${i + 1}</td>
        <td><b>${escapeHtml(l.name || "—")}</b><br><span class="ph">${escapeHtml(l.phone)}</span></td>
        <td>${escapeHtml(addressLine(l))}</td>
        <td><b>${escapeHtml(s.gift_item || "—")}</b>${s.notes ? `<br><i>${escapeHtml(s.notes)}</i>` : ""}</td>
        <td class="box">&#9744;</td><td class="rem"></td></tr>`;
    }).join("");
    return `<section>
      <h2>${escapeHtml(g.employee)} <small>${escapeHtml(day)} &middot; ${g.stops.length} stops</small></h2>
      <div class="pack"><b>Pack:</b> ${escapeHtml(giftTotals(g.stops))}</div>
      <div class="meta">Left at: ______ &nbsp; Back at: ______ &nbsp; Vehicle / fuel: ____________ &nbsp; Checked by: ____________</div>
      <table><thead><tr><th>#</th><th>Client</th><th>Address</th><th>Gift</th><th>Done</th><th>Remarks / signature</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
    section { page-break-after: always; } section:last-child { page-break-after: auto; }
    h2 { font-size: 16px; margin: 0 0 4px; } h2 small { font-weight: normal; color: #555; font-size: 12px; margin-left: 8px; }
    .pack { margin: 2px 0 4px; padding: 4px 6px; background: #f3f4f6; } .meta { margin: 4px 0 8px; color: #333; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #888; padding: 5px 6px; vertical-align: top; text-align: left; }
    th { background: #eee; } tr { page-break-inside: avoid; } .ph { color: #333; }
    .n { width: 26px; text-align: center; } .box { width: 38px; text-align: center; font-size: 18px; } .rem { width: 150px; }
  </style></head><body>${pages || "<p>Nothing is scheduled for this day.</p>"}</body></html>`;
}
