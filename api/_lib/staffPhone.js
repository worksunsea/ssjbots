// Official staff messages go to the OFFICE phone first (the company device),
// then the personal phone, then the legacy staff.phone as last resort.
// Pass {preferPersonal: true} for after-hours nudges (e.g. the 7:30pm
// completion reminder) where the office phone likely isn't being checked.
// Loads employee_docs once so reminder loops don't N+1 the lookup.
export async function staffPhoneMap(sb, tenantId) {
  const { data } = await sb
    .from("employee_docs")
    .select("staff_id,staff_name,office_phone,personal_phone")
    .eq("tenant_id", tenantId);

  const byId = new Map();
  const byName = new Map();
  for (const d of data || []) {
    if (d.staff_id != null) byId.set(String(d.staff_id), d);
    if (d.staff_name) byName.set(d.staff_name.trim().toLowerCase(), d);
  }

  return {
    // s: a staff row ({id?, name?, phone?}) — returns best phone or null
    forStaff(s, { preferPersonal = false } = {}) {
      if (!s) return null;
      const d = (s.id != null && byId.get(String(s.id))) || (s.name && byName.get(s.name.trim().toLowerCase()));
      const fromDocs = d && (preferPersonal ? (d.personal_phone || d.office_phone) : (d.office_phone || d.personal_phone));
      return fromDocs || s.phone || null;
    },
  };
}
