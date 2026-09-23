-- Two more one-time overdue-milestone stamps for kitty-cron.js (the
-- existing overdue_reminded_at column is repurposed as the 1-day-overdue
-- milestone stamp — see kitty-cron.js for the 1/3/7-day sweep).
alter table public.kitty_installments add column if not exists overdue_3day_reminded_at timestamptz;
alter table public.kitty_installments add column if not exists overdue_1week_reminded_at timestamptz;
