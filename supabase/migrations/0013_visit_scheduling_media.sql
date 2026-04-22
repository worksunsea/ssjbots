-- Phase D part 2: Showroom visit scheduling + authority media assets + reschedule support.

-- ── 1. Visit scheduling on demands
alter table public.bullion_demands
  add column if not exists visit_scheduled_at   timestamptz,
  add column if not exists visit_confirmed       boolean default false,
  add column if not exists visit_rescheduled_count int default 0,
  add column if not exists visit_notes           text;

create index if not exists bullion_demands_visit_idx on public.bullion_demands (tenant_id, visit_scheduled_at asc nulls last);

-- ── 2. Authority / brand media assets (PDF brochure, intro video, etc.)
create table if not exists public.bullion_media_assets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  title       text not null,
  asset_type  text default 'pdf',      -- pdf | video | image | link
  url         text not null,           -- publicly accessible URL
  caption     text,                    -- message text sent WITH the asset
  send_to_new_leads boolean default true,  -- auto-send on new demand / new inbound
  active      boolean default true,
  sort_order  int default 1,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists bullion_media_assets_tenant_idx on public.bullion_media_assets (tenant_id, active, sort_order);

-- ── 3. message_type on scheduled messages (for visit reminders vs normal drip)
alter table public.bullion_scheduled_messages
  add column if not exists message_type text default 'text';
  -- text           = normal drip/nurture message
  -- visit_reminder = D-1 "are you coming tomorrow?" ask
  -- visit_day      = day-of "we look forward to seeing you" reminder
  -- authority      = brand asset / intro PDF/video follow-up
