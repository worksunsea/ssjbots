-- Kitty WhatsApp sends (reminders, rate-cut notices, redemption codes, etc.)
-- previously failed silently (.catch(() => ({status:0}))) with nothing kept
-- to retry — if the WA session was down, the member just never got told.
-- This queues any failed send so staff can see it, get nudged, and retry
-- (one-by-one or paced "send all") from Kitty Admin.

create table if not exists public.kitty_message_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  lead_id uuid references public.bullion_leads(id) on delete set null,
  phone text not null,
  message text not null,
  context jsonb default '{}'::jsonb,   -- {type: 'due_reminder'|'rate_notify'|'redemption_code'|..., ...ids}
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 1,
  last_error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists kitty_message_queue_pending_idx on public.kitty_message_queue (tenant_id, status, created_at);

alter table public.kitty_message_queue enable row level security;
drop policy if exists anon_all_kitty_message_queue on public.kitty_message_queue;
create policy anon_all_kitty_message_queue on public.kitty_message_queue for all to anon using (true) with check (true);
