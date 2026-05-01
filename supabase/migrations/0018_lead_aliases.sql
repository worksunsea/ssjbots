-- Map a WhatsApp LID JID (or any alternate phone-ish identifier) to the
-- canonical bullion_leads row, so inbound messages from a LID-only sender
-- attach to the real client record after the user has linked them.
--
-- Lookup flow on inbound webhook:
--   1. Compute phone (real digits if Baileys exposed sender_pn, else LID JID).
--   2. If alias row exists for that phone → route all writes to alias.lead_id.
--   3. Else upsert lead by phone as before.

CREATE TABLE IF NOT EXISTS public.bullion_lead_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  alias_phone  text NOT NULL,           -- e.g. "258802028912814@lid"
  lead_id      uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  UNIQUE (tenant_id, alias_phone)
);

CREATE INDEX IF NOT EXISTS bullion_lead_aliases_lead_idx
  ON public.bullion_lead_aliases (lead_id);
