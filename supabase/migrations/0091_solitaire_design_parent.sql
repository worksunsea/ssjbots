-- Sibling designs created via "Create N New Designs to Review" (e.g.
-- "Classic Solitaire Ring 6") were showing as flat top-level entries in the
-- admin dropdown, mixed in with the 25 original base designs. Saurav wants
-- them nested under their base design instead — the admin dropdown should
-- only list base designs (one per original concept); siblings appear as a
-- sub-selector once a base design with children is picked.

ALTER TABLE public.solitaire_designs ADD COLUMN IF NOT EXISTS parent_design_id uuid REFERENCES public.solitaire_designs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_solitaire_designs_parent ON public.solitaire_designs(parent_design_id);
