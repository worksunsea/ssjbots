// Diamond / stone / misc line helpers for the jewellery calculator.
// A line's unit is "ct" or "g" (rate is per unit), or "ct_flat" / "g_flat":
// the weight is still deducted from gross gold, but the rate is charged once
// as a flat amount instead of weight x rate.

export const STONE_UNITS = [
  { value: "ct", label: "ct" },
  { value: "g", label: "g" },
  { value: "ct_flat", label: "ct · flat ₹" },
  { value: "g_flat", label: "g · flat ₹" },
];

export const isFlatUnit = (unit) => typeof unit === "string" && unit.endsWith("_flat");
export const unitBase = (unit) => (typeof unit === "string" && unit.startsWith("ct") ? "ct" : "g");
export const unitLabel = (unit) => (isFlatUnit(unit) ? `${unitBase(unit)} flat` : unitBase(unit));

// Weight in grams (1 ct = 0.2 g) — what gets deducted from gross gold weight.
export const weightToGrams = (wt, unit) => {
  const w = parseFloat(wt || 0) || 0;
  return unitBase(unit) === "ct" ? w * 0.2 : w;
};

// Money for a stone/diamond line. Flat units: the rate itself, only when a
// weight is entered. Per-unit: weight x rate.
export const lineValue = (wt, rate, unit) => {
  const w = parseFloat(wt || 0) || 0;
  const r = parseFloat(rate || 0) || 0;
  if (isFlatUnit(unit)) return w > 0 ? r : 0;
  return w * r;
};

// Next unit when the misc line's compact toggle button is clicked.
export const nextUnit = (unit) => {
  const i = STONE_UNITS.findIndex((u) => u.value === unit);
  return STONE_UNITS[(i + 1) % STONE_UNITS.length].value;
};
