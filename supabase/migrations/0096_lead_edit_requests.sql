-- Staged customer-submitted profile edits (name/email/address/bday/
-- anniversary/family members), via the public /profile and /update?t=
-- forms. Previously api/contact-update.js wrote straight to bullion_leads /
-- bullion_family_members with no review step — this table adds the missing
-- staff-approval gate: nothing the customer submits touches live data until
-- an admin/superadmin approves it, so old data is never silently
-- overwritten or lost. Approving a scalar field applies it directly (only
-- one current value can exist); approving a family-member edit lets staff
-- choose to replace the existing row or append a new one, so an edited
-- spouse/family record is never destructively lost either.

create table public.bullion_lead_edit_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  lead_id            uuid not null references public.bullion_leads(id) on delete cascade,
  status             text not null default 'pending',
    -- pending | approved | rejected
  proposed_fields    jsonb not null default '{}'::jsonb,
    -- { name, email, city, address_house, address_locality, address_state, address_pincode, address_country, bday, anniversary }
  current_snapshot   jsonb not null default '{}'::jsonb,
    -- same shape as proposed_fields, captured at submission time — lets staff see the diff
  family_additions   jsonb not null default '[]'::jsonb,
    -- new family members with no existing id: [{ relationship, name, dob, mobile }]
  family_edits       jsonb not null default '[]'::jsonb,
    -- edits to existing rows: [{ id, relationship, name, dob, mobile }]
  deleted_family_ids uuid[] not null default '{}',
    -- customer-requested removals — NOT executed until staff approves
  reviewed_by        text,
  reviewed_at        timestamptz,
  created_at         timestamptz default now()
);

create index bullion_lead_edit_requests_lead_idx   on public.bullion_lead_edit_requests (lead_id);
create index bullion_lead_edit_requests_status_idx on public.bullion_lead_edit_requests (status) where status = 'pending';

alter table public.bullion_lead_edit_requests enable row level security;
create policy anon_tenant on public.bullion_lead_edit_requests for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
