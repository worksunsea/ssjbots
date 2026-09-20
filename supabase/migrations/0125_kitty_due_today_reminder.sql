-- The existing due-reminder (kitty-cron.js section 1) fires once, up to 3
-- days BEFORE an installment is due, then stamps reminded_at and never
-- fires again for that installment — so a member still unpaid ON their due
-- date got no further nudge that day. Staff want a distinct, more urgent
-- same-day message (pay today to lock today's rate) sent once per
-- installment on its actual due date, separate from the advance reminder.
alter table public.kitty_installments add column if not exists due_today_reminded_at timestamptz;
