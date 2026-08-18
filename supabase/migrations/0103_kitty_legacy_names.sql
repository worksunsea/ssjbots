-- Staff-managed list of old (pre-system) kitty names, so the Legacy Member
-- form offers a dropdown instead of free-typing the same old scheme name
-- differently each time (typos would otherwise fragment one real old kitty
-- into several distinct "legacy_scheme_name" strings).

create table public.kitty_legacy_scheme_names (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.ssj_tenant_id(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index kitty_legacy_scheme_names_tenant_name_idx on public.kitty_legacy_scheme_names (tenant_id, name);

alter table public.kitty_legacy_scheme_names enable row level security;
create policy anon_tenant on public.kitty_legacy_scheme_names for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
