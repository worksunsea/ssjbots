import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

// Must exactly match RAP_CLARITIES / RAP_COLORS in App.jsx
const SEED_CLARITIES = ["IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2","I3"]; // 10 rows
const SEED_COLORS    = ["D","E","F","G","H","I","J","K","L","M","N"];               // 11 cols

// FL on PDF → row index 0 (IF); I3 may or may not appear on PDF
const CLARITY_ROW = { FL:0, IF:0, VVS1:1, VVS2:2, VS1:3, VS2:4, SI1:5, SI2:6, I1:7, I2:8, I3:9 };

const WEIGHT_RANGES = ["0.30","0.40","0.50","0.70","0.90","1.00","1.50","2.00","3.00","4.00","5.00"];

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
      } catch (err) { warnings.push("Round PDF parse failed: " + err.message); }
    }
    if (fancy64) {
      try {
        const buf = Buffer.from(fancy64, "base64");
        const parsed = await pdfParse(buf);
        fancyText = parsed.text;
      } catch (err) { warnings.push("Fancy PDF parse failed: " + err.message); }
    }

    // Returns tables in same array-of-arrays format as RAP_SEED in App.jsx:
    //   tables["0.30"] = [[IF_D, IF_E, ..., IF_N], [VVS1_D, ...], ...10 rows, 11 cols]
    const parseRapTable = (text) => {
      if (!text) return null;
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      const dateMatch = text.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
      const date = dateMatch
        ? `${dateMatch[1].padStart(2,"0")}/${dateMatch[2].padStart(2,"0")}/${dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3]}`
        : null;

      const tables = {};
      let currentRange = null;

      for (const line of lines) {
        const rangeKey = WEIGHT_RANGES.find(w => line.includes(w));
        if (rangeKey && line.length < 30) {
          currentRange = rangeKey;
          // Pre-fill with nulls so missing rows stay null (not undefined)
          tables[currentRange] = Array.from({ length: 10 }, () => Array(11).fill(null));
          continue;
        }
        if (!currentRange) continue;

        // Match clarity at line start: "IF ", "VVS1\t", etc.
        const cl = Object.keys(CLARITY_ROW).find(c =>
          line.startsWith(c + " ") || line.startsWith(c + "\t") || line === c
        );
        if (cl === undefined) continue;

        const ri = CLARITY_ROW[cl];
        const nums = line.replace(cl, "").trim()
          .split(/[\s\t]+/)
          .map(n => parseFloat(n.replace(/,/g, "")))
          .filter(n => !isNaN(n) && n > 0);

        // Up to 11 columns (D..N); PDF may have 10 (no N) — pad remaining as null
        for (let ki = 0; ki < Math.min(nums.length, 11); ki++) {
          tables[currentRange][ri][ki] = nums[ki];
        }
      }
      return { date, tables };
    };

    const roundData = parseRapTable(roundsText);
    const fancyData = parseRapTable(fancyText);
    const date = roundData?.date || fancyData?.date || new Date().toLocaleDateString("en-GB");

    // Key names MUST match rapLookup() in App.jsx: rapData.rounds / rapData.fancy
    const merged = {
      date,
      updated_at: new Date().toISOString(),
      rounds: roundData?.tables || {},
      fancy:  fancyData?.tables || {},
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
      rounds_parsed: !!roundData && Object.keys(roundData.tables || {}).length > 0,
      fancy_parsed:  !!fancyData && Object.keys(fancyData.tables  || {}).length > 0,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
