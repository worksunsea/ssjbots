-- Staff-submitted edits to an already-logged walk-in (bullion_visits row +
-- the linked bullion_leads profile fields) are staged here instead of
-- writing straight to live data — same pattern as bullion_lead_edit_requests
-- for customer-submitted profile edits. The staff member who originally
-- filled the walk-in form cannot silently change it afterward; an
-- admin/manager/superadmin reviews the diff (current_snapshot vs
-- proposed_fields) and approves or rejects. Admin/manager/superadmin edits
-- made directly from the Walk-in screen skip this table entirely and write
-- straight to bullion_visits/bullion_leads, same as before.

create table public.bullion_visit_edit_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  visit_id         uuid references public.bullion_visits(id) on delete cascade,
  lead_id          uuid not null references public.bullion_leads(id) on delete cascade,
  status           text not null default 'pending',
    -- pending | approved | rejected
  proposed_fields  jsonb not null default '{}'::jsonb,
    -- { name, phone, city, notes, price_quoted, items_seen }
  current_snapshot jsonb not null default '{}'::jsonb,
    -- same shape, captured at submission time — lets admin see the diff
  requested_by     text,
  reviewed_by      text,
  reviewed_at      timestamptz,
  created_at       timestamptz default now()
);

create index bullion_visit_edit_requests_visit_idx  on public.bullion_visit_edit_requests (visit_id);
create index bullion_visit_edit_requests_status_idx on public.bullion_visit_edit_requests (status) where status = 'pending';

alter table public.bullion_visit_edit_requests enable row level security;
create policy tenant_scoped on public.bullion_visit_edit_requests for all
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
