-- Corporate gifting coins landing page (/corporategiftingcoins).
-- Standalone product table (not the jewellery `catalogue_products` schema —
-- that's built for purity/making-charge jewellery pricing; gifting coins are
-- simpler: a name, a category tab, an image, and one of three price modes).

create table if not exists corporate_gifting_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  category text not null check (category in ('gold_bars','gold_coins','silver_bars','silver_coins','silver_bar_coin','shagun_coins','basic_coins')),
  name text not null,
  description text,
  image_url text,
  sort_order int not null default 0,
  active boolean not null default true,
  -- Pricing: exactly one of these modes is used at read time.
  --   gifting_sheet — look up rates.giftingCoins by `gifting_sheet_name` (already GST-inclusive)
  --   live_gold     — weight_grams * rates.spot.gold24kt
  --   live_silver   — weight_grams * rates.spot.silverPerGram
  --   manual        — manual_price as-is
  price_mode text not null default 'manual' check (price_mode in ('gifting_sheet','live_gold','live_silver','manual')),
  gifting_sheet_name text,
  weight_grams numeric,
  manual_price numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_corp_gift_products_category on corporate_gifting_products(tenant_id, category, active, sort_order);

-- Corporate gifting drip funnel — inactive until Saurav assigns a WA session
-- and drip steps via the Funnels tab (FunnelsScreen / FunnelStepsEditor).
insert into funnels (id, tenant_id, name, description, kind, active, goal, product_focus)
values (
  'corporate_gifting',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Corporate Gifting',
  'Leads captured from the /corporategiftingcoins public landing page — bulk corporate coin gifting enquiries.',
  'acquisition',
  false,
  'Convert bulk gifting enquiry into an order',
  'gold_silver_coins'
)
on conflict (id) do nothing;

-- Seed product names from the existing "New Gold & Silver Coins Catalog" PDF.
-- All start inactive-priced (manual_price null → page shows "Contact for pricing")
-- until Saurav supplies photos + pricing basis per product.
insert into corporate_gifting_products (category, name, sort_order) values
  ('gold_bars', 'MMTC Lotus Gold Bar', 1),
  ('gold_bars', 'MMTC Laxmi Gold Bar', 2),
  ('gold_bars', 'MMTC Shankh Ganesh Laxmi Gold Bar', 3),
  ('gold_bars', 'MMTC Ram Lalla Gold Bar', 4),
  ('gold_bars', 'MMTC Rose Gold Bar', 5),
  ('gold_bars', 'MMTC Peacock Gold Bar', 6),

  ('gold_coins', 'Laxmi Gold Coin', 1),
  ('gold_coins', 'Lotus Gold Coin', 2),
  ('gold_coins', 'Sone Ki Chidiya Gold Coin', 3),
  ('gold_coins', 'Tree of Life Gold Coin', 4),
  ('gold_coins', 'Rose Gold Oval Coin', 5),
  ('gold_coins', 'Laxmi Gold Oval Coin', 6),

  ('silver_bars', 'MMTC Banyan Tree Silver Bar', 1),
  ('silver_bars', 'MMTC Ram Lalla Colored Silver Bar', 2),
  ('silver_bars', 'MMTC Guru Nanak Dev Colored Silver Bar', 3),
  ('silver_bars', 'MMTC Laxmi Colored Silver Bar', 4),
  ('silver_bars', 'Lord Shiva Silver Bar', 5),
  ('silver_bars', 'Laddoo Gopal Silver Bar', 6),

  ('silver_coins', 'Banyan Tree Silver Coin', 1),
  ('silver_coins', 'Ganesh Laxmi Silver Coin', 2),
  ('silver_coins', 'Ganesha Colored Silver Coin', 3),
  ('silver_coins', 'Shankh Shape Ganesh Laxmi Coin', 4),
  ('silver_coins', 'Bond Silver Coin', 5),
  ('silver_coins', 'Newborn Baby (Blue) Silver Coin', 6),

  ('silver_bar_coin', 'Stylized Laxmi Ganesh Colored Silver', 1),
  ('silver_bar_coin', 'Char Dham Silver Coin Set (20g x 4)', 2),
  ('silver_bar_coin', 'Purest Casted Silver Bar', 3),

  ('shagun_coins', '24K Banyan Tree Gold Coin (200mg, Box Packing)', 1),
  ('shagun_coins', 'Ganesh Laxmi Silver Coin (1gm, Box Packing)', 2),
  ('shagun_coins', 'Ganesh Laxmi Silver Coin (3gm, Box Packing)', 3),
  ('shagun_coins', 'Ganesh Laxmi Silver Coin (8gm, Box Packing)', 4),

  ('basic_coins', '24K (999.9) Gold Coin (Basic)', 1),
  ('basic_coins', '999 Silver Coin (Basic)', 2)
on conflict do nothing;
