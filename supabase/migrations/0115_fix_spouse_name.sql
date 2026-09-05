-- spouse_name was missing from the schema — referenced everywhere in code but
-- never added. ~11k rows silently failed during the first import.

alter table public.bullion_leads add column if not exists spouse_name text;
