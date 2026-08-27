// Official staff messages (daily reminders, warnings, anything from the
// system) go to staff.phone — the "WhatsApp / Login Phone" field in ssj-hr's
// staff profile (App.jsx labels it exactly that; it's also what they log
// into the HR app with). employee_docs office/personal phone is only a
// fallback for staff with no login phone on file yet.
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
    forStaff(s) {
      if (!s) return null;
      if (s.phone) return s.phone;
      const d = (s.id != null && byId.get(String(s.id))) || (s.name && byName.get(s.name.trim().toLowerCase()));
      return (d && (d.office_phone || d.personal_phone)) || null;
    },
  };
}
