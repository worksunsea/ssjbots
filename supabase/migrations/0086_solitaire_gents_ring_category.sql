-- Adds a "gents_ring" category alongside ring/pendant/earring, per
-- Saurav's request (2026-07-23) for a dedicated men's solitaire ring section.

ALTER TABLE public.solitaire_designs DROP CONSTRAINT solitaire_designs_category_check;
ALTER TABLE public.solitaire_designs ADD CONSTRAINT solitaire_designs_category_check
  CHECK (category IN ('ring', 'pendant', 'earring', 'gents_ring'));

ALTER TABLE public.solitaire_design_selections DROP CONSTRAINT solitaire_design_selections_category_check;
ALTER TABLE public.solitaire_design_selections ADD CONSTRAINT solitaire_design_selections_category_check
  CHECK (category IN ('ring', 'pendant', 'earring', 'gents_ring'));
