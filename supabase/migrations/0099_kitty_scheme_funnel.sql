-- Attach an optional WA drip funnel to each kitty scheme (reuses the
-- existing funnels/bullion_funnel_steps drip system — no new messaging
-- infra). When a lead enrolls in (or is legacy-added to) a scheme that has
-- a funnel_id set, api/kitty-enroll.js and api/kitty.js call the existing
-- enrollLeadInDrip() helper so the member starts receiving that funnel's
-- message sequence right away.

alter table public.kitty_schemes add column funnel_id text references public.funnels(id);
