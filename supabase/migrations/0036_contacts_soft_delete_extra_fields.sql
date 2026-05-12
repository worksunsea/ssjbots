-- Missing columns added to frontend (App.jsx) without DB migrations:
--   1. deleted_at / deleted_by — soft-delete for contacts
--   2. extra_fields — custom JSONB fields per contact

ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text,
  ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}';

-- Index for the soft-delete filter (IS NULL fast path)
CREATE INDEX IF NOT EXISTS bullion_leads_deleted_at_idx
  ON public.bullion_leads (tenant_id, deleted_at)
  WHERE deleted_at IS NULL;

-- Index for extra_fields jsonb queries
CREATE INDEX IF NOT EXISTS bullion_leads_extra_fields_gin
  ON public.bullion_leads USING gin (extra_fields);
