// Corporate-gifting price formula. Shared by api/corporate-gifting.js (public
// catalogue) and the CRM Corp Gifting Pricing screen (live preview while typing),
// so what staff see before saving is exactly what customers will see.

export function computePrice(p, rates) {
  if (p.price_mode === "manual") return p.manual_price != null ? Number(p.manual_price) : null;
  if (p.price_mode === "gifting_sheet") {
    const match = (rates.giftingCoins || []).find((g) => g.name === p.gifting_sheet_name);
    return match?.price ?? (p.manual_price != null ? Number(p.manual_price) : null);
  }
  if (p.price_mode === "live_gold") {
    const rate = rates.spot.gold24kt;
    if (rate != null && p.weight_grams != null) return Math.round(Number(p.weight_grams) * rate);
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  if (p.price_mode === "live_silver") {
    const rate = rates.spot.silverPerGram;
    if (rate != null && p.weight_grams != null) return Math.round(Number(p.weight_grams) * rate);
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  // live_gold_markup / live_gold22_markup / live_silver_markup: (weight x today's rate from our
  // rates tab + making_charge) x (1 + tax_percent/100) + price_diff — GST
  // is charged on the full invoice value (metal + making), not just the
  // making charge; default 3% on both gold and silver. price_diff is a
  // staff-editable adjustment (set once from today's competitor price,
  // editable anytime) that lands the total on their price today, while
  // the bullion component keeps tracking our rates tab daily. Falls back
  // to markup_amount for rows that don't have a real making_charge yet.
  // live_gold22_markup: same formula for 22K (916.7) coins, priced off the 22KT rate.
  if (p.price_mode === "live_gold_markup" || p.price_mode === "live_gold22_markup" || p.price_mode === "live_silver_markup") {
    const rate = p.price_mode === "live_gold_markup" ? rates.spot.gold24kt
      : p.price_mode === "live_gold22_markup" ? rates.spot.gold22kt
      : rates.spot.silverPerGram;
    if (rate != null && p.weight_grams != null) {
      const bullionValue = Number(p.weight_grams) * rate;
      if (p.making_charge != null) {
        return Math.round((bullionValue + Number(p.making_charge)) * (1 + Number(p.tax_percent ?? 3) / 100) + Number(p.price_diff || 0));
      }
      if (p.markup_amount != null) return Math.round(bullionValue + Number(p.markup_amount));
    }
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  return null;
}
