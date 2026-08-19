-- Estimate versioning: editing a saved estimate now inserts a new row
-- instead of overwriting it, so the original stays intact for diffing.

ALTER TABLE public.bullion_estimates
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_estimate_id uuid REFERENCES public.bullion_estimates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bullion_estimates_parent_idx ON public.bullion_estimates(parent_estimate_id);
