// One-off clean-up of saved addresses in bullion_leads.
//   node tools/address-cleanup.mjs <outDir>            -> dry run: writes a report, changes nothing
//   node tools/address-cleanup.mjs <outDir> --apply    -> backs up the old values, then updates
// For every contact that has any address text it splits street / area / city / state /
// pincode, fills what the pincode tells us (city, state, delivery zone), and looks up a
// missing pincode from the area name. The original values are kept in
// extra_fields.address_cleanup.original so any row can be put back.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseAddress, normalizePincode } from "../api/_lib/addressParse.js";

const outDir = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!outDir) { console.error("usage: node tools/address-cleanup.mjs <outDir> [--apply]"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" };
const TENANT = env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
const FIELDS = ["address_house", "address_locality", "city", "address_state", "address_pincode"];

async function loadAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bullion_leads?tenant_id=eq.${TENANT}&deleted_at=is.null&select=id,name,phone,city,address_house,address_locality,address_state,address_pincode,address_country,address_zone,extra_fields&order=id&offset=${from}&limit=1000`, { headers: H });
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(JSON.stringify(page));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const hasAddress = (c) => FIELDS.some((k) => String(c[k] ?? "").trim());
const contacts = (await loadAll()).filter(hasAddress);
console.log(`${contacts.length} contacts have some address text`);

// make sure every pincode we may meet is in the postal dictionary
const pins = new Set();
contacts.forEach((c) => { const p = normalizePincode(c.address_pincode) || (`${c.address_house} ${c.address_locality}`.match(/(?<!\d)([1-9]\d{2})\s?(\d{3})(?!\d)/) || []).slice(1).join(""); if (/^[1-9]\d{5}$/.test(p)) pins.add(p); });
const pinFile = path.join(outDir, "pins.json");
fs.writeFileSync(pinFile, JSON.stringify([...pins]));
execFileSync("node", ["tools/build-postal-dict.mjs", pinFile], { stdio: "inherit" });
const postal = JSON.parse(fs.readFileSync("tools/data/postal.json", "utf8"));

const plan = contacts.map((c) => {
  const r = parseAddress(c, postal);
  const zoneChanged = r.zone && r.zone !== (c.address_zone || "");
  return { c, ...r, changed: Object.keys(r.fields).length > 0 || zoneChanged };
});
const changed = plan.filter((p) => p.changed);

const count = (f) => plan.filter(f).length;
console.log("\n=== dry-run summary ===");
console.log("contacts to update:", changed.length);
console.log("pincode newly set:", count((p) => p.fields.address_pincode && !normalizePincode(p.c.address_pincode)),
  "| of which from address text:", count((p) => p.sources.address_pincode === "found in address text"),
  "| from area name:", count((p) => /^area name/.test(p.sources.address_pincode || "")));
console.log("pincode tidied (e.g. 201301.0):", count((p) => p.fields.address_pincode && normalizePincode(p.c.address_pincode) === "" && String(p.c.address_pincode || "").trim() !== ""));
console.log("city newly set:", count((p) => p.fields.city && !String(p.c.city || "").trim()));
console.log("state newly set:", count((p) => p.fields.address_state && !String(p.c.address_state || "").trim()));
console.log("area newly set:", count((p) => p.fields.address_locality && !String(p.c.address_locality || "").trim()));
const zones = {}; plan.forEach((p) => { const z = p.zone || (p.flags.length ? "(unzoned)" : "(unzoned)"); zones[z] = (zones[z] || 0) + 1; });
console.log("zones:", Object.entries(zones).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" | "));
console.log("still no pincode:", count((p) => !(p.fields.address_pincode || normalizePincode(p.c.address_pincode))));

fs.writeFileSync(path.join(outDir, "address-report.json"), JSON.stringify(plan.map((p) => ({ id: p.c.id, name: p.c.name, before: Object.fromEntries(FIELDS.map((k) => [k, p.c[k]])), after: p.fields, zone: p.zone, sources: p.sources, flags: p.flags })), null, 1));

if (!APPLY) { console.log(`\nDry run only — report: ${path.join(outDir, "address-report.json")}`); process.exit(0); }

fs.writeFileSync(path.join(outDir, "address-backup.json"), JSON.stringify(changed.map((p) => ({ id: p.c.id, address_zone: p.c.address_zone ?? null, extra_fields: p.c.extra_fields ?? {}, ...Object.fromEntries(FIELDS.map((k) => [k, p.c[k] ?? null])) }))));
let done = 0; let failed = 0;
for (let i = 0; i < changed.length; i += 15) {
  await Promise.all(changed.slice(i, i + 15).map(async (p) => {
    const patch = { ...p.fields };
    if (p.zone) patch.address_zone = p.zone;
    patch.extra_fields = { ...(p.c.extra_fields || {}), address_cleanup: { at: new Date().toISOString(), original: Object.fromEntries(FIELDS.map((k) => [k, p.c[k] ?? null])), sources: p.sources, flags: p.flags } };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bullion_leads?id=eq.${p.c.id}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
    if (res.ok) done += 1; else { failed += 1; console.error("failed", p.c.id, res.status); }
  }));
}
console.log(`\nApplied: ${done} updated, ${failed} failed. Backup: ${path.join(outDir, "address-backup.json")}`);
