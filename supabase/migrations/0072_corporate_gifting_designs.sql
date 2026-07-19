-- AI-generated branded packaging/card designs for corporate gifting leads.
-- One "batch" = 4 design options from a single generation call. A lead gets
-- 1 free batch; staff can approve more (max_batches) after the order is
-- confirmed — enforced server-side in api/corporate-gifting.js, not by RLS.

create table if not exists corporate_gifting_designs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  lead_id uuid not null references bullion_leads(id),
  logo_url text,
  color text,
  custom_text text,
  images jsonb not null default '[]',
  selected_index int,
  batch_count int not null default 0,
  max_batches int not null default 1,
  status text not null default 'pending' check (status in ('pending','generated','finalized')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_corp_gift_designs_lead on corporate_gifting_designs(lead_id);
