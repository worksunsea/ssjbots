-- Ad campaign tracking: WA click-to-chat ads land with a pre-filled
-- message. Matching that text against a keyword configured per lead
-- source lets us auto-attribute + auto-enroll a new lead into the right
-- campaign funnel, and surface them in a dedicated AdLeads tab instead of
-- mixing into the regular Demands inbox.

-- bullion_lead_sources existed only as a migration file, never actually
-- run — the whole Lead Sources tab has been silently non-functional.
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

-- Phrase to match against a NEW lead's first inbound WhatsApp message
-- (case-insensitive substring) — this is what makes a "lead source" also
-- work as a WA-ad-click attribution rule, comma-separated for multiple
-- phrasings of the same ad's pre-filled text.
ALTER TABLE public.bullion_lead_sources
  ADD COLUMN IF NOT EXISTS wa_keyword text;

-- Which configured source/campaign a lead was attributed to. Set once, at
-- lead-creation time, independent of whether a demand ever gets created
-- from the conversation — this is what drives the AdLeads tab.
ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS lead_source_id uuid REFERENCES public.bullion_lead_sources(id);
CREATE INDEX IF NOT EXISTS bullion_leads_lead_source_idx ON public.bullion_leads (tenant_id, lead_source_id);
