-- Stock for corporate gifting products. Staff set it in the CRM (Corporate Gifting Pricing).
--   in_stock  : master switch (false = website shows "Out of stock - Request to buy")
--   stock_qty : units on hand, CRM-only (never sent to the website). null = not tracked.
-- Website shows "Available" when in_stock and (stock_qty is null or > 0).
alter table public.corporate_gifting_products
  add column if not exists in_stock boolean not null default true,
  add column if not exists stock_qty integer check (stock_qty is null or stock_qty >= 0);
