-- Which WhatsApp session/number a message was sent/received on. The
-- business now runs 6 sessions (Reception, priyankacrm, accounts, diamond,
-- gold, production) but bullion_messages never recorded which one handled
-- a given conversation — the Messages screen had no way to show it.
ALTER TABLE public.bullion_messages
  ADD COLUMN wa_client text;
CREATE INDEX bullion_messages_wa_client_idx ON public.bullion_messages (tenant_id, wa_client);
