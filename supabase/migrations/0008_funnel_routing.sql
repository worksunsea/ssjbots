-- Smart funnel routing + cross-funnel contact continuity.
--
-- Rationale: multiple ad campaigns often share a single WhatsApp number.
-- We route based on keywords in the user's first message (set as the
-- prefilled text in each ad's WhatsApp button). If the same phone enters
-- via a different funnel later, we update the lead's current funnel and
-- append the old one to funnel_history — NO duplicate lead rows.

-- ── funnels: add match_keywords column
alter table public.funnels
  add column if not exists match_keywords text;

update public.funnels set match_keywords = 'gold, gold coin, akshaya gold, AKT-GOLD, sona, ginni, bullion, biscuit, bar'
  where id = 'f1' and match_keywords is null;
update public.funnels set match_keywords = 'silver, silver coin, chandi, akshaya silver, AKT-SILVER'
  where id = 'f2' and match_keywords is null;
update public.funnels set match_keywords = 'test, akshaya test, AKT-TEST'
  where id = 'f3' and match_keywords is null;

-- ── bullion_leads: funnel_history + single-row-per-phone constraint
alter table public.bullion_leads
  add column if not exists funnel_history jsonb default '[]'::jsonb;

-- Drop the old (phone, funnel_id) unique and replace with just (phone) per tenant.
-- The old constraint was auto-named by the unique() inline syntax; find + drop.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.bullion_leads'::regclass
    and contype = 'u'
    and array_length(conkey, 1) = 3;  -- old constraint covered 3 columns
  if cname is not null then
    execute format('alter table public.bullion_leads drop constraint %I', cname);
  end if;
end $$;

-- Add new unique on (tenant_id, phone)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bullion_leads'::regclass
      and conname = 'bullion_leads_tenant_phone_key'
  ) then
    alter table public.bullion_leads
      add constraint bullion_leads_tenant_phone_key unique (tenant_id, phone);
  end if;
end $$;

-- ── Replace upsert RPC to handle cross-funnel switches
create or replace function public.bullion_upsert_lead(
  p_tenant_id uuid,
  p_phone     text,
  p_name      text,
  p_funnel_id text,
  p_body      text
)
returns public.bullion_leads
language plpgsql
security definer
as $$
declare
  v_row  public.bullion_leads;
  v_existing public.bullion_leads;
begin
  -- Try to read the existing row (by phone, ignoring funnel)
  select * into v_existing
  from public.bullion_leads
  where tenant_id = p_tenant_id and phone = p_phone
  limit 1;

  if v_existing.id is null then
    -- New contact
    insert into public.bullion_leads (tenant_id, phone, funnel_id, name, last_msg, last_msg_at)
    values (p_tenant_id, p_phone, p_funnel_id, coalesce(p_name, ''), p_body, now())
    returning * into v_row;
  else
    -- Existing contact. If the requested funnel differs, push the old one
    -- into funnel_history and switch current funnel_id.
    if v_existing.funnel_id is distinct from p_funnel_id and p_funnel_id is not null then
      update public.bullion_leads set
        funnel_history = coalesce(funnel_history, '[]'::jsonb) ||
          jsonb_build_object(
            'from_funnel_id', v_existing.funnel_id,
            'entered_at',     v_existing.created_at,
            'exited_at',      now()
          ),
        funnel_id    = p_funnel_id,
        name         = coalesce(nullif(p_name, ''), v_existing.name),
        last_msg     = p_body,
        last_msg_at  = now(),
        updated_at   = now(),
        -- A re-entry resets the active-conversation counters so escalation
        -- logic doesn't immediately trigger on the fresh funnel.
        exchanges_count = 0,
        stage        = 'greeting',
        status       = 'active',
        bot_paused   = false
      where id = v_existing.id
      returning * into v_row;
    else
      -- Same funnel, just an inbound touch
      update public.bullion_leads set
        name        = coalesce(nullif(p_name, ''), v_existing.name),
        last_msg    = p_body,
        last_msg_at = now(),
        updated_at  = now()
      where id = v_existing.id
      returning * into v_row;
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.bullion_upsert_lead(uuid, text, text, text, text) to anon, authenticated, service_role;
