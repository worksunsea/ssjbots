-- Lucky-draw schemes (Golden Bliss/Bloom) issue each enrollment a numbered
-- slot within its batch (1..max_members) — a client can enroll multiple
-- times in the same scheme, each entry gets its own number. Unique per
-- batch so two entries can never collide on the same number; cancelling an
-- enrollment frees its number back up for reuse (index is partial, only
-- covers non-null batch_id + member_number).

alter table public.kitty_enrollments add column member_number int;

create unique index kitty_enrollments_batch_number_idx
  on public.kitty_enrollments (batch_id, member_number)
  where batch_id is not null and member_number is not null;
