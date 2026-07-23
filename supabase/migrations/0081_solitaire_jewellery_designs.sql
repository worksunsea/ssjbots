-- Solitaire jewellery designer module: base design concepts.
-- 75 seed rows (25 per category) with a text concept_prompt only — actual
-- product images are generated per gold-colour/shape combo into
-- solitaire_design_variants (0082), since a single design has no single image.

CREATE TABLE IF NOT EXISTS public.solitaire_designs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  category         text        NOT NULL CHECK (category IN ('ring','pendant','earring')),
  design_number    int         NOT NULL,
  name             text        NOT NULL,
  concept_prompt   text        NOT NULL,
  has_side_diamonds boolean    NOT NULL DEFAULT false,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.solitaire_designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_scoped" ON public.solitaire_designs
  FOR ALL USING (tenant_id = public.ssj_tenant_id());

CREATE UNIQUE INDEX ON public.solitaire_designs(tenant_id, category, design_number);
CREATE INDEX ON public.solitaire_designs(tenant_id, category, active);
