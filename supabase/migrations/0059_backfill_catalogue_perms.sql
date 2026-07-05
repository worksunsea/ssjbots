-- Same fix as 0057, for the new "catalogue" tab: backfill it into any staff
-- whose app_permissions.crm was already customized before this tab existed,
-- so they don't lose access to it the way calculator/walkin did originally.

UPDATE public.staff
SET app_permissions = app_permissions || jsonb_build_object(
  'crm',
  to_jsonb(
    ARRAY(
      SELECT DISTINCT e FROM jsonb_array_elements_text(app_permissions->'crm') e
      UNION
      SELECT 'catalogue'
    )
  )
)
WHERE app_permissions ? 'crm'
  AND jsonb_typeof(app_permissions->'crm') = 'array'
  AND NOT (app_permissions->'crm' ? 'all');
