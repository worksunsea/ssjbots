-- Richer trigger options for funnel steps.
-- trigger_type:
--   after_prev_step        — delay_minutes after the previous step's send_at (default)
--   after_enrollment       — delay_minutes after the lead was enrolled
--   after_last_inbound     — delay_minutes after the lead's last incoming message
--   after_last_purchase    — delay_minutes after bullion_leads.last_purchase_at
--   specific_datetime      — send at exactly trigger_at

alter table public.bullion_funnel_steps
  add column if not exists trigger_type text default 'after_prev_step';

alter table public.bullion_funnel_steps
  add column if not exists trigger_at timestamptz;
