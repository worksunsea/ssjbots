-- Gullak members are commonly walk-ins with ordinary names — staff have
-- had real confusion mixing up two members with the same/similar name.
-- Reuses the existing member_number column (kitty_enrollments, added
-- 0102 for lucky-draw slot picks) but scoped per-scheme instead of
-- per-batch, since Gullak has no batches — the existing unique index
-- (batch_id, member_number) only fires where batch_id is not null, so
-- this partial index is mutually exclusive with it, no collision risk.
create unique index kitty_enrollments_scheme_member_number_idx
  on public.kitty_enrollments (scheme_id, member_number)
  where batch_id is null and member_number is not null;

-- Backfill sequential numbers (order of joining) for every live Gullak
-- enrollment that doesn't have one yet, so existing members get numbered
-- too, not just new signups from here on.
with gullak as (
  select id from public.kitty_schemes where slug = 'gullak-gold-savings'
),
numbered as (
  select e.id, row_number() over (order by e.created_at) as rn
  from public.kitty_enrollments e, gullak g
  where e.scheme_id = g.id and e.member_number is null
)
update public.kitty_enrollments e
set member_number = numbered.rn
from numbered
where e.id = numbered.id;
