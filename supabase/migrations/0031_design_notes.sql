-- Design/media notes on demands — track what designs were sent to the client
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS design_notes text;
