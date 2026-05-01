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
-- spouse_name was missing from the schema — referenced everywhere in code but
-- never added. ~11k rows silently failed during the first import.

alter table public.bullion_leads add column if not exists spouse_name text;
-- Phase D part 2: Showroom visit scheduling + authority media assets + reschedule support.

-- ── 1. Visit scheduling on demands
alter table public.bullion_demands
  add column if not exists visit_scheduled_at   timestamptz,
  add column if not exists visit_confirmed       boolean default false,
  add column if not exists visit_rescheduled_count int default 0,
  add column if not exists visit_notes           text;

create index if not exists bullion_demands_visit_idx on public.bullion_demands (tenant_id, visit_scheduled_at asc nulls last);

-- ── 2. Authority / brand media assets (PDF brochure, intro video, etc.)
create table if not exists public.bullion_media_assets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  title       text not null,
  asset_type  text default 'pdf',      -- pdf | video | image | link
  url         text not null,           -- publicly accessible URL
  caption     text,                    -- message text sent WITH the asset
  send_to_new_leads boolean default true,  -- auto-send on new demand / new inbound
  active      boolean default true,
  sort_order  int default 1,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists bullion_media_assets_tenant_idx on public.bullion_media_assets (tenant_id, active, sort_order);

-- ── 3. message_type on scheduled messages (for visit reminders vs normal drip)
alter table public.bullion_scheduled_messages
  add column if not exists message_type text default 'text';
  -- text           = normal drip/nurture message
  -- visit_reminder = D-1 "are you coming tomorrow?" ask
  -- visit_day      = day-of "we look forward to seeing you" reminder
  -- authority      = brand asset / intro PDF/video follow-up
-- Returns upcoming birthdays and anniversaries within the next N days for a tenant.
-- next_occurrence is always in the current or next calendar year.
CREATE OR REPLACE FUNCTION upcoming_events(p_tenant_id uuid, p_days int DEFAULT 30)
RETURNS TABLE (
  id         uuid,
  name       text,
  phone      text,
  city       text,
  event_type text,   -- 'bday' | 'anniversary'
  raw_date   text,
  days_until int,
  next_date  date
) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      l.id, l.name, l.phone, l.city,
      'bday'        AS event_type,
      l.bday        AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.bday IS NOT NULL AND l.bday <> ''
    UNION ALL
    SELECT
      l.id, l.name, l.phone, l.city,
      'anniversary' AS event_type,
      l.anniversary AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.anniversary IS NOT NULL AND l.anniversary <> ''
  ),
  parsed AS (
    SELECT
      b.*,
      -- Handle MM-DD (length 5) and YYYY-MM-DD (length 10)
      CASE
        WHEN length(b.raw_date) = 5
          THEN to_date(extract(year FROM current_date)::text || '-' || b.raw_date, 'YYYY-MM-DD')
        WHEN length(b.raw_date) = 10
          THEN to_date(extract(year FROM current_date)::text || '-' || substring(b.raw_date FROM 6), 'YYYY-MM-DD')
        ELSE NULL
      END AS this_year_date
    FROM base b
  ),
  next_occ AS (
    SELECT
      p.*,
      CASE
        WHEN p.this_year_date >= current_date THEN p.this_year_date
        ELSE p.this_year_date + interval '1 year'
      END AS next_date
    FROM parsed p
    WHERE p.this_year_date IS NOT NULL
  )
  SELECT
    n.id, n.name, n.phone, n.city,
    n.event_type,
    n.raw_date,
    extract(day FROM (n.next_date - current_date))::int AS days_until,
    n.next_date
  FROM next_occ n
  WHERE extract(day FROM (n.next_date - current_date))::int <= p_days
    AND extract(day FROM (n.next_date - current_date))::int >= 0
  ORDER BY n.next_date ASC, n.name ASC;
$$;
-- Add app_permissions to staff table for centralized access control.
-- Format: {"crm": ["demands","contacts","upcoming"], "hr": ["all"], "fms": ["jobs"]}
-- null = use role-based defaults in each app.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS app_permissions jsonb;

COMMENT ON COLUMN staff.app_permissions IS
  'Per-app page access. Keys: crm, hr, fms. Values: array of page keys or ["all"]. null = role defaults.';
-- Add form_token to bullion_leads for the customer profile update link.
ALTER TABLE bullion_leads ADD COLUMN IF NOT EXISTS form_token uuid DEFAULT gen_random_uuid();
UPDATE bullion_leads SET form_token = gen_random_uuid() WHERE form_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bullion_leads_form_token_idx ON bullion_leads (form_token);
-- Step 1: Delete duplicate inbound messages — keep only the earliest per msgId
-- (duplicates were created before the dedup fix was in place)
DELETE FROM bullion_messages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY wbiztool_msg_id, direction
             ORDER BY created_at ASC
           ) AS rn
    FROM bullion_messages
    WHERE wbiztool_msg_id IS NOT NULL
      AND wbiztool_msg_id <> ''
      AND direction = 'in'
  ) ranked
  WHERE rn > 1
);

-- Step 2: Now the unique index can be created cleanly
CREATE UNIQUE INDEX IF NOT EXISTS bullion_messages_dedup_inbound
  ON bullion_messages (wbiztool_msg_id, direction)
  WHERE wbiztool_msg_id IS NOT NULL
    AND wbiztool_msg_id <> ''
    AND direction = 'in';

-- Step 3: Track broadcasts as proper records (used by broadcast history tab)
CREATE TABLE IF NOT EXISTS bullion_broadcast_sends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  funnel_id     TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  message_text  TEXT,
  media_url     TEXT,
  media_type    TEXT,    -- image | video | document | null
  filter_json   JSONB,   -- audience filter used
  recipient_count INT DEFAULT 0,
  skipped_count   INT DEFAULT 0,
  pace          TEXT DEFAULT 'safe',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by    TEXT
);

CREATE INDEX IF NOT EXISTS bullion_broadcast_sends_funnel ON bullion_broadcast_sends(funnel_id);
CREATE INDEX IF NOT EXISTS bullion_broadcast_sends_tenant ON bullion_broadcast_sends(tenant_id);
-- Map a WhatsApp LID JID (or any alternate phone-ish identifier) to the
-- canonical bullion_leads row, so inbound messages from a LID-only sender
-- attach to the real client record after the user has linked them.
--
-- Lookup flow on inbound webhook:
--   1. Compute phone (real digits if Baileys exposed sender_pn, else LID JID).
--   2. If alias row exists for that phone → route all writes to alias.lead_id.
--   3. Else upsert lead by phone as before.

CREATE TABLE IF NOT EXISTS public.bullion_lead_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  alias_phone  text NOT NULL,           -- e.g. "258802028912814@lid"
  lead_id      uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  UNIQUE (tenant_id, alias_phone)
);

CREATE INDEX IF NOT EXISTS bullion_lead_aliases_lead_idx
  ON public.bullion_lead_aliases (lead_id);
-- Auto source-tagging:
-- Each funnel can declare its origin label (e.g. "fb_ads", "insta_ads",
-- "google_ads", "wa_organic", "walk_in"). When the bot creates a new lead
-- via that funnel, lead.source is set to this label so the contact is
-- already classified by acquisition channel — no manual tagging needed.
ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS source_label text;

COMMENT ON COLUMN public.funnels.source_label IS
  'Acquisition channel label copied to lead.source on first inbound (e.g. fb_ads, insta_ads, walk_in, wa_organic).';
-- Phase E: Telecaller flow + post-outcome funnel routing.
-- See plan: /Users/sg/.claude/plans/why-not-take-the-elegant-ladybug.md
--
-- Adds:
--   • next_on_lost / next_on_not_interested on funnels (mirror existing next_on_convert).
--   • assigned_staff_id, outcome, call_attempts, next_call_at on bullion_demands.
--   • bullion_call_logs    — every call attempt (telecaller, disposition, notes).
--   • bullion_telecaller_rotation — round-robin pointer per tenant.
--   • Seed cadence offsets, disposition list, scripts, objections via bullion_dropdowns.

-- ── 1. Funnel outcome routing ────────────────────────────────────────────────
ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS next_on_lost text,            -- e.g. 'cold_revive' funnel id
  ADD COLUMN IF NOT EXISTS next_on_not_interested text;  -- e.g. 'hot_followup' funnel id

-- ── 2. Demand-level call/assignment fields ───────────────────────────────────
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome text,                  -- converted | lost | not_interested
  ADD COLUMN IF NOT EXISTS call_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_call_at timestamptz;

CREATE INDEX IF NOT EXISTS bullion_demands_assigned_idx ON public.bullion_demands (tenant_id, assigned_staff_id);
CREATE INDEX IF NOT EXISTS bullion_demands_next_call_idx ON public.bullion_demands (tenant_id, next_call_at) WHERE next_call_at IS NOT NULL;

-- ── 3. Call logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bullion_call_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  demand_id    uuid NOT NULL REFERENCES public.bullion_demands(id) ON DELETE CASCADE,
  lead_id      uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  staff_id     uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  attempt_no   int NOT NULL,
  called_at    timestamptz NOT NULL DEFAULT now(),
  duration_sec int,
  disposition  text NOT NULL,                 -- answered_interested | answered_not_now | answered_not_interested
                                              -- no_answer | busy | voicemail_left | callback_requested
                                              -- wrong_number | dnc
  notes        text,
  next_callback_at timestamptz
);
CREATE INDEX IF NOT EXISTS bullion_call_logs_demand_idx ON public.bullion_call_logs (demand_id, called_at DESC);
CREATE INDEX IF NOT EXISTS bullion_call_logs_staff_idx  ON public.bullion_call_logs (staff_id, called_at DESC);
ALTER TABLE public.bullion_call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_call_logs ON public.bullion_call_logs;
CREATE POLICY anon_all_call_logs ON public.bullion_call_logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── 4. Round-robin pointer ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bullion_telecaller_rotation (
  tenant_id     uuid PRIMARY KEY,
  last_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bullion_telecaller_rotation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_rotation ON public.bullion_telecaller_rotation;
CREATE POLICY anon_all_rotation ON public.bullion_telecaller_rotation FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── 5. Seed cadence + dispositions + scripts + objections via bullion_dropdowns
-- Cadence offsets (in minutes from enquiry creation). Index = attempt# - 1.
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','5',          1),  -- attempt 1: +5 min
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','120',        2),  -- attempt 2: +2 h
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','1320',       3),  -- attempt 3: next day 10:30 (~22h)
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','3960',       4),  -- attempt 4: day 3 evening
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','6480',       5),  -- attempt 5: day 5 mid-day
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','9720',       6)   -- attempt 6: day 7 evening
ON CONFLICT DO NOTHING;

-- Dispositions
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_interested',     10),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_not_now',        20),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_not_interested', 30),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','no_answer',               40),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','busy',                    50),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','voicemail_left',          60),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','callback_requested',      70),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','wrong_number',            80),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','dnc',                     90)
ON CONFLICT DO NOTHING;

-- Scripts (one row per script slot — S1 first contact, S2 follow-up, S3 final)
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s1',
   'Namaste {name} ji, main {staff_name} bol rahi hoon Sun Sea Jewellers, Karol Bagh se. Aapne abhi humari WhatsApp pe {product_category} ke liye enquiry ki thi — bas confirm karne ke liye call kiya hai. Kya aap thoda bata sakte hain — kis occasion ke liye dekh rahe hain, aur kab tak chahiye? … Theek hai, main aapko WhatsApp pe options bhej deti hoon. Ek baar showroom visit ka time tay kar lein? Hum aapko personally dikha sakte hain.',
   1),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s2',
   'Namaste {name} ji, main {staff_name} from Sun Sea Jewellers. Pehle bhi try kiya tha aapko — aapne {product_category} ke baare mein pucha tha. Bas ek minute lagega — kya abhi baat kar sakte hain ya kuch der baad call karoon?',
   1),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s3',
   'Namaste {name} ji, {staff_name} from Sun Sea Jewellers — yeh meri last call hai. Agar aap interested hain to bas yes bol dein, main detail bhej doongi. Warna koi baat nahin, hum aapko WhatsApp pe occasionally update bhejte rahenge — convenient ho to wapas connect ho jaayenge.',
   1)
ON CONFLICT DO NOTHING;

-- Objection responses (Q | A separated by " ||| ")
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Abhi busy hoon ||| Bilkul, sirf 30 second. Kya 6 baje free honge? Tab call karoon?', 10),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Rate WhatsApp pe bhejo ||| Bilkul, abhi bhej rahi hoon. Visit ke saath aap design aur weight personally check kar sakte hain — kab tak aana convenient hoga?', 20),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Sirf dekh rahe hain ||| Koi pressure nahin, samajh sakti hoon. Kya aap kisi specific design ya budget ke baare mein soch rahe hain? Hum WhatsApp pe options share kar sakte hain — koi obligation nahin.', 30),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Mahanga lagta hai ||| Samajh aaya. Hum customisation aur exchange options bhi dete hain — purana gold dene se kaafi adjustment ho jaata hai. Kya appointment fix karein discuss karne ke liye?', 40),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Sochenge / consult karenge ||| Bilkul. Main aapko WhatsApp pe details + pricing bhej deti hoon — family ke saath dekh sakte hain. 2-3 din baad ek follow-up karoon?', 50)
ON CONFLICT DO NOTHING;
-- The frontend (ContactEditModal, ContactsScreen, ContactsDBScreen, broadcast
-- audience filters) reads/writes bullion_leads.tags directly as a text[].
-- The column was never added in earlier migrations — writes silently failed.
-- This adds the column + a GIN index for tag-based filters.

ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS bullion_leads_tags_gin
  ON public.bullion_leads USING gin (tags);

COMMENT ON COLUMN public.bullion_leads.tags IS
  'Free-form tags for segmentation (broadcast filters, source labels, custom flags). Master list lives in bullion_tags.';
-- Walk-in form additions: jewellery type multi-select, how-they-found-us,
-- visit tracking (in/out time, party size, items seen), and not-bought reason.

-- Per-demand
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS product_types text[]    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS items_seen   text[]    NOT NULL DEFAULT '{}',  -- subset of PRODUCT_TYPES + free
  ADD COLUMN IF NOT EXISTS party_size   int,                              -- how many people walked in together
  ADD COLUMN IF NOT EXISTS in_time      timestamptz,                      -- when they entered the showroom
  ADD COLUMN IF NOT EXISTS out_time     timestamptz,                      -- when they left
  ADD COLUMN IF NOT EXISTS price_quoted numeric,                          -- ₹ price quoted on their highest-interest item
  ADD COLUMN IF NOT EXISTS not_bought_reason text,                        -- dropdown value (see UI list)
  ADD COLUMN IF NOT EXISTS not_bought_notes  text,                        -- free-text detail
  ADD COLUMN IF NOT EXISTS competitor_mentioned text,                     -- "Tanishq", "PNG", "Khazana", etc.
  ADD COLUMN IF NOT EXISTS followup_required boolean NOT NULL DEFAULT false;

-- Per-contact
ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS discovery_source text;

CREATE INDEX IF NOT EXISTS bullion_demands_product_types_gin
  ON public.bullion_demands USING gin (product_types);
CREATE INDEX IF NOT EXISTS bullion_demands_items_seen_gin
  ON public.bullion_demands USING gin (items_seen);
-- Per-step "tried to call" WhatsApp fallback template.
-- Used when a telecaller logs a no-answer / busy / voicemail disposition and
-- wants to send a quick WA nudge ("Hi, tried calling about your enquiry…").
-- Stored on the step so each call step can carry its own copy. AI/render
-- substitutes {{name}}, {{phone}}, {{staff_name}} like normal templates.

ALTER TABLE public.bullion_funnel_steps
  ADD COLUMN IF NOT EXISTS no_answer_template text;
-- Help slip: mandatory "what have you tried / what do you propose" field +
-- inline admin reply + raiser-seen flag for next-login popup.

ALTER TABLE public.help_slips
  ADD COLUMN IF NOT EXISTS solution_proposed text,
  ADD COLUMN IF NOT EXISTS reply text,
  ADD COLUMN IF NOT EXISTS reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_by text,
  ADD COLUMN IF NOT EXISTS raiser_seen_reply boolean NOT NULL DEFAULT true;
-- Optional reference image on a task — used for KRAs that need a visual
-- (e.g. how a clean counter should look, where stock should be placed).
-- Stored as a public URL into the shared `media` Supabase storage bucket.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reference_image_url text;
-- Personal / family tasks (e.g. kids' checklists) that should be hidden from
-- the office staff view. Only the assignee, the assigner, and superadmin can
-- see private tasks. Default false so existing tasks stay visible as before.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
-- ============================================================
-- 0027_telecaller_enhancements.sql
-- Adds call-lag tracking, talk-time buckets, priority scoring,
-- structured lost reasons, and CRM source to the telecaller system.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. bullion_call_logs — lag + talk tracking columns
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_call_logs
  ADD COLUMN IF NOT EXISTS opened_at          timestamptz,   -- when telecaller opened Log Call modal
  ADD COLUMN IF NOT EXISTS lag_minutes        numeric(8,2),  -- opened_at minus demand.next_call_at
  ADD COLUMN IF NOT EXISTS lag_bucket         text           -- INSTANT <5m | FAST <30m | SLOW <2h | DELAYED <24h | MISSED ≥24h
    CHECK (lag_bucket IN ('INSTANT','FAST','SLOW','DELAYED','MISSED')),
  ADD COLUMN IF NOT EXISTS talk_bucket        text           -- GHOST <10s | SHORT <60s | NORMAL <5m | LONG ≥5m
    CHECK (talk_bucket IN ('GHOST','SHORT','NORMAL','LONG')),
  ADD COLUMN IF NOT EXISTS is_first_call      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_suspicious      boolean NOT NULL DEFAULT false;  -- very short "answered" calls

-- ─────────────────────────────────────────────────────────────
-- 2. bullion_demands — priority scoring + lost reason + CRM source
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_demands
  ADD COLUMN IF NOT EXISTS crm_source         text           -- acquisition source: online_google | online_instagram | walkin | referral | old_client | exhibition | other
    CHECK (crm_source IN ('online_google','online_instagram','online_other','walkin','referral','old_client','exhibition','broadcast','other')),
  ADD COLUMN IF NOT EXISTS lost_reason        text           -- structured: LOST_PRICE | LOST_TIMING | LOST_COMPETITOR | LOST_NOT_INTERESTED | LOST_BUDGET | LOST_NO_SHOW | LOST_JUNK | LOST_WRONG_NUMBER
    CHECK (lost_reason IN ('LOST_PRICE','LOST_TIMING','LOST_COMPETITOR','LOST_NOT_INTERESTED','LOST_BUDGET','LOST_NO_SHOW','LOST_JUNK','LOST_WRONG_NUMBER')),
  ADD COLUMN IF NOT EXISTS priority_score     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_callback_promised boolean NOT NULL DEFAULT false;

-- Index for telecaller queue: their assigned demands, sorted by priority DESC
CREATE INDEX IF NOT EXISTS idx_demands_queue
  ON bullion_demands (assigned_staff_id, outcome, priority_score DESC)
  WHERE outcome IS NULL;

-- Index for callback-promised demands so the cron can find them fast
CREATE INDEX IF NOT EXISTS idx_demands_callback_promised
  ON bullion_demands (is_callback_promised, next_call_at)
  WHERE is_callback_promised = true AND outcome IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 3–5. Ensure hot_followup, cold_revive, nurture_warm funnels exist.
--
-- wa_number is NOT NULL on the funnels table, so we borrow it from
-- the first existing active funnel for this tenant rather than hard-coding one.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  _tid  uuid := 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
  _wa   text;
BEGIN
  -- Pick any existing wa_number from this tenant's funnels as the default
  SELECT wa_number INTO _wa
  FROM   funnels
  WHERE  tenant_id = _tid
    AND  wa_number IS NOT NULL
  LIMIT  1;

  -- hot_followup
  INSERT INTO funnels
    (id, tenant_id, name, kind, active, description, wa_number, next_on_lost, next_on_not_interested)
  VALUES
    ('hot_followup', _tid, 'Hot Follow-up', 'sales', true,
     'Intensive follow-up for HOT leads — high-frequency touch sequence',
     _wa, 'cold_revive', 'nurture_warm')
  ON CONFLICT (id) DO UPDATE SET
    next_on_lost           = EXCLUDED.next_on_lost,
    next_on_not_interested = EXCLUDED.next_on_not_interested,
    active                 = EXCLUDED.active;

  -- cold_revive
  INSERT INTO funnels
    (id, tenant_id, name, kind, active, description, wa_number, next_on_lost, next_on_not_interested)
  VALUES
    ('cold_revive', _tid, 'Cold Revival', 'nurture', true,
     'Long-term 12-touch WhatsApp sequence for leads that went cold — no calls',
     _wa, 'dead_archive', 'dead_archive')
  ON CONFLICT (id) DO UPDATE SET
    next_on_lost           = EXCLUDED.next_on_lost,
    next_on_not_interested = EXCLUDED.next_on_not_interested,
    active                 = EXCLUDED.active;

  -- nurture_warm
  INSERT INTO funnels
    (id, tenant_id, name, kind, active, description, wa_number, next_on_lost, next_on_not_interested)
  VALUES
    ('nurture_warm', _tid, 'Nurture Warm', 'nurture', true,
     '8-touch WhatsApp sequence for warm leads not ready to buy yet',
     _wa, 'cold_revive', 'cold_revive')
  ON CONFLICT (id) DO UPDATE SET
    active = EXCLUDED.active;
END $$;
-- ============================================================
-- 0028_jewelry_fields_exchange.sql
-- Structured jewelry detail fields + exchange/trade-in tracking
-- on bullion_demands. Also seeds config keys in bullion_dropdowns.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Jewelry specification fields
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_demands
  ADD COLUMN IF NOT EXISTS metal           text
    CHECK (metal IN ('gold_22k','gold_18k','gold_14k','white_gold','platinum','silver','other')),
  ADD COLUMN IF NOT EXISTS stone           text
    CHECK (stone IN ('diamond','ruby','emerald','sapphire','pearl','kundan','polki','none','other')),
  ADD COLUMN IF NOT EXISTS item_category   text
    CHECK (item_category IN ('ring','necklace','earrings','bangles','bracelet','pendant','set','anklet','other')),
  ADD COLUMN IF NOT EXISTS ring_size       text,           -- US size e.g. "6", "6.5", "7"
  ADD COLUMN IF NOT EXISTS purity          text
    CHECK (purity IN ('916','750','585','925','999','other')),
  ADD COLUMN IF NOT EXISTS hallmark_pref   text
    CHECK (hallmark_pref IN ('bis_hallmark','none','client_choice'));

-- ─────────────────────────────────────────────────────────────
-- 2. Exchange / Trade-in fields
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_demands
  ADD COLUMN IF NOT EXISTS has_exchange    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_desc   text,           -- "Old 22k necklace ~15g, good condition"
  ADD COLUMN IF NOT EXISTS exchange_value  numeric(12,2);  -- estimated ₹ value

-- ─────────────────────────────────────────────────────────────
-- 3. Seed config keys in bullion_dropdowns
--    These are editable by admin via the Config UI without redeploy.
-- ─────────────────────────────────────────────────────────────

-- Seed config keys using field as the key name (no label column in this table).
-- Use NOT EXISTS so re-running is safe and won't overwrite admin edits.
DO $$
DECLARE
  _tid uuid := 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
BEGIN
  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'google_review_link', '', true, 90
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'google_review_link');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day3',
    'Hi {name}, we hope you are loving your new {product} 💎 It was a pleasure serving you at Sun Sea Jewellers! If you need any adjustments or have questions, we are always here. 🙏',
    true, 91
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day3');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day7',
    'Hi {name}, we hope your {product} is bringing you joy! ✨ If you have a moment, we would truly appreciate a Google review — it means the world to us: {review_link}

Thank you for your trust. 🙏',
    true, 92
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day7');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day30',
    'Hi {name}, it has been a month since you picked up your {product} from Sun Sea Jewellers 💎 We hope it is perfect! If you ever need a resize, repair, or cleaning — just reach out. Always here for you. 🙏',
    true, 93
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day30');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'missed_call_auto_reply',
    'Hi! You tried calling Sun Sea Jewellers. We are sorry we missed you! Our team will call you back shortly. 💎 Or WhatsApp us here anytime.',
    true, 94
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'missed_call_auto_reply');
END $$;
-- ============================================================
-- 0029_staff_targets_dead_archive.sql
-- Staff monthly targets for leaderboard + dead_archive funnel
-- as the terminal state for cold_revive / hot_followup chains.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Staff monthly targets
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_targets (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  staff_id            uuid         NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  month               date         NOT NULL,   -- first day of month, e.g. '2026-05-01'
  target_calls        int          NOT NULL DEFAULT 0,
  target_conversions  int          NOT NULL DEFAULT 0,
  target_revenue      numeric(14,2) NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (staff_id, month)
);

CREATE INDEX IF NOT EXISTS idx_staff_targets_month
  ON public.staff_targets (tenant_id, month);

-- ─────────────────────────────────────────────────────────────
-- 2. dead_archive funnel — terminal, active=false so no WA
--    messages are ever sent from it. Just a bucket for
--    leads that have exhausted all nurture sequences.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  _tid uuid := 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
  _wa  text;
BEGIN
  SELECT wa_number INTO _wa
  FROM   funnels
  WHERE  tenant_id = _tid AND wa_number IS NOT NULL
  LIMIT  1;

  INSERT INTO funnels
    (id, tenant_id, name, kind, active, description, wa_number)
  VALUES
    ('dead_archive', _tid, 'Dead Archive', 'archive', false,
     'Terminal funnel — lead has exhausted all nurture; no further messaging', _wa)
  ON CONFLICT (id) DO NOTHING;
END $$;
