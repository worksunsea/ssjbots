-- Walk-in form additions: jewellery type multi-select, how-they-found-us,
-- visit tracking (in/out time, party size, items seen), and not-bought reason.

-- Per-demand
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS product_types text[]    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS items_seen   text[]    NOT NULL DEFAULT '{}',  -- subset of PRODUCT_TYPES + free
  ADD COLUMN IF NOT EXISTS party_size   int,                              -- how many people walked in together
  ADD COLUMN IF NOT EXISTS in_time      timestamptz,                      -- when they entered the showroom
  ADD COLUMN IF NOT EXISTS out_time     timestamptz,                      -- when they left
  ADD COLUMN IF NOT EXISTS price_quoted numeric,                          -- ₹ price quoted on their highest-interest item
  ADD COLUMN IF NOT EXISTS not_bought_reason text,                        -- dropdown value (see UI list)
  ADD COLUMN IF NOT EXISTS not_bought_notes  text,                        -- free-text detail
  ADD COLUMN IF NOT EXISTS competitor_mentioned text,                     -- "Tanishq", "PNG", "Khazana", etc.
  ADD COLUMN IF NOT EXISTS followup_required boolean NOT NULL DEFAULT false;

-- Per-contact
ALTER TABLE public.bullion_leads
  ADD COLUMN IF NOT EXISTS discovery_source text;

CREATE INDEX IF NOT EXISTS bullion_demands_product_types_gin
  ON public.bullion_demands USING gin (product_types);
CREATE INDEX IF NOT EXISTS bullion_demands_items_seen_gin
  ON public.bullion_demands USING gin (items_seen);
