-- Replace the back-computed markup_amount values (derived from matching
-- MMTC's retail price on scrape day) with REAL making charges from MMTC's
-- official "Making Charges — July 2026" rate card (given directly by
-- Saurav). This is a meaningfully better basis: our price = OUR bullion
-- rate (rates tab, already live) x weight + MMTC's actual making charge
-- (+3% GST on the making charge, per the card's own note) — legitimate
-- cost-plus pricing rather than mirroring a competitor's retail price.
-- markup_amount = making_charge * 1.03, rounded.

-- ── Lotus Gold Bar — full official weight lineup, including 20g (missed
-- earlier — MMTC's product listing pages don't sell 20g as its own SKU,
-- but the making-charge card confirms it's a real denomination). ────────
update corporate_gifting_products set markup_amount = 309  where name = 'MMTC Lotus Gold Bar (1g)';
update corporate_gifting_products set markup_amount = 361  where name = 'MMTC Lotus Gold Bar (2g)';
update corporate_gifting_products set markup_amount = 824  where name = 'MMTC Lotus Gold Bar (5g)';
update corporate_gifting_products set markup_amount = 1442 where name = 'MMTC Lotus Gold Bar (10g)';
update corporate_gifting_products set markup_amount = 3605 where name = 'MMTC Lotus Gold Bar (50g)';
update corporate_gifting_products set markup_amount = 5923 where name = 'MMTC Lotus Gold Bar (100g)';
insert into corporate_gifting_products (category, name, sort_order, price_mode, weight_grams, markup_amount, image_url)
select 'gold_bars', 'MMTC Lotus Gold Bar (20g)', 4, 'live_gold_markup', 20, 2575, image_url
from corporate_gifting_products where name = 'MMTC Lotus Gold Bar (10g)'
on conflict do nothing;
update corporate_gifting_products set sort_order = 5 where name = 'MMTC Lotus Gold Bar (50g)';
update corporate_gifting_products set sort_order = 6 where name = 'MMTC Lotus Gold Bar (100g)';

-- ── Banyan Tree Silver Bar / Ganesh Laxmi Silver Coin (same series) ─────
update corporate_gifting_products set markup_amount = 216  where name = 'MMTC Banyan Tree Silver Bar (10g)';
update corporate_gifting_products set markup_amount = 288  where name = 'MMTC Banyan Tree Silver Bar (20g)';
update corporate_gifting_products set markup_amount = 618  where name = 'MMTC Banyan Tree Silver Bar (50g)';
update corporate_gifting_products set markup_amount = 1133 where name = 'MMTC Banyan Tree Silver Bar (100g)';
update corporate_gifting_products set markup_amount = 216  where name = 'Ganesh Laxmi Silver Coin';

-- ── Other gold products with a direct making-charge match ───────────────
update corporate_gifting_products set markup_amount = 335  where name = 'Rose Gold Oval Coin';          -- 1g Rose Oval 325*1.03
update corporate_gifting_products set markup_amount = 361  where name = 'Laxmi Gold Oval Coin';          -- 2g Rose Oval 350*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Laxmi Gold Coin';                -- Lakshmi Series 5g 800*1.03
update corporate_gifting_products set markup_amount = 361  where name = 'MMTC Peacock Gold Bar';          -- generic 2g ingot 350*1.03
update corporate_gifting_products set markup_amount = 1442 where name = 'MMTC Ram Lalla Gold Bar';        -- Ram Lalla 10g 1400*1.03
update corporate_gifting_products set markup_amount = 1442 where name = 'MMTC Rose Gold Bar';             -- Rose Series 10g 1400*1.03
update corporate_gifting_products set markup_amount = 1442 where name = 'MMTC Laxmi Gold Bar';            -- Lakshmi Series 10g 1400*1.03
update corporate_gifting_products set markup_amount = 1494 where name = 'MMTC Shankh Ganesh Laxmi Gold Bar'; -- Shankh 5g+5g 1450*1.03
update corporate_gifting_products set markup_amount = 1133 where name = 'Tree of Life Gold Coin';         -- Tree of Life 22K 8g 1100*1.03
update corporate_gifting_products set markup_amount = 227  where name = 'Lotus Gold Coin';                -- Lotus Series 0.5g 220*1.03
update corporate_gifting_products set markup_amount = 1648 where name = 'Sone Ki Chidiya Gold Coin';      -- 1600*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Heaven on Earth Gold Coin';      -- 1000*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Shubh Aarambh Gold Coin';        -- 1000*1.03
update corporate_gifting_products set markup_amount = 2575 where name = 'Shankh Laxmi Gold Coin';         -- Shankh 20g 2500*1.03
update corporate_gifting_products set markup_amount = 1339 where name = 'Maharajadhiraj Rajaraam Gold Coin'; -- 1300*1.03

-- ── Other silver products with a direct making-charge match ─────────────
update corporate_gifting_products set markup_amount = 1030 where name = 'Lord Buddha Silver Bar';         -- 1000*1.03
update corporate_gifting_products set markup_amount = 1442 where name = 'Lord Hanuman Silver Bar';        -- 1400*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Bouquet of Flower Silver Coin';  -- 1000*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Vaishno Devi Silver Coin';       -- 1000*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Lord Shiva Silver Bar';          -- 1000*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'MMTC Ram Lalla Colored Silver Bar'; -- Ram Lalla Ayodhya 50g 800*1.03
update corporate_gifting_products set markup_amount = 2678 where name = 'Char Dham Silver Coin Set (20g x 4)'; -- 2600*1.03
update corporate_gifting_products set markup_amount = 1700 where name = 'Purest Casted Silver Bar';       -- Cast Bar 250g 1650*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Ashta Laxmi Silver Coin';        -- 800*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Ganesha Colored Silver Coin';    -- Lord Ganesha 800*1.03
update corporate_gifting_products set markup_amount = 422  where name = 'MMTC Laxmi Colored Silver Bar';  -- Goddess Lakshmi Coloured 20g 410*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'MMTC Guru Nanak Dev Colored Silver Bar'; -- 800*1.03
update corporate_gifting_products set markup_amount = 1210 where name = 'Shankh Shape Ganesh Laxmi Coin'; -- Lakshmi Ganesh Shankh 25+25g 1175*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Maharishi Mahesh Yogi Silver Coin'; -- 1000*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Adi Shankaracharya Silver Coin';    -- 1000*1.03
update corporate_gifting_products set markup_amount = 1030 where name = 'Swami Brahmananda Saraswati Silver Coin'; -- 1000*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Stylized Laxmi Ganesh Colored Silver'; -- 800*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Balaji Silver Bar';               -- Lord Balaji 800*1.03
update corporate_gifting_products set markup_amount = 1751 where name = 'Sukh Samridhi Silver Bar';       -- Coloured 100g 1700*1.03
update corporate_gifting_products set markup_amount = 824  where name = 'Laddoo Gopal Silver Bar';        -- 800*1.03
-- 'Love Forever Gold Coin', 'Banyan Tree Silver Coin', 'Newborn Baby (Blue) Silver Coin' — no match
-- in the making-charge card, left on their earlier back-computed markup.
