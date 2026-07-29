-- Products sourced from MMTC's catalogue (image_url on cem-product-images.s3
-- bucket, MMTC-PAMP's own product media host) that were left in the generic
-- gold_coins/silver_coins/silver_bars/silver_bar_coin categories instead of
-- mmtc_gold/mmtc_silver. Reassign by metal so all MMTC stock lives under the
-- MMTC Gold / MMTC Silver heads consistently.

update corporate_gifting_products set category = 'mmtc_gold'
  where category = 'gold_coins' and image_url ilike '%cem-product-images%';

update corporate_gifting_products set category = 'mmtc_silver'
  where category in ('silver_coins', 'silver_bars', 'silver_bar_coin')
    and image_url ilike '%cem-product-images%';
