-- Document inbox: staff upload photos of handwritten forms from the phone.
-- A scheduled Claude routine reads them hourly and writes `proposal`;
-- a person reviews/edits in the app and saves as final, which updates contacts.
create table if not exists public.doc_inbox (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  kind         text not null default 'vip_sheet',   -- vip_sheet | vendor_card | other
  note         text,
  image_urls   text[] not null default '{}',
  status       text not null default 'new',          -- new | proposed | final | rejected
  proposal     jsonb,                                -- { people:[...], notes:"" } written by the routine
  final_data   jsonb,                                -- what the reviewer saved
  uploaded_by  text,
  reviewed_by  text,
  processed_at timestamptz,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists doc_inbox_status_idx on public.doc_inbox (tenant_id, status, created_at);

alter table public.doc_inbox enable row level security;
create policy anon_tenant on public.doc_inbox for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
