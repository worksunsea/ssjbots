-- Generated image sets for a solitaire design x gold-colour x diamond-shape
-- (± carat size, if the admin chooses to regenerate per size). This is what
-- gates client-facing pricing: a design has no sellable image/price until an
-- 'approved' variant exists for the chosen combo (enforced in the app, not RLS).

CREATE TABLE IF NOT EXISTS public.solitaire_design_variants (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  design_id          uuid        NOT NULL REFERENCES public.solitaire_designs(id) ON DELETE CASCADE,
  gold_color         text        NOT NULL CHECK (gold_color IN ('yellow','white','rose')),
  diamond_shape      text        NOT NULL,
  carat_size         numeric,
  view_images        jsonb       NOT NULL DEFAULT '{}',
  est_gold_weight_g  numeric,
  generated_by       text,
  generation_prompt  text,
  status             text        NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','approved','rejected')),
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE public.solitaire_design_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_scoped" ON public.solitaire_design_variants
  FOR ALL USING (tenant_id = public.ssj_tenant_id());

CREATE INDEX ON public.solitaire_design_variants(tenant_id, design_id);
CREATE INDEX ON public.solitaire_design_variants(tenant_id, design_id, gold_color, diamond_shape, status);
