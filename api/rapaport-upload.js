import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./_lib/config.js";

const WEIGHT_RANGES = [
  "0.30","0.40","0.50","0.70","0.90",
  "1.00","1.50","2.00","3.00","4.00","5.00",
];

// ─── Seed data fallback — Rapaport June 19, 2026 ─────────────────────────────
// Used when PDF parsing fails validation. Mirrors rapaport-sync.js SEED_ROUNDS/SEED_FANCY.
const SEED_DATE = "2026-06-19";

const SEED_ROUNDS = {
  "0.30": [
    [27,22,19,17,15,14,13,12,11,10,7],
    [23,20,17,15,14,13,12,11,10,9,6],
    [20,18,16,14,13,12,11,10,10,9,6],
    [18,16,14,13,12,12,11,10,9,8,5],
    [15,14,13,12,11,11,10,9,8,7,5],
    [13,12,11,11,10,10,9,8,7,6,5],
    [12,11,10,10,9,9,8,7,6,6,4],
    [11,10,9,9,8,8,7,6,5,5,4],
    [10,9,8,8,7,7,6,6,5,5,3],
    [9,8,8,7,7,7,6,5,5,4,3],
  ],
  "0.40": [
    [31,25,21,20,18,16,15,14,13,11,8],
    [26,22,19,18,17,15,14,13,12,10,7],
    [23,20,18,17,16,14,13,12,11,10,7],
    [21,18,17,16,15,13,12,11,10,9,6],
    [18,16,15,14,13,12,11,10,9,8,6],
    [16,14,13,12,12,11,10,9,8,7,6],
    [14,13,12,11,11,10,10,9,8,7,5],
    [13,12,11,10,10,9,9,8,7,6,5],
    [12,11,10,9,9,8,8,7,6,5,4],
    [11,10,9,8,8,8,7,6,5,5,4],
  ],
  "0.50": [
    [47,37,29,25,22,19,16,15,14,13,11],
    [37,32,26,23,20,17,15,14,13,12,10],
    [32,28,24,21,19,16,14,13,12,11,10],
    [27,24,21,19,18,15,13,12,11,10,9],
    [23,21,19,17,16,14,12,11,10,10,8],
    [20,18,16,15,14,13,11,10,9,9,8],
    [17,15,14,13,12,12,11,10,9,9,7],
    [15,14,13,12,11,11,10,9,8,8,7],
    [14,13,12,11,10,10,9,9,8,7,6],
    [13,12,11,10,9,9,8,8,8,6,5],
  ],
  "0.70": [
    [64,51,41,35,30,26,23,21,19,17,12],
    [52,45,38,33,28,24,21,19,17,16,11],
    [45,40,34,30,26,22,19,17,16,15,11],
    [38,33,30,27,24,20,17,16,15,14,10],
    [31,28,25,23,21,18,16,15,14,14,9],
    [26,23,21,20,18,16,15,14,13,13,9],
    [22,20,19,18,16,15,14,13,12,12,8],
    [20,18,17,16,15,14,13,12,11,10,8],
    [18,16,15,14,13,12,11,11,11,8,7],
    [16,14,13,12,11,11,10,10,10,7,6],
  ],
  "0.90": [
    [96,82,62,53,45,36,29,26,25,20,15],
    [83,71,57,48,41,32,26,24,23,19,14],
    [73,63,52,44,38,30,24,22,21,18,13],
    [59,52,45,40,35,28,23,21,20,17,12],
    [47,43,39,34,31,26,22,20,19,16,12],
    [41,37,34,30,28,24,20,19,18,15,11],
    [35,32,29,26,24,21,19,18,17,14,10],
    [30,27,25,23,21,19,17,16,15,13,9],
    [26,23,21,20,18,16,15,15,14,12,8],
    [23,20,18,17,16,15,14,14,13,10,7],
  ],
  "1.00": [
    [150,118,89,76,63,48,37,32,30,23,16],
    [115,102,81,69,57,44,34,30,28,22,15],
    [96,87,74,63,52,41,32,28,26,21,14],
    [75,68,62,54,47,37,30,26,24,20,13],
    [58,53,49,45,42,34,28,25,23,19,13],
    [48,44,41,38,35,31,26,24,22,18,12],
    [40,36,33,31,29,26,23,21,20,17,12],
    [34,31,29,27,25,23,21,20,19,16,11],
    [29,27,25,23,21,19,18,17,16,15,10],
    [25,23,22,21,19,17,16,15,14,14,10],
  ],
  "1.50": [
    [200,178,146,127,114,88,71,63,52,33,18],
    [179,164,136,116,105,82,65,57,49,31,17],
    [156,145,125,108,98,77,61,54,47,30,16],
    [129,120,108,94,85,71,57,51,44,29,15],
    [103,95,86,77,70,63,52,48,40,28,15],
    [83,77,69,65,60,53,48,44,37,26,14],
    [70,64,58,54,50,46,41,37,33,25,14],
    [60,53,48,45,42,38,35,32,29,23,13],
    [50,45,41,38,36,33,31,29,28,22,12],
    [44,39,37,34,32,30,29,27,26,21,12],
  ],
  "2.00": [
    [330,275,235,205,175,141,113,95,80,41,19],
    [270,245,210,190,160,132,105,88,76,39,18],
    [245,220,195,175,150,123,98,83,72,37,17],
    [205,185,165,150,135,112,92,77,68,35,16],
    [165,150,135,125,115,104,86,71,65,33,15],
    [135,120,110,100,93,86,78,66,61,31,15],
    [109,99,91,84,76,69,63,57,54,29,14],
    [91,83,76,70,63,57,53,50,47,28,14],
    [78,71,66,61,54,50,46,43,40,27,13],
    [68,63,57,54,48,45,42,40,38,26,13],
  ],
  "3.00": [
    [550,460,410,350,295,235,200,139,103,49,21],
    [450,420,370,320,265,210,185,131,98,47,20],
    [405,375,335,295,245,195,170,124,93,45,19],
    [335,315,280,245,210,180,155,112,87,43,18],
    [270,250,225,205,185,160,135,101,82,41,17],
    [220,205,190,175,160,140,120,92,77,38,16],
    [175,165,150,140,130,120,110,84,71,35,15],
    [145,135,125,120,110,103,97,76,62,33,15],
    [117,111,107,103,95,90,82,65,55,31,14],
    [95,91,87,83,79,75,67,58,47,30,14],
  ],
  "4.00": [
    [745,645,585,495,415,315,255,155,111,54,23],
    [625,585,525,450,390,295,240,145,106,52,22],
    [565,520,475,410,355,275,225,138,101,50,21],
    [465,430,395,360,315,245,200,127,95,47,20],
    [360,335,315,295,260,215,180,114,90,44,19],
    [280,260,245,230,210,190,160,105,86,41,18],
    [225,210,195,185,170,155,140,95,75,39,17],
    [185,175,160,150,140,130,120,83,66,36,17],
    [150,140,130,120,115,105,100,73,59,34,16],
    [125,115,105,100,95,90,80,65,50,32,16],
  ],
  "5.00": [
    [1000,855,770,690,580,430,315,175,125,60,25],
    [835,750,670,595,520,395,295,170,120,57,23],
    [730,670,595,540,465,360,280,160,115,54,22],
    [605,555,505,460,395,320,260,150,110,51,21],
    [480,445,400,360,325,265,225,140,100,48,21],
    [365,345,315,290,255,225,195,130,95,46,20],
    [280,260,240,220,205,195,170,120,88,43,19],
    [220,210,195,180,170,165,150,110,81,41,18],
    [180,165,155,150,140,135,125,100,69,37,17],
    [150,140,130,125,120,110,100,80,60,34,16],
  ],
};

const SEED_FANCY = {
  "0.30": [
    [23,21,19,17,16,15,13,11,9,7,6],
    [21,19,17,16,15,14,12,10,8,7,5],
    [19,17,16,15,14,13,11,9,7,6,5],
    [17,16,15,14,13,12,10,8,7,6,4],
    [16,15,14,13,12,11,9,7,6,5,4],
    [15,14,13,12,11,10,8,7,6,5,4],
    [13,12,11,10,9,8,7,6,5,5,3],
    [11,10,9,8,8,7,7,6,5,5,3],
    [10,9,8,7,7,7,6,5,5,4,2],
    [9,8,8,7,7,6,6,5,4,3,2],
  ],
  "0.40": [
    [26,24,22,20,18,17,15,13,11,8,7],
    [24,22,20,18,17,16,14,12,10,8,6],
    [23,21,19,17,16,15,13,11,9,7,5],
    [21,19,17,16,15,14,12,10,9,7,5],
    [19,17,16,15,14,13,11,9,8,6,5],
    [17,16,15,14,13,12,10,9,7,6,4],
    [15,14,13,12,11,10,9,8,6,5,4],
    [13,12,11,10,10,9,8,7,6,5,4],
    [12,11,10,9,9,8,7,6,5,5,3],
    [11,10,9,8,8,7,6,5,5,4,3],
  ],
  "0.50": [
    [30,28,26,24,22,20,18,17,15,12,9],
    [28,26,24,23,21,19,17,16,14,11,8],
    [26,24,23,22,20,18,16,15,13,10,7],
    [24,22,21,20,19,17,15,14,12,9,7],
    [22,20,19,18,17,16,14,13,11,8,7],
    [20,18,17,16,15,14,13,12,10,8,6],
    [18,17,16,15,14,13,12,11,9,7,6],
    [16,15,14,13,12,11,10,9,8,6,6],
    [14,13,12,11,11,10,9,8,7,6,5],
    [13,12,11,10,10,9,8,7,6,5,4],
  ],
  "0.70": [
    [43,40,37,34,31,26,22,20,18,16,10],
    [40,37,35,32,29,24,20,18,16,15,9],
    [37,35,33,30,27,22,18,16,15,14,9],
    [34,32,30,28,25,21,17,15,15,14,8],
    [31,29,27,25,23,19,16,15,14,13,8],
    [29,27,25,23,20,18,15,14,13,12,8],
    [24,23,21,19,17,16,15,14,12,11,7],
    [20,19,18,17,16,15,14,13,11,10,7],
    [18,17,16,16,15,14,13,12,10,8,6],
    [16,15,14,14,13,12,11,10,8,7,5],
  ],
  "0.90": [
    [62,58,52,48,41,34,30,27,24,18,11],
    [59,52,48,45,39,32,28,25,23,17,10],
    [52,49,46,43,37,30,26,23,22,16,10],
    [49,47,44,41,35,29,24,22,21,16,9],
    [46,43,40,37,32,27,23,21,20,15,9],
    [39,37,35,32,29,25,21,19,18,14,9],
    [34,32,30,28,25,22,19,17,16,13,8],
    [28,26,24,22,21,19,17,15,14,12,8],
    [22,21,20,18,17,16,15,14,13,10,7],
    [19,18,17,16,15,14,13,12,11,9,7],
  ],
  "1.00": [
    [93,82,76,67,57,46,39,35,31,21,13],
    [82,75,69,62,54,43,37,33,29,20,12],
    [74,68,64,58,51,40,35,31,28,20,11],
    [66,62,58,54,48,38,33,29,26,19,10],
    [56,52,49,46,42,36,31,27,24,18,10],
    [47,44,42,39,37,32,28,24,22,17,10],
    [40,38,36,34,32,29,25,22,19,15,9],
    [34,32,30,28,26,24,22,19,17,14,9],
    [29,27,25,23,22,20,19,18,16,12,9],
    [25,23,21,20,19,18,17,16,13,10,8],
  ],
  "1.50": [
    [141,132,125,116,99,81,67,59,51,27,15],
    [132,124,116,108,93,76,63,55,48,26,14],
    [123,115,108,102,88,72,60,51,45,25,13],
    [109,105,100,93,82,67,56,48,42,24,12],
    [92,88,84,79,71,62,52,45,39,23,11],
    [79,75,72,68,63,56,48,42,36,22,11],
    [64,61,58,55,52,48,44,38,33,20,11],
    [49,47,45,43,41,39,37,33,29,18,10],
    [41,39,37,36,34,32,30,28,26,16,10],
    [35,33,32,31,29,27,25,24,22,15,10],
  ],
  "2.00": [
    [215,200,185,175,160,135,103,82,69,30,16],
    [200,185,170,160,150,125,96,78,64,29,15],
    [185,170,160,150,140,117,91,74,59,28,14],
    [170,160,150,140,130,107,86,70,55,27,13],
    [135,125,120,115,110,99,82,64,51,25,12],
    [108,104,99,95,90,85,75,57,48,24,12],
    [88,84,81,77,74,70,63,51,45,22,12],
    [70,66,63,60,58,55,51,43,37,21,11],
    [54,51,49,47,45,43,41,36,33,19,11],
    [45,42,40,38,36,35,33,29,27,18,10],
  ],
  "3.00": [
    [420,355,325,300,270,230,180,122,86,36,17],
    [365,325,295,275,250,215,170,112,80,33,16],
    [325,295,270,250,230,200,160,104,74,30,15],
    [290,265,245,225,210,185,150,95,67,29,15],
    [240,225,210,195,185,165,140,88,62,27,14],
    [195,185,175,165,155,145,125,81,57,26,14],
    [154,142,135,127,121,111,102,71,54,25,13],
    [119,111,105,100,94,88,82,61,50,24,13],
    [89,83,79,75,71,66,62,53,44,23,12],
    [67,63,60,57,54,49,46,41,36,21,11],
  ],
  "4.00": [
    [535,460,435,405,375,280,210,137,92,39,19],
    [460,420,400,375,345,265,200,129,88,37,17],
    [420,390,370,345,315,250,190,119,82,35,16],
    [375,340,320,300,275,235,180,109,77,32,16],
    [305,285,270,255,235,205,170,103,72,29,15],
    [250,235,220,205,190,175,150,95,66,28,15],
    [195,185,175,165,155,145,125,81,61,26,14],
    [158,148,139,132,123,115,105,70,56,25,14],
    [113,106,100,95,90,84,77,58,48,24,13],
    [81,77,74,71,68,64,61,47,39,22,12],
  ],
  "5.00": [
    [750,635,600,570,490,375,270,146,105,43,20],
    [630,580,550,525,455,350,250,139,95,40,18],
    [565,535,510,485,430,320,235,129,89,38,17],
    [500,470,445,425,365,295,220,124,84,36,17],
    [420,385,365,335,300,250,205,118,81,33,16],
    [325,300,275,255,235,210,180,107,77,30,16],
    [250,230,215,200,185,175,160,97,70,28,15],
    [195,185,175,165,155,145,135,88,65,27,15],
    [150,140,135,130,125,120,110,71,56,24,14],
    [115,110,105,95,90,85,80,61,46,23,13],
  ],
};

// ─── Date extraction — month-name first, then validated numeric ───────────────
function extractDate(text) {
  if (!text) return null;
  const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
  const monthMap = {
    January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",
    July:"07",August:"08",September:"09",October:"10",November:"11",December:"12",
  };
  const patterns = [
    new RegExp(`(${monthNames})\\s+(\\d{1,2}),?\\s+(20\\d{2})`),
    new RegExp(`(\\d{1,2})\\s+(${monthNames})\\s+(20\\d{2})`),
    // Validated numeric: month 01-12, day 01-31, year 20xx — avoids garbled-content matches
    /\b(0[1-9]|1[0-2])[\/\.](0[1-9]|[12]\d|3[01])\/(20\d{2})\b/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (!m) continue;
    if (m[1] in monthMap) return `${m[3]}-${monthMap[m[1]]}-${m[2].padStart(2,"0")}`;
    if (m[2] in monthMap) return `${m[3]}-${monthMap[m[2]]}-${m[1].padStart(2,"0")}`;
    return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }
  return null;
}

// ─── Sanity-check parsed tables ───────────────────────────────────────────────
// Returns true only when key IF-D prices are within expected Rapaport ranges and
// price increases with weight (larger diamonds cost more per ct).
// This catches bracket-offset bugs caused by extra rows from garbled PDF content.
function validateRapTables(tables) {
  if (!tables || typeof tables !== "object") return false;
  const keys = Object.keys(tables);
  if (keys.length < 8) return false; // expect ≥8 brackets out of 12

  const ifD = (bracket) => tables[bracket]?.[0]?.[0];

  const v030 = ifD("0.30");
  const v090 = ifD("0.90");
  const v100 = ifD("1.00");

  // All three key brackets must be present and positive
  if (!v030 || v030 <= 0) return false;
  if (!v090 || v090 <= 0) return false;
  if (!v100 || v100 <= 0) return false;

  // Reasonable Rapaport ranges (hundreds $/ct):
  //   0.30ct IF D: roughly 15–60
  //   0.90ct IF D: roughly 40–200
  //   1.00ct IF D: roughly 80–500
  if (v030 < 10 || v030 > 100) return false;
  if (v090 < 30 || v090 > 350) return false;
  if (v100 < 60 || v100 > 700) return false;

  // 1ct should be meaningfully more expensive than 0.90ct (the carat-premium effect)
  if (v100 <= v090) return false;

  // 0.90ct should be more expensive than 0.30ct
  if (v090 <= v030) return false;

  return true;
}

// ─── PDF parsing ─────────────────────────────────────────────────────────────
const parseRapTable = (text) => {
  if (!text) return null;

  const rawLines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Estimate how many Rapaport values a token contains using the ≤35 heuristic.
  // Small-bracket values are ≤35: "16141313"→4, "98877765543"→11, "272220"→3.
  const estimateTokenVals = (t) => {
    if (!/^\d{3,}$/.test(t)) return 1;
    let n = 0, i = 0;
    while (i < t.length) {
      if (i + 1 < t.length && parseInt(t.slice(i, i + 2)) <= 35) { n++; i += 2; }
      else { n++; i++; }
    }
    return n;
  };

  // Pre-pass: join consecutive lines that together form one split data row.
  // Rapaport small-bracket (.30-.40ct) rows are split across 2 lines by pdf-parse:
  //   line A: "272220"              (merged first 3 values — no spaces)
  //   line B: "181614   13  12  11  10  7"  (remaining 8 values)
  // Detect: line is all-numeric, ≤4 tokens, estimated expanded count < 8.
  const lines = [];
  let si = 0;
  while (si < rawLines.length) {
    const line = rawLines[si];
    if (!/RAPAPORT|ROUNDS/i.test(line)) {
      const stripped = line.replace(/\s+/g, '');
      if (stripped.length > 0 && /^\d+$/.test(stripped)) {
        const toks = line.split(/\s+/).filter(t => /^\d+$/.test(t));
        const estimatedAlone = toks.reduce((s, t) => s + estimateTokenVals(t), 0);
        if (toks.length >= 1 && toks.length <= 4 && estimatedAlone < 8 && si + 1 < rawLines.length) {
          const nextLine = rawLines[si + 1];
          if (!/RAPAPORT|ROUNDS/i.test(nextLine)) {
            const nextToks = nextLine.split(/\s+/).filter(t => /^\d+$/.test(t));
            if (nextToks.length >= 2) {
              lines.push(line.trim() + ' ' + nextLine.trim());
              si += 2;
              continue;
            }
          }
        }
      }
    }
    lines.push(line);
    si++;
  }

  const normToKey = (raw) => {
    const num = raw.includes('.') ? parseFloat(raw) : parseFloat(raw) / 100;
    for (const w of WEIGHT_RANGES) {
      if (Math.abs(parseFloat(w) - num) < 0.005) return w;
    }
    return null;
  };

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

  // Split a merged token string into n values using ceil-division chunking.
  // e.g. splitTokenIntoN("272220", 3) → [27, 22, 20]
  //      splitTokenIntoN("1188976", 3) → [118, 89, 76]
  const splitTokenIntoN = (tokenStr, n) => {
    const s = tokenStr;
    const parts = [];
    let pos = 0;
    for (let k = 0; k < n; k++) {
      const charsLeft = s.length - pos;
      const remaining = n - k;
      const chunkLen = Math.ceil(charsLeft / remaining);
      parts.push(parseInt(s.slice(pos, pos + chunkLen)));
      pos += chunkLen;
    }
    return parts;
  };

  // Two-phase expand:
  // Phase 1: ≤35 heuristic — for small-bracket values (all ≤35).
  //   Each ≥2-char token: greedily take 2-char chunk if ≤35, else 1-char.
  //   "272220"→[27,22,20], "98877765543"→[9,8,8,7,7,7,6,5,5,4,3]
  // Phase 2: ceil-division — for large brackets (values >35).
  //   Used when Phase 1 yields wrong count (over/under-expanded).
  //   "1188976"→[118,89,76], "47372925"→[47,37,29,25]
  const expandMerged = (tokens, targetCount) => {
    // Phase 1: ≤35 heuristic — correct for small-bracket rows (all values ≤35).
    // Tracks which values came from 2-char expansions for Phase 1b.
    const phase1 = [];
    const is2Char = [];
    for (const t of tokens) {
      if (/^\d{2,}$/.test(t)) {
        let i = 0;
        while (i < t.length) {
          if (i + 1 < t.length && parseInt(t.slice(i, i + 2)) <= 35) {
            phase1.push(parseInt(t.slice(i, i + 2)));
            is2Char.push(true);
            i += 2;
          } else {
            phase1.push(parseInt(t[i]));
            is2Char.push(false);
            i++;
          }
        }
      } else {
        phase1.push(parseInt(t));
        is2Char.push(false);
      }
    }
    if (phase1.length === targetCount) return phase1;

    // Phase 1b: if slightly short, re-split 2-char expansions (≥10) into individual digits.
    // Fixes fancy .30ct M row: "432"→[4,32] → re-split 32 → [4,3,2].
    if (phase1.length < targetCount) {
      const vals = [...phase1];
      const flags = [...is2Char];
      for (let k = 0; k < flags.length && vals.length < targetCount; k++) {
        if (flags[k] && vals[k] >= 10) {
          vals.splice(k, 1, Math.floor(vals[k] / 10), vals[k] % 10);
          flags.splice(k, 1, false, false);
        }
      }
      if (vals.length === targetCount) return vals;
    }

    // Phase 2: proportional allocation for large-bracket rows (values >35).
    // Fancy 2ct+ rows have multiple merged tokens (e.g. "215200185175160135", "103826930", "16").
    // Old single-token split incorrectly over-split the first token and missed the rest.
    // New: distribute target count across ALL long tokens proportionally by char-length share.
    const isLong = (t) => /^\d{4,}$/.test(t);
    const shortCount = tokens.filter(t => !isLong(t)).length;
    const countFromLong = targetCount - shortCount;
    const totalLongChars = tokens.filter(isLong).reduce((s, t) => s + t.length, 0);
    if (countFromLong <= 0 || totalLongChars === 0) return tokens.slice(0, targetCount).map(Number);

    const strs = [...tokens];
    let remaining = countFromLong;
    let longsSeen = 0;
    const numLongs = tokens.filter(isLong).length;

    for (let i = 0; i < strs.length && remaining > 0; i++) {
      if (!isLong(strs[i])) continue;
      longsSeen++;
      const isLastLong = longsSeen === numLongs;
      const parts = isLastLong
        ? remaining
        : Math.max(1, Math.floor(strs[i].length / totalLongChars * countFromLong));
      if (parts >= 2) {
        const split = splitTokenIntoN(strs[i], parts).map(String);
        strs.splice(i, 1, ...split);
        i += split.length - 1;
      }
      remaining -= parts;
    }
    return strs.slice(0, targetCount).map(Number);
  };

  const tryParseDataRow = (line) => {
    if (/RAPAPORT|ROUNDS/i.test(line)) return null;
    if (/^[A-N]$/.test(line)) return null;
    if (/^[A-N]-[A-N]$/.test(line)) return null;
    if (/[a-z]{3,}/i.test(line)) return null;

    let s = line;
    s = s.replace(/^[D-N](?=\d)/, '');
    s = s.replace(/^[D-N]\s+/, '');
    s = s.replace(/\s+[D-N]$/, '');

    // Reject lines with non-digit/non-whitespace/non-punctuation chars (control chars, parens, etc.)
    if (/[^0-9\s\t,.-]/.test(s)) return null;

    const tokens = s.trim().split(/[\s\t,]+/).filter(t => /^\d+\.?\d*$/.test(t));
    if (tokens.some(t => t.includes('.'))) return null;

    const estimatedCount = tokens.reduce((sum, t) => sum + estimateTokenVals(t), 0);
    if (estimatedCount < 8) return null;

    const nums = expandMerged(tokens, 11);
    if (nums.length < 8) return null;
    return nums.slice(0, 11);
  };

  const allDataRows = [];
  for (const line of lines) {
    const row = tryParseDataRow(line);
    if (row) allDataRows.push(row);
  }
  console.log(`RAP rows collected=${allDataRows.length}, expected≈${sortedBrackets.length * 10}`);

  if (allDataRows.length < 10) {
    console.log("RAP: too few data rows found");
    return { tables: {} };
  }

  // Sliding-window group validator: in a genuine Rapaport group of 10 rows
  // (colors D→M), the IF-clarity value (col 0) strictly decreases row-to-row.
  // Garbled/extra rows between PDF pages don't satisfy this. Slide past them.
  const isValidGroup = (rows) => {
    if (rows.length < 10) return false;
    for (let r = 1; r < 10; r++) {
      if (rows[r][0] >= rows[r - 1][0]) return false;
    }
    return true;
  };

  const cleanGroups = [];
  let pos = 0;
  while (pos + 10 <= allDataRows.length && cleanGroups.length < sortedBrackets.length) {
    const group = allDataRows.slice(pos, pos + 10);
    if (isValidGroup(group)) {
      cleanGroups.push(group);
      pos += 10;
    } else {
      pos++;
    }
  }
  console.log(`RAP clean groups=${cleanGroups.length} (expected=${sortedBrackets.length})`);

  if (cleanGroups.length === 0) {
    console.log("RAP: no valid groups found");
    return { tables: {} };
  }

  const tables = {};
  for (let bi = 0; bi < sortedBrackets.length; bi++) {
    const bracket = sortedBrackets[bi];
    const group = cleanGroups[bi];
    if (!group) break;

    tables[bracket] = Array.from({ length: 10 }, () => Array(11).fill(null));

    for (let colorIdx = 0; colorIdx < group.length; colorIdx++) {
      const nums = group[colorIdx];
      for (let col = 0; col < Math.min(nums.length, 11); col++) {
        let ci;
        if (col <= 6)       { ci = col; }
        else if (col === 7) { continue; }
        else                { ci = col - 1; }
        tables[bracket][ci][colorIdx] = nums[col];
      }
    }
  }

  const filled = Object.values(tables).filter(t =>
    t.some(row => row.some(v => v !== null))
  ).length;
  console.log(`parseRapTable: brackets_filled=${filled}/${Object.keys(tables).length}`);

  return { tables };
};

// ─── Fetch current rapaport_data from DB ─────────────────────────────────────
async function fetchExistingRapData() {
  const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT}&select=value&limit=1`,
      { headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.[0]?.value) return null;
    return JSON.parse(rows[0].value);
  } catch {
    return null;
  }
}

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

    // Parse PDFs
    const roundData = parseRapTable(roundsText);
    const fancyData = parseRapTable(fancyText);

    // Extract date using month-name pattern (avoids garbled-content false matches)
    const parsedDate = extractDate(roundsText) || extractDate(fancyText);

    // Fetch existing DB data so we can preserve what isn't being replaced
    const existing = await fetchExistingRapData();

    // ── Determine rounds data source ─────────────────────────────────────────
    let roundsFinal, roundsSource;
    if (rounds64 && roundData && validateRapTables(roundData.tables)) {
      roundsFinal = roundData.tables;
      roundsSource = "parsed";
    } else if (rounds64) {
      // PDF was provided but parsing failed or failed validation → seed fallback
      roundsFinal = SEED_ROUNDS;
      roundsSource = "seed_fallback";
      warnings.push("Rounds PDF parsed but data failed sanity check — using June-19 seed data");
    } else {
      // No rounds PDF uploaded → preserve existing rounds (or seed if no existing)
      roundsFinal = existing?.rounds || SEED_ROUNDS;
      roundsSource = "preserved";
    }

    // ── Determine fancy data source ──────────────────────────────────────────
    let fancyFinal, fancySource;
    if (fancy64 && fancyData && validateRapTables(fancyData.tables)) {
      fancyFinal = fancyData.tables;
      fancySource = "parsed";
    } else if (fancy64) {
      // Fancy PDF provided but parsing failed/invalid → seed fallback
      fancyFinal = SEED_FANCY;
      fancySource = "seed_fallback";
      warnings.push("Fancy PDF parsed but data failed sanity check — using June-19 seed data");
    } else {
      // No fancy PDF uploaded → preserve existing fancy (or seed if no existing)
      fancyFinal = existing?.fancy || SEED_FANCY;
      fancySource = "preserved";
    }

    const date = parsedDate || existing?.date || SEED_DATE;

    const merged = {
      date,
      updated_at: new Date().toISOString(),
      rounds: roundsFinal,
      fancy:  fancyFinal,
    };

    const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
    const sbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT}`,
      { method: "PATCH", headers: { ...sbHeaders, Prefer: "return=representation" }, body: JSON.stringify({ value: JSON.stringify(merged) }) }
    );
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
      rounds_source: roundsSource,
      fancy_source:  fancySource,
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
