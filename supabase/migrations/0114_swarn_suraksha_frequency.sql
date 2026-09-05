-- Swarn Suraksha auto-debit can now run daily, weekly, fortnightly, or
-- monthly (not just monthly) — remembers which, for display/admin and so
-- the freeze-rollover cron can reconstruct the right cadence.
alter table public.kitty_enrollments
  add column swarn_frequency text; -- daily | weekly | fortnightly | monthly
