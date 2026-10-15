// Area-wise delivery lists: group contacts into zones by pincode, order them so
// neighbouring pincodes/localities sit together, split into trips, and render a
// printable sheet. Pure functions — unit-tested.

import { addressLine } from "./giftFilter";

export const UNZONED = "Other / not in a zone";

/**
 * Starter zones (editable on the Gifts screen and saved for everyone). Pincodes
 * listed here are the ones that are certain; anything not listed shows up under
 * "Other / not in a zone" so it can be assigned instead of silently misplaced.
 */
export const DEFAULT_ZONES = [
  { name: "North Delhi", pincodes: ["110007", "110009", "110033", "110052", "110054", "110084", "110085", "110086", "110088"] },
  { name: "Central / Old Delhi", pincodes: ["110001", "110002", "110005", "110006", "110055"] },
  { name: "West Delhi", pincodes: ["110008", "110015", "110018", "110026", "110027", "110041", "110058", "110063", "110064"] },
  { name: "South Delhi", pincodes: ["110016", "110017", "110019", "110024", "110029", "110048", "110049", "110067", "110070"] },
  { name: "East Delhi / Shahdara", pincodes: ["110031", "110032", "110051", "110053", "110090", "110091", "110092", "110093", "110094"] },
];

const pin = (c) => String(c.address_pincode ?? "").trim();
const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Parses "110007, 110009 110033" -> ["110007","110009","110033"] (6-digit only, unique). */
export function parsePincodes(text) {
  return [...new Set(String(text ?? "").match(/\b\d{6}\b/g) || [])];
}

export function zoneForPincode(zones, pincode) {
  const p = String(pincode ?? "").trim();
  return zones.find((z) => z.pincodes.includes(p))?.name || UNZONED;
}

/** Neighbouring pincodes first, then locality, then name — a sensible walking/driving order. */
export function routeCompare(a, b) {
  return pin(a).localeCompare(pin(b))
    || norm(a.address_locality).localeCompare(norm(b.address_locality))
    || norm(a.address_house).localeCompare(norm(b.address_house), undefined, { numeric: true })
    || norm(a.name).localeCompare(norm(b.name));
}

/** @returns {{zone:string, rows:object[]}[]} in zone-config order, "other" last, empty zones dropped. */
export function groupByZone(rows, zones) {
  const buckets = new Map([...zones.map((z) => [z.name, []]), [UNZONED, []]]);
  rows.forEach((c) => buckets.get(zoneForPincode(zones, pin(c))).push(c));
  return [...buckets.entries()]
    .map(([zone, list]) => ({ zone, rows: list.sort(routeCompare) }))
    .filter((g) => g.rows.length);
}

/** Splits one zone's ordered rows into trips of at most `size` stops. */
export function buildTrips(groups, size) {
  const n = Math.max(1, Math.floor(size) || 25);
  return groups.flatMap(({ zone, rows }) => {
    const count = Math.ceil(rows.length / n);
    return Array.from({ length: count }, (_, i) => ({ zone, trip: i + 1, trips: count, rows: rows.slice(i * n, (i + 1) * n) }));
  });
}

export const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/** Self-contained printable HTML (one page break per trip). */
export function buildRoutePrintHtml(trips, { title = "Gift delivery list", date = new Date() } = {}) {
  const day = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const pages = trips.map((t) => {
    const lines = t.rows.map((c, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td><b>${escapeHtml(c.name || "—")}</b></td>
      <td class="nw">${escapeHtml(c.phone)}</td>
      <td>${escapeHtml(addressLine(c))}</td>
      <td class="box">&#9744;</td>
      <td class="rem"></td></tr>`).join("");
    return `<section>
      <h2>${escapeHtml(t.zone)} &mdash; Trip ${t.trip} of ${t.trips} <small>${t.rows.length} stops &middot; ${escapeHtml(day)}</small></h2>
      <div class="meta">Delivered by: ____________________ &nbsp;&nbsp; Vehicle: ____________ &nbsp;&nbsp; Start: ______ &nbsp; End: ______</div>
      <table><thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Address</th><th>Done</th><th>Remarks / signature</th></tr></thead><tbody>${lines}</tbody></table>
    </section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
    section { page-break-after: always; }
    section:last-child { page-break-after: auto; }
    h2 { font-size: 16px; margin: 0 0 4px; } h2 small { font-weight: normal; color: #555; font-size: 12px; margin-left: 8px; }
    .meta { margin: 4px 0 8px; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #888; padding: 5px 6px; vertical-align: top; text-align: left; }
    th { background: #eee; } tr { page-break-inside: avoid; }
    .n { width: 26px; text-align: center; } .nw { white-space: nowrap; } .box { width: 38px; text-align: center; font-size: 18px; } .rem { width: 160px; }
  </style></head><body>${pages || "<p>No contacts to print.</p>"}</body></html>`;
}
