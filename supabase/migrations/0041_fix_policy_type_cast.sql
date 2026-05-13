-- ============================================================
-- 0041_fix_policy_type_cast.sql
-- HR tables have tenant_id as TEXT not UUID.
-- 0040 failed with "operator does not exist: text = uuid".
-- Fix: cast both sides to text in all HR table policies.
-- Also re-runs bot table fixes + REVOKEs (may not have committed).
-- ============================================================

-- ── Re-run bot table leftover drops (idempotent) ─────────────────────────────
DROP POLICY IF EXISTS anon_all_bullion_demands      ON public.bullion_demands;
DROP POLICY IF EXISTS anon_all_bullion_media_assets ON public.bullion_media_assets;

-- role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_role_permissions ON public.role_permissions;
DROP POLICY IF EXISTS anon_tenant               ON public.role_permissions;
CREATE POLICY anon_tenant ON public.role_permissions FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

-- score_commitments
ALTER TABLE public.score_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_score_commitments ON public.score_commitments;
DROP POLICY IF EXISTS anon_tenant                ON public.score_commitments;
CREATE POLICY anon_tenant ON public.score_commitments FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

-- ── HR tables — use ::text cast on both sides ─────────────────────────────────

DROP POLICY IF EXISTS "allow all"               ON public.staff;
DROP POLICY IF EXISTS tenant_all                ON public.staff;
CREATE POLICY tenant_all ON public.staff FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "allow all"               ON public.tenants;
DROP POLICY IF EXISTS tenant_all                ON public.tenants;
CREATE POLICY tenant_all ON public.tenants FOR ALL TO anon
  USING (id::text = public.ssj_tenant_id()::text)
  WITH CHECK (id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for attendance" ON public.attendance;
DROP POLICY IF EXISTS tenant_all                 ON public.attendance;
CREATE POLICY tenant_all ON public.attendance FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for company_assets" ON public.company_assets;
DROP POLICY IF EXISTS tenant_all                     ON public.company_assets;
CREATE POLICY tenant_all ON public.company_assets FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for employee_docs" ON public.employee_docs;
DROP POLICY IF EXISTS tenant_all                    ON public.employee_docs;
CREATE POLICY tenant_all ON public.employee_docs FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for help_slips" ON public.help_slips;
DROP POLICY IF EXISTS tenant_all                 ON public.help_slips;
CREATE POLICY tenant_all ON public.help_slips FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "allow all"  ON public.jobs;
DROP POLICY IF EXISTS tenant_all   ON public.jobs;
CREATE POLICY tenant_all ON public.jobs FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for leaves" ON public.leaves;
DROP POLICY IF EXISTS tenant_all             ON public.leaves;
CREATE POLICY tenant_all ON public.leaves FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all"  ON public.petty_cash_txns;
DROP POLICY IF EXISTS tenant_all   ON public.petty_cash_txns;
CREATE POLICY tenant_all ON public.petty_cash_txns FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for resources" ON public.resources;
DROP POLICY IF EXISTS tenant_all                ON public.resources;
CREATE POLICY tenant_all ON public.resources FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for salary" ON public.salary;
DROP POLICY IF EXISTS tenant_all             ON public.salary;
CREATE POLICY tenant_all ON public.salary FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for tasks" ON public.tasks;
DROP POLICY IF EXISTS tenant_all            ON public.tasks;
CREATE POLICY tenant_all ON public.tasks FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all"  ON public.training_modules;
DROP POLICY IF EXISTS tenant_all   ON public.training_modules;
CREATE POLICY tenant_all ON public.training_modules FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all"  ON public.training_progress;
DROP POLICY IF EXISTS tenant_all   ON public.training_progress;
CREATE POLICY tenant_all ON public.training_progress FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "Allow all for warnings" ON public.warnings;
DROP POLICY IF EXISTS tenant_all               ON public.warnings;
CREATE POLICY tenant_all ON public.warnings FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

DROP POLICY IF EXISTS "allow all"  ON public.workflows;
DROP POLICY IF EXISTS tenant_all   ON public.workflows;
CREATE POLICY tenant_all ON public.workflows FOR ALL TO anon
  USING (tenant_id::text = public.ssj_tenant_id()::text)
  WITH CHECK (tenant_id::text = public.ssj_tenant_id()::text);

-- ── Re-revoke SECURITY DEFINER function grants ────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.bullion_upsert_lead(uuid, text, text, text, text)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM anon, authenticated;
