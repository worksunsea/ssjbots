-- Multi-item enquiry support for walk-in demands.
-- Each element: {category, product, purity, weightG, notes}
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS enquiry_items jsonb NOT NULL DEFAULT '[]'::jsonb;
