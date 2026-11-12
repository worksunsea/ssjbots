// Pure helpers for the Document Inbox review screen — no React, unit-tested.
// A "person" is what the Claude routine proposes for one name on an uploaded form:
//   { match_id|null, match_label, fields:{...bullion_leads columns}, extra:{...extra_fields keys},
//     tags:[...], questions:[...], skip:boolean }

export const FIELD_DEFS = [
  ["name", "Name"], ["phone", "Phone"], ["mobile2", "Phone 2"], ["email", "Email"],
  ["bday", "Birthday"], ["anniversary", "Anniversary"], ["profession", "Profession"],
  ["spouse_name", "Spouse name"], ["spouse_mobile", "Spouse phone"], ["spouse_dob", "Spouse birthday"],
  ["address_house", "House / street"], ["address_locality", "Area / colony"], ["city", "City"],
  ["address_state", "State"], ["address_pincode", "Pincode"],
];
export const EXTRA_DEFS = [["reference", "Reference"], ["misc", "Misc"], ["old_address", "Old address"], ["gift", "Gift"], ["gift_received", "Gift received"]];

const text = (v) => String(v ?? "").trim();
const filled = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, text(v)]).filter(([, v]) => v !== ""));

/** What to write to bullion_leads for one reviewed person. Blank form fields never erase existing data. */
export function buildLeadWrite(person, existing, tenantId) {
  const fields = filled(person.fields);
  const extra = filled(person.extra);
  const tags = [...new Set([...(existing?.tags || []), ...(person.tags || [])])];
  if (existing) {
    return { action: "update", id: existing.id, row: { ...fields, tags, extra_fields: { ...(existing.extra_fields || {}), ...extra } } };
  }
  return { action: "insert", row: { ...fields, tags, extra_fields: extra, tenant_id: tenantId, status: "new", funnel_id: "bullion" } };
}

/** Problems that must be fixed before a person can be saved. */
export function personProblems(person, existing) {
  if (person.skip) return [];
  const out = [];
  const f = filled(person.fields);
  if (!existing && !f.phone) out.push("New contact needs a phone number.");
  // 10 digits for India; international numbers (with country code) may be 6-15 digits.
  if (f.phone && !/^\d{6,15}$/.test(f.phone.replace(/\D/g, ""))) out.push("Phone should be 6-15 digits (10 for India).");
  if (f.address_pincode && !/^\d{6}$/.test(f.address_pincode)) out.push("Pincode should be 6 digits.");
  if (!existing && !f.name) out.push("Name is missing.");
  return out;
}

/** Counts shown on the inbox tab badge. */
export function inboxCounts(items) {
  const c = { new: 0, proposed: 0, final: 0, rejected: 0 };
  (items || []).forEach((i) => { if (c[i.status] !== undefined) c[i.status] += 1; });
  return c;
}
