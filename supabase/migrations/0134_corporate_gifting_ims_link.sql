-- Link a corporate-gifting coin to its FMS IMS SKU (ims_jw_items, migration 021 in fms-tracker).
-- Once the IMS item has an opening count (opening_as_of set), website availability follows
-- IMS stock (sales and purchases in FMS) instead of the manual in_stock / stock_qty fields.
alter table public.corporate_gifting_products
  add column if not exists sku_code text,
  add column if not exists ims_item_id uuid references public.ims_jw_items(id) on delete set null;
create index if not exists corporate_gifting_products_ims_item on public.corporate_gifting_products(ims_item_id);
