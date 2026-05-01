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

-- Seed config keys using field as the key name (no label column in this table).
-- Use NOT EXISTS so re-running is safe and won't overwrite admin edits.
DO $$
DECLARE
  _tid uuid := 'a1b2c3d4-0000-0000-0000-000000000001'::uuid;
BEGIN
  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'google_review_link', '', true, 90
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'google_review_link');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day3',
    'Hi {name}, we hope you are loving your new {product} 💎 It was a pleasure serving you at Sun Sea Jewellers! If you need any adjustments or have questions, we are always here. 🙏',
    true, 91
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day3');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day7',
    'Hi {name}, we hope your {product} is bringing you joy! ✨ If you have a moment, we would truly appreciate a Google review — it means the world to us: {review_link}

Thank you for your trust. 🙏',
    true, 92
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day7');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'post_sale_day30',
    'Hi {name}, it has been a month since you picked up your {product} from Sun Sea Jewellers 💎 We hope it is perfect! If you ever need a resize, repair, or cleaning — just reach out. Always here for you. 🙏',
    true, 93
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'post_sale_day30');

  INSERT INTO bullion_dropdowns (tenant_id, field, value, active, sort_order)
  SELECT _tid, 'missed_call_auto_reply',
    'Hi! You tried calling Sun Sea Jewellers. We are sorry we missed you! Our team will call you back shortly. 💎 Or WhatsApp us here anytime.',
    true, 94
  WHERE NOT EXISTS (SELECT 1 FROM bullion_dropdowns WHERE tenant_id = _tid AND field = 'missed_call_auto_reply');
END $$;
