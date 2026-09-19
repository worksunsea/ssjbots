-- Birthday/anniversary AI messages always ended with the same fixed
-- signature. Staff want the closing line (and the salutation used before
-- the customer's name) to vary by tag combination — e.g. contacts tagged
-- both "sanjeev_sir" and "rotary" get one footer, "saurav_sir" + "rotary"
-- get another, either tag alone gets a third/fourth. Made fully
-- staff-configurable (add/edit/remove combos + wording from the UI)
-- instead of hardcoding names in code, since the combos are expected to
-- grow over time.

create table if not exists public.bday_footer_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- ALL of these tags must be present on the contact for this rule to match.
  tags text[] not null,
  -- Optional — placed before the customer's first name in the message
  -- (e.g. "Shri", "Dr."). Null = no special salutation, use name as-is.
  salutation text,
  -- Exact closing line(s) the AI is told to end the message with.
  footer_text text not null,
  -- When a contact's tags match more than one rule, the rule with the
  -- highest priority wins; ties broken by whichever rule requires more
  -- tags (more specific match wins).
  priority int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists bday_footer_rules_tenant_active_idx
  on public.bday_footer_rules (tenant_id, active);

alter table public.bday_footer_rules enable row level security;
drop policy if exists anon_all_bday_footer_rules on public.bday_footer_rules;
create policy anon_all_bday_footer_rules on public.bday_footer_rules for all to anon using (true) with check (true);
