-- Staff-editable overrides for Kitty WhatsApp message templates. One row
-- per context_type (see api/_lib/kittyTemplates.js registry for the full
-- set + built-in defaults). No row for a type = default text is used;
-- active=false = temporarily revert to default without losing the edit.
create table if not exists public.kitty_message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  context_type text not null,
  template text not null,
  active boolean not null default true,
  updated_by text,
  updated_at timestamptz default now(),
  unique (tenant_id, context_type)
);

alter table public.kitty_message_templates enable row level security;
drop policy if exists anon_all_kitty_message_templates on public.kitty_message_templates;
create policy anon_all_kitty_message_templates on public.kitty_message_templates for all to anon using (true) with check (true);
