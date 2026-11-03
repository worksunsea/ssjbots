// Matching-pair rules for lab-grown stones (earrings need two similar stones).
// Standard rule: same shape, same colour (white = same grade; fancy = same
// fancy colour + intensity), length/width within 0.2 mm, depth within 0.3 mm,
// carat within 5%, clarity up to 2 grades apart.

export const PAIR_RULE = { lengthWidthMm: 0.2, depthMm: 0.3, caratPct: 5, clarityGrades: 2 };

const CLARITY_ORDER = ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"];

export const clarityIndex = (c) => CLARITY_ORDER.indexOf(String(c || "").toUpperCase().replace(/\s+/g, ""));

// "20.28-15.86x9.54" / "21.9-15.47-9.47" -> { l, w, d } (mm) or null.
export function parseMeasurements(text) {
  const nums = String(text || "").match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return null;
  const [l, w, d] = nums.slice(0, 3).map(Number);
  return { l, w, d };
}

// "Oval" and "Oval Brilliant" are the same cut; "Heart Modified" is not "Heart".
export const normShape = (s) => String(s || "").toLowerCase().replace(/\b(brilliant|cut)\b/g, "").replace(/\s+/g, " ").trim();

// Solitaire designer shape for a stone (DIAMOND_SHAPES), or null when no setting exists.
export function settingShape(shape) {
  const s = String(shape || "").toLowerCase();
  if (/rose/.test(s)) return null;
  for (const [re, name] of [[/heart/, "Heart"], [/marquise/, "Marquise"], [/pear/, "Pear"], [/oval/, "Oval"], [/princess/, "Princess"],
    [/radiant/, "Radiant"], [/asscher/, "Asscher"], [/emerald/, "Emerald"], [/cushion/, "Cushion"], [/^round/, "Round"]]) {
    if (re.test(s)) return name;
  }
  return null;
}

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Returns a closeness score (lower = better match) or null when the stones don't pair.
export function pairScore(a, b, rule = PAIR_RULE) {
  if (!a || !b || a.sku === b.sku) return null;
  if (normShape(a.shape) !== normShape(b.shape)) return null;
  const fancy = Boolean(a.fancy_color);
  if (fancy !== Boolean(b.fancy_color)) return null;
  if (fancy) {
    if (!same(a.fancy_color, b.fancy_color) || !same(a.fancy_intensity, b.fancy_intensity) || !same(a.fancy_overtone, b.fancy_overtone)) return null;
  } else if (!same(a.color, b.color)) return null;

  const ca = Number(a.carat), cb = Number(b.carat);
  if (!(ca > 0) || !(cb > 0) || Math.abs(ca - cb) / ca > rule.caratPct / 100) return null;
  const ia = clarityIndex(a.clarity), ib = clarityIndex(b.clarity);
  if (ia < 0 || ib < 0 || Math.abs(ia - ib) > rule.clarityGrades) return null;

  const ma = parseMeasurements(a.measurements), mb = parseMeasurements(b.measurements);
  if (!ma || !mb) return null;
  const dl = Math.abs(ma.l - mb.l), dw = Math.abs(ma.w - mb.w), dd = Math.abs(ma.d - mb.d);
  if (dl > rule.lengthWidthMm + 1e-9 || dw > rule.lengthWidthMm + 1e-9 || dd > rule.depthMm + 1e-9) return null;

  return Number((dl + dw + dd + Math.abs(ca - cb) / ca * 10 + Math.abs(ia - ib) * 0.1).toFixed(3));
}

export function findPairs(base, candidates, { limit = 12, rule = PAIR_RULE } = {}) {
  return candidates
    .map((c) => ({ c, score: pairScore(base, c, rule) }))
    .filter((x) => x.score !== null)
    .sort((x, y) => x.score - y.score)
    .slice(0, limit)
    .map((x) => x.c);
}
