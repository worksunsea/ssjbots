-- Side (accent/pave) diamond total weight per design — has_side_diamonds was
-- a bare flag with no actual weight/pricing behind it. This is a per-design
-- constant (the setting's side-stone layout doesn't change per gold-colour/
-- shape combo), admin-editable, priced via a separate ₹/ct rate in
-- solitaire_labgrown_prices-style config (see pricing-config action).

ALTER TABLE public.solitaire_designs ADD COLUMN IF NOT EXISTS side_diamond_weight_ct numeric;
