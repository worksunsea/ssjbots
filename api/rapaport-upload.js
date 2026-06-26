import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

// Exact match with RAP_CLARITIES / RAP_COLORS / RAP_WEIGHT_RANGES in App.jsx
const WEIGHT_RANGES  = ["0.30","0.40","0.50","0.70","0.90","1.00","1.50","2.00","3.00","4.00","5.00"];
const SEED_CLARITIES = ["IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2","I3"]; // 10 rows
const SEED_COLORS    = ["D","E","F","G","H","I","J","K","L","M","N"];               // 11 cols

// FL on PDF → same row as IF (index 0)
const CLARITY_ROW = { FL:0, IF:0, VVS1:1, VVS2:2, VS1:3, VS2:4, SI1:5, SI2:6, I1:7, I2:8, I3:9 };

// Sorted longest-first so "VVS1" is tried before "VS1", "SI1" before "I1", etc.
const CLARITY_KEYS = Object.keys(CLARITY_ROW).sort((a,b) => b.length - a.length);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const body = req.body || {};
  const rounds64 = body.rounds || null;
  const fancy64  = body.fancy  || null;

  if (!rounds64 && !fancy64) return res.status(400).json({ ok: false, error: "No PDF data received" });

  try {
    if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; } };
    if (typeof globalThis.DOMPoint  === "undefined") globalThis.DOMPoint  = class DOMPoint  { constructor(x=0,y=0){this.x=x;this.y=y;} };
    const pdfParse = require("pdf-parse/dist/pdf-parse/cjs/index.cjs");

    const warnings = [];
    let roundsText = null, fancyText = null;

    if (rounds64) {
      try {
        const buf = Buffer.from(rounds64, "base64");
        const parsed = await pdfParse(buf);
        roundsText = parsed.text;
        // Log sample lines for debugging format issues
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

    // Returns tables in same array-of-arrays format as RAP_SEED in App.jsx:
    //   tables["0.30"] = [ [IF_D..IF_N], [VVS1_D..VVS1_N], ... ]  (10 rows × 11 cols)
    //
    // Handles both layouts that pdf-parse produces:
    //   Layout A (combined): "IF  27  22  19  17  15  14  13  12  11  10"
    //   Layout B (split):    "IF\n27  22  19  17  15  14  13  12  11  10"
    const parseRapTable = (text) => {
      if (!text) return null;

      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      const dateMatch = text.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
      const date = dateMatch
        ? `${dateMatch[1].padStart(2,"0")}/${dateMatch[2].padStart(2,"0")}/${dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3]}`
        : null;

      // Detect weight range header: line that starts with (or is) one of the known range values,
      // followed only by an optional "- N.NN" range end. Anchored so "Round 1.00-1.49" doesn't match.
      const getRangeKey = (line) => {
        const norm = line.replace(/[–—]/g, "-").replace(/\s+/g, " ");
        for (const w of WEIGHT_RANGES) {
          // Must start with the range value, nothing alphanumeric before it
          const re = new RegExp(`^${w.replace(".", "\\.")}(\\s*[-]\\s*[\\d.]+)?$`);
          if (re.test(norm)) return w;
        }
        return null;
      };

      // Detect clarity label at the start of a line (or the entire line)
      const getClarityAtStart = (line) => {
        for (const c of CLARITY_KEYS) {
          if (line === c || line.startsWith(c + " ") || line.startsWith(c + "\t")) return c;
        }
        return null;
      };

      const extractNums = (str) =>
        str.trim().split(/[\s\t]+/).map(n => parseFloat(n.replace(/,/g, ""))).filter(n => !isNaN(n) && n > 0);

      const tables = {};
      let currentRange   = null;
      let pendingRow     = null; // row index when clarity appears alone on a line

      for (const line of lines) {
        // --- Weight range header ---
        const rangeKey = getRangeKey(line);
        if (rangeKey) {
          currentRange = rangeKey;
          pendingRow   = null;
          if (!tables[currentRange]) {
            tables[currentRange] = Array.from({ length: 10 }, () => Array(11).fill(null));
          }
          continue;
        }
        if (!currentRange) continue;

        // --- Clarity row (with or without numbers on same line) ---
        const cl = getClarityAtStart(line);
        if (cl !== null) {
          const ri  = CLARITY_ROW[cl];
          if (ri === undefined) continue;
          const rest = line.slice(cl.length).trim();
          const nums = extractNums(rest);
          if (nums.length >= 3) {
            // Layout A: "IF 27 22 19 ..."
            for (let ki = 0; ki < Math.min(nums.length, 11); ki++) tables[currentRange][ri][ki] = nums[ki];
            pendingRow = null;
          } else {
            // Layout B: clarity alone, numbers expected on next line
            pendingRow = ri;
          }
          continue;
        }

        // --- Numbers line (Layout B follow-up) ---
        if (pendingRow !== null) {
          const nums = extractNums(line);
          if (nums.length >= 3) {
            for (let ki = 0; ki < Math.min(nums.length, 11); ki++) tables[currentRange][pendingRow][ki] = nums[ki];
          }
          pendingRow = null;
          continue;
        }
      }

      const bracketsFilled = Object.values(tables).filter(t =>
        t.some(row => row.some(v => v !== null))
      ).length;
      console.log(`parseRapTable: date=${date} brackets=${bracketsFilled}/${Object.keys(tables).length}`);

      return { date, tables };
    };

    const roundData = parseRapTable(roundsText);
    const fancyData = parseRapTable(fancyText);
    const date = roundData?.date || fancyData?.date || new Date().toLocaleDateString("en-GB");

    const roundsEmpty = !roundData || Object.keys(roundData.tables || {}).length === 0 ||
      !Object.values(roundData.tables).some(t => t.some(r => r.some(v => v !== null)));
    const fancyEmpty  = !fancyData  || Object.keys(fancyData.tables  || {}).length === 0 ||
      !Object.values(fancyData.tables ).some(t => t.some(r => r.some(v => v !== null)));

    if (roundsEmpty && fancyEmpty) {
      const sample = (roundsText || fancyText || "").split(/\n/).map(l=>l.trim()).filter(Boolean).slice(0,25);
      return res.json({ ok: false, error: "PDF parsed but no price data found. First 25 lines: " + JSON.stringify(sample) });
    }

    // Key names MUST match rapLookup() in App.jsx: rapData.rounds / rapData.fancy
    const merged = {
      date,
      updated_at: new Date().toISOString(),
      rounds: roundsEmpty ? {} : roundData.tables,
      fancy:  fancyEmpty  ? {} : fancyData.tables,
    };

    const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
    const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" };

    // Try UPDATE first; INSERT only if no rows matched
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
