-- One size-comparison image per design (not per variant) — shows the same
-- setting with diamonds from .30ct to 5ct side by side so a client can see
-- the size progression in a single photo, per Saurav's request (2026-07-23).

ALTER TABLE public.solitaire_designs ADD COLUMN IF NOT EXISTS size_chart_image_url text;
