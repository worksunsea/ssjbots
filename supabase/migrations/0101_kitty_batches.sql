-- Lucky-draw kitty schemes (Golden Bliss/Bloom) run in capped rounds — max
-- 100 members per 12-month batch, and a fresh batch opens automatically
-- when one completes (existing members get pushed a WA nudge to re-enroll
-- into the new round). Fixed-schedule schemes (Sparkle/Glow/Serenty) and
-- Gullak don't use batches — enrollment.batch_id stays null for those.

create table public.kitty_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.ssj_tenant_id(),
  scheme_id    uuid not null references public.kitty_schemes(id),
  batch_label  text not null,
  start_date   date not null,
  max_members  int not null default 100,
  status       text not null default 'open', -- open | full | completed
  created_at   timestamptz not null default now()
);

create index kitty_batches_scheme_idx on public.kitty_batches (scheme_id);
create index kitty_batches_open_idx on public.kitty_batches (scheme_id, status) where status = 'open';

alter table public.kitty_enrollments add column batch_id uuid references public.kitty_batches(id);
alter table public.kitty_draws add column batch_id uuid references public.kitty_batches(id);

-- Draws now scope to a batch (each round has its own monthly draw), not just
-- scheme+month — needed once a scheme can have more than one concurrent
-- batch (an old round still finishing while a new one has already opened).
drop index if exists kitty_draws_scheme_month_idx;
create unique index kitty_draws_batch_month_idx on public.kitty_draws (batch_id, draw_month) where batch_id is not null;

alter table public.kitty_batches enable row level security;
create policy anon_tenant on public.kitty_batches for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());
