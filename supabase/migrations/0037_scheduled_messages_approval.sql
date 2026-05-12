-- Approval workflow for scheduled messages + media columns for broadcasts.
-- These columns were added to the codebase (cron.js, ApprovalsScreen, broadcast-send.js)
-- without a corresponding migration.
--
-- How the approval flow works:
--   1. drip.js enrolls leads → rows created with approved = false (default)
--   2. cron pre-generates AI body into edited_body for unapproved calendar messages
--   3. Saurav reviews in Approvals tab → sets approved = true (optionally edits body)
--   4. Cron gate: .eq("approved", true) — only sends approved messages
--   5. Broadcast rows and visit reminders are created with approved = true (auto-approved)

ALTER TABLE public.bullion_scheduled_messages
  ADD COLUMN IF NOT EXISTS approved     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by  text,
  ADD COLUMN IF NOT EXISTS edited_body  text,        -- manager's edited version; cron sends this over body
  ADD COLUMN IF NOT EXISTS media_url    text,        -- for image/video broadcasts
  ADD COLUMN IF NOT EXISTS media_type   text;        -- 'image' | 'video' | 'document'

-- Fast index for the cron gate query: pending + approved + send_at
CREATE INDEX IF NOT EXISTS bullion_sched_approved_idx
  ON public.bullion_scheduled_messages (tenant_id, approved, send_at)
  WHERE status = 'pending' AND approved = true;

-- Fast index for the AI preview generation query: pending + not approved + no edited_body
CREATE INDEX IF NOT EXISTS bullion_sched_preview_idx
  ON public.bullion_scheduled_messages (tenant_id, send_at)
  WHERE status = 'pending' AND approved = false AND edited_body IS NULL;
