-- Contact merge used to execute instantly the moment a manager typed the
-- other lead's ID into a prompt() — no visibility, no second pair of eyes on
-- an action that soft-deletes a record and re-points everything (including
-- Kitty enrollments) onto another. Now: manager+ requests a merge, it queues
-- here, and superadmin approves before anything actually moves.

create table if not exists public.bullion_lead_merge_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  primary_lead_id uuid not null references public.bullion_leads(id) on delete cascade,
  secondary_lead_id uuid not null references public.bullion_leads(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by text,
  requested_at timestamptz default now(),
  decided_by text,
  decided_at timestamptz
);
create index if not exists bullion_lead_merge_requests_status_idx on public.bullion_lead_merge_requests (tenant_id, status, requested_at desc);

alter table public.bullion_lead_merge_requests enable row level security;
drop policy if exists anon_all_lead_merge_requests on public.bullion_lead_merge_requests;
create policy anon_all_lead_merge_requests on public.bullion_lead_merge_requests for all to anon using (true) with check (true);
