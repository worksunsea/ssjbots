// Shared pricing math for the solitaire jewellery designer module.
// Diamond (Rapaport) lookup constants/logic mirror src/App.jsx's
// CalculatorScreen (RAP_CLARITIES/RAP_COLORS/RAP_WEIGHT_RANGES/rapLookup) —
// kept as an independent copy here rather than an in-place refactor of
// App.jsx, since that file is flagged stable (see SSJ_STABLE_FEATURES.md)
// and this module doesn't need any of the Calculator's UI state.

export const RAP_CLARITIES = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3"];
export const RAP_COLORS = ["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
export const RAP_WEIGHT_RANGES = ["0.30", "0.40", "0.50", "0.70", "0.90", "1.00", "1.50", "2.00", "3.00", "4.00", "5.00"];
export const RAP_RANGE_MINS = [0.30, 0.40, 0.50, 0.70, 0.90, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00];

// Gold purity options — rateKey maps directly to a getRates().spot field,
// which is already the purity-specific market rate per gram (not a fraction
// applied to 24kt). Matches CalculatorScreen's PURITIES table.
export const GOLD_PURITIES = [
  { key: "22kt", label: "22kt (91.6%)", rateField: "gold22kt", pct: 91.6 },
  { key: "18kt", label: "18kt (75%)", rateField: "gold18kt", pct: 75 },
  { key: "14kt", label: "14kt (58.5%)", rateField: "gold14kt", pct: 58.5 },
  { key: "9kt", label: "9kt (37.5%)", rateField: "gold9kt", pct: 37.5 },
];

export const DIAMOND_SHAPES = ["Round", "Princess", "Oval", "Cushion", "Pear", "Emerald", "Marquise", "Asscher", "Radiant", "Heart"];

export const LABGROWN_CARAT_SIZES = [0.30, 0.50, 0.70, 0.90, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12];

/**
 * @param {object} rapData - { rounds: {...}, fancy: {...} } from bullion_dropdowns.rapaport_data
 * @param {number} weight - carat weight
 * @param {string} color - one of RAP_COLORS
 * @param {string} clarity - one of RAP_CLARITIES (or "FL", mapped to IF)
 * @param {boolean} isRound
 * @returns {number|null} price in hundreds of $/ct, or null if out of table range
 */
export function rapLookup(rapData, weight, color, clarity, isRound) {
  const tables = isRound ? rapData?.rounds : rapData?.fancy;
  if (!tables) return null;
  const effectiveWeight = Math.min(weight, 5.0); // 5ct+ capped at 5ct pricing, same as Calculator
  let bracket = RAP_WEIGHT_RANGES[0];
  for (let i = 0; i < RAP_RANGE_MINS.length; i++) {
    if (effectiveWeight >= RAP_RANGE_MINS[i]) bracket = RAP_WEIGHT_RANGES[i];
  }
  const table = tables[bracket];
  if (!table) return null;
  const clar = clarity === "FL" ? "IF" : clarity;
  const ci = RAP_CLARITIES.indexOf(clar);
  const ki = RAP_COLORS.indexOf(color);
  if (ci < 0 || ki < 0 || !table[ci]) return null;
  return table[ci][ki] ?? null;
}

/**
 * Natural diamond value in ₹, via Rapaport lookup + USD/INR + buy/sell discount.
 * Returns null if weight is below the smallest banded range (0.30ct) or the
 * combo isn't in the table — caller should show "manual pricing" in that case.
 */
export function computeNaturalDiamondValue({ rapData, usdInr, weightCt, color, clarity, shape, sellDiscPct = 0 }) {
  if (!rapData || !usdInr || !weightCt || weightCt < 0.30) return null;
  const isRound = shape === "Round";
  const rap100 = rapLookup(rapData, weightCt, color, clarity, isRound);
  if (rap100 == null) return null;
  const rapInrPerCt = rap100 * 100 * usdInr;
  const sellPpc = rapInrPerCt * (1 - sellDiscPct / 100);
  return Math.round(sellPpc * weightCt);
}

/** Lab-grown diamond value in ₹, via the admin-editable price grid. */
export function computeLabgrownDiamondValue({ labgrownPrices, caratSize, shape }) {
  if (!labgrownPrices?.length || !caratSize) return null;
  const shapeMatch = labgrownPrices.find((p) => p.carat_size === caratSize && p.shape === shape);
  const row = shapeMatch || labgrownPrices.find((p) => p.carat_size === caratSize && !p.shape);
  if (!row || !row.price_per_ct) return null;
  return Math.round(row.price_per_ct * caratSize);
}

/** Gold value in ₹ for a given purity + estimated weight. Custom % uses gold24kt x pct/100. */
export function computeGoldValue({ rates, purityKey, customPct, weightG }) {
  if (!rates?.spot || !weightG) return null;
  if (purityKey === "custom") {
    if (!customPct || !rates.spot.gold24kt) return null;
    return Math.round(weightG * rates.spot.gold24kt * (customPct / 100));
  }
  const purity = GOLD_PURITIES.find((p) => p.key === purityKey);
  const rate = purity && rates.spot[purity.rateField];
  if (!rate) return null;
  return Math.round(weightG * rate);
}

/**
 * Full price breakdown for a solitaire design selection.
 * @param {object} params
 * @param {object} params.rates - getRates() result
 * @param {object} params.rapData - Rapaport table data
 * @param {number} params.usdInr
 * @param {array} params.labgrownPrices
 * @param {string} params.diamondSource - "natural" | "labgrown"
 * @param {number} params.caratSize
 * @param {string} params.shape
 * @param {string} params.diamondColor
 * @param {string} params.diamondClarity
 * @param {number} params.sellDiscPct
 * @param {string} params.purityKey
 * @param {number} params.customPct
 * @param {number} params.estGoldWeightG
 * @param {number} params.makingChargePerGram
 * @param {number} params.sideDiamondWeightCt - total ct of side/accent diamonds on this design (0/null if none)
 * @param {number} params.sideDiamondPricePerCt - admin-set ₹/ct rate for side melee, separate from the center stone
 */
export function computeSolitairePrice(params) {
  const {
    rates, rapData, usdInr, labgrownPrices,
    diamondSource, caratSize, shape, diamondColor, diamondClarity, sellDiscPct = 0,
    purityKey, customPct, estGoldWeightG, makingChargePerGram = 0,
    sideDiamondWeightCt = 0, sideDiamondPricePerCt = 0,
  } = params;

  const goldValue = computeGoldValue({ rates, purityKey, customPct, weightG: estGoldWeightG });

  const diamondValue = diamondSource === "labgrown"
    ? computeLabgrownDiamondValue({ labgrownPrices, caratSize, shape })
    : computeNaturalDiamondValue({ rapData, usdInr, weightCt: caratSize, color: diamondColor, clarity: diamondClarity, shape, sellDiscPct });

  const making = goldValue != null ? Math.round(estGoldWeightG * makingChargePerGram) : null;
  const sideDiamondValue = sideDiamondWeightCt > 0 ? Math.round(sideDiamondWeightCt * sideDiamondPricePerCt) : 0;

  if (goldValue == null || diamondValue == null) {
    return { goldValue, diamondValue, making, sideDiamondValue, total: null, priceable: false };
  }

  const total = goldValue + diamondValue + (making || 0) + sideDiamondValue;
  return { goldValue, diamondValue, making: making || 0, sideDiamondValue, total, priceable: true };
}
