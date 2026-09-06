-- Mission 100 sells only 1g MMTC 24kt gold coins — no 2g/5g/10g coin
-- denomination. 1 unit = 1 coin = 1g. A member can still buy any quantity
-- of units in one purchase (e.g. 5 units = 5 x 1g coins), but there is no
-- bigger single-coin SKU — every unit is individually priced at that
-- day's live gold rate at the moment of payment, same math as before
-- (add-installment/mission100-payment already derive rate_locked =
-- amount/grams uniformly; this only removes the "bigger coin" framing).
update public.kitty_schemes
set perks = perks - 'weight_tiers_g' || jsonb_build_object(
  'unit_grams', 1,
  'mmtc_1g_coin_only', true
)
where slug = 'mission-100';
