-- Add app_permissions to staff table for centralized access control.
-- Format: {"crm": ["demands","contacts","upcoming"], "hr": ["all"], "fms": ["jobs"]}
-- null = use role-based defaults in each app.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS app_permissions jsonb;

COMMENT ON COLUMN staff.app_permissions IS
  'Per-app page access. Keys: crm, hr, fms. Values: array of page keys or ["all"]. null = role defaults.';
