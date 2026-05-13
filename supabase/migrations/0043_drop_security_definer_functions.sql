-- ============================================================
-- 0043_drop_security_definer_functions.sql
-- REVOKE does not survive Supabase migrations — the platform
-- re-applies GRANT ALL ON ALL FUNCTIONS IN SCHEMA public after
-- every migration run, overriding any REVOKE in the same batch.
--
-- Permanent fix:
--   1. Recreate bullion_upsert_lead as SECURITY INVOKER so even
--      if anon calls it, it runs under anon's limited RLS permissions
--      (not superuser). service_role callers are unaffected.
--   2. Drop rls_auto_enable() — one-time utility, no longer needed.
-- ============================================================

-- 1. Recreate bullion_upsert_lead WITHOUT security definer
--    Body is identical to 0038 (0008 logic), only SECURITY DEFINER removed.
CREATE OR REPLACE FUNCTION public.bullion_upsert_lead(
  p_tenant_id uuid,
  p_phone     text,
  p_name      text,
  p_funnel_id text,
  p_body      text
)
RETURNS public.bullion_leads
LANGUAGE plpgsql
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

-- 2. Drop rls_auto_enable — one-time utility, no longer needed.
--    Must drop the dependent event trigger first.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
DROP FUNCTION IF EXISTS public.rls_auto_enable();
