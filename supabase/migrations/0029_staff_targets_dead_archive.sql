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
