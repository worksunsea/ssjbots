// Shared gram-derivation math for kitty installments. Grams are always
// derived as paid_amount / rate_locked, counted only for settled rows
// (status "paid" or "free") — kept in one place instead of duplicated
// inline (previously in api/kitty-client.js and src/KittyAdmin.jsx).

export function gramsForInstallments(installments) {
  const settled = (installments || []).filter((i) => i.status === "paid" || i.status === "free");
  const totalGrams = settled.reduce((sum, i) => (i.rate_locked ? sum + Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : sum), 0);
  const totalPaid = settled.reduce((sum, i) => sum + Number(i.paid_amount ?? i.amount ?? 0), 0);
  return { totalGrams: Number(totalGrams.toFixed(3)), totalPaid };
}
