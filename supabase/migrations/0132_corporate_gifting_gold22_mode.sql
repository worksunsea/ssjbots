-- 22K (916.7) gold coins (e.g. The Oxford Mint Sovereign) are priced off the 22KT rate, not 24KT.
-- Same formula as live_gold_markup; see api/_lib/giftingPrice.js.
alter table corporate_gifting_products drop constraint if exists corporate_gifting_products_price_mode_check;
alter table corporate_gifting_products add constraint corporate_gifting_products_price_mode_check
  check (price_mode in ('gifting_sheet','live_gold','live_silver','live_gold_markup','live_gold22_markup','live_silver_markup','manual'));
