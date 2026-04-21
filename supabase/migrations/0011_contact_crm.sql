-- Phase C: Contacts-as-directory model + tags + family + visits + dropdowns + import log.
-- See /Users/sg/.claude/plans/resilient-knitting-dusk.md for full context.

-- ── 1. Extend bullion_leads with contact-level fields
alter table public.bullion_leads
  add column if not exists client_code text,
  add column if not exists salutation text,
  add column if not exists misc_names text[] default '{}',
  add column if not exists mobile2 text,
  add column if not exists address_house text,
  add column if not exists address_locality text,
  add column if not exists address_state text,
  add column if not exists address_pincode text,
  add column if not exists address_country text default 'India',
  add column if not exists spouse_dob text,
  add column if not exists spouse_mobile text,
  add column if not exists partner_lead_id uuid references public.bullion_leads(id) on delete set null,
  add column if not exists profession text,
  add column if not exists company text,
  add column if not exists industry text,
  add column if not exists client_rating int,
  add column if not exists visit_count int default 0,
  add column if not exists first_visit_at timestamptz,
  add column if not exists last_visit_at timestamptz,
  add column if not exists ever_bought boolean default false,
  add column if not exists completeness_score int default 0,
  add column if not exists merged_from jsonb default '[]'::jsonb,
  add column if not exists custom_fields jsonb default '{}'::jsonb;

create index if not exists bullion_leads_completeness_idx on public.bullion_leads (tenant_id, completeness_score desc);
create index if not exists bullion_leads_last_visit_idx on public.bullion_leads (tenant_id, last_visit_at desc);

-- ── 2. Tags + join
create table if not exists public.bullion_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  category text not null default 'custom',   -- source | segment | flag | custom
  color text default '#888',
  sort_order int default 100,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, name)
);
create index if not exists bullion_tags_cat_idx on public.bullion_tags (tenant_id, category, sort_order);

create table if not exists public.bullion_lead_tags (
  lead_id uuid not null references public.bullion_leads(id) on delete cascade,
  tag_id  uuid not null references public.bullion_tags(id)  on delete cascade,
  created_at timestamptz default now(),
  primary key (lead_id, tag_id)
);
create index if not exists bullion_lead_tags_tag_idx on public.bullion_lead_tags (tag_id);

-- ── 3. Family members
create table if not exists public.bullion_family_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lead_id uuid references public.bullion_leads(id) on delete cascade,
  relationship text,     -- spouse | son | daughter | father | mother | sibling | other
  name text,
  dob text,              -- MM-DD or YYYY-MM-DD
  mobile text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists bullion_family_lead_idx on public.bullion_family_members (lead_id);

-- ── 4. Visits (per-walk-in record)
create table if not exists public.bullion_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lead_id uuid references public.bullion_leads(id) on delete cascade,
  visited_at timestamptz,
  counter text,
  staff text,
  items_seen text,
  purpose text,
  sale boolean default false,
  sale_amount numeric,
  gift_given text,
  google_review boolean,
  insta_follow boolean,
  source_file text,
  notes text,
  created_at timestamptz default now()
);
create index if not exists bullion_visits_lead_idx on public.bullion_visits (lead_id, visited_at desc);

-- ── 5. Dropdowns (owner-editable option sets)
create table if not exists public.bullion_dropdowns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  field text not null,
  value text not null,
  sort_order int default 100,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, field, value)
);
create index if not exists bullion_dropdowns_idx on public.bullion_dropdowns (tenant_id, field, active, sort_order);

-- ── 6. Import run log
create table if not exists public.bullion_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  file text,
  sheet text,
  rows_in int,
  rows_created int,
  rows_merged int,
  rows_skipped int,
  errors jsonb default '[]'::jsonb,
  summary jsonb default '{}'::jsonb
);
create index if not exists bullion_imports_tenant_idx on public.bullion_imports (tenant_id, started_at desc);

-- ── 7. touch triggers
drop trigger if exists bullion_tags_touch on public.bullion_tags;
create trigger bullion_tags_touch before update on public.bullion_tags
  for each row execute function public.touch_updated_at();

drop trigger if exists bullion_family_touch on public.bullion_family_members;
create trigger bullion_family_touch before update on public.bullion_family_members
  for each row execute function public.touch_updated_at();

drop trigger if exists bullion_dropdowns_touch on public.bullion_dropdowns;
create trigger bullion_dropdowns_touch before update on public.bullion_dropdowns
  for each row execute function public.touch_updated_at();

-- ── 8. RLS
alter table public.bullion_tags           enable row level security;
alter table public.bullion_lead_tags      enable row level security;
alter table public.bullion_family_members enable row level security;
alter table public.bullion_visits         enable row level security;
alter table public.bullion_dropdowns      enable row level security;
alter table public.bullion_imports        enable row level security;

drop policy if exists anon_all_tags on public.bullion_tags;
drop policy if exists anon_all_lead_tags on public.bullion_lead_tags;
drop policy if exists anon_all_family on public.bullion_family_members;
drop policy if exists anon_all_visits on public.bullion_visits;
drop policy if exists anon_all_dropdowns on public.bullion_dropdowns;
drop policy if exists anon_all_imports on public.bullion_imports;
create policy anon_all_tags      on public.bullion_tags           for all to anon using (true) with check (true);
create policy anon_all_lead_tags on public.bullion_lead_tags      for all to anon using (true) with check (true);
create policy anon_all_family    on public.bullion_family_members for all to anon using (true) with check (true);
create policy anon_all_visits    on public.bullion_visits         for all to anon using (true) with check (true);
create policy anon_all_dropdowns on public.bullion_dropdowns      for all to anon using (true) with check (true);
create policy anon_all_imports   on public.bullion_imports        for all to anon using (true) with check (true);

-- ── 9. Seed default tags (SSJ tenant)
insert into public.bullion_tags (tenant_id, name, category, color, sort_order) values
  -- flags (checkboxes)
  ('a1b2c3d4-0000-0000-0000-000000000001','Diwali_gift','flag','#e67e22',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','Calendar','flag','#2980b9',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','Greetings','flag','#27ae60',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','Bday_gift','flag','#e84393',40),
  ('a1b2c3d4-0000-0000-0000-000000000001','Gold_rate','flag','#f39c12',50),
  ('a1b2c3d4-0000-0000-0000-000000000001','Letter','flag','#8e44ad',60),
  -- segments
  ('a1b2c3d4-0000-0000-0000-000000000001','client','segment','#27ae60',100),
  ('a1b2c3d4-0000-0000-0000-000000000001','wholesale','segment','#2980b9',110),
  ('a1b2c3d4-0000-0000-0000-000000000001','jewellers','segment','#c0392b',120),
  ('a1b2c3d4-0000-0000-0000-000000000001','sanjeev_sir','segment','#8e44ad',130),
  ('a1b2c3d4-0000-0000-0000-000000000001','vip','segment','#d35400',140),
  ('a1b2c3d4-0000-0000-0000-000000000001','karigar','segment','#7f8c8d',150),
  ('a1b2c3d4-0000-0000-0000-000000000001','b2b','segment','#34495e',160),
  ('a1b2c3d4-0000-0000-0000-000000000001','exhibition','segment','#16a085',170),
  ('a1b2c3d4-0000-0000-0000-000000000001','kitty','segment','#e91e63',180),
  ('a1b2c3d4-0000-0000-0000-000000000001','saurav_phone','segment','#95a5a6',190),
  ('a1b2c3d4-0000-0000-0000-000000000001','family','segment','#f39c12',200),
  ('a1b2c3d4-0000-0000-0000-000000000001','unsubscribed','segment','#c0392b',210),
  -- sources (one per import file/sheet)
  ('a1b2c3d4-0000-0000-0000-000000000001','master_client_list','source','#3498db',300),
  ('a1b2c3d4-0000-0000-0000-000000000001','google_csv','source','#4285f4',310),
  ('a1b2c3d4-0000-0000-0000-000000000001','walk_in','source','#16a085',320),
  ('a1b2c3d4-0000-0000-0000-000000000001','wbiztool_drip','source','#1abc9c',330),
  ('a1b2c3d4-0000-0000-0000-000000000001','exhibition_sheet','source','#9b59b6',340),
  ('a1b2c3d4-0000-0000-0000-000000000001','customer_enquiry_form','source','#2c3e50',350),
  ('a1b2c3d4-0000-0000-0000-000000000001','fb_bday','source','#3b5998',360),
  ('a1b2c3d4-0000-0000-0000-000000000001','customer_is_king_form','source','#e74c3c',370),
  ('a1b2c3d4-0000-0000-0000-000000000001','bday_xls','source','#9c27b0',380),
  ('a1b2c3d4-0000-0000-0000-000000000001','customer_xls','source','#673ab7',390),
  ('a1b2c3d4-0000-0000-0000-000000000001','shivani','source','#ff5722',400),
  ('a1b2c3d4-0000-0000-0000-000000000001','sanjeevji','source','#795548',410),
  ('a1b2c3d4-0000-0000-0000-000000000001','sunseaclientcombined','source','#607d8b',420),
  ('a1b2c3d4-0000-0000-0000-000000000001','signup_form','source','#00acc1',430)
on conflict (tenant_id, name) do nothing;

-- ── 10. Seed dropdowns from validation sheet + new common values
insert into public.bullion_dropdowns (tenant_id, field, value, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001','category','CUSTOMER',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','category','WHOLESALE CLIENT',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','category','B2B Supplier / Karigar',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','category','Diamond Jewellery',40),
  ('a1b2c3d4-0000-0000-0000-000000000001','category','Gold Jewellery',50),
  ('a1b2c3d4-0000-0000-0000-000000000001','category','Polki',60),
  ('a1b2c3d4-0000-0000-0000-000000000001','status','Interested',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','status','Not Interested',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','status','Call Back',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','ref_group','Reference',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','ref_group','DMN',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','ref_group','BMP',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','Own Business',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','Job',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','Homemaker',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','CA',40),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','Manufacturing',50),
  ('a1b2c3d4-0000-0000-0000-000000000001','profession','Wholesale / Trading',60),
  ('a1b2c3d4-0000-0000-0000-000000000001','purchase_demand','General',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','purchase_demand','Wedding',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','purchase_demand','Anniversary',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','enroll','Kitty',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','enroll','Daily Gold Prices',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','enroll','Events',30),
  ('a1b2c3d4-0000-0000-0000-000000000001','comm_mode','Email',10),
  ('a1b2c3d4-0000-0000-0000-000000000001','comm_mode','WA',20),
  ('a1b2c3d4-0000-0000-0000-000000000001','comm_mode','Calls',30)
on conflict (tenant_id, field, value) do nothing;

-- ── 11. Bootstrap Gemtre tenant (copy of SSJ funnel/persona structure — empty data)
-- Gemtre tenant UUID (stable)
do $$
declare
  gemtre uuid := 'a1b2c3d4-0000-0000-0000-000000000002';
begin
  -- Clone 3 personas for Gemtre (placeholder prompts — gemtre owner will customize)
  insert into public.personas (tenant_id, name, description, tone, system_prompt, is_default)
  select gemtre, p.name, p.description, p.tone, p.system_prompt, p.is_default
  from public.personas p
  where p.tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001'
    and not exists (select 1 from public.personas p2 where p2.tenant_id = gemtre);

  -- Clone default tags
  insert into public.bullion_tags (tenant_id, name, category, color, sort_order)
  select gemtre, name, category, color, sort_order
  from public.bullion_tags
  where tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001'
  on conflict (tenant_id, name) do nothing;

  -- Clone dropdowns
  insert into public.bullion_dropdowns (tenant_id, field, value, sort_order, active)
  select gemtre, field, value, sort_order, active
  from public.bullion_dropdowns
  where tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001'
  on conflict (tenant_id, field, value) do nothing;
end $$;

-- ── 12. Helper view: "leads" vs "contacts"
-- Backwards-compat layer: a contact is any bullion_leads row. A "lead" is one
-- with active conversation signals. This view makes it queryable.
create or replace view public.bullion_active_leads_view as
select l.*
from public.bullion_leads l
where l.dnd = false
  and l.status in ('active','handoff')
     or l.funnel_id is not null
     or exists (
       select 1 from public.bullion_messages m
       where m.lead_id = l.id
         and m.direction = 'in'
         and m.created_at > now() - interval '30 days'
     );
