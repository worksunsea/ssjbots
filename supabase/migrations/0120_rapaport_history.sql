-- Rapaport price-table history — one row per report snapshot, so the CRM can
-- flag what changed vs the previous report (simple per-bracket up/down) the
-- next time the Calculator loads, instead of just overwriting rapaport_data
-- silently on every upload/sync with no trace of what it replaced.

create table if not exists public.bullion_rapaport_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  date text not null,          -- Rapaport report date, e.g. '2026-09-11'
  rounds jsonb,
  fancy jsonb,
  created_at timestamptz default now()
);
create index if not exists bullion_rapaport_history_idx on public.bullion_rapaport_history (tenant_id, created_at desc);

alter table public.bullion_rapaport_history enable row level security;
drop policy if exists anon_all_rapaport_history on public.bullion_rapaport_history;
create policy anon_all_rapaport_history on public.bullion_rapaport_history for all to anon using (true) with check (true);
