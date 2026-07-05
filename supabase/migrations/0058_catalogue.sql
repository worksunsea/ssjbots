-- Product Catalogue feature: collections (item type / material / style axes,
-- matching the store's existing inventory-code spreadsheet), products with
-- auto-generated SKUs, multi-image uploads, shareable client links with a
-- resolved product snapshot, and a persistent per-client selection basket.
--
-- SKU format: {item_type.code}{material.code}{style.code || ''}-{seq:04d}
-- e.g. CKGAT-0001 (Ring Cocktail + Gold + Antique, item #1). See
-- catalogue_next_sku() below — sequence is keyed on the full composed
-- prefix, not on item type alone, since two products can share an item
-- type but differ in material/style and must number independently.

-- ── catalogue_item_types ──────────────────────────────────────────────────
-- The "collection" axis staff browse/send by (Rings, Necklaces, ...),
-- hierarchical so e.g. Ring Cocktail/Everyday/Band nest under Ring.
CREATE TABLE public.catalogue_item_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  parent_id   uuid        REFERENCES public.catalogue_item_types(id) ON DELETE SET NULL,
  name        text        NOT NULL,
  code        text        NOT NULL,
  cover_image_url text,
  description text,
  is_default  boolean     NOT NULL DEFAULT false,
  active      boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX catalogue_item_types_code_idx ON public.catalogue_item_types (tenant_id, code);
CREATE INDEX catalogue_item_types_parent_idx ON public.catalogue_item_types (tenant_id, parent_id);
ALTER TABLE public.catalogue_item_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_item_types FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_materials ───────────────────────────────────────────────────
-- Metal/stone class attribute (Gold/Diamond/Platinum/Panchdhatu/Gemstone/Silver).
CREATE TABLE public.catalogue_materials (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  name       text        NOT NULL,
  code       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX catalogue_materials_code_idx ON public.catalogue_materials (tenant_id, code);
ALTER TABLE public.catalogue_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_materials FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_styles ──────────────────────────────────────────────────────
-- Optional design-style attribute (Antique/Plain/Italian/Jadau/Solitaire/...).
CREATE TABLE public.catalogue_styles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  name       text        NOT NULL,
  code       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX catalogue_styles_code_idx ON public.catalogue_styles (tenant_id, code);
ALTER TABLE public.catalogue_styles ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_styles FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_sku_counters ────────────────────────────────────────────────
-- Atomic per-composed-prefix sequence. Row-locked upsert in catalogue_next_sku()
-- makes concurrent staff-safe numbering without dynamic sequence objects.
CREATE TABLE public.catalogue_sku_counters (
  tenant_id  uuid    NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  prefix     text    NOT NULL,
  next_seq   integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, prefix)
);
ALTER TABLE public.catalogue_sku_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_sku_counters FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_products ────────────────────────────────────────────────────
CREATE TABLE public.catalogue_products (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  item_type_id          uuid        NOT NULL REFERENCES public.catalogue_item_types(id) ON DELETE RESTRICT,
  material_id           uuid        NOT NULL REFERENCES public.catalogue_materials(id) ON DELETE RESTRICT,
  style_id              uuid        REFERENCES public.catalogue_styles(id) ON DELETE SET NULL,
  sku                   text        NOT NULL,
  old_sku               text,
  name                  text,
  description           text,
  weight_grams          numeric,
  status                text        NOT NULL DEFAULT 'draft',
  stock_status          text        NOT NULL DEFAULT 'in_stock',
  -- Live-pricing recipe (nullable — only set when price_mode='live_gold')
  price_mode            text        NOT NULL DEFAULT 'manual',
  rate_source            text,       -- 'jewellery_purity' | 'mmtc_coin'
  purity_idx            integer,
  net_gold_weight_grams numeric,
  coin_weight_g         numeric,
  making_amount         numeric     DEFAULT 0,
  dia_total             numeric     DEFAULT 0,
  misc_total            numeric     DEFAULT 0,
  apply_gst             boolean     NOT NULL DEFAULT true,
  qty                   integer     NOT NULL DEFAULT 1,
  manual_price          numeric,
  price_visible         boolean     NOT NULL DEFAULT true,
  source_estimate_id    uuid        REFERENCES public.bullion_estimates(id) ON DELETE SET NULL,
  created_by            text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT catalogue_products_status_chk CHECK (status IN ('draft','published','archived')),
  CONSTRAINT catalogue_products_stock_chk  CHECK (stock_status IN ('in_stock','reserved','sold','out_of_stock')),
  CONSTRAINT catalogue_products_price_mode_chk CHECK (price_mode IN ('live_gold','manual')),
  CONSTRAINT catalogue_products_rate_source_chk CHECK (rate_source IS NULL OR rate_source IN ('jewellery_purity','mmtc_coin'))
);
CREATE UNIQUE INDEX catalogue_products_sku_idx ON public.catalogue_products (tenant_id, sku);
CREATE INDEX catalogue_products_item_type_idx ON public.catalogue_products (tenant_id, item_type_id);
CREATE INDEX catalogue_products_status_idx ON public.catalogue_products (tenant_id, status);
ALTER TABLE public.catalogue_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_products FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_product_collections ─────────────────────────────────────────
-- Marketing/curation layer: a product's own item_type_id is its structural
-- home (drives SKU), but it can ALSO be tagged into other groupings (e.g.
-- "New Arrivals"). This join table is the single source of truth for
-- "which collections show this product" — always includes a row for the
-- product's own item_type_id too, set by the SKU trigger below.
CREATE TABLE public.catalogue_product_collections (
  product_id   uuid NOT NULL REFERENCES public.catalogue_products(id) ON DELETE CASCADE,
  item_type_id uuid NOT NULL REFERENCES public.catalogue_item_types(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, item_type_id)
);
ALTER TABLE public.catalogue_product_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_product_collections FOR ALL TO anon
  USING (EXISTS (SELECT 1 FROM public.catalogue_products p WHERE p.id = product_id AND p.tenant_id = public.ssj_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogue_products p WHERE p.id = product_id AND p.tenant_id = public.ssj_tenant_id()));

-- ── catalogue_product_images ──────────────────────────────────────────────
CREATE TABLE public.catalogue_product_images (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  product_id      uuid        NOT NULL REFERENCES public.catalogue_products(id) ON DELETE CASCADE,
  url             text        NOT NULL,
  storage_backend text        NOT NULL DEFAULT 'supabase',
  is_cover        boolean     NOT NULL DEFAULT false,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT catalogue_images_backend_chk CHECK (storage_backend IN ('supabase','nas'))
);
CREATE INDEX catalogue_images_product_idx ON public.catalogue_product_images (tenant_id, product_id, sort_order);
ALTER TABLE public.catalogue_product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_product_images FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_shares ──────────────────────────────────────────────────────
-- id itself IS the share token embedded in the public link (mirrors
-- bullion_referrals, 0046). A share is "a curated, resolved set of products
-- sent to one client" — whole collection, price/date filtered, or a
-- hand-picked cross-collection list — resolved into catalogue_share_products
-- at send time so the link stays stable even if the collection changes later.
CREATE TABLE public.catalogue_shares (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  share_type      text        NOT NULL DEFAULT 'collection',
  item_type_id    uuid        REFERENCES public.catalogue_item_types(id) ON DELETE SET NULL,
  filters         jsonb,
  lead_id         uuid        REFERENCES public.bullion_leads(id) ON DELETE SET NULL,
  sent_to_phone   text,
  sent_at         timestamptz,
  wa_status       text        DEFAULT 'pending',
  view_count      integer     NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT catalogue_shares_type_chk CHECK (share_type IN ('collection','filtered','custom'))
);
CREATE INDEX catalogue_shares_item_type_idx ON public.catalogue_shares (tenant_id, item_type_id);
CREATE INDEX catalogue_shares_phone_idx ON public.catalogue_shares (sent_to_phone);
CREATE INDEX catalogue_shares_lead_idx ON public.catalogue_shares (lead_id);
ALTER TABLE public.catalogue_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_shares FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── catalogue_share_products ──────────────────────────────────────────────
CREATE TABLE public.catalogue_share_products (
  share_id   uuid NOT NULL REFERENCES public.catalogue_shares(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.catalogue_products(id) ON DELETE CASCADE,
  PRIMARY KEY (share_id, product_id)
);
ALTER TABLE public.catalogue_share_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_share_products FOR ALL TO anon
  USING (EXISTS (SELECT 1 FROM public.catalogue_shares s WHERE s.id = share_id AND s.tenant_id = public.ssj_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogue_shares s WHERE s.id = share_id AND s.tenant_id = public.ssj_tenant_id()));

-- ── catalogue_selections / catalogue_selection_items ──────────────────────
-- Persistent basket keyed by client (lead/phone), NOT by share — a client
-- who receives multiple links over time gets one consolidated basket, both
-- staff (per-lead CRM panel) and the client (reopening any of their links)
-- see the same consolidated list.
CREATE TABLE public.catalogue_selections (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  lead_id    uuid        REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  phone      text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX catalogue_selections_lead_idx ON public.catalogue_selections (tenant_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX catalogue_selections_phone_idx ON public.catalogue_selections (tenant_id, phone) WHERE lead_id IS NULL AND phone IS NOT NULL;
ALTER TABLE public.catalogue_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_selections FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE TABLE public.catalogue_selection_items (
  selection_id uuid        NOT NULL REFERENCES public.catalogue_selections(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.catalogue_products(id) ON DELETE CASCADE,
  share_id     uuid        REFERENCES public.catalogue_shares(id) ON DELETE SET NULL,
  added_at     timestamptz DEFAULT now(),
  PRIMARY KEY (selection_id, product_id)
);
ALTER TABLE public.catalogue_selection_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.catalogue_selection_items FOR ALL TO anon
  USING (EXISTS (SELECT 1 FROM public.catalogue_selections s WHERE s.id = selection_id AND s.tenant_id = public.ssj_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogue_selections s WHERE s.id = selection_id AND s.tenant_id = public.ssj_tenant_id()));

-- ── SKU generation ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.catalogue_next_sku(p_item_type_id uuid, p_material_id uuid, p_style_id uuid, p_tenant_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_it_code   text;
  v_mat_code  text;
  v_style_code text;
  v_prefix    text;
  v_seq       integer;
BEGIN
  SELECT code INTO v_it_code FROM public.catalogue_item_types WHERE id = p_item_type_id;
  SELECT code INTO v_mat_code FROM public.catalogue_materials WHERE id = p_material_id;
  IF p_style_id IS NOT NULL THEN
    SELECT code INTO v_style_code FROM public.catalogue_styles WHERE id = p_style_id;
  END IF;
  IF v_it_code IS NULL OR v_mat_code IS NULL THEN
    RAISE EXCEPTION 'catalogue_next_sku: item type or material not found (item_type_id=%, material_id=%)', p_item_type_id, p_material_id;
  END IF;
  v_prefix := v_it_code || v_mat_code || COALESCE(v_style_code, '');

  INSERT INTO public.catalogue_sku_counters (tenant_id, prefix, next_seq)
  VALUES (p_tenant_id, v_prefix, 2)
  ON CONFLICT (tenant_id, prefix) DO UPDATE SET next_seq = catalogue_sku_counters.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  RETURN v_prefix || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogue_products_before_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sku IS NULL OR NEW.sku = '' THEN
    NEW.sku := public.catalogue_next_sku(NEW.item_type_id, NEW.material_id, NEW.style_id, NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalogue_products_sku_trg BEFORE INSERT ON public.catalogue_products
  FOR EACH ROW EXECUTE FUNCTION public.catalogue_products_before_insert();

-- Keep catalogue_product_collections seeded with the product's own structural
-- item type whenever it's created or moved.
CREATE OR REPLACE FUNCTION public.catalogue_products_sync_home_collection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.catalogue_product_collections (product_id, item_type_id)
  VALUES (NEW.id, NEW.item_type_id)
  ON CONFLICT (product_id, item_type_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalogue_products_sync_home_collection_trg AFTER INSERT ON public.catalogue_products
  FOR EACH ROW EXECUTE FUNCTION public.catalogue_products_sync_home_collection();

-- ── Seed data ─────────────────────────────────────────────────────────────

-- Materials (Group Name axis) — matches the store's spreadsheet + Silver added per request
INSERT INTO public.catalogue_materials (name, code, sort_order) VALUES
  ('Gold Jewellery',      'G', 1),
  ('Diamond Jewellery',   'D', 2),
  ('Platinum Jewellery',  'P', 3),
  ('Panchdhatu',          'M', 4),
  ('Gemstone Jewellery',  'R', 5),
  ('Silver Jewellery',    'S', 6);

-- Styles — matches the store's spreadsheet style suffixes
INSERT INTO public.catalogue_styles (name, code, sort_order) VALUES
  ('Antique',         'AT', 1),
  ('AD (American Diamond)', 'AD', 2),
  ('Plain',           'PL', 3),
  ('Italian',         'IT', 4),
  ('Gold Instant',    'GI', 5),
  ('Jadau',           'JU', 6),
  ('Diamond',         'DD', 7),
  ('Solitaire',       'SO', 8),
  ('Diamond Instant', 'DI', 9),
  ('Polki',           'PK', 10),
  ('Gents',           'GT', 11),
  ('Kids',            'KD', 12),
  ('Mounts',          'MT', 13),
  ('God',             'GD', 14);

-- Item types (Category axis) — parents first, then children referencing them
INSERT INTO public.catalogue_item_types (name, code, is_default, sort_order) VALUES
  ('Rings',       'RG', true, 1),
  ('Earrings',    'ER', true, 2),
  ('Necklaces',   'NY', true, 3),
  ('Pendants',    'PD', true, 4),
  ('Bracelet',    'BR', true, 5),
  ('Bangles',     'BG', true, 5),
  ('Chain',       'CH', true, 6),
  ('Tirmania',    'TR', true, 7),
  ('Nosepin',     'NP', true, 8),
  ('Accessories', 'AC', true, 9),
  ('Purses',      'PU', true, 10),
  ('Idols',       'ID', true, 11),
  ('Coins',       'CN', true, 12);

INSERT INTO public.catalogue_item_types (parent_id, name, code, is_default, sort_order)
SELECT id, 'Ring Band', 'BD', true, 1 FROM public.catalogue_item_types WHERE code = 'RG'
UNION ALL SELECT id, 'Ring Everyday', 'EV', true, 2 FROM public.catalogue_item_types WHERE code = 'RG'
UNION ALL SELECT id, 'Ring Cocktail', 'CK', true, 3 FROM public.catalogue_item_types WHERE code = 'RG'
UNION ALL SELECT id, 'Engagement Ring', 'EN', true, 4 FROM public.catalogue_item_types WHERE code = 'RG'
UNION ALL SELECT id, 'Couple Band', 'CB', true, 5 FROM public.catalogue_item_types WHERE code = 'RG'
UNION ALL SELECT id, 'Vali', 'VL', true, 1 FROM public.catalogue_item_types WHERE code = 'ER'
UNION ALL SELECT id, 'Tops', 'TP', true, 2 FROM public.catalogue_item_types WHERE code = 'ER'
UNION ALL SELECT id, 'Necklace Set', 'NS', true, 1 FROM public.catalogue_item_types WHERE code = 'NY'
UNION ALL SELECT id, 'Pendant Set', 'PS', true, 1 FROM public.catalogue_item_types WHERE code = 'PD'
UNION ALL SELECT id, 'Tirmania Set', 'TS', true, 1 FROM public.catalogue_item_types WHERE code = 'TR';

-- ── Storage RLS: uploads/catalogue/% path in the existing 'media' bucket ──
CREATE POLICY "catalogue_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND name LIKE 'uploads/catalogue/%');
CREATE POLICY "catalogue_select" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'media' AND name LIKE 'uploads/catalogue/%');
CREATE POLICY "catalogue_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND name LIKE 'uploads/catalogue/%');
