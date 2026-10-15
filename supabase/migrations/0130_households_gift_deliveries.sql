-- Households: contacts who live at the same address but have their own phone
-- numbers share a household_id (staff confirm the links on the Gifts screen).
-- address_zone: delivery area label (e.g. "South Delhi") derived from pincode.
-- gift_deliveries: which gift goes to whom, on which day, carried by which employee.

alter table public.bullion_leads
  add column if not exists household_id uuid,
  add column if not exists address_zone text;

create index if not exists bullion_leads_household_idx on public.bullion_leads (household_id) where household_id is not null;
create index if not exists bullion_leads_zone_idx on public.bullion_leads (tenant_id, address_zone) where address_zone is not null;

create table if not exists public.gift_deliveries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  lead_id       uuid not null references public.bullion_leads(id) on delete cascade,
  gift_item     text,                          -- what is being given, e.g. "Silver coin 10g + sweets"
  planned_date  date not null,
  assigned_to   text,                          -- employee name (staff.name)
  status        text not null default 'planned',
    -- planned | delivered | not_home | returned | cancelled
  delivered_at  timestamptz,
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists gift_deliveries_day_idx  on public.gift_deliveries (tenant_id, planned_date, assigned_to);
create index if not exists gift_deliveries_lead_idx on public.gift_deliveries (lead_id);

alter table public.gift_deliveries enable row level security;
create policy anon_tenant on public.gift_deliveries for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
