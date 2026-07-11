-- Vendor Management v2 — expands 0061 based on real exhibition-usage feedback:
--   - multiple named contacts per vendor (a card often lists 2-3 people)
--   - front AND back card photos (many cards have info on both sides)
--   - exhibition_name is now independent of `source` (a card can be scanned
--     AT an exhibition — source stays 'card_scan' — while still recording
--     which exhibition it was met at)
-- Table has zero production rows (confirmed before writing this migration),
-- so this is a clean redesign rather than a data migration.

ALTER TABLE public.bullion_vendors
  DROP COLUMN IF EXISTS contact_person,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS alt_phone,
  DROP COLUMN IF EXISTS designation;

ALTER TABLE public.bullion_vendors
  ADD COLUMN contacts jsonb NOT NULL DEFAULT '[]'::jsonb; -- [{name, phone, designation}]

ALTER TABLE public.bullion_vendors
  RENAME COLUMN card_image_url TO card_image_front_url;

ALTER TABLE public.bullion_vendors
  ADD COLUMN card_image_back_url text;

-- Full-card-text search: notes already exists, but was a single free-text
-- field. Nothing to add schema-wise — the AI extraction now folds
-- "deals in" text + any other card text it can't structurally place into
-- this field, and vendor search (client-side) already includes it.
COMMENT ON COLUMN public.bullion_vendors.notes IS
  'Free text — includes AI-extracted "deals in" text and any other card content that does not map to a structured field. Searched alongside company_name/contacts/gstin.';

-- Lightweight custom fields — ad-hoc label/value pairs per vendor, added on
-- the fly when a field doesn't fit the structured schema. No field-type
-- system, no admin builder UI — deliberately simple (see conversation
-- 2026-07-11: a full form-builder was considered and rejected as
-- over-engineering for this scale).
ALTER TABLE public.bullion_vendors
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb; -- [{label, value}]

-- Not every vendor category is a jewellery product line — packaging,
-- equipment, cleaning chemicals, etc. are service/supply categories a
-- vendor can be tagged with. catalogue_item_types doubles as the
-- CUSTOMER-FACING product taxonomy (shown on shared catalogue links), so
-- vendor-only categories must not surface there. customer_visible defaults
-- true (existing/CatalogueScreen-created categories are unaffected);
-- VendorsScreen's inline "+ New Category" quick-add sets it false unless
-- staff explicitly opts a new category into the client catalogue.
ALTER TABLE public.catalogue_item_types
  ADD COLUMN customer_visible boolean NOT NULL DEFAULT true;
