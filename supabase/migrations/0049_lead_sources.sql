-- Lead source webhook configurations
-- Each row represents one external portal (IndiaMART, JustDial, Facebook, etc.)
-- that pushes leads to /api/inbound?token=<webhook_token>

CREATE TABLE IF NOT EXISTS public.bullion_lead_sources (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  name              text        NOT NULL,
  source_type       text        NOT NULL DEFAULT 'generic',
  webhook_token     text        NOT NULL UNIQUE,
  field_map         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  default_funnel_id text,
  enroll_drip       boolean     NOT NULL DEFAULT true,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bullion_lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_tenant ON public.bullion_lead_sources;
CREATE POLICY anon_tenant ON public.bullion_lead_sources
  FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());
