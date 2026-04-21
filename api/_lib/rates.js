// Pull live rates from the Apps Script proxy (Google Sheet "new" tab), parse
// them into a structured shape the bot can reason over, and format a clean
// prompt snippet.
//
// Sheet shape (Saurav's `new` tab, 3 columns: gold | estimated | ""):
//   - Spot per-gram rates (24KT 995 / 22 KT / 18KT / 14KT) in `estimated`
//   - "Sun Sea Jewellers" header → next block is coin table
//       weight (in `gold`), Sun Sea 995 (in `estimated`), MMTC 9999 (in "")
//   - "Ginni 916 22kt" → 4g / 8g prices in `estimated`
//   - Second "Sun Sea Jewellers" → silver coin block (same shape, pure silver)
//   - "Silver Rate" → silver spot (price per kg in `gold`, gold MCX in `estimated`)
//   - "Gifting Coins" → small gifts: name, weight, price
//
// Business rules (owner):
//   - Gold-price enquiries → 24KT 995 per gram
//   - Gold-coin enquiries → MMTC 9999 column
//   - Silver-coin enquiries → MMTC column of silver block
//   - GST 3% already included in all coin prices

import { APPS_SCRIPT_URL } from "./config.js";

let cache = { ts: 0, data: null, parsed: null };
const TTL_MS = 60_000;

export async function getRates() {
  const now = Date.now();
  if (cache.parsed && now - cache.ts < TTL_MS) return cache.parsed;
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=rates`, { redirect: "follow" });
    const data = await res.json();
    const rows = data?.rates || data?.rows || [];
    if (rows.length) {
      const parsed = parseRates(rows);
      cache = { ts: now, data: rows, parsed };
      return parsed;
    }
  } catch {
    /* swallow — bot will continue without rates */
  }
  return cache.parsed || emptyParsed();
}

function emptyParsed() {
  return {
    spot: { gold24kt: null, gold22kt: null, gold18kt: null, gold14kt: null, silverPerGram: null },
    goldCoins: [],
    silverCoins: [],
    ginni916: [],
    giftingCoins: [],
    fetchedAt: new Date().toISOString(),
  };
}

function isNum(v) {
  return typeof v === "number" && !Number.isNaN(v);
}

export function parseRates(rows) {
  const out = emptyParsed();

  // Section detector — transitions on specific header rows.
  let section = "spot"; // spot | gold_coins | ginni | silver_coins | silver_spot | gifting

  for (const row of rows) {
    const labelRaw = row.gold;
    const label = typeof labelRaw === "string" ? labelRaw.trim() : labelRaw;
    const est = row.estimated;
    const mmtc = row[""];

    // ── Section headers ──
    if (label === "995 Coins" && typeof mmtc === "string" && mmtc.includes("9999")) {
      section = "gold_coins"; continue;
    }
    if (label === "Ginni 916 22kt") { section = "ginni"; continue; }
    if (label === "Silver Coins Wt") { section = "silver_coins"; continue; }
    if (label === "Silver Rate") { section = "silver_spot"; continue; }
    if (label === "Gifting Coins") { section = "gifting"; continue; }
    // Skip column-header / separator rows
    if (label === "Sun Sea Jewellers") continue;
    if (label === "Gold Wt") continue;
    if (label === "Full White") continue;
    if (label === "Old Gold Buyback") continue;
    if (typeof label === "string" && label.startsWith("Prices are estimates")) continue;

    // ── Spot per-gram gold rates (section=spot) ──
    if (label === "24KT 995" && isNum(est)) { out.spot.gold24kt = est; continue; }
    if (label === "22 KT" && isNum(est)) { out.spot.gold22kt = est; continue; }
    if (label === "18KT" && isNum(est)) { out.spot.gold18kt = est; continue; }
    if (label === "14KT" && isNum(est)) { out.spot.gold14kt = est; continue; }

    // ── Gold coin rows (numeric weight in `gold`) ──
    if (section === "gold_coins" && isNum(labelRaw)) {
      out.goldCoins.push({
        weight_g: labelRaw,
        sunSea995: isNum(est) ? est : null,
        mmtc9999: isNum(mmtc) ? mmtc : null,
      });
      continue;
    }

    // ── Ginni 916 22kt coins (4g, 8g — price in `estimated`) ──
    if (section === "ginni" && isNum(labelRaw) && isNum(est)) {
      out.ginni916.push({ weight_g: labelRaw, price: est });
      continue;
    }

    // ── Silver coin rows ──
    if (section === "silver_coins" && isNum(labelRaw)) {
      out.silverCoins.push({
        weight_g: labelRaw,
        sunSea: isNum(est) ? est : null,
        mmtc: isNum(mmtc) ? mmtc : null,
      });
      continue;
    }

    // ── Silver spot — "251115 | 153562" row (gold column = silver price per kg) ──
    if (section === "silver_spot" && isNum(labelRaw) && labelRaw > 10000) {
      // 251115 → ₹251.115/g
      out.spot.silverPerGram = Math.round(labelRaw / 1000 * 100) / 100;
      continue;
    }

    // ── Gifting coins (small sets) ──
    if (section === "gifting" && typeof label === "string" && label && isNum(est)) {
      out.giftingCoins.push({
        name: label,
        weight_g: est,
        price: isNum(mmtc) ? mmtc : null,
      });
      continue;
    }
  }

  return out;
}

// Render a Claude-friendly block with the live rates.
export function ratesForPrompt(parsed) {
  if (!parsed) return "(rates unavailable)";
  const s = parsed.spot;
  const fmt = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
  const lines = [];

  lines.push("LIVE RATES (cached 60s):");
  lines.push("");
  lines.push("Spot per-gram (raw bullion — quote these for \"gold rate\" / \"bhav\" questions):");
  lines.push(`  24KT 995: ${fmt(s.gold24kt)}/g   ← default answer for \"gold price\"`);
  lines.push(`  22KT:     ${fmt(s.gold22kt)}/g`);
  lines.push(`  18KT:     ${fmt(s.gold18kt)}/g`);
  lines.push(`  14KT:     ${fmt(s.gold14kt)}/g`);
  lines.push(`  Silver:   ${fmt(s.silverPerGram)}/g   (approx, per gram)`);
  lines.push("");

  if (parsed.goldCoins.length) {
    lines.push("Gold coins — GST 3% included. **Quote the MMTC 9999 column for coin enquiries.**");
    lines.push("  Weight │  Sun Sea 995  │  MMTC 9999 (preferred)");
    for (const c of parsed.goldCoins) {
      lines.push(`   ${String(c.weight_g).padStart(4, " ")}g │  ${fmt(c.sunSea995).padStart(12, " ")}  │  ${fmt(c.mmtc9999)}`);
    }
    lines.push("");
  }

  if (parsed.ginni916.length) {
    lines.push("Ginni 916 (22kt) coins:");
    for (const g of parsed.ginni916) {
      lines.push(`  ${g.weight_g}g — ${fmt(g.price)}`);
    }
    lines.push("");
  }

  if (parsed.silverCoins.length) {
    lines.push("Silver coins — GST 3% included. **Quote the MMTC column for silver coin enquiries.**");
    lines.push("  Weight │   Sun Sea   │   MMTC (preferred)");
    for (const c of parsed.silverCoins) {
      lines.push(`   ${String(c.weight_g).padStart(4, " ")}g │  ${fmt(c.sunSea).padStart(10, " ")}  │  ${fmt(c.mmtc)}`);
    }
    lines.push("");
  }

  if (parsed.giftingCoins.length) {
    lines.push("Gifting coins (low-ticket, great for impulse/gift buyers):");
    for (const g of parsed.giftingCoins) {
      lines.push(`  ${g.name} — ${g.weight_g}g — ${fmt(g.price)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Back-compat shim for older call sites.
export function ratesSnippet(parsed) {
  return ratesForPrompt(parsed);
}
