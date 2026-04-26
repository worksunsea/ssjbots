-- Step 1: Delete duplicate inbound messages — keep only the earliest per msgId
-- (duplicates were created before the dedup fix was in place)
DELETE FROM bullion_messages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY wbiztool_msg_id, direction
             ORDER BY created_at ASC
           ) AS rn
    FROM bullion_messages
    WHERE wbiztool_msg_id IS NOT NULL
      AND wbiztool_msg_id <> ''
      AND direction = 'in'
  ) ranked
  WHERE rn > 1
);

-- Step 2: Now the unique index can be created cleanly
CREATE UNIQUE INDEX IF NOT EXISTS bullion_messages_dedup_inbound
  ON bullion_messages (wbiztool_msg_id, direction)
  WHERE wbiztool_msg_id IS NOT NULL
    AND wbiztool_msg_id <> ''
    AND direction = 'in';

-- Step 3: Track broadcasts as proper records (used by broadcast history tab)
CREATE TABLE IF NOT EXISTS bullion_broadcast_sends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  funnel_id     TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  message_text  TEXT,
  media_url     TEXT,
  media_type    TEXT,    -- image | video | document | null
  filter_json   JSONB,   -- audience filter used
  recipient_count INT DEFAULT 0,
  skipped_count   INT DEFAULT 0,
  pace          TEXT DEFAULT 'safe',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by    TEXT
);

CREATE INDEX IF NOT EXISTS bullion_broadcast_sends_funnel ON bullion_broadcast_sends(funnel_id);
CREATE INDEX IF NOT EXISTS bullion_broadcast_sends_tenant ON bullion_broadcast_sends(tenant_id);
