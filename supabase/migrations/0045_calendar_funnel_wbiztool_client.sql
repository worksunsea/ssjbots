-- Set wbiztool_client = '7560' (8860866000 production number) on
-- birthday and anniversary funnels so all calendar messages go out
-- from the main SSJ number via WbizTool.

UPDATE public.funnels
SET wbiztool_client = '7560'
WHERE id IN ('birthday', 'anniversary')
  AND tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
