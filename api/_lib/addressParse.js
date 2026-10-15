// Splits a contact's free-text address into proper fields (street, area, city,
// state, pincode), fills what can be worked out from the pincode, and labels the
// delivery zone. Pure and conservative: it never invents a street, only moves
// text that is clearly a pincode/city/state into its own field, and every guess
// carries its source so staff can review it. `postal` = tools/data/postal.json
// ({ pincode: { district, state, offices[] } }).

const CITIES = [
  { re: /\bgreater\s+noida\b|\bgr\.?\s+noida\b/i, city: "Greater Noida", state: "Uttar Pradesh" },
  { re: /\bnoida\b/i, city: "Noida", state: "Uttar Pradesh" },
  { re: /\bgurgaon\b|\bgurugram\b/i, city: "Gurgaon", state: "Haryana" },
  { re: /\bghaziabad\b|\bgzb\b/i, city: "Ghaziabad", state: "Uttar Pradesh" },
  { re: /\bfaridabad\b/i, city: "Faridabad", state: "Haryana" },
  { re: /\bsonipat\b|\bsonepat\b/i, city: "Sonipat", state: "Haryana" },
  { re: /\bbahadurgarh\b/i, city: "Bahadurgarh", state: "Haryana" },
  { re: /\bjaipur\b/i, city: "Jaipur", state: "Rajasthan" },
  { re: /\bmumbai\b/i, city: "Mumbai", state: "Maharashtra" },
  { re: /\bchandigarh\b/i, city: "Chandigarh", state: "Chandigarh" },
  { re: /\bludhiana\b/i, city: "Ludhiana", state: "Punjab" },
  { re: /\bamritsar\b/i, city: "Amritsar", state: "Punjab" },
  { re: /\blucknow\b/i, city: "Lucknow", state: "Uttar Pradesh" },
  { re: /\bdehradun\b/i, city: "Dehradun", state: "Uttarakhand" },
  { re: /\bkolkata\b/i, city: "Kolkata", state: "West Bengal" },
  { re: /\bbangalore\b|\bbengaluru\b/i, city: "Bengaluru", state: "Karnataka" },
  { re: /\bhyderabad\b/i, city: "Hyderabad", state: "Telangana" },
  { re: /\bpune\b/i, city: "Pune", state: "Maharashtra" },
  // Delhi last: "Noida, Delhi NCR" must resolve to Noida.
  { re: /\bnew\s*delhi\b|\bdelhi\b|\bn\.?\s?delhi\b/i, city: "New Delhi", state: "Delhi" },
];

const STATE_WORDS = /\b(uttar\s+pradesh|u\.?\s?p\.?|haryana|delhi|rajasthan|punjab)\b/i;

/** Areas with no post office of their own: pincode is the one used for that whole area (lower confidence). */
export const AREA_ALIASES = {
  "mukherjee nagar": "110009", "kamla nagar": "110007", "pitampura": "110034", "lajpat nagar": "110024",
  "greater kailash": "110048", "defence colony": "110024", "vasant vihar": "110057", "saket": "110017",
  "hauz khas": "110016", "green park": "110016", "rajouri garden": "110027", "punjabi bagh": "110026",
  "paschim vihar": "110063", "preet vihar": "110092", "laxmi nagar": "110092", "mayur vihar": "110091",
  "shahdara": "110032", "karol bagh": "110005", "rajendra nagar": "110060", "patel nagar": "110008",
  "model town": "110009", "civil lines": "110054", "connaught place": "110001", "chandni chowk": "110006",
  "daryaganj": "110002", "nehru place": "110019", "kalkaji": "110019", "chittaranjan park": "110019",
  "malviya nagar": "110017", "vasant kunj": "110070", "dilshad garden": "110095", "vivek vihar": "110095",
  "shalimar bagh": "110088", "ashok vihar": "110052", "tilak nagar": "110018", "uttam nagar": "110059",
  "vikaspuri": "110018", "moti nagar": "110015", "kirti nagar": "110015", "sarojini nagar": "110023",
};

const DELHI_ZONE_BY_DISTRICT = {
  "north delhi": "North Delhi", "north west delhi": "North Delhi",
  "north east delhi": "East Delhi", "east delhi": "East Delhi", "shahdara": "East Delhi",
  "central delhi": "Central Delhi", "new delhi": "Central Delhi",
  "south delhi": "South Delhi", "south east delhi": "South Delhi",
  "west delhi": "West Delhi", "south west delhi": "West Delhi",
};

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const tidy = (s) => clean(s).replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, "").replace(/\s*,\s*(,\s*)+/g, ", ");
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** "201301.0" -> "201301"; junk like "DELHI-5" -> "". */
export function normalizePincode(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^([1-9]\d{5})(?:\.0+)?$/);
  if (m) return m[1];
  const short = s.match(/^delhi\s*-?\s*(\d{1,2})$/i); // old postal style: "Delhi-5" = 110005
  return short && Number(short[1]) > 0 ? `1100${short[1].padStart(2, "0")}` : "";
}

const PIN_IN_TEXT = /(?<![\d])([1-9]\d{2})\s?(\d{3})(?![\d])/;

function findPin(parts) {
  for (const p of parts) {
    const m = p.match(PIN_IN_TEXT);
    if (m) return { pin: m[1] + m[2], token: m[0] };
  }
  return null;
}

export function detectCity(text) {
  for (const c of CITIES) if (c.re.test(text)) return c;
  return null;
}

/** Delivery zone from the city and (for Delhi) the postal district. */
export function zoneFor(city, district) {
  const key = String(district ?? "").trim().toLowerCase();
  if (DELHI_ZONE_BY_DISTRICT[key]) return DELHI_ZONE_BY_DISTRICT[key];
  const c = detectCity(clean(city));
  if (c && c.city === "New Delhi") return "";           // Delhi but district unknown: needs a pincode first
  return c ? c.city : "";
}

function stripTokens(part, tokens) {
  let out = part;
  for (const t of tokens) out = out.replace(t, " ");
  return tidy(out.replace(/\b(india)\b/i, " "));
}

/**
 * @param {object} c contact row
 * @param {Record<string,{district:string|null,state:string|null,offices:string[]}>} postal
 * @returns {{ fields: Record<string,string>, zone: string, sources: Record<string,string>, flags: string[] }}
 *   `fields` holds only values that differ from what is stored.
 */
export function parseAddress(c, postal = {}) {
  const flags = [];
  const sources = {};
  let house = clean(c.address_house);
  let locality = clean(c.address_locality);
  if (house && locality && same(house, locality)) locality = "";

  // pincode: stored value first, then anywhere in the text
  let pin = normalizePincode(c.address_pincode);
  const tokens = [];
  const found = findPin([house, locality, clean(c.address_pincode)]);
  if (found) { tokens.push(new RegExp(`[-\\s,]*${found.token.replace(/\s/g, "\\s?")}\\b`)); if (!pin) { pin = found.pin; sources.address_pincode = "found in address text"; } }

  // city / state: stored value, else from the text
  const storedCity = clean(c.city);
  let cityInfo = storedCity ? detectCity(storedCity) : null;
  let city = cityInfo ? cityInfo.city : storedCity;
  let state = clean(c.address_state);
  const international = storedCity && !cityInfo && !/^(india)?$/i.test(storedCity) && clean(c.address_country) && !/india/i.test(c.address_country);
  if (!city) {
    const hit = [house, locality].map(detectCity).find(Boolean);
    if (hit) { cityInfo = hit; city = hit.city; sources.city = "found in address text"; }
  }
  if (cityInfo) {
    tokens.push(new RegExp(cityInfo.re.source, "ig"));
    if (!state) { state = cityInfo.state; sources.address_state = "from city"; }
  }
  const info = pin ? postal[pin] : null;
  if (info?.state && !state) { state = info.state; sources.address_state = "from pincode"; }
  if (!city && info?.district && DELHI_ZONE_BY_DISTRICT[info.district.toLowerCase()]) { city = "New Delhi"; sources.city = "from pincode"; }
  if (state && STATE_WORDS.test(state)) tokens.push(new RegExp(`\\b${state.replace(/\./g, "\\.")}\\b`, "ig"));
  if (/^uttar pradesh$/i.test(state)) tokens.push(/[,\s]+u\.?\s?p\.?(?=[\s,.]*$)/ig); // trailing "U.P"

  // street/area text with the pincode, city and state words taken out
  const newHouse = stripTokens(house, tokens);
  let newLocality = stripTokens(locality, tokens);
  if (same(newHouse, newLocality)) newLocality = "";

  // area: a post-office name for this pincode found in the text
  const textForArea = `${newHouse} ${newLocality}`.toLowerCase();
  if (!newLocality && info?.offices?.length) {
    const office = [...info.offices].sort((a, b) => b.length - a.length)
      .find((o) => o.length >= 5 && textForArea.includes(o.toLowerCase().replace(/\s*\(.*\)$/, "")));
    if (office) { newLocality = office.replace(/\s*\(.*\)$/, ""); sources.address_locality = "post office name in text"; }
  }

  // pincode missing: look the area up
  if (!pin && (!city || cityInfo?.city === "New Delhi") && !international) {
    const area = Object.keys(AREA_ALIASES).sort((a, b) => b.length - a.length).find((k) => textForArea.includes(k));
    if (area) {
      pin = AREA_ALIASES[area]; sources.address_pincode = `area name "${titleCase(area)}"`;
      if (!newLocality) { newLocality = titleCase(area); sources.address_locality = "area name in text"; }
    }
  }
  const finalInfo = pin ? postal[pin] : null;
  if (finalInfo?.state && !state) { state = finalInfo.state; sources.address_state = "from pincode"; }
  if (!city && finalInfo?.district && DELHI_ZONE_BY_DISTRICT[finalInfo.district.toLowerCase()]) { city = "New Delhi"; sources.city = "from pincode"; }

  const next = { address_house: newHouse, address_locality: newLocality, city, address_state: state, address_pincode: pin };
  const fields = {};
  for (const [k, v] of Object.entries(next)) if (clean(v) !== clean(c[k])) fields[k] = v;
  if (international) flags.push("outside India — pincode/zone not applied");
  if (!pin && !international && (house || locality)) flags.push("no pincode could be worked out");
  if (!city && (house || locality)) flags.push("city unknown");

  const zone = international ? "" : zoneFor(city, finalInfo?.district);
  return { fields, zone, sources, flags };
}
