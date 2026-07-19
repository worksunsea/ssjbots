-- Fill in weight_grams + live pricing for products seeded in 0066, and add
-- products found on MMTC-PAMP's public shop pages (mmtcpamp.com/shop/gold,
-- /shop/silver) that weren't in the original PDF catalogue. Pricing stays
-- OURS (live rate x weight, via price_mode=live_gold/live_silver) — not
-- copied from MMTC's own retail price, which includes their markup.
-- One-time content pull, not a recurring sync job (see chat 2026-07-19).

-- ── Existing gold_bars — fill weight, switch to live pricing ──────────────
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 1  where name = 'MMTC Lotus Gold Bar';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 10 where name = 'MMTC Laxmi Gold Bar';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 10 where name = 'MMTC Shankh Ganesh Laxmi Gold Bar';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 10 where name = 'MMTC Ram Lalla Gold Bar';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 10 where name = 'MMTC Rose Gold Bar';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 2  where name = 'MMTC Peacock Gold Bar';

-- ── Existing gold_coins ────────────────────────────────────────────────────
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 5   where name = 'Laxmi Gold Coin';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 0.5 where name = 'Lotus Gold Coin';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 10  where name = 'Sone Ki Chidiya Gold Coin';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 1   where name = 'Rose Gold Oval Coin';
update corporate_gifting_products set price_mode = 'live_gold', weight_grams = 2   where name = 'Laxmi Gold Oval Coin';
-- 'Tree of Life Gold Coin' not found on MMTC shop pages — left as manual/no weight.

-- ── Existing silver_bars ───────────────────────────────────────────────────
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 10 where name = 'MMTC Banyan Tree Silver Bar';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'MMTC Ram Lalla Colored Silver Bar';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'MMTC Guru Nanak Dev Colored Silver Bar';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 20 where name = 'MMTC Laxmi Colored Silver Bar';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'Lord Shiva Silver Bar';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'Laddoo Gopal Silver Bar';

-- ── Existing silver_coins ───────────────────────────────────────────────────
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 5  where name = 'Banyan Tree Silver Coin';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 10 where name = 'Ganesh Laxmi Silver Coin';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'Ganesha Colored Silver Coin';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50 where name = 'Shankh Shape Ganesh Laxmi Coin';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 20 where name = 'Newborn Baby (Blue) Silver Coin';
-- 'Bond Silver Coin' not found on MMTC shop pages — left as manual/no weight.

-- ── Existing silver_bar_coin ────────────────────────────────────────────────
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 50  where name = 'Stylized Laxmi Ganesh Colored Silver';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 80  where name = 'Char Dham Silver Coin Set (20g x 4)';
update corporate_gifting_products set price_mode = 'live_silver', weight_grams = 250 where name = 'Purest Casted Silver Bar';

-- ── New products found on MMTC shop pages, not in the original PDF ─────────
insert into corporate_gifting_products (category, name, sort_order, price_mode, weight_grams) values
  ('gold_coins', 'Heaven on Earth Gold Coin', 10, 'live_gold', 5),
  ('gold_coins', 'Shubh Aarambh Gold Coin', 11, 'live_gold', 5),
  ('gold_coins', 'Love Forever Gold Coin', 12, 'live_gold', 5),
  ('gold_coins', 'Shankh Laxmi Gold Coin', 13, 'live_gold', 20),
  ('gold_coins', 'Maharajadhiraj Rajaraam Gold Coin', 14, 'live_gold', 8),

  ('silver_bars', 'Lord Buddha Silver Bar', 10, 'live_silver', 50),
  ('silver_bars', 'Lord Hanuman Silver Bar', 11, 'live_silver', 50),
  ('silver_bars', 'Balaji Silver Bar', 12, 'live_silver', 50),
  ('silver_bars', 'Sukh Samridhi Silver Bar', 13, 'live_silver', 100),

  ('silver_coins', 'Bouquet of Flower Silver Coin', 10, 'live_silver', 50),
  ('silver_coins', 'Vaishno Devi Silver Coin', 11, 'live_silver', 50),
  ('silver_coins', 'Ashta Laxmi Silver Coin', 12, 'live_silver', 50),
  ('silver_coins', 'Maharishi Mahesh Yogi Silver Coin', 13, 'live_silver', 31.1),
  ('silver_coins', 'Adi Shankaracharya Silver Coin', 14, 'live_silver', 31.1),
  ('silver_coins', 'Swami Brahmananda Saraswati Silver Coin', 15, 'live_silver', 31.1)
on conflict do nothing;
