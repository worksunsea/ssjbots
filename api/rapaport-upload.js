import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const body = req.body || {};
  const rounds64 = body.rounds || null;
  const fancy64 = body.fancy || null;

  if (!rounds64 && !fancy64) return res.status(400).json({ ok: false, error: "No PDF data received" });

  try {
    if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; } };
    if (typeof globalThis.DOMPoint === "undefined") globalThis.DOMPoint = class DOMPoint { constructor(x=0,y=0){this.x=x;this.y=y;} };
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");

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

    const parseRapTable = (text) => {
      if (!text) return null;
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      const dateMatch = text.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
      const date = dateMatch ? `${dateMatch[1].padStart(2,"0")}/${dateMatch[2].padStart(2,"0")}/${dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3]}` : null;
      const weightRanges = ["0.30","0.40","0.50","0.70","0.90","1.00","1.50","2.00","3.00","4.00","5.00"];
      const clarities = ["FL","IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1","I2"];
      const colors = ["D","E","F","G","H","I","J","K","L","M"];
      const tables = {};
      let currentRange = null;
      for (const line of lines) {
        const wm = weightRanges.find(w => line.includes(w));
        if (wm && line.length < 30) { currentRange = wm; tables[wm] = {}; continue; }
        if (!currentRange) continue;
        const cl = clarities.find(c => line.startsWith(c + " ") || line.startsWith(c + "\t"));
        if (!cl) continue;
        const nums = line.replace(cl, "").trim().split(/[\s\t]+/).map(n => parseFloat(n.replace(/,/g,""))).filter(n => !isNaN(n) && n > 0);
        if (nums.length >= colors.length) {
          tables[currentRange][cl] = {};
          colors.forEach((col, i) => { if (nums[i]) tables[currentRange][cl][col] = nums[i]; });
        }
      }
      return { date, tables };
    };

    const roundData = parseRapTable(roundsText);
    const fancyData = parseRapTable(fancyText);
    const date = roundData?.date || fancyData?.date || new Date().toLocaleDateString("en-GB");

    const merged = {
      date,
      updated_at: new Date().toISOString(),
      round: roundData?.tables || {},
      fancy: fancyData?.tables || {},
    };

    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ field: "rapaport_data", value: JSON.stringify(merged), tenant_id: "a1b2c3d4-0000-0000-0000-000000000001" }),
    });

    if (!sbRes.ok) return res.json({ ok: false, error: "DB write failed: " + await sbRes.text() });

    return res.json({
      ok: true,
      date,
      rounds_parsed: !!roundData && Object.keys(roundData.tables||{}).length > 0,
      fancy_parsed: !!fancyData && Object.keys(fancyData.tables||{}).length > 0,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
