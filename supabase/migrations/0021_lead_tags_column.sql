-- The frontend (ContactEditModal, ContactsScreen, ContactsDBScreen, broadcast
-- audience filters) reads/writes bullion_leads.tags directly as a text[].
-- The column was never added in earlier migrations — writes silently failed.
-- This adds the column + a GIN index for tag-based filters.

ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS bullion_leads_tags_gin
  ON public.bullion_leads USING gin (tags);

COMMENT ON COLUMN public.bullion_leads.tags IS
  'Free-form tags for segmentation (broadcast filters, source labels, custom flags). Master list lives in bullion_tags.';
