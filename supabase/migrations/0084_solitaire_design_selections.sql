-- Client-facing saved selections from the solitaire jewellery designer
-- module — same role as bullion_estimates but for a design+variant pick
-- rather than a freeform line-item estimate.

CREATE TABLE IF NOT EXISTS public.solitaire_design_selections (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  lead_id           uuid        REFERENCES public.bullion_leads(id) ON DELETE SET NULL,
  created_by        text,
  design_id         uuid        NOT NULL REFERENCES public.solitaire_designs(id),
  variant_id        uuid        NOT NULL REFERENCES public.solitaire_design_variants(id),
  category          text        NOT NULL CHECK (category IN ('ring','pendant','earring')),
  shape             text        NOT NULL,
  carat_size        numeric     NOT NULL,
  diamond_source    text        NOT NULL CHECK (diamond_source IN ('natural','labgrown')),
  diamond_color     text,
  diamond_clarity   text,
  gold_karat        text,
  gold_purity_pct   numeric,
  gold_color        text        NOT NULL CHECK (gold_color IN ('yellow','white','rose')),
  price_breakdown   jsonb       NOT NULL DEFAULT '{}',
  tryon_image_url   text,
  status            text        NOT NULL DEFAULT 'saved',
  metadata          jsonb       DEFAULT '{}',
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.solitaire_design_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_scoped" ON public.solitaire_design_selections
  FOR ALL USING (tenant_id = public.ssj_tenant_id());

CREATE INDEX ON public.solitaire_design_selections(tenant_id, lead_id);
CREATE INDEX ON public.solitaire_design_selections(tenant_id, created_at DESC);
