-- Monthly Kitty gold-savings schemes (MYNN card: Golden Bliss/Bloom/Sparkle/
-- Glow/Serenty) — fully admin-defined via the CRM Kitty Admin screen, no
-- hardcoded scheme templates. Distinct from the older, unrelated gullak-box
-- "buy 1g/month" concept (kitty-interest.js / bullion_leads.extra_fields —
-- left untouched, still its own product on a separate ssj.in page).
--
-- kitty_schemes.perks holds the per-scheme perk toggles (lucky draw,
-- non-winner benefit, gold-coin chance, free-installment month, rate-lock
-- day, making-charge discount, redemption mode) as jsonb so the admin form
-- and the public card renderer share one shape with zero per-scheme code.
--
-- kitty_enrollments.scheme_id is nullable + is_legacy/legacy_scheme_name
-- exist so staff can hand-enter old, already-paid-up-but-unclaimed members
-- who predate this system and don't cleanly map to a current scheme row.

create table public.kitty_schemes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.ssj_tenant_id(),
  name                text not null,
  slug                text not null,
  monthly_amount      numeric not null,
  duration_months     int not null default 12,
  perks               jsonb not null default '{}'::jsonb,
  description         text,
  active              boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index kitty_schemes_tenant_slug_idx on public.kitty_schemes (tenant_id, slug);
create index kitty_schemes_active_idx on public.kitty_schemes (tenant_id, active);

create table public.kitty_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.ssj_tenant_id(),
  lead_id             uuid not null references public.bullion_leads(id) on delete cascade,
  scheme_id           uuid references public.kitty_schemes(id),
  is_legacy           boolean not null default false,
  legacy_scheme_name  text,
  status              text not null default 'pending_confirmation',
    -- interested | pending_confirmation | active | completed | cancelled
  start_date          date,
  confirmed_by        text,
  confirmed_at        timestamptz,
  claim_status        text not null default 'not_applicable',
    -- not_applicable | unclaimed | reminded | claimed
  claimed_at          timestamptz,
  last_claim_reminded_at timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);

create index kitty_enrollments_lead_idx ON public.kitty_enrollments (lead_id);
create index kitty_enrollments_scheme_idx ON public.kitty_enrollments (scheme_id);
create index kitty_enrollments_status_idx ON public.kitty_enrollments (tenant_id, status);
create index kitty_enrollments_claim_idx ON public.kitty_enrollments (tenant_id, claim_status) where claim_status in ('unclaimed', 'reminded');

create table public.kitty_installments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.ssj_tenant_id(),
  enrollment_id       uuid not null references public.kitty_enrollments(id) on delete cascade,
  month_number        int not null,
  due_date            date not null,
  amount              numeric not null,
  status              text not null default 'due',
    -- due | paid | free | waived
  paid_amount         numeric,
  paid_at             timestamptz,
  rate_locked         numeric,
  recorded_by         text,
  reminded_at         timestamptz,
  created_at          timestamptz not null default now()
);

create unique index kitty_installments_enrollment_month_idx on public.kitty_installments (enrollment_id, month_number);
create index kitty_installments_due_idx on public.kitty_installments (tenant_id, status, due_date);

create table public.kitty_draws (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null default public.ssj_tenant_id(),
  scheme_id                uuid not null references public.kitty_schemes(id),
  draw_month               date not null,
  winner_enrollment_id     uuid references public.kitty_enrollments(id),
  gold_coin_winner_enrollment_id uuid references public.kitty_enrollments(id),
  non_winner_benefit_amount numeric,
  recorded_by              text,
  recorded_at              timestamptz not null default now()
);

create unique index kitty_draws_scheme_month_idx on public.kitty_draws (scheme_id, draw_month);

alter table public.kitty_schemes      enable row level security;
alter table public.kitty_enrollments  enable row level security;
alter table public.kitty_installments enable row level security;
alter table public.kitty_draws        enable row level security;

create policy anon_tenant on public.kitty_schemes for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

create policy anon_tenant on public.kitty_enrollments for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

create policy anon_tenant on public.kitty_installments for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

create policy anon_tenant on public.kitty_draws for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

-- Seed the 5 real MYNN card schemes so the admin panel and ssj.in page have
-- real data from day one — staff can still edit/deactivate/add via CRM.
-- tenant_id set explicitly (not left to the column DEFAULT) since a plain
-- migration-runner INSERT doesn't reliably re-evaluate it in all execution
-- contexts.
insert into public.kitty_schemes (tenant_id, name, slug, monthly_amount, duration_months, perks, description, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Golden Bliss', 'golden-bliss', 2000, 12,
   '{"lucky_draw": true, "non_winner_benefit_amount": 1000, "redemption": "jewellery_only"}'::jsonb,
   '1 lucky draw monthly — winner does not have to pay ahead. Non-winning members get a ₹1,000 benefit. Monthly exclusive lucky draw for visiting (paying) members. Buy jewellery only after the kitty is complete.', 1),
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Golden Bloom', 'golden-bloom', 5000, 12,
   '{"lucky_draw": true, "non_winner_benefit_amount": 2000, "gold_coin_chance": true, "gold_coin_weight_mg": 100, "redemption": "jewellery_only"}'::jsonb,
   '1 lucky draw monthly — winner does not have to pay ahead. Non-winning members get a ₹2,000 benefit, plus a monthly chance to win a 100mg gold coin. Buy jewellery only after the kitty is complete.', 2),
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Golden Sparkle', 'golden-sparkle', 10000, 12,
   '{"rate_lock_day": 20, "making_charge_discount_pct": 50, "redemption": "jewellery_or_raw_gold"}'::jsonb,
   'Every 20th of the month, that day''s gold rate is booked. After 12 months, take raw gold or opt for any jewellery with flat 50% off making charges.', 3),
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Golden Glow', 'golden-glow', 5000, 12,
   '{"free_installment_month": 12, "redemption": "jewellery_only"}'::jsonb,
   'One installment free in the last month of the kitty. Buy jewellery only after the kitty is complete.', 4),
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Golden Serenty', 'golden-serenty', 10000, 12,
   '{"free_installment_month": 12, "redemption": "jewellery_only"}'::jsonb,
   'One installment free in the last month of the kitty. Buy jewellery only after the kitty is complete.', 5);
