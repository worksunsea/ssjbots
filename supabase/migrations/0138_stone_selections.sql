-- Private client selections: staff pick stones from the website stock, send the client a personal link
-- (ssj.in/my-selection/<token>), the client views them under their own name and finalises N pieces.
-- The token is the only credential (24+ random chars); the link never lists other stock or any cost.
-- SECURITY: RLS on, no policies -> server (service role) only. api/stone-selection.js is the sole reader.

create table if not exists public.stone_selections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  token         text not null unique,
  client_name   text not null,
  client_phone  text,
  note          text,
  skus          text[] not null default '{}',     -- stones offered to the client
  max_picks     integer not null default 1 check (max_picks > 0),
  picked_skus   text[] not null default '{}',     -- the client's choice (draft until finalised)
  google_uid    text,                              -- Google account that claimed this link (first sign-in binds it)
  google_email  text,
  google_name   text,
  status        text not null default 'open' check (status in ('open', 'finalised', 'closed')),
  finalised_at  timestamptz,
  last_viewed_at timestamptz,
  view_count    integer not null default 0,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists stone_selections_tenant_idx on public.stone_selections (tenant_id, created_at desc);

alter table public.stone_selections enable row level security;
