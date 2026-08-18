-- Schemes with a gold end-redemption (perks.redemption =
-- 'jewellery_or_raw_gold' or 'sell_anytime_or_jewellery' — Golden Sparkle,
-- Gullak) let each member pick their own monthly amount in ₹5,000
-- multiples (₹5,000 up to ₹3,00,000), instead of the scheme's fixed
-- monthly_amount. Stored per-enrollment so buildInstallmentSchedule can use
-- it instead of the scheme default. Mid-cycle top-ups already work via the
-- existing action=add-installment (any active enrollment, any month) — all
-- contributions (base schedule + top-ups) already sum into total gold
-- grams via kitty-client.js's rate_locked-based calculation, no schema
-- change needed for that part.

alter table public.kitty_enrollments add column monthly_amount_override numeric;
