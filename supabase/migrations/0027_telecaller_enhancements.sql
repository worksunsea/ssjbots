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
