-- Phase D: Demand tracking + FMS steps + life events + after-marriage funnel.
-- Adds bullion_demands table, demand-related columns on leads/funnel_steps,
-- and seeds the non_gold_qualify + after_marriage lifecycle funnels.

-- ── 1. Contact flag on bullion_leads (clients vs active leads)
alter table public.bullion_leads
  add column if not exists is_client boolean default false;

-- ── 2. Life events on bullion_leads
alter table public.bullion_leads
  add column if not exists wedding_date date,
  add column if not exists wedding_family_member text,            -- "daughter Priya", "son Rahul"
  add column if not exists post_wedding_enrolled_at timestamptz;  -- when after_marriage funnel activated

-- ── 3. Demands table
create table if not exists public.bullion_demands (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  lead_id           uuid references public.bullion_leads(id) on delete cascade,
  funnel_id         text references public.funnels(id) on delete set null,
  description       text,
  product_category  text,      -- gold | silver | diamond | polki | kundan | gemstone | solitaire | other
  budget            numeric,
  image_urls        text[],
  occasion          text,      -- "daughter's wedding", "Diwali gifting", "self anniversary"
  occasion_date     date,      -- when client needs it — drives urgency sort
  for_whom          text,      -- "self", "daughter", "wife", "mother", etc.
  ai_summary        text,      -- bot-filled: full understanding of demand
  budget_confirmed  boolean default false,
  needs_qualified   boolean default false,   -- bot confirmed full details captured
  sales_notified_at timestamptz,             -- when sales team was alerted (idempotency)
  fms_step_id       uuid references public.bullion_funnel_steps(id) on delete set null,
  bot_active        boolean default false,
  assigned_to       text,
  created_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists bullion_demands_lead_idx    on public.bullion_demands (lead_id);
create index if not exists bullion_demands_tenant_idx  on public.bullion_demands (tenant_id, updated_at desc);
create index if not exists bullion_demands_occasion_idx on public.bullion_demands (tenant_id, occasion_date asc nulls last);
create index if not exists bullion_demands_active_idx  on public.bullion_demands (tenant_id, bot_active, needs_qualified);

-- ── 4. Extend funnel steps with type + AI message flag
alter table public.bullion_funnel_steps
  add column if not exists step_type      text default 'message',   -- 'message' | 'call'
  add column if not exists use_ai_message boolean default false;
-- step_type='call': cron skips auto-send; demand stays on this step; owner alerted
-- use_ai_message=true: cron calls Claude for personalized message at send-time instead of template

-- ── 5. Extend scheduled_messages for occasion reminders
alter table public.bullion_scheduled_messages
  add column if not exists is_reminder   boolean default false,  -- true = alert to owner, not WA to lead
  add column if not exists reminder_phone text;                  -- who to alert (defaults to OWNER_ALERT_PHONE)

-- ── 6. Non-gold qualify funnel + after_marriage lifecycle funnel
-- (SSJ tenant only; Gemtre gets its own via separate seed)
insert into public.funnels
  (id, tenant_id, name, description, wa_number, wbiztool_client, product_focus, persona_id, active, goal, kind, match_keywords, next_on_convert, next_on_exhaust)
values
  ('non_gold_qualify',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Non-Gold Demand Qualification',
   'For diamond, polki, kundan, gemstone and other custom/design enquiries. Bot fully qualifies the demand (occasion, budget, for whom, occasion date, design preferences) then hands to agent. Do NOT quote prices for non-gold items — gather all details and hand off.',
   '8860866000', '7560', 'all',
   (select id from public.personas where tenant_id='a1b2c3d4-0000-0000-0000-000000000001' and is_default=true limit 1),
   true,
   'Fully qualify the demand and hand off to sales agent with complete brief',
   'acquisition',
   null,
   'hot_followup', null),

  ('after_marriage',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'After Marriage — Lifetime Relationship',
   'Activated after a wedding occasion in the client''s family. Year-round outreach pegged to buying occasions — anniversary, Karva Chauth, Navratri, Diwali, New Year. All messages are AI-generated and personalized. Builds the long-term jewellery relationship.',
   '8860866000', '7560', 'all',
   (select id from public.personas where tenant_id='a1b2c3d4-0000-0000-0000-000000000001' and is_default=true limit 1),
   true,
   'Become the family jeweller for all lifetime occasions',
   'anniversary',
   null,
   'after_sales', null)
on conflict (id) do nothing;

-- ── 7. Drip steps for non_gold_qualify (qualify then handoff — use_ai_message)
insert into public.bullion_funnel_steps
  (tenant_id, funnel_id, step_order, name, delay_minutes, trigger_type, condition, message_template, active, step_type, use_ai_message)
values
  ('a1b2c3d4-0000-0000-0000-000000000001','non_gold_qualify',1,'Qualify follow-up 1h',60,'after_enrollment','always',
   'Sir/Ma''am {{name}}, we''re working on your enquiry. Could you share a bit more about the occasion and your design preference so I can help better?',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','non_gold_qualify',2,'Qualify follow-up 24h',1440,'after_prev_step','always',
   'Sir/Ma''am {{name}}, just following up on your jewellery enquiry. Our expert would love to understand your requirement. What is the occasion and approximate budget?',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','non_gold_qualify',3,'Agent call step',10,'after_prev_step','always',
   'Sir/Ma''am {{name}}, our jewellery consultant will personally assist you. Expect a call shortly.',true,'call',false)
on conflict do nothing;

-- ── 8. Drip steps for after_marriage (occasion-relative, all AI-generated)
-- All use trigger_type='after_enrollment' so delays are from wedding date enrollment
insert into public.bullion_funnel_steps
  (tenant_id, funnel_id, step_order, name, delay_minutes, trigger_type, condition, message_template, active, step_type, use_ai_message)
values
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',1,'Post-wedding warmth D+7',10080,'after_enrollment','always',
   'Sir/Ma''am {{name}}, hope the wedding celebrations went beautifully! Warmest wishes from everyone at Sun Sea Jewellers.',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',2,'Check-in D+30',43200,'after_enrollment','always',
   'Sir/Ma''am {{name}}, hope the family is settling in well after the wedding. Do reach out if you need anything from us.',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',3,'First anniversary season D+90',129600,'after_enrollment','always',
   'Sir/Ma''am {{name}}, the first anniversary is around the corner — a lovely time to celebrate with a special gift. Would love to help you pick something memorable.',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',4,'Karva Chauth / Navratri D+180',259200,'after_enrollment','always',
   'Sir/Ma''am {{name}}, festive season greetings! A beautiful time for jewellery gifting. Do visit or WhatsApp us — we have some lovely pieces set aside.',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',5,'Diwali season D+270',388800,'after_enrollment','always',
   'Sir/Ma''am {{name}}, Diwali greetings! If you are looking for festive gifting or something special for yourself, we would love to assist.',true,'message',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_marriage',6,'First anniversary wish D+365',525600,'after_enrollment','always',
   'Sir/Ma''am {{name}}, wishing the family a very happy first anniversary! A wonderful milestone — hope to celebrate it with you.',true,'message',true)
on conflict do nothing;
