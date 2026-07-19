-- Switch MMTC- and shaguncoins-sourced products from flat live-metal pricing
-- to "live metal rate + fixed markup" — the markup is each product's
-- competitor price today minus (its weight x our rate today), so tomorrow's
-- price auto-updates with our rates tab while keeping the making-charge/
-- packaging premium constant. Anchor rates used to derive markup today
-- (2026-07-19): gold24kt = 14110/g, silverPerGram = 220.9/g (from our own
-- rates tab at the time this was computed).

alter table corporate_gifting_products
  add column if not exists markup_amount numeric;

alter table corporate_gifting_products drop constraint if exists corporate_gifting_products_price_mode_check;
alter table corporate_gifting_products add constraint corporate_gifting_products_price_mode_check
  check (price_mode in ('gifting_sheet','live_gold','live_silver','live_gold_markup','live_silver_markup','manual'));

-- Two shagun-coin image URLs that were dropped earlier due to output truncation.
update corporate_gifting_products set image_url = 'https://img.jewelflix.com/indigo-prints4170/products/bifwhgfeajzu053kdeul' where name = '10 GRAM SILVER COIN BIG SIZE PREMIUM - 60MM - best wishes';
update corporate_gifting_products set image_url = 'https://img.jewelflix.com/indigo-prints4170/products/k8ta0dawk3mivvdvao0c' where name = '1 GRAM SILVER COIN PREMIUM - BIRTHDAY';

-- ── MMTC-sourced gold products: markup = mmtc_price_today - weight*14110 ──
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=2520  where name = 'Rose Gold Oval Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=10740 where name = 'Heaven on Earth Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=9620  where name = 'Shubh Aarambh Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=2110  where name = 'MMTC Lotus Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=1365  where name = 'Lotus Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=9400  where name = 'Laxmi Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=18790 where name = 'Sone Ki Chidiya Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=3950  where name = 'MMTC Peacock Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=18570 where name = 'MMTC Ram Lalla Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=18570 where name = 'MMTC Rose Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=9400  where name = 'Love Forever Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=3950  where name = 'Laxmi Gold Oval Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=18570 where name = 'MMTC Laxmi Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=18630 where name = 'MMTC Shankh Ganesh Laxmi Gold Bar';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=36810 where name = 'Shankh Laxmi Gold Coin';
update corporate_gifting_products set price_mode='live_gold_markup', markup_amount=14460 where name = 'Maharajadhiraj Rajaraam Gold Coin';

-- ── MMTC-sourced silver products: markup = mmtc_price_today - weight*220.9 ──
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2925  where name = 'Lord Buddha Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=3775  where name = 'Lord Hanuman Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2925  where name = 'Bouquet of Flower Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2555  where name = 'Vaishno Devi Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2555  where name = 'Lord Shiva Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=821   where name = 'MMTC Banyan Tree Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'MMTC Ram Lalla Colored Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=5228  where name = 'Char Dham Silver Coin Set (20g x 4)';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=10395 where name = 'Purest Casted Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=821   where name = 'Ganesh Laxmi Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'Ashta Laxmi Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'Ganesha Colored Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=1632  where name = 'MMTC Laxmi Colored Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'MMTC Guru Nanak Dev Colored Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=706   where name = 'Banyan Tree Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2755  where name = 'Shankh Shape Ganesh Laxmi Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2020  where name = 'Maharishi Mahesh Yogi Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2020  where name = 'Adi Shankaracharya Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2020  where name = 'Swami Brahmananda Saraswati Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=1632  where name = 'Newborn Baby (Blue) Silver Coin';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'Stylized Laxmi Ganesh Colored Silver';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'Balaji Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=4280  where name = 'Sukh Samridhi Silver Bar';
update corporate_gifting_products set price_mode='live_silver_markup', markup_amount=2325  where name = 'Laddoo Gopal Silver Bar';

-- ── shaguncoins.com products (sort_order 100-229): parse weight from the
-- leading "<n> mg."/"<n> GRAM"/"<n> GARM" token in the name (already the
-- TOTAL product weight, incl. multi-coin sets), then markup = the reference
-- manual_price we stored - weight*rate. GOLD/SILVER picked from the name.
update corporate_gifting_products
set
  weight_grams = case
    when name ~* '^\d+(\.\d+)?\s*mg' then (regexp_match(name, '^(\d+(\.\d+)?)\s*mg', 'i'))[1]::numeric / 1000
    when name ~* '^\d+(\.\d+)?\s*g(ram|arm)' then (regexp_match(name, '^(\d+(\.\d+)?)\s*g(ram|arm)', 'i'))[1]::numeric
    else weight_grams
  end
where category = 'shagun_coins' and sort_order between 100 and 229;

update corporate_gifting_products
set
  price_mode = case when name ~* 'gold' then 'live_gold_markup' else 'live_silver_markup' end,
  markup_amount = round(manual_price - weight_grams * (case when name ~* 'gold' then 14110 else 220.9 end))
where category = 'shagun_coins' and sort_order between 100 and 229 and weight_grams is not null and manual_price is not null;
