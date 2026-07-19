-- Split MMTC Lotus Gold Bar and MMTC Banyan Tree Silver Bar into their real
-- weight variants (each is a separate sellable SKU on MMTC's own site), each
-- with its own markup derived from MMTC's price for that exact weight today
-- vs. weight*rate today (rate = gold24kt 14110/g, silverPerGram 220.9/g).
-- Same product photo reused across all weight variants (same coin, different
-- size — no need for separate photos, per Saurav 2026-07-19).
--
-- Note: MMTC does not sell a 20g Lotus Gold Bar (real sizes: 1/2/5/10/50/100g,
-- skipping the odd 31.1g denomination too) — using their actual lineup rather
-- than inventing a 20g row.

delete from corporate_gifting_products where name = 'MMTC Lotus Gold Bar';
delete from corporate_gifting_products where name = 'MMTC Banyan Tree Silver Bar';

insert into corporate_gifting_products (category, name, sort_order, price_mode, weight_grams, markup_amount, image_url) values
  ('gold_bars', 'MMTC Lotus Gold Bar (1g)',   1, 'live_gold_markup', 1,   2110,   'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),
  ('gold_bars', 'MMTC Lotus Gold Bar (2g)',   2, 'live_gold_markup', 2,   3950,   'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),
  ('gold_bars', 'MMTC Lotus Gold Bar (5g)',   3, 'live_gold_markup', 5,   9400,   'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),
  ('gold_bars', 'MMTC Lotus Gold Bar (10g)',  4, 'live_gold_markup', 10,  18570,  'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),
  ('gold_bars', 'MMTC Lotus Gold Bar (50g)',  5, 'live_gold_markup', 50,  81560,  'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),
  ('gold_bars', 'MMTC Lotus Gold Bar (100g)', 6, 'live_gold_markup', 100, 161750, 'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/xkpnu.png'),

  ('silver_bars', 'MMTC Banyan Tree Silver Bar (10g)',  1, 'live_silver_markup', 10,  821,  'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/870og.png'),
  ('silver_bars', 'MMTC Banyan Tree Silver Bar (20g)',  2, 'live_silver_markup', 20,  1512, 'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/870og.png'),
  ('silver_bars', 'MMTC Banyan Tree Silver Bar (50g)',  3, 'live_silver_markup', 50,  2095, 'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/870og.png'),
  ('silver_bars', 'MMTC Banyan Tree Silver Bar (100g)', 4, 'live_silver_markup', 100, 3610, 'https://cem-product-images.s3.ap-south-1.amazonaws.com/DEV/product/media/870og.png');
