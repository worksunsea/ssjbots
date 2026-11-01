// Creates an FMS IMS SKU (ims_jw_items) for every active corporate-gifting coin that has none,
// and links the product (corporate_gifting_products.ims_item_id / sku_code).
//
//   node scripts/coin-skus/create-coin-skus.mjs            dry run, prints the codes
//   node scripts/coin-skus/create-coin-skus.mjs --apply    writes to the database
//
// SKU codes:
//   - Shagun coins use Shagun's OWN product code. Supply them in scripts/coin-skus/shagun-skus.csv
//     (columns: name,sku). A Shagun coin with no code in the CSV is skipped, never invented.
//   - MMTC coins have no code on MMTC's public pages, so a readable one is generated from the name:
//     MMTC-<G|S>-<DESIGN>-<BAR|COIN>-<WEIGHT>, e.g. MMTC-G-LOTUS-BAR-1G.
// Stock starts at 0 and is NOT live (opening_as_of unset) until an opening count is entered in
// FMS -> IMS -> Coins, so the website keeps its current availability until then.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(here, "../../.env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_KEY"));
const TENANT = process.env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
const APPLY = process.argv.includes("--apply");

const STOP = new Set(["MMTC", "GOLD", "SILVER", "BAR", "COIN", "COLORED", "PURIST", "PUREST", "CASTED", "THE", "OF", "SET", "K", "24K", "22K", "G", "KG"]);

function weightToken(g) {
  const n = Number(g);
  if (!Number.isFinite(n) || n <= 0) return "NA";
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}KG`;
  return `${String(n).replace(".", "P")}G`;
}

function mmtcCode(p, taken) {
  const metal = p.category === "mmtc_gold" ? "G" : "S";
  const form = /\bbar\b/i.test(p.name) ? "BAR" : "COIN";
  const design = p.name.replace(/\(.*?\)/g, " ").replace(/[^A-Za-z ]/g, " ").toUpperCase().split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map((w) => w.slice(0, 7)).slice(0, 3).join("-") || "PLAIN";
  const base = `MMTC-${metal}-${design}-${form}-${weightToken(p.weight_grams)}`;
  let code = base; let i = 2;
  while (taken.has(code.toLowerCase())) code = `${base}-${i++}`;
  taken.add(code.toLowerCase());
  return code;
}

function readShagunCsv() {
  const f = path.join(here, "shagun-skus.csv");
  if (!fs.existsSync(f)) return new Map();
  const m = new Map();
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/).slice(1)) {
    const i = line.lastIndexOf(",");
    if (i < 1) continue;
    const name = line.slice(0, i).replace(/^"|"$/g, "").trim();
    const sku = line.slice(i + 1).trim();
    if (name && sku) m.set(name.toLowerCase(), sku);
  }
  return m;
}

const { data: products, error } = await sb.from("corporate_gifting_products")
  .select("id, category, name, weight_grams, image_url")
  .eq("tenant_id", TENANT).eq("active", true).is("ims_item_id", null)
  .in("category", ["mmtc_gold", "mmtc_silver", "shagun_coins"]).order("category").order("sort_order");
if (error) throw error;

const { data: existing } = await sb.from("ims_jw_items").select("sku_code").eq("tenant_id", TENANT);
const taken = new Set((existing || []).map((e) => e.sku_code.toLowerCase()));
const shagun = readShagunCsv();

const plan = [];
const skipped = [];
for (const p of products) {
  let sku;
  if (p.category === "shagun_coins") {
    sku = shagun.get(p.name.toLowerCase());
    if (!sku) { skipped.push(p.name); continue; }
    if (taken.has(sku.toLowerCase())) { skipped.push(`${p.name} (code ${sku} already used)`); continue; }
    taken.add(sku.toLowerCase());
  } else {
    sku = mmtcCode(p, taken);
  }
  plan.push({ p, sku });
}

console.log(`${plan.length} SKUs to create, ${skipped.length} Shagun coins skipped (no code supplied)`);
for (const { p, sku } of plan) console.log(`${sku.padEnd(40)} ${p.name}`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to write."); process.exit(0); }

let done = 0;
for (const { p, sku } of plan) {
  const supplier = p.category === "shagun_coins" ? "Shagun Coins" : "MMTC-PAMP";
  const gold = p.category !== "mmtc_silver" && !/silver/i.test(p.name);
  const purity = /22\s?k/i.test(p.name) ? "22K" : gold ? "24K" : "999";
  const { data: item, error: e1 } = await sb.from("ims_jw_items").insert({
    tenant_id: TENANT, sku_code: sku, item_name: p.name, category: "Coins & Bars",
    jewellery_type: p.category === "mmtc_gold" ? "MMTC Gold" : p.category === "mmtc_silver" ? "MMTC Silver" : "Shagun Coin",
    purity, net_wt: p.weight_grams, supplier_name: supplier, source: "bought", created_by: "coin-sku-script",
  }).select("id").single();
  if (e1) { console.error("FAIL", sku, e1.message); continue; }
  if (p.image_url) {
    await sb.from("ims_jw_item_images").insert({ tenant_id: TENANT, item_id: item.id, path: `external/${item.id}`, url: p.image_url, thumb_url: p.image_url, position: 0 });
  }
  const { error: e2 } = await sb.from("corporate_gifting_products").update({ sku_code: sku, ims_item_id: item.id }).eq("id", p.id);
  if (e2) console.error("LINK FAIL", sku, e2.message); else done++;
}
console.log(`Created and linked ${done}/${plan.length}`);
