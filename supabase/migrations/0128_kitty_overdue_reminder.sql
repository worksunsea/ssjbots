-- Stamp for the overdue-installment reminder sweep (kitty-cron.js). These
-- reminders are queued (kitty_message_queue, status=pending) for staff to
-- review/approve via Kitty Admin > Pending Messages, never auto-sent —
-- unlike the 7-day/3-day/due-today reminders which send straight away.
alter table public.kitty_installments add column if not exists overdue_reminded_at timestamptz;
