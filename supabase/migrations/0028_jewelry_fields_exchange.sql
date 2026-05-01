-- ============================================================
-- 0028_jewelry_fields_exchange.sql
-- Structured jewelry detail fields + exchange/trade-in tracking
-- on bullion_demands. Also seeds config keys in bullion_dropdowns.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Jewelry specification fields
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_demands
  ADD COLUMN IF NOT EXISTS metal           text
    CHECK (metal IN ('gold_22k','gold_18k','gold_14k','white_gold','platinum','silver','other')),
  ADD COLUMN IF NOT EXISTS stone           text
    CHECK (stone IN ('diamond','ruby','emerald','sapphire','pearl','kundan','polki','none','other')),
  ADD COLUMN IF NOT EXISTS item_category   text
    CHECK (item_category IN ('ring','necklace','earrings','bangles','bracelet','pendant','set','anklet','other')),
  ADD COLUMN IF NOT EXISTS ring_size       text,           -- US size e.g. "6", "6.5", "7"
  ADD COLUMN IF NOT EXISTS purity          text
    CHECK (purity IN ('916','750','585','925','999','other')),
  ADD COLUMN IF NOT EXISTS hallmark_pref   text
    CHECK (hallmark_pref IN ('bis_hallmark','none','client_choice'));

-- ─────────────────────────────────────────────────────────────
-- 2. Exchange / Trade-in fields
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bullion_demands
  ADD COLUMN IF NOT EXISTS has_exchange    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_desc   text,           -- "Old 22k necklace ~15g, good condition"
  ADD COLUMN IF NOT EXISTS exchange_value  numeric(12,2);  -- estimated ₹ value

-- ─────────────────────────────────────────────────────────────
-- 3. Seed config keys in bullion_dropdowns
--    These are editable by admin via the Config UI without redeploy.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  _tid uuid := 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
BEGIN
  INSERT INTO bullion_dropdowns (tenant_id, field, label, value, active, sort_order)
  VALUES
    (_tid, 'config', 'Google Review Link',      'google_review_link',        true, 10),
    (_tid, 'config', 'Post-Sale Day 3 WA',       'post_sale_day3',            true, 11),
    (_tid, 'config', 'Post-Sale Day 7 WA (Review)', 'post_sale_day7',         true, 12),
    (_tid, 'config', 'Post-Sale Day 30 WA',      'post_sale_day30',           true, 13),
    (_tid, 'config', 'Missed Call Auto-Reply',   'missed_call_auto_reply',    true, 14)
  ON CONFLICT DO NOTHING;
END $$;
