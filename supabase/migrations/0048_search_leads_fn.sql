-- Full-text search across all bullion_leads columns including extra_fields JSONB.
-- Called from frontend as sb.rpc('search_leads', { p_tenant_id, p_term }).
CREATE OR REPLACE FUNCTION public.search_leads(p_tenant_id uuid, p_term text)
RETURNS SETOF public.bullion_leads
LANGUAGE sql STABLE
AS $$
  SELECT * FROM public.bullion_leads
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (
      name            ILIKE '%' || p_term || '%'
      OR phone        ILIKE '%' || p_term || '%'
      OR mobile2      ILIKE '%' || p_term || '%'
      OR spouse_mobile ILIKE '%' || p_term || '%'
      OR email        ILIKE '%' || p_term || '%'
      OR city         ILIKE '%' || p_term || '%'
      OR source       ILIKE '%' || p_term || '%'
      OR bday         ILIKE '%' || p_term || '%'
      OR company      ILIKE '%' || p_term || '%'
      OR client_code  ILIKE '%' || p_term || '%'
      OR (extra_fields IS NOT NULL AND extra_fields::text ILIKE '%' || p_term || '%')
    )
  ORDER BY name NULLS LAST
  LIMIT 300;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads(uuid, text) TO anon;
