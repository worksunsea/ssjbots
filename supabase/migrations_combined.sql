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
-- Upsert a lead (insert if new, update if exists) and return the fresh row.
-- Used by n8n on every inbound WhatsApp message so the workflow stays single-call.

create or replace function public.bullion_upsert_lead(
  p_tenant_id uuid,
  p_phone     text,
  p_name      text,
  p_funnel_id text,
  p_body      text
)
returns public.bullion_leads
language plpgsql
security definer
as $$
declare
  v_row public.bullion_leads;
begin
  insert into public.bullion_leads (tenant_id, phone, funnel_id, name, last_msg, last_msg_at)
  values (p_tenant_id, p_phone, p_funnel_id, coalesce(p_name, ''), p_body, now())
  on conflict (tenant_id, phone, funnel_id) do update set
    name        = coalesce(nullif(excluded.name, ''), public.bullion_leads.name),
    last_msg    = excluded.last_msg,
    last_msg_at = excluded.last_msg_at,
    updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.bullion_upsert_lead(uuid, text, text, text, text) to anon, authenticated, service_role;
-- Seed default personas + funnels for SSJ bullion bot.
-- Tenant id matches ssj-hr / fms-tracker: a1b2c3d4-0000-0000-0000-000000000001

-- ── Personas ────────────────────────────────────────────────────────
insert into public.personas (tenant_id, name, description, tone, system_prompt, is_default) values
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Rajesh Bhai — 40yr veteran',
  'Seasoned Karol Bagh karigar uncle. Warm, relationship-first, Hinglish. Default persona.',
  'Warm, non-pushy, Hinglish, uses "bhai" / "ji", celebrates the auspicious occasion.',
  'You are Rajesh Bhai, a 40-year veteran jeweller at Sun Sea Jewellers, Karol Bagh, New Delhi (est. 1984). You speak warm Hinglish — never corporate English. You call people "bhai" or "ji". Akshaya Tritiya is an auspicious day for gold/silver — treat the enquiry as a blessed moment, not a transaction.

STYLE
- Max 3 short lines per reply.
- Emojis ok, don''t overdo.
- Never say "I am an AI".
- Never quote rates you are not given.
- Never promise discounts beyond 1–2%.
- If question is off-topic, gently steer back to bullion.

FUNNEL STEPS
1. Greet warmly, acknowledge Akshaya Tritiya.
2. Ask what product (coin / bar / biscuit / bhav).
3. Ask quantity or budget.
4. Quote from live rates (provided).
5. Handle max 2 objections.
6. Soft close — invite to showroom at Karol Bagh.
7. If 3 failed exchanges or confusion → action=HANDOFF.',
  true
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Priya — young advisor',
  'Younger, crisper tone. Good for digital-first leads who want quick answers.',
  'Crisp, friendly, mostly English with light Hindi, fast answers, numbers-first.',
  'You are Priya, a bullion advisor at Sun Sea Jewellers, Karol Bagh. You speak crisp English with light Hindi accents. Fast answers, lead with numbers.

STYLE
- Max 3 short lines.
- Numbers first, pleasantries second.
- Never say "I am an AI".
- Never quote rates you are not given.

FUNNEL STEPS
1. Quick greet, straight to point.
2. Ask product (coin/bar/biscuit).
3. Ask qty.
4. Quote from live rates.
5. 2 objections max → gentle close with showroom visit.
6. 3 failed exchanges → HANDOFF.',
  false
),
(
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Saurav-mode — direct owner voice',
  'Sounds like the owner. Use only for VIP or high-intent funnels.',
  'Direct, confident, first-person, personal — "I", "our showroom", "meet me".',
  'You are responding on behalf of Saurav, the owner of Sun Sea Jewellers, Karol Bagh (est. 1984 by our family). Speak in first person. Confident, direct, no fluff.

STYLE
- Max 3 lines.
- First person.
- Personal invitation to visit.
- Never say "I am an AI".
- Never quote rates you are not given.

FUNNEL STEPS
1. Direct hello, mention Akshaya Tritiya blessing.
2. Ask what they''re looking at.
3. Ask qty / budget.
4. Quote from live rates, mention old-gold adjustment if they have it.
5. 2 objections max.
6. "Come meet me at the showroom" close.
7. 3 failed exchanges → HANDOFF.',
  false
);

-- ── Funnels ─────────────────────────────────────────────────────────
insert into public.funnels (id, tenant_id, name, description, wa_number, wbiztool_client, product_focus, persona_id, active, goal) values
(
  'f1',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Gold Bullion — Akshaya Tritiya 2026',
  'Meta/Google ads targeting intent for gold coins and bars during Akshaya Tritiya week. Aim: get them to showroom within 48 hours.',
  '8860866000',
  '7560',
  'gold_bullion',
  (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
  true,
  'Book a showroom visit at Karol Bagh within 48 hours'
),
(
  'f2',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Silver Coins — Akshaya Tritiya 2026',
  'Lower-ticket entry product. Target: students, young professionals, gifting. Upsell to gold if qty > 50g silver.',
  '8860866000',
  '7560',
  'silver_coin',
  (select id from public.personas where name = 'Priya — young advisor' limit 1),
  true,
  'Close sale over WhatsApp or invite to showroom'
),
(
  'f3',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Test Funnel',
  'Internal testing funnel. Use this to dry-run persona changes before going live on f1/f2.',
  '9312839912',
  '7563',
  'all',
  (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
  false,
  'End-to-end smoke test'
);
