-- Advance reminder was bumped 3 -> 7 days, then staff asked for BOTH: a
-- 7-day heads-up AND a separate, more urgent 3-day nudge, not one
-- replacing the other. Separate stamp column so the two fire
-- independently (reminded_at = 7-day, this = 3-day).
alter table public.kitty_installments add column if not exists reminded_3day_at timestamptz;
