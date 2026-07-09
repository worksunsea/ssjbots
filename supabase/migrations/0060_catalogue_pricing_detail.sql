-- Holds the full jewellery-calculator-shaped breakdown (gross weight, purity,
-- making mode/rate, diamond1/diamond2/stone, misc1/2/3, size) for products
-- created with price_mode='live_gold' + rate_source='jewellery_purity', so
-- the Catalogue product form can show/edit the same granular fields as the
-- Calculator instead of only aggregate totals. Mirrors the existing
-- bullion_estimates.items JSONB-blob convention rather than one column per
-- field. The aggregate columns (net_gold_weight_grams, making_amount,
-- dia_total, misc_total) remain the compiled values live pricing reads —
-- always recompiled from pricing_detail on save.
ALTER TABLE public.catalogue_products ADD COLUMN IF NOT EXISTS pricing_detail jsonb;
