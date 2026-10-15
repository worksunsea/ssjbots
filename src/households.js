// Household suggestions: people who live at the same address (or are linked as
// spouses) but have their own phone numbers. Pure functions — unit-tested.
// Staff confirm every link; nothing is linked automatically.

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const last10 = (v) => digits(v).slice(-10);
const text = (v) => String(v ?? "").trim();

/** Same street text + same pincode => same key. Needs a house number so "Delhi" can't match everyone. */
export function addressKey(c) {
  const pin = text(c.address_pincode);
  const street = text(c.address_house).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!/^\d{6}$/.test(pin) || street.length < 5 || !/\d/.test(street)) return "";
  return `${pin}|${street}`;
}

class Groups {
  constructor() { this.parent = new Map(); this.reasons = new Map(); }
  find(x) { while (this.parent.get(x) !== x) { this.parent.set(x, this.parent.get(this.parent.get(x))); x = this.parent.get(x); } return x; }
  add(x) { if (!this.parent.has(x)) this.parent.set(x, x); }
  union(a, b, reason) {
    this.add(a); this.add(b);
    const ra = this.find(a); const rb = this.find(b);
    const merged = new Set([...(this.reasons.get(ra) || []), ...(this.reasons.get(rb) || []), reason]);
    if (ra !== rb) this.parent.set(rb, ra);
    this.reasons.set(this.find(a), merged);
  }
}

/**
 * @param {object[]} contacts rows with id, name, phone, mobile2, spouse_mobile, partner_lead_id, household_id, address_house, address_pincode
 * @param {{maxSize?:number}} opts groups bigger than maxSize are dropped as suspicious (shared office address, etc.)
 * @returns {{ ids:string[], reasons:string[], existingHouseholdId:string|null }[]}
 */
export function suggestHouseholds(contacts, { maxSize = 8 } = {}) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const g = new Groups();

  const byAddress = new Map();
  const byPhone = new Map();
  contacts.forEach((c) => {
    const k = addressKey(c);
    if (k) byAddress.set(k, [...(byAddress.get(k) || []), c.id]);
    [c.phone, c.mobile2].forEach((p) => { if (last10(p).length === 10) byPhone.set(last10(p), [...(byPhone.get(last10(p)) || []), c.id]); });
  });

  byAddress.forEach((ids) => ids.slice(1).forEach((id) => g.union(ids[0], id, "same address")));
  contacts.forEach((c) => {
    if (c.partner_lead_id && byId.has(c.partner_lead_id)) g.union(c.id, c.partner_lead_id, "linked as spouses");
    const sp = last10(c.spouse_mobile);
    if (sp.length === 10) (byPhone.get(sp) || []).filter((id) => id !== c.id).forEach((id) => g.union(c.id, id, "spouse's number"));
  });

  const clusters = new Map();
  [...g.parent.keys()].forEach((id) => { const r = g.find(id); clusters.set(r, [...(clusters.get(r) || []), id]); });

  return [...clusters.entries()]
    .map(([root, ids]) => {
      const existing = [...new Set(ids.map((id) => byId.get(id).household_id).filter(Boolean))];
      return { ids, reasons: [...(g.reasons.get(root) || [])], existingHouseholdId: existing.length === 1 ? existing[0] : null, allLinked: existing.length === 1 && ids.every((id) => byId.get(id).household_id) };
    })
    .filter((x) => x.ids.length >= 2 && x.ids.length <= maxSize && !x.allLinked)
    .map(({ allLinked, ...rest }) => rest)
    .sort((a, b) => b.ids.length - a.ids.length);
}

/** One delivery stop per household: members share a stop, names and phones are joined. */
export function collapseHouseholds(rows) {
  const stops = [];
  const byHousehold = new Map();
  rows.forEach((c) => {
    if (!c.household_id) { stops.push({ ...c, members: [c] }); return; }
    const existing = byHousehold.get(c.household_id);
    if (existing) { existing.members.push(c); return; }
    const stop = { ...c, members: [c] };
    byHousehold.set(c.household_id, stop);
    stops.push(stop);
  });
  return stops.map((s) => (s.members.length < 2 ? s : {
    ...s,
    name: s.members.map((m) => m.name || "—").join(" / "),
    phone: s.members.map((m) => m.phone).filter(Boolean).join(", "),
    // keep the most complete address of the group
    ...pickBestAddress(s.members),
  }));
}

const ADDRESS_KEYS = ["address_house", "address_locality", "city", "address_state", "address_pincode"];
const completeness = (c) => ADDRESS_KEYS.filter((k) => text(c[k])).length;

/** The member whose address has the most parts filled in. */
export function pickBestAddress(members) {
  const best = [...members].sort((a, b) => completeness(b) - completeness(a))[0];
  return Object.fromEntries(ADDRESS_KEYS.map((k) => [k, best[k]]));
}
