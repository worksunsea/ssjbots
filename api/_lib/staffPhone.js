// Official staff messages go to the OFFICE phone first (the company device),
// then the personal phone, then the legacy staff.phone as last resort.
// Loads employee_docs once so reminder loops don't N+1 the lookup.
export async function staffPhoneMap(sb, tenantId) {
  const { data } = await sb
    .from("employee_docs")
    .select("staff_id,staff_name,office_phone,personal_phone")
    .eq("tenant_id", tenantId);

  const byId = new Map();
  const byName = new Map();
  for (const d of data || []) {
    const preferred = d.office_phone || d.personal_phone || null;
    if (!preferred) continue;
    if (d.staff_id != null) byId.set(String(d.staff_id), preferred);
    if (d.staff_name) byName.set(d.staff_name.trim().toLowerCase(), preferred);
  }

  return {
    // s: a staff row ({id?, name?, phone?}) — returns best phone or null
    forStaff(s) {
      if (!s) return null;
      return (
        (s.id != null && byId.get(String(s.id))) ||
        (s.name && byName.get(s.name.trim().toLowerCase())) ||
        s.phone ||
        null
      );
    },
  };
}
