-- ============================================================
-- 0040_fix_remaining_open_policies.sql
-- Clears remaining rls_policy_always_true warnings:
--
--   1. Drop leftover open anon_all_* policies on bot tables
--      (these pre-existed in the live DB before 0038 ran)
--   2. Fix role_permissions + score_commitments (bot tables
--      not covered in 0038)
--   3. Fix HR app tables on this shared Supabase project
--      (attendance, salary, staff, etc.) — same tenant model
--   4. Re-issue REVOKE on SECURITY DEFINER functions
--      (Supabase re-applies default grants on CREATE OR REPLACE)
-- ============================================================

-- ── 1. Drop leftover open policies on bot tables ─────────────────────────────
-- 0038 added anon_tenant policies but these old ones still existed in live DB.

DROP POLICY IF EXISTS anon_all_bullion_demands      ON public.bullion_demands;
DROP POLICY IF EXISTS anon_all_bullion_media_assets ON public.bullion_media_assets;

-- ── 2. Bot tables not covered in 0038 ────────────────────────────────────────

-- role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_role_permissions ON public.role_permissions;
CREATE POLICY anon_tenant ON public.role_permissions FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- score_commitments
ALTER TABLE public.score_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_score_commitments ON public.score_commitments;
CREATE POLICY anon_tenant ON public.score_commitments FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── 3. HR app tables (shared Supabase project, same tenant model) ─────────────
-- These have USING (true) / WITH CHECK (true) FOR ALL (all roles).
-- Replace with tenant-scoped policies so only SSJ data is accessible.

-- staff (contains credentials — high priority)
DROP POLICY IF EXISTS "allow all" ON public.staff;
CREATE POLICY tenant_all ON public.staff FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- tenants (lookup table — read-only is sufficient but keep ALL for admin ops)
DROP POLICY IF EXISTS "allow all" ON public.tenants;
CREATE POLICY tenant_all ON public.tenants FOR ALL TO anon
  USING (id = public.ssj_tenant_id())
  WITH CHECK (id = public.ssj_tenant_id());

-- attendance
DROP POLICY IF EXISTS "Allow all for attendance" ON public.attendance;
CREATE POLICY tenant_all ON public.attendance FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- company_assets
DROP POLICY IF EXISTS "Allow all for company_assets" ON public.company_assets;
CREATE POLICY tenant_all ON public.company_assets FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- employee_docs
DROP POLICY IF EXISTS "Allow all for employee_docs" ON public.employee_docs;
CREATE POLICY tenant_all ON public.employee_docs FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- help_slips
DROP POLICY IF EXISTS "Allow all for help_slips" ON public.help_slips;
CREATE POLICY tenant_all ON public.help_slips FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- jobs
DROP POLICY IF EXISTS "allow all" ON public.jobs;
CREATE POLICY tenant_all ON public.jobs FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- leaves
DROP POLICY IF EXISTS "Allow all for leaves" ON public.leaves;
CREATE POLICY tenant_all ON public.leaves FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- petty_cash_txns
DROP POLICY IF EXISTS "Allow all" ON public.petty_cash_txns;
CREATE POLICY tenant_all ON public.petty_cash_txns FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- resources
DROP POLICY IF EXISTS "Allow all for resources" ON public.resources;
CREATE POLICY tenant_all ON public.resources FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- salary (sensitive — employee pay data)
DROP POLICY IF EXISTS "Allow all for salary" ON public.salary;
CREATE POLICY tenant_all ON public.salary FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- tasks
DROP POLICY IF EXISTS "Allow all for tasks" ON public.tasks;
CREATE POLICY tenant_all ON public.tasks FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- training_modules
DROP POLICY IF EXISTS "Allow all" ON public.training_modules;
CREATE POLICY tenant_all ON public.training_modules FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- training_progress
DROP POLICY IF EXISTS "Allow all" ON public.training_progress;
CREATE POLICY tenant_all ON public.training_progress FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- warnings
DROP POLICY IF EXISTS "Allow all for warnings" ON public.warnings;
CREATE POLICY tenant_all ON public.warnings FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- workflows
DROP POLICY IF EXISTS "allow all" ON public.workflows;
CREATE POLICY tenant_all ON public.workflows FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── 4. Re-revoke SECURITY DEFINER function grants ────────────────────────────
-- Supabase re-applies default EXECUTE grants on CREATE OR REPLACE.
-- Must revoke *after* any function recreation.

REVOKE EXECUTE ON FUNCTION public.bullion_upsert_lead(uuid, text, text, text, text)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM anon, authenticated;
