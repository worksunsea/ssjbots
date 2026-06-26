import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

// Must match App.jsx rapLookup() weight bracket keys
const WEIGHT_RANGES = [
  "0.30","0.40","0.50","0.70","0.90",
  "1.00","1.50","2.00","3.00","4.00","5.00","10.00",
];

// Returns { date, tables } where tables matches RAP_SEED in App.jsx:
//   tables["0.30"] = [ [IF_D..IF_N], [VVS1_D..VVS1_N], ... ]  (10 rows × 11 cols)
//
// PDF structure (.30ct+ sections):
//   Header:  "RAPAPORT : (.30 - .39 CT.) : ROUNDS RAPAPORT : (.40 - .49 CT.) :"
//   Data:    10 rows per bracket (colors D→M), each row has 11 integers
//   PDF col: IF VVS1 VVS2 VS1 VS2 SI1 SI2 [SI3-skip] I1 I2 I3  (col 7 = SI3, skipped)
//   Row 0 = D color, row 1 = E, ..., row 9 = M (NO letter labels on data rows)
//   All bracket sections appear in ascending size order within the text.
//   Transposition needed: PDF rows=colors, PDF cols=clarities → storage rows=clarities cols=colors
const parseRapTable = (text) => {
  if (!text) return null;

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Date from filename-style pattern first (most reliable for Rapaport)
  const dateMatch = text.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  const date = dateMatch
    ? `${dateMatch[1].padStart(2,"0")}/${dateMatch[2].padStart(2,"0")}/${dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3]}`
    : null;

  // Normalise lower-bound string from header regex to a WEIGHT_RANGES key
  const normToKey = (raw) => {
    // raw examples: "30" → 0.30, "1.00" → 1.00, "50" → 0.50
    const num = raw.includes('.') ? parseFloat(raw) : parseFloat(raw) / 100;
    for (const w of WEIGHT_RANGES) {
      if (Math.abs(parseFloat(w) - num) < 0.005) return w;
    }
    return null;
  };

  // Collect bracket keys from all "RAPAPORT : (.XX - .XX CT.) :" header lines
  const bracketSet = new Set();
  const HDR_RE = /\(\s*\.?(\d+\.?\d*)\s*[-–—]\s*\.?\d+\.?\d*\s*[Cc][Tt]\.?\s*\)/g;
  for (const line of lines) {
    if (!/RAPAPORT/i.test(line)) continue;
    HDR_RE.lastIndex = 0;
    let m;
    while ((m = HDR_RE.exec(line)) !== null) {
      const key = normToKey(m[1]);
      if (key) bracketSet.add(key);
    }
  }
  const sortedBrackets = Array.from(bracketSet).sort((a, b) => parseFloat(a) - parseFloat(b));
  console.log("RAP brackets detected:", sortedBrackets);

  // Expand merged digit tokens produced by some PDF encoders.
  // Example: tokens ["13","12","987","6","4"] with targetCount=11 would become
  // ["13","12","9","8","7","6","4"] (11 tokens) because deficit=2, "987".length===3.
  // Only expands ONE token, only when deficit>=2, only 3+ digit tokens.
  const expandMerged = (tokens, targetCount) => {
    if (tokens.length >= targetCount) return tokens.slice(0, targetCount).map(Number);
    const deficit = targetCount - tokens.length;
    if (deficit < 2) return tokens.map(Number);
    const result = [];
    let expanded = false;
    for (const t of tokens) {
      if (!expanded && /^\d{3,}$/.test(t) && t.length === deficit + 1) {
        result.push(...t.split('').map(Number));
        expanded = true;
      } else {
        result.push(parseFloat(t));
      }
    }
    return result.slice(0, targetCount);
  };

  // Try to parse a line as one data row of 11 integers.
  // Returns null for header lines, letter-only lines, decimal (small stone) lines, etc.
  const tryParseDataRow = (line) => {
    if (/RAPAPORT|ROUNDS/i.test(line)) return null;
    if (/^[A-N]$/.test(line)) return null;       // single colour letter
    if (/^[A-N]-[A-N]$/.test(line)) return null; // grouped header "D-F"
    if (/[a-z]{3,}/i.test(line)) return null;    // line contains words

    // Strip colour letter that may be attached to or separated from first/last number
    let s = line;
    s = s.replace(/^[D-N](?=\d)/, ''); // "D39..." → "39..."
    s = s.replace(/^[D-N]\s+/, '');    // "D 39 ..." → "39 ..."
    s = s.replace(/\s+[D-N]$/, '');    // "... 39 D" → "... 39"

    const tokens = s.trim().split(/[\s\t,]+/).filter(t => /^\d+\.?\d*$/.test(t));
    if (tokens.length < 8) return null;
    if (tokens.some(t => t.includes('.'))) return null; // decimal = small-stone row, skip

    const nums = expandMerged(tokens, 11);
    if (nums.length < 8) return null;
    return nums.slice(0, 11);
  };

  // Collect every valid data row in document order
  const allDataRows = [];
  for (const line of lines) {
    const row = tryParseDataRow(line);
    if (row) allDataRows.push(row);
  }
  console.log(`RAP rows collected=${allDataRows.length}, expected≈${sortedBrackets.length * 10}`);

  if (allDataRows.length < 10) {
    console.log("RAP: too few data rows found");
    return { date, tables: {} };
  }

  // Chunk into groups of 10 and match to brackets in ascending order
  const tables = {};
  for (let bi = 0; bi < sortedBrackets.length; bi++) {
    const bracket = sortedBrackets[bi];
    const group = allDataRows.slice(bi * 10, bi * 10 + 10);
    if (group.length === 0) break;

    tables[bracket] = Array.from({ length: 10 }, () => Array(11).fill(null));

    for (let colorIdx = 0; colorIdx < group.length; colorIdx++) {
      const nums = group[colorIdx]; // PDF row = one colour (D=0 … M=9)
      // Transpose: PDF col → clarity index, skipping SI3 at col 7
      for (let col = 0; col < Math.min(nums.length, 11); col++) {
        let ci;
        if (col <= 6)      { ci = col; }
        else if (col === 7){ continue; }   // skip SI3
        else               { ci = col - 1; }
        tables[bracket][ci][colorIdx] = nums[col];
      }
    }
  }

  const filled = Object.values(tables).filter(t =>
    t.some(row => row.some(v => v !== null))
  ).length;
  console.log(`parseRapTable: date=${date} brackets_filled=${filled}/${Object.keys(tables).length}`);

  return { date, tables };
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const body = req.body || {};
  const rounds64 = body.rounds || null;
  const fancy64  = body.fancy  || null;

  if (!rounds64 && !fancy64) return res.status(400).json({ ok: false, error: "No PDF data received" });

  try {
    const pdfParse = require("pdf-parse");

    const warnings = [];
    let roundsText = null, fancyText = null;

    if (rounds64) {
      try {
        const buf = Buffer.from(rounds64, "base64");
        const parsed = await pdfParse(buf);
        roundsText = parsed.text;
        const sample = parsed.text.split(/\n/).map(l=>l.trim()).filter(Boolean).slice(0,80);
        console.log("ROUNDS_PDF_SAMPLE:", JSON.stringify(sample));
      } catch (err) { warnings.push("Round PDF parse failed: " + err.message); }
    }
    if (fancy64) {
      try {
        const buf = Buffer.from(fancy64, "base64");
        const parsed = await pdfParse(buf);
        fancyText = parsed.text;
        const sample = parsed.text.split(/\n/).map(l=>l.trim()).filter(Boolean).slice(0,40);
        console.log("FANCY_PDF_SAMPLE:", JSON.stringify(sample));
      } catch (err) { warnings.push("Fancy PDF parse failed: " + err.message); }
    }

    const roundData = parseRapTable(roundsText);
    const fancyData = parseRapTable(fancyText);
    const date = roundData?.date || fancyData?.date || new Date().toLocaleDateString("en-GB");

    const roundsEmpty = !roundData || Object.keys(roundData.tables || {}).length === 0 ||
      !Object.values(roundData.tables).some(t => t.some(r => r.some(v => v !== null)));
    const fancyEmpty  = !fancyData  || Object.keys(fancyData.tables  || {}).length === 0 ||
      !Object.values(fancyData.tables ).some(t => t.some(r => r.some(v => v !== null)));

    if (roundsEmpty && fancyEmpty) {
      const sample = (roundsText || fancyText || "").split(/\n/).map(l=>l.trim()).filter(Boolean).slice(0,15);
      return res.json({
        ok: false,
        error: `PDF parsed but no data. rounds64_len=${rounds64?.length||0} fancyLen=${fancy64?.length||0} roundsTextLen=${roundsText?.length||0} warnings=${JSON.stringify(warnings)} sample=${JSON.stringify(sample)}`
      });
    }

    const merged = {
      date,
      updated_at: new Date().toISOString(),
      rounds: roundsEmpty ? {} : roundData.tables,
      fancy:  fancyEmpty  ? {} : fancyData.tables,
    };

    const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
    const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" };

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ value: JSON.stringify(merged) }),
    });
    const patched = await patchRes.json().catch(() => []);
    if (!patchRes.ok) return res.json({ ok: false, error: "DB update failed: " + JSON.stringify(patched) });

    if (!Array.isArray(patched) || patched.length === 0) {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({ field: "rapaport_data", value: JSON.stringify(merged), tenant_id: TENANT }),
      });
      if (!insertRes.ok) return res.json({ ok: false, error: "DB insert failed: " + await insertRes.text() });
    }

    return res.json({
      ok: true,
      date,
      rounds_parsed: !roundsEmpty,
      fancy_parsed:  !fancyEmpty,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
