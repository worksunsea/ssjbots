-- Shagun coin weight tiers, pulled from Saurav's "Corporate Gold Coin" flyer
-- (Canva design DAHPzm01fl8): 24K Banyan Tree Gold Coin, box-packed, offered
-- in 20mg / 50mg / 100mg / 200mg / 500mg. Switching to live pricing (weight x
-- gold rate) same as the other categories. Photos still pending — the flyer
-- is a marketing mockup (brand-box placeholders), not clean per-product
-- photography, so image_url stays null until Saurav sends real coin photos.

update corporate_gifting_products
set price_mode = 'live_gold', weight_grams = 0.2
where name = '24K Banyan Tree Gold Coin (200mg, Box Packing)';

insert into corporate_gifting_products (category, name, sort_order, price_mode, weight_grams) values
  ('shagun_coins', '24K Banyan Tree Gold Coin (20mg, Box Packing)', 0, 'live_gold', 0.02),
  ('shagun_coins', '24K Banyan Tree Gold Coin (50mg, Box Packing)', 1, 'live_gold', 0.05),
  ('shagun_coins', '24K Banyan Tree Gold Coin (100mg, Box Packing)', 2, 'live_gold', 0.1),
  ('shagun_coins', '24K Banyan Tree Gold Coin (500mg, Box Packing)', 4, 'live_gold', 0.5)
on conflict do nothing;
