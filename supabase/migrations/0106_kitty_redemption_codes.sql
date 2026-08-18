-- Redemption now goes through a WA-verified code instead of a direct staff
-- click: staff initiates (action=initiate-redeem), the member gets a WA
-- message with a 6-digit code + the amount/item being redeemed, they read
-- it out to staff in person, staff enters it (action=confirm-redeem) —
-- only then does the actual kitty_redemptions row get created and the
-- enrollment marked redeemed. Prevents a staff member (or anyone with CRM
-- access) from redeeming a kitty the member never actually asked to redeem.

create table public.kitty_redemption_codes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.ssj_tenant_id(),
  enrollment_id     uuid not null references public.kitty_enrollments(id) on delete cascade,
  code_hash         text not null,
  redemption_type   text not null,
  item_description  text,
  value             numeric,
  notes             text,
  initiated_by      text,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index kitty_redemption_codes_enrollment_idx on public.kitty_redemption_codes (enrollment_id, consumed_at);

alter table public.kitty_redemption_codes enable row level security;
create policy anon_tenant on public.kitty_redemption_codes for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
