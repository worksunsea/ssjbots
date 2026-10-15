// Area-wise delivery lists: group contacts into zones by pincode, order them so
// neighbouring pincodes/localities sit together, split into trips, and render a
// printable sheet. Pure functions — unit-tested.

import { addressLine } from "./giftFilter";

export const UNZONED = "Other / not in a zone";

/**
 * Area labels. Every contact's `address_zone` is filled from its pincode by tools/address-cleanup.mjs,
 * so these entries only matter as a fallback: add pincodes to an area here (Edit areas on the Gifts
 * screen) for contacts that have a pincode but no stored zone. Anything else shows under "Other".
 */
export const DEFAULT_ZONES = [
  { name: "North Delhi", pincodes: [] },
  { name: "Central Delhi", pincodes: [] },
  { name: "West Delhi", pincodes: [] },
  { name: "South Delhi", pincodes: [] },
  { name: "East Delhi", pincodes: [] },
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
  const buckets = new Map(zones.map((z) => [z.name, []]));
  // The stored zone (set by the address clean-up from the pincode) wins; the pincode lists are the fallback.
  rows.forEach((c) => {
    const zone = String(c.address_zone ?? "").trim() || zoneForPincode(zones, pin(c));
    if (!buckets.has(zone)) buckets.set(zone, []);
    buckets.get(zone).push(c);
  });
  const unzoned = buckets.get(UNZONED);
  buckets.delete(UNZONED);
  if (unzoned) buckets.set(UNZONED, unzoned);
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
