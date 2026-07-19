-- Store each product's competitor website price as a separate reference
-- column (never used in our own price formula, purely for staff to audit
-- "how far is our computed price from what MMTC/shaguncoins actually
-- charge today"). computePrice() in api/corporate-gifting.js is unchanged
-- by this — it stays weight*rate + making_charge, GST on the total.

alter table corporate_gifting_products add column if not exists reference_price numeric;

-- shagun_coins rows: manual_price already holds the shaguncoins.com tier
-- reference price scraped 2026-07-19 — copy it into reference_price too.
update corporate_gifting_products set reference_price = manual_price
where category = 'shagun_coins' and manual_price is not null;

-- MMTC-sourced products: exact price scraped from mmtcpamp.com/shop/gold
-- and /shop/silver (+ per-weight product pages) on 2026-07-19.
update corporate_gifting_products set reference_price = 16630  where name = 'Rose Gold Oval Coin';
update corporate_gifting_products set reference_price = 81290  where name = 'Heaven on Earth Gold Coin';
update corporate_gifting_products set reference_price = 80170  where name = 'Shubh Aarambh Gold Coin';
update corporate_gifting_products set reference_price = 16220  where name = 'MMTC Lotus Gold Bar (1g)';
update corporate_gifting_products set reference_price = 32170  where name = 'MMTC Lotus Gold Bar (2g)';
update corporate_gifting_products set reference_price = 79950  where name = 'MMTC Lotus Gold Bar (5g)';
update corporate_gifting_products set reference_price = 159670 where name = 'MMTC Lotus Gold Bar (10g)';
update corporate_gifting_products set reference_price = 787060 where name = 'MMTC Lotus Gold Bar (50g)';
update corporate_gifting_products set reference_price = 1572750 where name = 'MMTC Lotus Gold Bar (100g)';
update corporate_gifting_products set reference_price = 8420   where name = 'Lotus Gold Coin';
update corporate_gifting_products set reference_price = 79950  where name = 'Laxmi Gold Coin';
update corporate_gifting_products set reference_price = 159890 where name = 'Sone Ki Chidiya Gold Coin';
update corporate_gifting_products set reference_price = 32170  where name = 'MMTC Peacock Gold Bar';
update corporate_gifting_products set reference_price = 159670 where name = 'MMTC Ram Lalla Gold Bar';
update corporate_gifting_products set reference_price = 159670 where name = 'MMTC Rose Gold Bar';
update corporate_gifting_products set reference_price = 79950  where name = 'Love Forever Gold Coin';
update corporate_gifting_products set reference_price = 32170  where name = 'Laxmi Gold Oval Coin';
update corporate_gifting_products set reference_price = 159670 where name = 'MMTC Laxmi Gold Bar';
update corporate_gifting_products set reference_price = 159730 where name = 'MMTC Shankh Ganesh Laxmi Gold Bar';
update corporate_gifting_products set reference_price = 319010 where name = 'Shankh Laxmi Gold Coin';
update corporate_gifting_products set reference_price = 127340 where name = 'Maharajadhiraj Rajaraam Gold Coin';

update corporate_gifting_products set reference_price = 13970  where name = 'Lord Buddha Silver Bar';
update corporate_gifting_products set reference_price = 14820  where name = 'Lord Hanuman Silver Bar';
update corporate_gifting_products set reference_price = 13970  where name = 'Bouquet of Flower Silver Coin';
update corporate_gifting_products set reference_price = 13600  where name = 'Vaishno Devi Silver Coin';
update corporate_gifting_products set reference_price = 13600  where name = 'Lord Shiva Silver Bar';
update corporate_gifting_products set reference_price = 3030   where name = 'MMTC Banyan Tree Silver Bar (10g)';
update corporate_gifting_products set reference_price = 5930   where name = 'MMTC Banyan Tree Silver Bar (20g)';
update corporate_gifting_products set reference_price = 13140  where name = 'MMTC Banyan Tree Silver Bar (50g)';
update corporate_gifting_products set reference_price = 25700  where name = 'MMTC Banyan Tree Silver Bar (100g)';
update corporate_gifting_products set reference_price = 13370  where name = 'MMTC Ram Lalla Colored Silver Bar';
update corporate_gifting_products set reference_price = 22900  where name = 'Char Dham Silver Coin Set (20g x 4)';
update corporate_gifting_products set reference_price = 65620  where name = 'Purest Casted Silver Bar';
update corporate_gifting_products set reference_price = 3030   where name = 'Ganesh Laxmi Silver Coin';
update corporate_gifting_products set reference_price = 13370  where name = 'Ashta Laxmi Silver Coin';
update corporate_gifting_products set reference_price = 13370  where name = 'Ganesha Colored Silver Coin';
update corporate_gifting_products set reference_price = 6050   where name = 'MMTC Laxmi Colored Silver Bar';
update corporate_gifting_products set reference_price = 13370  where name = 'MMTC Guru Nanak Dev Colored Silver Bar';
update corporate_gifting_products set reference_price = 1810   where name = 'Banyan Tree Silver Coin';
update corporate_gifting_products set reference_price = 13800  where name = 'Shankh Shape Ganesh Laxmi Coin';
update corporate_gifting_products set reference_price = 8890   where name = 'Maharishi Mahesh Yogi Silver Coin';
update corporate_gifting_products set reference_price = 8890   where name = 'Adi Shankaracharya Silver Coin';
update corporate_gifting_products set reference_price = 8890   where name = 'Swami Brahmananda Saraswati Silver Coin';
update corporate_gifting_products set reference_price = 6050   where name = 'Newborn Baby (Blue) Silver Coin';
update corporate_gifting_products set reference_price = 13370  where name = 'Stylized Laxmi Ganesh Colored Silver';
update corporate_gifting_products set reference_price = 13370  where name = 'Balaji Silver Bar';
update corporate_gifting_products set reference_price = 26370  where name = 'Sukh Samridhi Silver Bar';
update corporate_gifting_products set reference_price = 13370  where name = 'Laddoo Gopal Silver Bar';
