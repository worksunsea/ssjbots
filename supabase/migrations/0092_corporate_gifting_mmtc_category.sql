-- MMTC-branded bars get their own categories (mmtc_gold / mmtc_silver)
-- instead of being mixed into gold_bars/silver_bars, and always list
-- lowest-to-highest price on the storefront (see api/corporate-gifting.js
-- action=products, which price-sorts these two categories server-side).

alter table corporate_gifting_products drop constraint corporate_gifting_products_category_check;
alter table corporate_gifting_products add constraint corporate_gifting_products_category_check
  check (category = any (array[
    'gold_bars', 'gold_coins', 'silver_bars', 'silver_coins',
    'silver_bar_coin', 'shagun_coins', 'basic_coins',
    'mmtc_gold', 'mmtc_silver'
  ]::text[]));

update corporate_gifting_products set category = 'mmtc_gold'
  where category = 'gold_bars' and name ilike '%mmtc%';

update corporate_gifting_products set category = 'mmtc_silver'
  where category = 'silver_bars' and name ilike '%mmtc%';
