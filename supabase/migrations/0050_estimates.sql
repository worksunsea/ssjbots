-- Bullion estimates table
-- Stores price estimates/quotes linked to leads.
-- Each estimate holds a list of line items (jsonb), a total, and optional notes.

CREATE TABLE IF NOT EXISTS public.bullion_estimates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  lead_id      uuid        REFERENCES public.bullion_leads(id) ON DELETE SET NULL,
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  mode         text,
  items        jsonb       NOT NULL DEFAULT '[]',
  total_amount numeric,
  notes        text,
  metadata     jsonb       DEFAULT '{}'
);

ALTER TABLE public.bullion_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_scoped" ON public.bullion_estimates
  FOR ALL USING (tenant_id = public.ssj_tenant_id());

CREATE INDEX ON public.bullion_estimates(tenant_id, lead_id);
CREATE INDEX ON public.bullion_estimates(tenant_id, created_at DESC);
