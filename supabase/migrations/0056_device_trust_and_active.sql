-- Office-TOTP device gate + staff deactivation flag.
-- See SSJ_STABLE_FEATURES.md §19 for the full feature writeup.

-- 1. Deactivation flag on the SHARED staff table (safe: default true, non-breaking
--    for sibling apps — ssj-hr, fms-tracker, jewelbos — reading the same table).
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- 2. Per-tenant security settings — holds the SHARED office TOTP secret.
--    RLS enabled with NO anon policies at all -> anon client fully denied.
--    Only api/*.js (service-role client) can read/write this table.
CREATE TABLE IF NOT EXISTS public.tenant_security_settings (
  tenant_id         uuid PRIMARY KEY,
  totp_secret       text,
  totp_enabled      boolean NOT NULL DEFAULT false,
  reauth_days       int     NOT NULL DEFAULT 15,
  device_trust_days int     NOT NULL DEFAULT 30,
  updated_at        timestamptz DEFAULT now(),
  updated_by        bigint
);
ALTER TABLE public.tenant_security_settings ENABLE ROW LEVEL SECURITY;

-- 3. Trusted devices — one row per browser verified with the office TOTP code.
--    RLS enabled with NO anon policies -> only the service-role endpoint writes/reads.
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  device_token         text NOT NULL,
  label                text,
  verified_by_staff_id bigint,
  verified_by_name     text,
  trusted_until        timestamptz NOT NULL,
  last_seen_at         timestamptz,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (tenant_id, device_token)
);
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

-- 4. Audit log of successful office-code verifications (who verified which device, when).
CREATE TABLE IF NOT EXISTS public.device_verifications (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  staff_id     bigint,
  staff_name   text,
  device_token text,
  ip           text,
  device       text,
  verified_at  timestamptz DEFAULT now()
);
ALTER TABLE public.device_verifications ENABLE ROW LEVEL SECURITY;
