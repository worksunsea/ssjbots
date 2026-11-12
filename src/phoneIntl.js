// International phone support for contacts (bullion_leads.phone / mobile2 / spouse_mobile).
//
// STORAGE RULE (keeps every existing row + unique-phone matching unchanged):
//   India          -> plain 10 digits, e.g. 9876543210            (as always)
//   International  -> full digits incl. country code, NO plus, e.g. 971501234567
// A stored value of exactly 10 digits is therefore always Indian. Because of that,
// an international number whose cc+national is exactly 10 digits (e.g. Singapore
// +65 + 8 digits) is rejected by validate() - it would be indistinguishable from an
// Indian mobile.

export const DEFAULT_CC = "91";

// Common codes shown in the dropdown. "" = Other (user types the code).
export const COUNTRY_CODES = [
  { cc: "91", label: "India +91" },
  { cc: "971", label: "UAE +971" },
  { cc: "1", label: "USA/Canada +1" },
  { cc: "44", label: "UK +44" },
  { cc: "65", label: "Singapore +65" },
  { cc: "61", label: "Australia +61" },
  { cc: "966", label: "Saudi +966" },
  { cc: "974", label: "Qatar +974" },
  { cc: "968", label: "Oman +968" },
  { cc: "973", label: "Bahrain +973" },
  { cc: "965", label: "Kuwait +965" },
  { cc: "977", label: "Nepal +977" },
  { cc: "94", label: "Sri Lanka +94" },
  { cc: "880", label: "Bangladesh +880" },
  { cc: "49", label: "Germany +49" },
  { cc: "33", label: "France +33" },
  { cc: "", label: "Other" },
];

const KNOWN = COUNTRY_CODES.map((c) => c.cc).filter(Boolean).sort((a, b) => b.length - a.length);

const digitsOf = (v) => String(v == null ? "" : v).replace(/\D/g, "");

/**
 * Normalise any phone spelling to the stored form.
 * Indian inputs (10 digits, 0-prefixed, +91/91/0091 prefixed) -> 10 digits (unchanged behaviour).
 * Anything else (international) keeps its country code.
 * Also strips a WhatsApp JID device suffix (":19").
 */
export function normalizePhone(p) {
  let d = String(p == null ? "" : p).replace(/:\d+$/, "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.startsWith("91")) {
    if (d.length === 12) return d.slice(2);
    // "+91 0 98765 43210" -> 91 + trunk 0 + 10 digits
    if (d.length === 13 && d[2] === "0") return d.slice(3);
  }
  return d;
}

/** stored -> { cc, national }. 10 digits / 91+10 => India. Known prefix => that cc. Unknown => cc "" (Other). */
export function split(stored) {
  const d = normalizePhone(stored);
  if (!d) return { cc: DEFAULT_CC, national: "" };
  if (d.length <= 10) return { cc: DEFAULT_CC, national: d };
  const cc = KNOWN.find((k) => d.startsWith(k) && d.length > k.length);
  if (cc) return { cc, national: d.slice(cc.length) };
  return { cc: "", national: d };
}

/** (cc, national) -> stored string. Indian => 10 digits. Does not validate. */
export function join(cc, national) {
  const c = digitsOf(cc).replace(/^0+/, "");
  let n = digitsOf(national).replace(/^0+/, "");
  if (!c || c === DEFAULT_CC) {
    // Tolerate a pasted +91 / 91 prefix on Indian input
    if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
    return n;
  }
  return c + n;
}

/** Returns "" when valid, else a human error message. */
export function validate(cc, national) {
  const c = digitsOf(cc).replace(/^0+/, "");
  let n = digitsOf(national).replace(/^0+/, "");
  if (!n) return "Enter a phone number.";
  if (c === DEFAULT_CC) {
    if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
    return /^[6-9]\d{9}$/.test(n) ? "" : "Indian mobile must be exactly 10 digits starting with 6-9.";
  }
  if (!c) return "Enter the country code.";
  if (c.length > 3) return "Country code looks wrong (1-3 digits).";
  if (n.length < 6 || n.length > 14) return "International number must be 6-14 digits (without country code).";
  const total = c.length + n.length;
  if (total > 15) return "Number is too long (max 15 digits including country code).";
  if (total === 10) return "This country-code + number combination is 10 digits total, which clashes with Indian numbers. Ask admin to add it.";
  return "";
}

/** Stored value -> digits for https://wa.me/<digits> (India => 91 + 10 digits). */
export function toWaNumber(stored) {
  const d = normalizePhone(stored);
  if (!d) return "";
  return d.length === 10 ? "91" + d : d;
}

/** Human display: "9876543210" stays as is, international gets a "+". */
export function displayPhone(stored) {
  const d = normalizePhone(stored);
  return d.length > 10 ? "+" + d : d;
}

/**
 * Lenient save-time check used by the forms: returns the stored value
 * (10 Indian digits, or 11-15 digit international) or "" when unusable.
 * The PhoneField itself does the precise cc+national validation while typing.
 */
export function toStoredPhone(raw) {
  const d = normalizePhone(raw);
  if (d.length === 10) return /^[6-9]/.test(d) ? d : "";
  if (d.length >= 11 && d.length <= 15) return d;
  return "";
}
