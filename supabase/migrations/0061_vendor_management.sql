-- Vendor Management feature: scan supplier business cards, record contact
-- details + payment terms, tag which catalogue collections they deal in,
-- and record item-wise making charges — so "who supplies X" is one search.
--
-- Categories link to the EXISTING catalogue_item_types taxonomy (Rings,
-- Necklaces, ...) rather than a new dropdown list, reusing CatalogueScreen's
-- existing collection admin UI.

-- ── bullion_vendors ──────────────────────────────────────────────────────
-- One row per supplier company.
CREATE TABLE public.bullion_vendors (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  company_name     text        NOT NULL,
  contact_person   text,
  designation      text,
  phone            text,
  alt_phone        text,
  email            text,
  address          text,
  city             text,
  state            text,
  website          text,
  gstin            text,
  payment_terms    text        NOT NULL DEFAULT 'advance',
  on_approval_days integer,
  credit_days      integer,
  card_image_url   text,
  notes            text,
  source           text        NOT NULL DEFAULT 'manual',
  exhibition_name  text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT bullion_vendors_payment_terms_chk
    CHECK (payment_terms IN ('advance','on_approval','credit','cod','other')),
  CONSTRAINT bullion_vendors_source_chk
    CHECK (source IN ('manual','card_scan','exhibition','referral','other'))
);
CREATE INDEX bullion_vendors_tenant_idx ON public.bullion_vendors (tenant_id, active);
CREATE INDEX bullion_vendors_company_idx ON public.bullion_vendors (tenant_id, lower(company_name));
CREATE INDEX bullion_vendors_gstin_idx ON public.bullion_vendors (tenant_id, gstin) WHERE gstin IS NOT NULL;
ALTER TABLE public.bullion_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.bullion_vendors FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── bullion_vendor_dealings ──────────────────────────────────────────────
-- Join table: which catalogue collections a vendor deals in.
CREATE TABLE public.bullion_vendor_dealings (
  vendor_id    uuid NOT NULL REFERENCES public.bullion_vendors(id) ON DELETE CASCADE,
  item_type_id uuid NOT NULL REFERENCES public.catalogue_item_types(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (vendor_id, item_type_id)
);
ALTER TABLE public.bullion_vendor_dealings ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.bullion_vendor_dealings FOR ALL TO anon
  USING (EXISTS (SELECT 1 FROM public.bullion_vendors v WHERE v.id = vendor_id AND v.tenant_id = public.ssj_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bullion_vendors v WHERE v.id = vendor_id AND v.tenant_id = public.ssj_tenant_id()));

-- ── bullion_vendor_items ─────────────────────────────────────────────────
-- Item-wise making charges quoted by a vendor. item_type_id is nullable —
-- a vendor may quote a charge for a free-text item before it's tagged to a
-- formal catalogue collection.
CREATE TABLE public.bullion_vendor_items (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL DEFAULT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
  vendor_id          uuid        NOT NULL REFERENCES public.bullion_vendors(id) ON DELETE CASCADE,
  item_type_id       uuid        REFERENCES public.catalogue_item_types(id) ON DELETE SET NULL,
  item_name          text        NOT NULL,
  making_charge      numeric     NOT NULL,
  making_charge_unit text        NOT NULL DEFAULT 'per_gram',
  price_note         text,
  active             boolean     NOT NULL DEFAULT true,
  created_by         text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  CONSTRAINT bullion_vendor_items_unit_chk
    CHECK (making_charge_unit IN ('per_gram','per_piece','per_carat','percent','flat'))
);
CREATE INDEX bullion_vendor_items_vendor_idx ON public.bullion_vendor_items (tenant_id, vendor_id, active);
CREATE INDEX bullion_vendor_items_item_type_idx ON public.bullion_vendor_items (tenant_id, item_type_id, active);
CREATE INDEX bullion_vendor_items_name_idx ON public.bullion_vendor_items (tenant_id, lower(item_name));
ALTER TABLE public.bullion_vendor_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.bullion_vendor_items FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id()) WITH CHECK (tenant_id = public.ssj_tenant_id());

-- ── storage RLS: uploads/vendors/% (card photos) ─────────────────────────
CREATE POLICY "vendors_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND name LIKE 'uploads/vendors/%');
CREATE POLICY "vendors_select" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'media' AND name LIKE 'uploads/vendors/%');
CREATE POLICY "vendors_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND name LIKE 'uploads/vendors/%');
