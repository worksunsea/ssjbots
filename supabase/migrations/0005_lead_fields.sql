-- Extend bullion_leads with capture fields for marketing / retention.
--   city        → asked early in every conversation
--   email       → captured on conversion
--   bday        → stored as text "MM-DD" or "YYYY-MM-DD"; used for bday-month offers
--   anniversary → same format; used for anniversary gifting offers
--   last_purchase_at → set by agent in CRM when a sale closes

alter table public.bullion_leads add column if not exists city text;
alter table public.bullion_leads add column if not exists email text;
alter table public.bullion_leads add column if not exists bday text;
alter table public.bullion_leads add column if not exists anniversary text;
alter table public.bullion_leads add column if not exists last_purchase_at timestamptz;
