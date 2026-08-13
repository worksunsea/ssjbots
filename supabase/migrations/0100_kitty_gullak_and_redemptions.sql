-- Folds the older gullak-box gold-accumulation product into the same
-- kitty_schemes system (was previously a hardcoded page + kitty-interest.js
-- lead-only capture, no real backend). Also adds:
--   * kitty_redemptions — a real "redeem now" record, usable mid-cycle
--     (someone can exit early) or at natural completion, not just a
--     claim_status label flip.
--   * kitty_schemes.monthly_amount made nullable — gullak is gram-based
--     (perks.unit = 'grams'), not a fixed rupee amount.

alter table public.kitty_schemes alter column monthly_amount drop not null;

create table public.kitty_redemptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.ssj_tenant_id(),
  enrollment_id      uuid not null references public.kitty_enrollments(id) on delete cascade,
  redemption_type    text not null, -- jewellery | raw_gold | benefit | other
  item_description   text,
  value              numeric,
  notes              text,
  redeemed_by        text,
  redeemed_at        timestamptz not null default now()
);

create index kitty_redemptions_enrollment_idx on public.kitty_redemptions (enrollment_id);

alter table public.kitty_redemptions enable row level security;
create policy anon_tenant on public.kitty_redemptions for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

insert into public.kitty_schemes (tenant_id, name, slug, monthly_amount, duration_months, perks, description, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Gullak Gold Savings', 'gullak-gold-savings', null, 36,
   '{"unit": "grams", "weight_tiers_g": [1, 2, 5, 10], "gullak_option": true, "redemption": "sell_anytime_or_jewellery", "making_charge_discount_pct": 50}'::jsonb,
   'Buy gold monthly from just 1 gram — or step up to 2g, 5g, or 10g tiers. Invest online or via a physical gullak (savings box) collection. The gold is yours from day one, whether kept with you or secured with us. Buying steadily over the scheme term (around 3 years) averages your purchase price plus any appreciation. Sell anytime at that day''s market rate, or convert to jewellery for flat 50% off (minimum) on making charges.', 0);
