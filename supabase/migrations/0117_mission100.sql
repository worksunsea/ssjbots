-- Mission 100 — gamified race-to-100g gold scheme layered on top of the
-- existing kitty_enrollments/kitty_installments gram-tracking machinery
-- (same mechanism the gram-based Gullak scheme already uses). A friend
-- group of 10 or 20 races to 100g each; checkpoints at 25g/50g/75g/100g
-- award the first group member to reach them, decoupled per-person so no
-- one's prize ever depends on groupmates finishing (dropouts are normal
-- at realistic multi-year pace and must never block anyone else's prize).
--
-- kitty_batches (capacity-based lucky-draw cohorts) is the wrong shape for
-- this — no ranking/race concept, no size-10/20 config — so this ships as
-- its own pair of tables instead.

create table public.mission100_groups (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default public.ssj_tenant_id(),
  scheme_id            uuid not null references public.kitty_schemes(id),
  group_label          text not null,
  invite_code          text not null,
  size                 int not null,
    -- 10 or 20 — capacity only, does not affect prize tier (same trip either way)
  status               text not null default 'forming',
    -- forming | racing | completed | closed
  formed_by            text not null,
    -- self_signup | staff
  created_by           text,
  started_at           timestamptz,
  winner_enrollment_id uuid references public.kitty_enrollments(id),
    -- the group's 100g/trip winner — mirrors the checkpoint_grams=100 row
    -- in mission100_checkpoint_wins for quick display without a join
  winner_declared_at   timestamptz,
  prize_status         text not null default 'not_applicable',
    -- not_applicable | pending | booked | fulfilled — staff's manual
    -- trip-fulfillment tracking, no automated booking
  notes                text,
  created_at           timestamptz not null default now(),

  constraint mission100_groups_size_check check (size in (10, 20)),
  constraint mission100_groups_formed_by_check check (formed_by in ('self_signup', 'staff'))
);

create unique index mission100_groups_tenant_invite_idx on public.mission100_groups (tenant_id, invite_code);
create index mission100_groups_status_idx on public.mission100_groups (tenant_id, status);
create index mission100_groups_scheme_idx on public.mission100_groups (scheme_id);

create table public.mission100_group_members (
  id                           uuid primary key default gen_random_uuid(),
  tenant_id                    uuid not null default public.ssj_tenant_id(),
  group_id                     uuid not null references public.mission100_groups(id) on delete cascade,
  enrollment_id                uuid not null references public.kitty_enrollments(id) on delete cascade,
  joined_via                   text not null,
    -- invite_link | staff_assigned
  referred_by_member_id        uuid references public.mission100_group_members(id),
    -- points to a PERSON not a group — referral is scheme-wide, a
    -- referrer's link can bring people into any group, not just their own
  checkpoint_25_reached_at     timestamptz,
    -- personal — this member's own total first crossed 25g, regardless of
    -- group placement. Doubles as the referral-qualification bar (a
    -- referred person only "counts" once they've bought a real quarter of
    -- the goal, not merely signed up).
  finished_at                  timestamptz,
    -- personal 100g reached — triggers the universal completion bonus for
    -- EVERY finisher, not just whoever's first in the group
  completion_bonus_awarded_at  timestamptz,
  finish_rank                  int,
    -- this member's own order of finishing within their group,
    -- informational only — the authoritative trip-winner record lives on
    -- mission100_checkpoint_wins (checkpoint_grams=100)
  referral_bonus_tier_awarded  int not null default 0,
    -- how many "every-5-qualifying-referrals" tiers already paid to this
    -- member as a referrer
  last_purchase_at             timestamptz,
    -- denormalized from installments, refreshed by cron — drives the
    -- monthly-minimum/inactive-flag display without a join on every read
  months_behind                int not null default 0,
    -- count of calendar months this member missed the 1g/month minimum —
    -- reminder/visibility only, never blocks anyone
  created_at                   timestamptz not null default now(),

  constraint mission100_group_members_joined_via_check check (joined_via in ('invite_link', 'staff_assigned'))
);

create unique index mission100_group_members_group_enrollment_idx on public.mission100_group_members (group_id, enrollment_id);
create unique index mission100_group_members_enrollment_idx on public.mission100_group_members (enrollment_id);
create index mission100_group_members_group_idx on public.mission100_group_members (group_id);
create index mission100_group_members_referrer_idx on public.mission100_group_members (referred_by_member_id);

create table public.mission100_checkpoint_wins (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.ssj_tenant_id(),
  group_id         uuid not null references public.mission100_groups(id) on delete cascade,
  checkpoint_grams int not null,
  winner_member_id uuid not null references public.mission100_group_members(id),
  awarded_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  constraint mission100_checkpoint_wins_grams_check check (checkpoint_grams in (25, 50, 75, 100))
);

create unique index mission100_checkpoint_wins_group_checkpoint_idx on public.mission100_checkpoint_wins (group_id, checkpoint_grams);

alter table public.mission100_groups          enable row level security;
alter table public.mission100_group_members   enable row level security;
alter table public.mission100_checkpoint_wins enable row level security;

create policy anon_tenant on public.mission100_groups for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

create policy anon_tenant on public.mission100_group_members for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

create policy anon_tenant on public.mission100_checkpoint_wins for all to anon
  using (tenant_id = public.ssj_tenant_id())
  with check (tenant_id = public.ssj_tenant_id());

-- Bonus/comped installments (checkpoint wins, universal completion bonus,
-- referral bonus) are inserted with status:'free' instead of 'paid' — add
-- the missing constraint value so the app-level status enum stays honest.
-- (kitty_installments.status has no DB check constraint today; nothing to
-- alter here, this comment just documents the accepted value for 'free'
-- rows going forward: due | paid | free | waived | awaiting_payment.)

-- Seed the Mission 100 scheme itself. duration_months is a placeholder —
-- irrelevant once perks.unit === "grams" makes confirm-enrollment
-- (api/kitty.js) skip fixed-schedule generation entirely, same as Gullak.
insert into public.kitty_schemes (tenant_id, name, slug, monthly_amount, duration_months, perks, description, active, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Mission 100', 'mission-100', null, 999,
   '{"unit": "grams", "redemption": "jewellery_or_raw_gold", "mission100": true, "target_grams": 100, "coin_weight_g": 1, "checkpoints_g": [25, 50, 75, 100], "min_grams_per_month": 1, "weight_tiers_g": [1, 2, 5, 10], "trip_prize_description": "Couple''s 2N/3D domestic trip, 5-star property"}'::jsonb,
   'Race your friend group (10 or 20) to 100 grams of gold. Checkpoints every 25g win bonus coins, first to 100g wins a couple''s trip, everyone who finishes gets a bonus coin.',
   true, 6);
