-- Upsert a lead (insert if new, update if exists) and return the fresh row.
-- Used by n8n on every inbound WhatsApp message so the workflow stays single-call.

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
  v_row public.bullion_leads;
begin
  insert into public.bullion_leads (tenant_id, phone, funnel_id, name, last_msg, last_msg_at)
  values (p_tenant_id, p_phone, p_funnel_id, coalesce(p_name, ''), p_body, now())
  on conflict (tenant_id, phone, funnel_id) do update set
    name        = coalesce(nullif(excluded.name, ''), public.bullion_leads.name),
    last_msg    = excluded.last_msg,
    last_msg_at = excluded.last_msg_at,
    updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.bullion_upsert_lead(uuid, text, text, text, text) to anon, authenticated, service_role;
