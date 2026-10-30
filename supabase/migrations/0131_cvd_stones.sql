-- CVD (lab-grown) certified diamond stock, synced daily from the supplier's
-- stock sheets in the Drive folder "Cvdapp" (api/cvd-sync.js, 3 PM IST).
-- One row per stone, SKU = CVD-<IGI report no>. Stones missing from the latest
-- sheet are soft-delisted (status='delisted'), never deleted, so old product
-- URLs and price history survive.
--
-- SECURITY: purchase_usd / purchase_inr are the supplier cost. RLS is on and
-- there is deliberately NO anon policy — the browser anon key can read nothing
-- here. Only the server (service role) reads it, and the public endpoint
-- api/cvd-stones.js returns a whitelisted column list that excludes cost.

create table if not exists public.cvd_stones (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  sku               text not null,
  report_no         text not null,
  stock_no          text,
  source_file_kind  text not null check (source_file_kind in ('white', 'fancy')),
  status            text not null default 'listed' check (status in ('listed', 'reserved', 'delisted')),
  shape             text,
  carat             numeric(6,2),
  color             text,
  clarity           text,
  cut               text,
  polish            text,
  symmetry          text,
  fluorescence      text,
  measurements      text,
  lab               text,
  fancy_color       text,
  fancy_intensity   text,
  fancy_overtone    text,
  depth_pct         numeric(5,2),
  table_pct         numeric(5,2),
  cert_url          text,
  video_url         text,
  image_url         text,
  purchase_usd      numeric(12,2) not null,   -- PRIVATE: supplier "Final Price"
  purchase_inr      numeric(12,0) not null,   -- PRIVATE
  usd_inr_used      numeric(8,2) not null,    -- Rates-tab USD/INR + 0.50 at last sync
  price_inr         numeric(12,0) not null,   -- selling price, ex-GST (100% markup)
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  delisted_at       timestamptz,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, report_no)
);

create index if not exists cvd_stones_list_idx on public.cvd_stones (tenant_id, status, source_file_kind, carat);
create index if not exists cvd_stones_shape_idx on public.cvd_stones (tenant_id, shape) where status <> 'delisted';

alter table public.cvd_stones enable row level security;
-- no policies on purpose: anon/authenticated roles get no access, service role bypasses RLS.

-- One row per sync run (and per file) so the daily job is auditable.
create table if not exists public.cvd_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  trigger        text not null default 'cron',   -- cron | manual
  status         text not null default 'running', -- running | ok | partial | error
  usd_inr        numeric(8,2),
  files          jsonb not null default '[]'::jsonb, -- [{kind,name,drive_id,modified,rows,stones,added,returned,delisted,price_changed,skipped,note}]
  added          integer not null default 0,
  delisted       integer not null default 0,
  price_changed  integer not null default 0,
  error          text
);

create index if not exists cvd_sync_runs_idx on public.cvd_sync_runs (tenant_id, started_at desc);

alter table public.cvd_sync_runs enable row level security;
-- no policies: server-only.
