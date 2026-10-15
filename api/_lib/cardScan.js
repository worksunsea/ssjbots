// Cleans up what the AI read from a handwritten Client Details Card so the
// values match what the CRM stores (same formats as the /profile web form).
// Pure functions — no I/O — so they are unit-tested.

const RELATIONS = ["spouse", "son", "daughter", "mother", "father", "brother", "sister", "other"];
const RELATION_ALIASES = {
  wife: "spouse", husband: "spouse", partner: "spouse", mom: "mother", mum: "mother", mummy: "mother",
  dad: "father", papa: "father", "mother in law": "other", "father in law": "other",
  child: "other", kid: "other", daughterinlaw: "other", soninlaw: "other",
};

/** "25/04/1985" -> "1985-04-25"; "25-04" -> "25-04"; unreadable -> "". */
export function normalizeCardDate(raw) {
  const parts = String(raw ?? "").match(/\d+/g);
  if (!parts || parts.length < 2 || parts.length > 3) return "";
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return "";
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  if (parts.length === 2) return `${dd}-${mm}`;
  let year = Number(parts[2]);
  if (parts[2].length <= 2) year += year >= 30 ? 1900 : 2000;
  if (year < 1900 || year > 2100) return `${dd}-${mm}`;
  return `${year}-${mm}-${dd}`;
}

/** Any Indian mobile spelling -> 10 digits, or "". */
export function normalizeCardPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}

export function normalizeRelation(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (RELATIONS.includes(key)) return key;
  return RELATION_ALIASES[key] || (key ? "other" : "");
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * @param {any} parsed JSON returned by the AI
 * @returns {{ fields: Record<string,string>, family: Array<{relationship:string,name:string,dob:string,mobile:string}>,
 *   referrals: Array<{name:string,phone:string}>, warnings: string[] }}
 */
export function sanitizeCardFields(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const warnings = [];

  const email = clean(p.email, 200).toLowerCase();
  const pincode = clean(p.address_pincode, 10).replace(/\D/g, "");
  const phone = normalizeCardPhone(p.phone);
  if (!phone) warnings.push("Mobile number not readable — type it in before saving.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push("Email looks wrong — check it.");
  if (pincode && pincode.length !== 6) warnings.push("Pincode should be 6 digits — check it.");

  const bday = normalizeCardDate(p.bday);
  const anniversary = normalizeCardDate(p.anniversary);
  if (clean(p.bday, 30) && !bday) warnings.push("Birthday not readable.");
  if (clean(p.anniversary, 30) && !anniversary) warnings.push("Anniversary not readable.");

  const fields = {
    name: clean(p.name, 100),
    phone,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    bday,
    anniversary,
    address_house: clean(p.address_house, 300),
    address_locality: clean(p.address_locality, 200),
    city: clean(p.city, 100),
    address_state: clean(p.address_state, 100),
    address_pincode: pincode.length === 6 ? pincode : "",
  };

  const family = (Array.isArray(p.family) ? p.family : [])
    .map((m) => ({
      relationship: normalizeRelation(m?.relationship) || "other",
      name: clean(m?.name, 100),
      dob: normalizeCardDate(m?.dob),
      mobile: normalizeCardPhone(m?.mobile),
    }))
    .filter((m) => m.name || m.dob || m.mobile)
    .slice(0, 12);
  family.forEach((m, i) => { if (!m.name) warnings.push(`Family row ${i + 1} has no name.`); });

  const referrals = (Array.isArray(p.referrals) ? p.referrals : [])
    .map((r) => ({ name: clean(r?.name, 100), phone: normalizeCardPhone(r?.phone) }))
    .filter((r) => r.phone)
    .slice(0, 5);

  return { fields, family, referrals, warnings };
}
