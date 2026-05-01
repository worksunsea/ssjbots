-- Optional reference image on a task — used for KRAs that need a visual
-- (e.g. how a clean counter should look, where stock should be placed).
-- Stored as a public URL into the shared `media` Supabase storage bucket.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reference_image_url text;
