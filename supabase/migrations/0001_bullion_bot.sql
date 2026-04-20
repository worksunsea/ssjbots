-- SSJ Bullion Bot — initial schema
-- Run against the shared Sun Sea Supabase project (uppyxzellmuissdlxsmy).
-- Tables use tenant_id to match ssj-hr / fms-tracker pattern.
-- Auth reuses the existing public.staff table (plaintext password login, role-gated).

-- ──────────────────────────────────────────────────────────
-- PERSONAS: reusable bot personalities picked per funnel
-- ──────────────────────────────────────────────────────────
create table if not exists public.personas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  name        text not null,                      -- e.g. "Rajesh Bhai — veteran"
  description text,                                -- internal note
  tone        text,                                -- short tone brief
  system_prompt text not null,                     -- full prompt body
  is_default  boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists personas_tenant_idx on public.personas (tenant_id);

-- ──────────────────────────────────────────────────────────
-- FUNNELS: each ad campaign / lead source
-- ──────────────────────────────────────────────────────────
create table if not exists public.funnels (
  id                          text primary key,    -- slug: f1, f2, akshaya_gold_2026
  tenant_id                   uuid not null,
  name                        text not null,
  description                 text not null,       -- purpose, injected into prompt
  wa_number                   text not null,       -- human-readable WA number
  wbiztool_client             text,                -- WbizTool whatsapp_client id (e.g. "7560")
  product_focus               text,                -- gold_bullion | silver_coin | all
  persona_id                  uuid references public.personas(id),
  active                      boolean default true,
  goal                        text,                -- "Book showroom visit"
  max_exchanges_before_handoff int default 3,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);
create index if not exists funnels_tenant_idx on public.funnels (tenant_id);
create index if not exists funnels_active_idx on public.funnels (active) where active = true;

-- ──────────────────────────────────────────────────────────
-- LEADS (bullion_leads to avoid collision with other apps)
-- ──────────────────────────────────────────────────────────
create table if not exists public.bullion_leads (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  phone             text not null,                 -- normalized, digits only
  name              text,
  funnel_id         text references public.funnels(id),
  stage             text default 'greeting',       -- greeting|qualifying|quoted|objection|closing|handoff|converted|dead
  product_interest  text,
  qty_grams         numeric,
  status            text default 'active',         -- active|handoff|converted|dead|paused
  last_msg          text,
  last_msg_at       timestamptz,
  exchanges_count   int default 0,
  bot_paused        boolean default false,         -- owner pauses bot on this lead
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (tenant_id, phone, funnel_id)
);
create index if not exists bullion_leads_tenant_idx on public.bullion_leads (tenant_id);
create index if not exists bullion_leads_funnel_idx on public.bullion_leads (tenant_id, funnel_id, status);
create index if not exists bullion_leads_updated_idx on public.bullion_leads (tenant_id, updated_at desc);

-- ──────────────────────────────────────────────────────────
-- MESSAGES (bullion_messages)
-- ──────────────────────────────────────────────────────────
create table if not exists public.bullion_messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  lead_id        uuid references public.bullion_leads(id) on delete cascade,
  phone          text not null,
  funnel_id      text references public.funnels(id),
  wbiztool_msg_id text,
  direction      text not null check (direction in ('in','out')),
  body           text,
  stage          text,
  claude_action  text,                             -- CONTINUE|HANDOFF|QUOTE_SENT|CONVERTED
  status         text default 'sent',              -- sent|delivered|read|failed
  created_at     timestamptz default now()
);
create index if not exists bullion_messages_lead_idx on public.bullion_messages (lead_id, created_at);
create index if not exists bullion_messages_tenant_idx on public.bullion_messages (tenant_id, created_at desc);

-- ──────────────────────────────────────────────────────────
-- Auto-update updated_at
-- ──────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personas_touch on public.personas;
create trigger personas_touch before update on public.personas
  for each row execute function public.touch_updated_at();

drop trigger if exists funnels_touch on public.funnels;
create trigger funnels_touch before update on public.funnels
  for each row execute function public.touch_updated_at();

drop trigger if exists bullion_leads_touch on public.bullion_leads;
create trigger bullion_leads_touch before update on public.bullion_leads
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────
-- Analytics view: per-funnel rollup
-- ──────────────────────────────────────────────────────────
create or replace view public.bullion_funnel_metrics as
select
  l.tenant_id,
  l.funnel_id,
  f.name as funnel_name,
  count(*)::int                                                    as total_leads,
  sum(case when l.status='converted' then 1 else 0 end)::int       as converted,
  sum(case when l.status='handoff'   then 1 else 0 end)::int       as handoff,
  sum(case when l.status='active'    then 1 else 0 end)::int       as active,
  sum(case when l.status='dead'      then 1 else 0 end)::int       as dead,
  round(100.0 * sum(case when l.status='converted' then 1 else 0 end) / nullif(count(*), 0), 1) as conversion_pct,
  avg(l.exchanges_count)::numeric(10,1)                            as avg_exchanges
from public.bullion_leads l
left join public.funnels f on f.id = l.funnel_id
group by l.tenant_id, l.funnel_id, f.name;

-- ──────────────────────────────────────────────────────────
-- Row Level Security
-- With anon key + no Supabase Auth session, the simplest
-- approach is permissive anon policies scoped to tenant_id.
-- This matches ssj-hr / fms-tracker which rely on the tenant_id
-- constant in the client and the private nature of the app URL.
-- ──────────────────────────────────────────────────────────
alter table public.personas          enable row level security;
alter table public.funnels           enable row level security;
alter table public.bullion_leads     enable row level security;
alter table public.bullion_messages  enable row level security;

drop policy if exists anon_all_personas          on public.personas;
drop policy if exists anon_all_funnels           on public.funnels;
drop policy if exists anon_all_bullion_leads     on public.bullion_leads;
drop policy if exists anon_all_bullion_messages  on public.bullion_messages;

create policy anon_all_personas          on public.personas          for all to anon using (true) with check (true);
create policy anon_all_funnels           on public.funnels           for all to anon using (true) with check (true);
create policy anon_all_bullion_leads     on public.bullion_leads     for all to anon using (true) with check (true);
create policy anon_all_bullion_messages  on public.bullion_messages  for all to anon using (true) with check (true);
-- NOTE: lock these down with Supabase Auth later if multi-tenant usage starts.
