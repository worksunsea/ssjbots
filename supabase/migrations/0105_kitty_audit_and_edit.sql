-- Audit trail: every mutating kitty action (create/edit/pay/redeem/close/
-- etc.) gets logged with who did it and when — a real footprint, not just
-- the mutation itself. entity_type/entity_id identify what was touched;
-- details is a free-form jsonb summary (before/after values, etc.).
create table public.kitty_audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.ssj_tenant_id(),
  entity_type text not null, -- scheme | enrollment | installment | batch | legacy_name
  entity_id   uuid,
  action      text not null, -- create | update | delete | confirm | cancel | paid | redeem | close | ...
  actor       text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index kitty_audit_log_entity_idx  on public.kitty_audit_log (entity_type, entity_id);
create index kitty_audit_log_created_idx on public.kitty_audit_log (tenant_id, created_at desc);

alter table public.kitty_audit_log enable row level security;
create policy anon_tenant on public.kitty_audit_log for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

-- Records whether a redemption happened before the scheme's term completed
-- (early exit) — completion-only perks (e.g. Sparkle's making-charge
-- discount) don't apply in that case, per the owner's explicit rule.
alter table public.kitty_redemptions add column is_early_exit boolean not null default false;
