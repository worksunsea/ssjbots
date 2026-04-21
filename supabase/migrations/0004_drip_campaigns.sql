-- Drip campaigns: per-funnel timed follow-up sequences.
--
-- When a lead is enrolled in a funnel, we schedule all its follow-up steps
-- as rows in `bullion_scheduled_messages`. A Vercel Cron worker wakes each
-- minute to flush due rows. If the lead replies between steps, pending
-- rows get canceled and the lead is flagged for agent follow-up.

create table if not exists public.bullion_funnel_steps (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  funnel_id           text references public.funnels(id) on delete cascade,
  step_order          int not null,
  name                text,                         -- "Day 1 reminder"
  delay_minutes       int not null,                 -- minutes after previous step's send_at (or after enrollment if step_order=1)
  condition           text default 'always',        -- always | no_reply_since_last_step | no_reply_since_enrollment
  message_template    text not null,                -- supports {{name}}, {{phone}}, {{funnel_name}}, {{goal}}
  active              boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (tenant_id, funnel_id, step_order)
);

create index if not exists bullion_funnel_steps_tenant_idx
  on public.bullion_funnel_steps (tenant_id, funnel_id);

create table if not exists public.bullion_scheduled_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  lead_id             uuid references public.bullion_leads(id) on delete cascade,
  step_id             uuid references public.bullion_funnel_steps(id) on delete set null,
  funnel_id           text references public.funnels(id),
  send_at             timestamptz not null,
  body                text not null,                -- pre-rendered at enrollment time
  status              text default 'pending',       -- pending | sent | canceled | failed
  sent_at             timestamptz,
  canceled_reason     text,                         -- 'lead_replied' | 'lead_converted' | 'funnel_disabled' | etc
  error               text,
  created_at          timestamptz default now()
);

create index if not exists bullion_sched_due_idx
  on public.bullion_scheduled_messages (status, send_at)
  where status = 'pending';

create index if not exists bullion_sched_lead_idx
  on public.bullion_scheduled_messages (lead_id);

drop trigger if exists bullion_funnel_steps_touch on public.bullion_funnel_steps;
create trigger bullion_funnel_steps_touch before update on public.bullion_funnel_steps
  for each row execute function public.touch_updated_at();

alter table public.bullion_funnel_steps        enable row level security;
alter table public.bullion_scheduled_messages  enable row level security;

drop policy if exists anon_all_bullion_funnel_steps on public.bullion_funnel_steps;
drop policy if exists anon_all_bullion_scheduled_messages on public.bullion_scheduled_messages;
create policy anon_all_bullion_funnel_steps       on public.bullion_funnel_steps       for all to anon using (true) with check (true);
create policy anon_all_bullion_scheduled_messages on public.bullion_scheduled_messages for all to anon using (true) with check (true);
