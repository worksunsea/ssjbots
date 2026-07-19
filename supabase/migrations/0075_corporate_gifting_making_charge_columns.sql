-- Split the opaque markup_amount into transparent, staff-editable
-- components: making_charge (from MMTC's rate card, or Sun Sea's own once
-- the shagun sheet arrives) + tax_percent (GST on the making charge only,
-- per the rate card's own note — default 3%). Final price becomes:
--   weight_grams * live_rate  +  making_charge * (1 + tax_percent/100)
-- markup_amount is kept as a fallback for any row not yet given a real
-- making_charge (computePrice() prefers making_charge when set).

alter table corporate_gifting_products
  add column if not exists making_charge numeric,
  add column if not exists tax_percent numeric not null default 3;

-- Backfill from the markup_amount values just set in 0074 (which were
-- already making_charge*1.03) — reverse that back out into the two fields.
update corporate_gifting_products
set making_charge = round(markup_amount / 1.03), tax_percent = 3
where price_mode in ('live_gold_markup', 'live_silver_markup') and markup_amount is not null;
