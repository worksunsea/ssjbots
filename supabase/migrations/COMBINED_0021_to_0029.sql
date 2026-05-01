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
