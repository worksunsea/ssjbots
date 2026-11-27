-- Natural (mined) certified solitaires listed on ssj.in/natural-diamonds, synced from the
-- Narola stock sheet in the same Drive folder as the CVD sheets (api/cvd-sync.js).
-- They share cvd_stones: stone_type separates them from lab-grown, SKU = NAR-<IGI report no>.
-- Selling price = Rapaport (backend diamond calc) x (1 - (supplier disc - markup)/100) x live USD/INR.
-- The markup (default 9 points) lives in bullion_dropdowns field 'cvd_natural_markup_disc'.
--
-- SECURITY: rap_usd / supplier_disc_pct / sell_disc_pct / purchase_* are PRIVATE; the public
-- endpoint api/cvd-stones.js only returns its PUBLIC_COLUMNS whitelist.

alter table public.cvd_stones
  add column if not exists stone_type        text not null default 'labgrown' check (stone_type in ('labgrown', 'natural')),
  add column if not exists rap_usd           numeric(12,2),   -- PRIVATE: supplier sheet Rap $/ct
  add column if not exists supplier_disc_pct numeric(6,2),    -- PRIVATE: discount we get off Rap
  add column if not exists sell_disc_pct     numeric(6,2);    -- PRIVATE: discount we sell at (supplier - markup)

create index if not exists cvd_stones_type_idx on public.cvd_stones (tenant_id, stone_type, status);
