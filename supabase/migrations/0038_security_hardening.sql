-- ============================================================
-- 0038_security_hardening.sql
-- Fixes all Supabase Security Advisor warnings:
--
--   1. Enable RLS on tables that were missing it
--   2. Replace USING (true) open policies with tenant-scoped policies
--      (frontend uses anon key + writes directly — policies allow full
--       CRUD but only for the SSJ tenant row)
--   3. Fix search_path on SECURITY DEFINER functions
--   4. Revoke anon EXECUTE on upsert function (only service_role needs it)
--   5. Fix bullion_active_leads_view operator precedence bug
-- ============================================================

-- ── Tenant constant (avoids hardcoding UUID in every policy) ─────────────────
CREATE OR REPLACE FUNCTION public.ssj_tenant_id()
RETURNS uuid LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid; $$;

-- ── 1. Enable RLS on tables that never had it ─────────────────────────────────
-- (tables created in migrations without explicit ALTER TABLE ... ENABLE ROW LEVEL SECURITY)

ALTER TABLE public.personas                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnels                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_funnel_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_faqs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_tags               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_lead_tags          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_family_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_visits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_dropdowns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_imports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_demands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_broadcast_sends    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_media_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_lead_aliases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_targets              ENABLE ROW LEVEL SECURITY;

-- ── 2. Replace open policies with tenant-scoped policies ─────────────────────
-- Strategy: anon role gets full CRUD but ONLY for rows belonging to the SSJ tenant.
-- Vercel API functions use service_role which bypasses RLS entirely — no change needed.
-- bullion_call_logs and bullion_telecaller_rotation already have RLS enabled (0020).

-- personas
DROP POLICY IF EXISTS anon_all_personas ON public.personas;
CREATE POLICY anon_tenant ON public.personas FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- funnels
DROP POLICY IF EXISTS anon_all_funnels ON public.funnels;
CREATE POLICY anon_tenant ON public.funnels FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_leads
DROP POLICY IF EXISTS anon_all_bullion_leads ON public.bullion_leads;
CREATE POLICY anon_tenant ON public.bullion_leads FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_messages
DROP POLICY IF EXISTS anon_all_bullion_messages ON public.bullion_messages;
CREATE POLICY anon_tenant ON public.bullion_messages FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_funnel_steps
DROP POLICY IF EXISTS anon_all_bullion_funnel_steps ON public.bullion_funnel_steps;
CREATE POLICY anon_tenant ON public.bullion_funnel_steps FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_scheduled_messages
DROP POLICY IF EXISTS anon_all_bullion_scheduled_messages ON public.bullion_scheduled_messages;
CREATE POLICY anon_tenant ON public.bullion_scheduled_messages FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_faqs
DROP POLICY IF EXISTS anon_all_bullion_faqs ON public.bullion_faqs;
CREATE POLICY anon_tenant ON public.bullion_faqs FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_tags
DROP POLICY IF EXISTS anon_all_tags ON public.bullion_tags;
CREATE POLICY anon_tenant ON public.bullion_tags FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_lead_tags (no tenant_id column — scope via lead join)
DROP POLICY IF EXISTS anon_all_lead_tags ON public.bullion_lead_tags;
CREATE POLICY anon_tenant ON public.bullion_lead_tags FOR ALL TO anon
  USING (EXISTS (
    SELECT 1 FROM public.bullion_leads l
    WHERE l.id = lead_id AND l.tenant_id = public.ssj_tenant_id()
  ));

-- bullion_family_members
DROP POLICY IF EXISTS anon_all_family ON public.bullion_family_members;
CREATE POLICY anon_tenant ON public.bullion_family_members FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_visits
DROP POLICY IF EXISTS anon_all_visits ON public.bullion_visits;
CREATE POLICY anon_tenant ON public.bullion_visits FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_dropdowns
DROP POLICY IF EXISTS anon_all_dropdowns ON public.bullion_dropdowns;
CREATE POLICY anon_tenant ON public.bullion_dropdowns FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_imports
DROP POLICY IF EXISTS anon_all_imports ON public.bullion_imports;
CREATE POLICY anon_tenant ON public.bullion_imports FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_call_logs (already had RLS from 0020, drop + replace open policy)
DROP POLICY IF EXISTS anon_all_call_logs ON public.bullion_call_logs;
CREATE POLICY anon_tenant ON public.bullion_call_logs FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_telecaller_rotation (already had RLS from 0020, drop + replace open policy)
DROP POLICY IF EXISTS anon_all_rotation ON public.bullion_telecaller_rotation;
CREATE POLICY anon_tenant ON public.bullion_telecaller_rotation FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- Tables with no prior policy (newly RLS-enabled above):
CREATE POLICY anon_tenant ON public.bullion_demands FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_broadcast_sends FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_media_assets FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_lead_aliases FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.staff_targets FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── 3. Fix search_path on SECURITY DEFINER function ──────────────────────────
-- Reproduces the full body from 0008_funnel_routing.sql (the latest version)
-- and adds SET search_path = public to prevent schema injection attacks.

CREATE OR REPLACE FUNCTION public.bullion_upsert_lead(
  p_tenant_id uuid,
  p_phone     text,
  p_name      text,
  p_funnel_id text,
  p_body      text
)
RETURNS public.bullion_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      public.bullion_leads;
  v_existing public.bullion_leads;
BEGIN
  SELECT * INTO v_existing
  FROM public.bullion_leads
  WHERE tenant_id = p_tenant_id AND phone = p_phone
  LIMIT 1;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.bullion_leads (tenant_id, phone, funnel_id, name, last_msg, last_msg_at)
    VALUES (p_tenant_id, p_phone, p_funnel_id, COALESCE(p_name, ''), p_body, now())
    RETURNING * INTO v_row;
  ELSE
    IF v_existing.funnel_id IS DISTINCT FROM p_funnel_id AND p_funnel_id IS NOT NULL THEN
      UPDATE public.bullion_leads SET
        funnel_history  = COALESCE(funnel_history, '[]'::jsonb) ||
          jsonb_build_object(
            'from_funnel_id', v_existing.funnel_id,
            'entered_at',     v_existing.created_at,
            'exited_at',      now()
          ),
        funnel_id       = p_funnel_id,
        name            = COALESCE(NULLIF(p_name, ''), v_existing.name),
        last_msg        = p_body,
        last_msg_at     = now(),
        updated_at      = now(),
        exchanges_count = 0,
        stage           = 'greeting',
        status          = 'active',
        bot_paused      = false
      WHERE id = v_existing.id
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.bullion_leads SET
        name        = COALESCE(NULLIF(p_name, ''), v_existing.name),
        last_msg    = p_body,
        last_msg_at = now(),
        updated_at  = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_row;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- ── 4. Revoke anon EXECUTE on upsert function ────────────────────────────────
-- Only called server-side by Vercel webhook (service_role bypasses RLS anyway).
-- Revoking from anon closes the unauthenticated unlimited-write attack vector.

REVOKE EXECUTE ON FUNCTION public.bullion_upsert_lead(uuid, text, text, text, text)
  FROM anon, authenticated;

-- ── 5. Fix search_path on upcoming_events (no SECURITY DEFINER but best practice) ──

CREATE OR REPLACE FUNCTION public.upcoming_events(p_tenant_id uuid, p_days int DEFAULT 30)
RETURNS TABLE (
  id         uuid,
  name       text,
  phone      text,
  city       text,
  event_type text,
  raw_date   text,
  days_until int,
  next_date  date
) LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT l.id, l.name, l.phone, l.city,
      'bday' AS event_type, l.bday AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.bday IS NOT NULL AND l.bday <> ''
    UNION ALL
    SELECT l.id, l.name, l.phone, l.city,
      'anniversary' AS event_type, l.anniversary AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.anniversary IS NOT NULL AND l.anniversary <> ''
  ),
  parsed AS (
    SELECT b.*,
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
    SELECT p.*,
      CASE
        WHEN p.this_year_date >= current_date THEN p.this_year_date
        ELSE p.this_year_date + interval '1 year'
      END AS next_date
    FROM parsed p
    WHERE p.this_year_date IS NOT NULL
  )
  SELECT n.id, n.name, n.phone, n.city, n.event_type, n.raw_date,
    extract(day FROM (n.next_date - current_date))::int AS days_until,
    n.next_date
  FROM next_occ n
  WHERE extract(day FROM (n.next_date - current_date))::int <= p_days
    AND extract(day FROM (n.next_date - current_date))::int >= 0
  ORDER BY n.next_date ASC, n.name ASC;
$$;

-- ── 6. Fix touch_updated_at trigger function ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── 7. Fix bullion_active_leads_view — operator precedence bug ────────────────
-- Old: dnd=false AND status IN (...) OR funnel_id IS NOT NULL OR EXISTS(...)
-- AND binds tighter than OR → the funnel_id / EXISTS clauses bypassed dnd filter.

CREATE OR REPLACE VIEW public.bullion_active_leads_view AS
SELECT l.*
FROM public.bullion_leads l
WHERE l.dnd = false
  AND (
    l.status IN ('active', 'handoff')
    OR l.funnel_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.bullion_messages m
      WHERE m.lead_id = l.id
        AND m.direction = 'in'
        AND m.created_at > now() - interval '30 days'
    )
  );
