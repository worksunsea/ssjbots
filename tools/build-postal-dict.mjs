// Builds tools/data/postal.json from India Post's public pincode directory:
//   { "110005": { district, state, offices: ["Karol Bagh", ...] }, ... }
// Used by the address clean-up to turn a pincode into city/state/delivery zone,
// and a locality name into a pincode. Re-run to refresh or to add more pincodes.
// Usage: node tools/build-postal-dict.mjs [extra pincodes file (json array)]
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("tools/data/postal.json");
const API = "https://api.postalpincode.in/pincode/";
const DELAY_MS = 250;

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const wanted = new Set();
for (let p = 110001; p <= 110099; p += 1) wanted.add(String(p));
if (process.argv[2]) JSON.parse(fs.readFileSync(process.argv[2], "utf8")).forEach((p) => /^[1-9]\d{5}$/.test(p) && wanted.add(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function lookup(pin) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(API + pin, { signal: AbortSignal.timeout(20000) });
      const [body] = await res.json();
      if (body.Status === "Success" && body.PostOffice?.length) {
        const offices = body.PostOffice;
        return { district: offices[0].District, state: offices[0].State, offices: [...new Set(offices.map((o) => o.Name))] };
      }
      return { district: null, state: null, offices: [] }; // pincode genuinely unknown
    } catch { await sleep(1500 * (attempt + 1)); }
  }
  return undefined; // network trouble — leave it out so a re-run retries
}

let fetched = 0;
for (const pin of wanted) {
  if (existing[pin]) continue;
  const info = await lookup(pin);
  if (info) { existing[pin] = info; fetched += 1; }
  await sleep(DELAY_MS);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(existing));
console.log(`postal.json: ${Object.keys(existing).length} pincodes (${fetched} fetched this run)`);
