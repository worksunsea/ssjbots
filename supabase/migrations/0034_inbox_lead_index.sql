-- Partial unique index: one "inbox" (funnel-less) lead per phone per tenant.
-- Inbox leads are created by the bot for unassigned inbound conversations.
-- When a telecaller assigns a funnel, a separate lead row is created for that funnel.
create unique index if not exists bullion_leads_inbox_unique
  on public.bullion_leads(tenant_id, phone)
  where funnel_id is null;
