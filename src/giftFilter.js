// Pure helpers for the Gift List screen (filters, tag edits, CSV) — no React, unit-tested.

export const DEFAULT_SENT_TAG = "Diwali 2026 Gift Sent";
export const DEFAULT_PICK_TAG = "Diwali 2026 Gift";

const text = (v) => String(v ?? "").trim();

/** House/street + 6-digit pincode + city are the minimum a courier needs. */
export function hasCompleteAddress(c) {
  return Boolean(text(c.address_house)) && /^\d{6}$/.test(text(c.address_pincode)) && Boolean(text(c.city));
}

export function addressLine(c) {
  return [c.address_house, c.address_locality, c.city, c.address_state, c.address_pincode]
    .map(text).filter(Boolean).join(", ");
}

/**
 * Filters that run in the browser after the server query (the server handles
 * include-tags, search, city, rating and client-only).
 * @param {object[]} list contacts
 * @param {{excludeTags?:string[], pincodePrefix?:string, address?:"any"|"complete"|"incomplete",
 *   gift?:"any"|"sent"|"unsent", sentTag?:string, hideDnd?:boolean}} f
 */
export function applyGiftFilters(list, f = {}) {
  const exclude = f.excludeTags || [];
  const prefix = text(f.pincodePrefix);
  const sentTag = f.sentTag || DEFAULT_SENT_TAG;
  return list.filter((c) => {
    const tags = c.tags || [];
    if (exclude.some((t) => tags.includes(t))) return false;
    if (prefix && !text(c.address_pincode).startsWith(prefix)) return false;
    if (f.address === "complete" && !hasCompleteAddress(c)) return false;
    if (f.address === "incomplete" && hasCompleteAddress(c)) return false;
    if (f.gift === "sent" && !tags.includes(sentTag)) return false;
    if (f.gift === "unsent" && tags.includes(sentTag)) return false;
    if (f.hideDnd && c.dnd) return false;
    return true;
  });
}

/** New tag array with `add` appended (no duplicates) and `remove` taken out. */
export function editTags(current, { add = [], remove = [] } = {}) {
  const gone = new Set(remove);
  return [...new Set([...(current || []), ...add])].filter((t) => !gone.has(t));
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function giftCsv(rows, sentTag = DEFAULT_SENT_TAG) {
  const header = ["Name", "Phone", "Address", "House/Street", "Area", "City", "State", "Pincode", "Address OK", "Gift sent", "Tags"];
  const lines = rows.map((c) => [
    c.name, c.phone, addressLine(c), c.address_house, c.address_locality, c.city, c.address_state, c.address_pincode,
    hasCompleteAddress(c) ? "yes" : "no", (c.tags || []).includes(sentTag) ? "yes" : "no", (c.tags || []).join("; "),
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
