-- Auto source-tagging:
-- Each funnel can declare its origin label (e.g. "fb_ads", "insta_ads",
-- "google_ads", "wa_organic", "walk_in"). When the bot creates a new lead
-- via that funnel, lead.source is set to this label so the contact is
-- already classified by acquisition channel — no manual tagging needed.
ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS source_label text;

COMMENT ON COLUMN public.funnels.source_label IS
  'Acquisition channel label copied to lead.source on first inbound (e.g. fb_ads, insta_ads, walk_in, wa_organic).';
