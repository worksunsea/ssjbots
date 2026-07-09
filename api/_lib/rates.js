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
//   - Row right after the silver coin table, marked "" === "ESTIMATED" →
//     retail silver ₹/g (in `gold`) — THIS is the correct customer-facing
//     silver rate. See "SILVER RATE SOURCE" note below before touching it.
//   - "Silver Rate" header → a DIFFERENT, raw wholesale/MCX-linked ₹/kg
//     spot value in `gold` — parsed as silverSpotWholesalePerGram but not
//     used for quotes (see note below).
//   - "Gifting Coins" → small gifts: name, weight, price
//
// Business rules (owner):
//   - Gold-price enquiries → 24KT 995 per gram
//   - Gold-coin enquiries → MMTC 9999 column
//   - Silver-coin enquiries → MMTC column of silver block
//   - GST 3% already included in all coin prices
//
// ── SILVER RATE SOURCE (read before adding any new silver feature) ──────────
// The sheet has TWO silver ₹/g-shaped numbers and they are NOT interchangeable:
//   1. The "ESTIMATED"-marked row (`spot.silverPerGram`) — the shop's actual
//      retail selling rate (~₹249-250/g as of 2026-07-04). USE THIS for any
//      customer-facing silver price: bot quotes, calculator, estimates, PDFs.
//   2. The row under the "Silver Rate" header (`spot.silverSpotWholesalePerGram`)
//      — raw MCX/wholesale spot, no retail markup (~₹237/g same day, i.e.
//      noticeably lower). Do NOT quote this to customers.
// Both purities (999 fine and 92.5 sterling) bill at the SAME ₹/g — store
// policy is no purity discount on silver, unlike gold. Do not add a `mult`/
// discount for 92.5 unless the owner explicitly changes that policy again.
// This mix-up already caused one real bug (src/App.jsx's calculator briefly
// quoted the wholesale rate) — if you're parsing rates in a new module,
// grep this file's history or SSJ_STABLE_FEATURES.md §21 first.

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
    spot: { gold24kt: null, gold22kt: null, gold18kt: null, gold14kt: null, gold9kt: null, silverPerGram: null, silverSpotWholesalePerGram: null },
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
    if (label === "9 KT" && isNum(est)) { out.spot.gold9kt = est; continue; }

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

    // ── Retail silver ₹/g — a row marked "ESTIMATED" in the 3rd column, sitting
    // right after the silver coin table. THIS is the shop's actual retail rate
    // for both 999 and 92.5 silver (store bills 92.5 at the same ₹/g as 999 —
    // no purity discount). Must be checked before the silver-coin-row rule
    // below, or this value gets misread as a coin weight.
    // See SSJ_STABLE_FEATURES.md "SILVER RATE SOURCE" note before touching this.
    if (mmtc === "ESTIMATED" && isNum(labelRaw)) {
      out.spot.silverPerGram = labelRaw;
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

    // ── Silver spot (raw MCX/wholesale ₹/kg under "Silver Rate" header) ──
    // NOT used for retail pricing — see the "ESTIMATED" rule above instead.
    // Kept parsed here only in case a future feature needs the wholesale
    // reference rate; do not wire this into customer-facing quotes.
    if (section === "silver_spot" && isNum(labelRaw) && labelRaw > 10000) {
      out.spot.silverSpotWholesalePerGram = Math.round(labelRaw / 1000 * 100) / 100;
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

// Render an AI-prompt-friendly block with the live rates.
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
    lines.push("Gold coins — prices are PER COIN (not per gram). GST 3% included.");
    lines.push("**Quote the MMTC 9999 column for coin enquiries. Always say 'per coin', never 'per gram'.**");
    lines.push("  Weight │  Sun Sea 995 (per coin)  │  MMTC 9999 (per coin, preferred)");
    for (const c of parsed.goldCoins) {
      lines.push(`   ${String(c.weight_g).padStart(4, " ")}g coin │  ${fmt(c.sunSea995).padStart(12, " ")}  │  ${fmt(c.mmtc9999)}`);
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
    lines.push("Silver coins — prices are PER COIN (not per gram). GST 3% included.");
    lines.push("**Quote the MMTC column for silver coin enquiries. Always say 'per coin', never 'per gram'.**");
    lines.push("  Weight │   Sun Sea (per coin)   │   MMTC (per coin, preferred)");
    for (const c of parsed.silverCoins) {
      lines.push(`   ${String(c.weight_g).padStart(4, " ")}g coin │  ${fmt(c.sunSea).padStart(10, " ")}  │  ${fmt(c.mmtc)}`);
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
