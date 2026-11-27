-- The Rapaport $/ct actually used to price a natural stone (backend Rapaport table, else the sheet's Rap).
-- Public: shown on the stone page with the discount and the USD/INR used, so the price can be re-checked by hand.
alter table public.cvd_stones add column if not exists rap_used_usd numeric(12,2),
  add column if not exists usd_rate_used numeric(8,2);  -- live USD/INR the natural price was calculated with
