-- Admin can now optionally supply a reference image and/or override the
-- generation prompt per variant (AI Design Generator enhancement,
-- 2026-07-23) — record what was actually used for traceability.

ALTER TABLE public.solitaire_design_variants ADD COLUMN IF NOT EXISTS reference_image_url text;
ALTER TABLE public.solitaire_design_variants ADD COLUMN IF NOT EXISTS prompt_override text;
