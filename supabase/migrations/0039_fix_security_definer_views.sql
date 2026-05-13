-- ============================================================
-- 0039_fix_security_definer_views.sql
-- Supabase Security Advisor: security_definer_view warnings.
-- Views default to SECURITY DEFINER in Postgres — recreate
-- with security_invoker=true so RLS of the *querying* user
-- applies, not the view owner's permissions.
-- ============================================================

-- bullion_active_leads_view
-- (also carries the operator-precedence fix from 0038)
CREATE OR REPLACE VIEW public.bullion_active_leads_view
  WITH (security_invoker = true)
AS
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

-- bullion_funnel_metrics
CREATE OR REPLACE VIEW public.bullion_funnel_metrics
  WITH (security_invoker = true)
AS
SELECT
  l.tenant_id,
  l.funnel_id,
  f.name AS funnel_name,
  count(*)::int                                                                            AS total_leads,
  sum(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END)::int                            AS converted,
  sum(CASE WHEN l.status = 'handoff'   THEN 1 ELSE 0 END)::int                            AS handoff,
  sum(CASE WHEN l.status = 'active'    THEN 1 ELSE 0 END)::int                            AS active,
  sum(CASE WHEN l.status = 'dead'      THEN 1 ELSE 0 END)::int                            AS dead,
  round(100.0 * sum(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) / NULLIF(count(*), 0), 1) AS conversion_pct,
  avg(l.exchanges_count)::numeric(10, 1)                                                   AS avg_exchanges
FROM public.bullion_leads l
LEFT JOIN public.funnels f ON f.id = l.funnel_id
GROUP BY l.tenant_id, l.funnel_id, f.name;
