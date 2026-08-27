-- Adds an ip column to trusted_devices so the Team-screen device list can
-- show where a trusted device was verified from, not just its User-Agent
-- label. device_verifications already logs ip per verification event; this
-- lets the CURRENT trust row show it too.
alter table public.trusted_devices add column if not exists ip text;
