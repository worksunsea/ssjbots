-- Manual temperature override on a demand.
-- When set, overrides the auto-computed hot/warm/cold logic entirely.
-- Null = auto (default behaviour unchanged).
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS temperature_override text
    CHECK (temperature_override IN ('hot','warm','cold'));
