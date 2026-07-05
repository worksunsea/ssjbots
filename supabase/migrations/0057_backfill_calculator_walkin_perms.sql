-- Backfill "calculator" + "walkin" into any staff whose app_permissions.crm was
-- explicitly customized before those tabs existed (commit d2837d9 fixed the
-- role-default list and re-grant toggle, but did not retroactively add the
-- tabs to staff who already had a custom crm array — e.g. Rajni).
-- Safe to re-run: uses UNION (de-dupes) and skips anyone on "all" access.

UPDATE public.staff
SET app_permissions = app_permissions || jsonb_build_object(
  'crm',
  to_jsonb(
    ARRAY(
      SELECT DISTINCT e FROM jsonb_array_elements_text(app_permissions->'crm') e
      UNION
      SELECT unnest(ARRAY['calculator', 'walkin'])
    )
  )
)
WHERE app_permissions ? 'crm'
  AND jsonb_typeof(app_permissions->'crm') = 'array'
  AND NOT (app_permissions->'crm' ? 'all');
