// Pure contact-field logic — no React, no Supabase, no side effects.
// Imported by App.jsx and by unit tests.

export const FIXED_CONTACT_FIELDS = [
  { key: "name",                 label: "Name",                      fixed: true },
  { key: "phone",                label: "Phone",                     fixed: true, required: true },
  { key: "mobile2",              label: "Phone 2",                   fixed: true },
  { key: "spouse_mobile",        label: "Phone 3 / Spouse",          fixed: true },
  { key: "salutation",           label: "Salutation",                fixed: true },
  { key: "city",                 label: "City",                      fixed: true },
  { key: "address_house",        label: "House / Flat No.",          fixed: true },
  { key: "address_locality",     label: "Locality / Society",        fixed: true },
  { key: "address_state",        label: "State",                     fixed: true },
  { key: "address_pincode",      label: "PIN Code",                  fixed: true },
  { key: "address_country",      label: "Country",                   fixed: true },
  { key: "email",                label: "Email",                     fixed: true },
  { key: "profession",           label: "Profession",                fixed: true },
  { key: "industry",             label: "Industry",                  fixed: true },
  { key: "company",              label: "Company / Firm",            fixed: true },
  { key: "client_code",          label: "Client Code / Ref",         fixed: true },
  { key: "bday",                 label: "Birthday (YYYY-MM-DD)",     fixed: true },
  { key: "anniversary",          label: "Anniversary (YYYY-MM-DD)",  fixed: true },
  { key: "spouse_name",          label: "Spouse Name",               fixed: true },
  { key: "spouse_dob",           label: "Spouse Birthday (YYYY-MM-DD)", fixed: true },
  { key: "wedding_date",         label: "Wedding Date (YYYY-MM-DD)", fixed: true },
  { key: "wedding_family_member",label: "Wedding (family member)",   fixed: true },
  { key: "client_rating",        label: "VIP Score",                 fixed: true },
  { key: "source",               label: "Source",                    fixed: true },
];

// Keys with custom render logic (not plain text inputs).
export const SPECIAL_RENDER_KEYS = new Set(["client_rating", "source"]);

// Fields that map to top-level DB columns (not extra_fields JSONB).
export const FIXED_DB_KEYS = new Set(FIXED_CONTACT_FIELDS.map(f => f.key));

/**
 * Merge fixed + custom fields respecting saved field order.
 * New fields not yet in saved order are appended at the end.
 */
export const getAllFieldsOrdered = (customFields, fieldOrder) => {
  const all = [...FIXED_CONTACT_FIELDS, ...customFields.map(f => ({ ...f, fixed: false }))];
  if (!fieldOrder) return all;
  const map = Object.fromEntries(all.map(f => [f.key, f]));
  const ordered = fieldOrder.map(k => map[k]).filter(Boolean);
  all.forEach(f => { if (!fieldOrder.includes(f.key)) ordered.push(f); });
  return ordered;
};

/**
 * Strip non-digits, leading zeros, and 91 country prefix from a phone string.
 * Used to normalise before saving to DB.
 */
export const normalizePhone = (p) =>
  String(p || "").replace(/:\d+$/, "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91/, "");

/**
 * Parse a loose date string (DD/MM/YYYY, YYYY-MM-DD, etc.) into YYYY-MM-DD.
 * Returns null on failure.
 */
export const parseDateJS = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (m1) {
    let [, d, mo, y] = m1;
    if (y.length === 2) y = parseInt(y) > 30 ? "19" + y : "20" + y;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  return null;
};

/**
 * Build the contact save payload from form state.
 * Keeps field list in sync with FIXED_CONTACT_FIELDS automatically.
 */
export const buildContactPayload = (tenantId, form) => ({
  tenant_id: tenantId,
  phone: normalizePhone(form.phone),
  name: form.name || null,
  mobile2: form.mobile2 || null,
  spouse_mobile: form.spouse_mobile || null,
  salutation: form.salutation || null,
  city: form.city || null,
  address_house: form.address_house || null,
  address_locality: form.address_locality || null,
  address_state: form.address_state || null,
  address_pincode: form.address_pincode || null,
  address_country: form.address_country || null,
  email: form.email || null,
  profession: form.profession || null,
  industry: form.industry || null,
  company: form.company || null,
  client_code: form.client_code || null,
  bday: form.bday || null,
  anniversary: form.anniversary || null,
  spouse_name: form.spouse_name || null,
  spouse_dob: form.spouse_dob || null,
  wedding_date: form.wedding_date || null,
  wedding_family_member: form.wedding_family_member || null,
  client_rating: form.client_rating ? Number(form.client_rating) : null,
  is_client: form.is_client,
  source: form.source || null,
  tags: form.tags,
  partner_lead_id: form.partner_lead_id || null,
  extra_fields: form.extra_fields || {},
});

/**
 * Build initial form state from a contact object.
 * Keeps field list in sync with FIXED_CONTACT_FIELDS automatically.
 */
export const buildContactFormState = (contact) => ({
  name: contact.name || "",
  phone: contact.phone || "",
  mobile2: contact.mobile2 || "",
  spouse_mobile: contact.spouse_mobile || "",
  salutation: contact.salutation || "",
  city: contact.city || "",
  address_house: contact.address_house || "",
  address_locality: contact.address_locality || "",
  address_state: contact.address_state || "",
  address_pincode: contact.address_pincode || "",
  address_country: contact.address_country || "India",
  email: contact.email || "",
  profession: contact.profession || "",
  industry: contact.industry || "",
  company: contact.company || "",
  client_code: contact.client_code || "",
  bday: contact.bday || "",
  anniversary: contact.anniversary || "",
  spouse_name: contact.spouse_name || "",
  spouse_dob: contact.spouse_dob || "",
  wedding_date: contact.wedding_date || "",
  wedding_family_member: contact.wedding_family_member || "",
  client_rating: contact.client_rating || "",
  is_client: contact.is_client || false,
  source: contact.source || "",
  tags: Array.isArray(contact.tags) ? contact.tags : [],
  partner_lead_id: contact.partner_lead_id || null,
  extra_fields: contact.extra_fields || {},
});
