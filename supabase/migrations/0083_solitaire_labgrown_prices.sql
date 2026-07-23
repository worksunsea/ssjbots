-- Admin-editable fixed price-per-carat grid for lab-grown diamonds, keyed by
-- the carat size list Saurav gave (2026-07-23). shape is nullable — a null
-- row is the default price for that carat size across all shapes; a
-- shape-specific row (if ever added) overrides it.

CREATE TABLE IF NOT EXISTS public.solitaire_labgrown_prices (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  carat_size   numeric     NOT NULL,
  shape        text,
  price_per_ct numeric     NOT NULL DEFAULT 0,
  updated_by   text,
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.solitaire_labgrown_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_scoped" ON public.solitaire_labgrown_prices
  FOR ALL USING (tenant_id = public.ssj_tenant_id());

CREATE UNIQUE INDEX ON public.solitaire_labgrown_prices(tenant_id, carat_size, coalesce(shape, ''));

INSERT INTO public.solitaire_labgrown_prices (carat_size, price_per_ct)
VALUES
  (0.30, 0), (0.50, 0), (0.70, 0), (0.90, 0),
  (1,    0), (1.5,  0), (2,    0), (3,    0), (3.5,  0),
  (4,    0), (4.5,  0), (5,    0), (5.5,  0), (6,    0),
  (7,    0), (8,    0), (9,    0), (10,   0), (11,   0), (12,   0)
ON CONFLICT DO NOTHING;
