-- FAQ bot page + separate column for WhatsApp display name.
-- Reason: Baileys' `pushName` is whatever the user has set on their WhatsApp
-- profile — it's a hint, not a confirmed name. Store it separately so the
-- bot still asks for the name properly during onboarding.

alter table public.bullion_leads
  add column if not exists wa_display_name text;

-- ── FAQs: editable Q&A pairs the bot consults to answer common questions.
-- keywords: comma/space separated words or phrases the bot matches against.
-- answer: the exact text to incorporate in the reply.

create table if not exists public.bullion_faqs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  keywords    text not null,                       -- "showroom address, location, where, shop, google pin, maps"
  answer      text not null,                       -- "Sun Sea Jewellers, 12/5 ..."
  active      boolean default true,
  sort_order  int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists bullion_faqs_tenant_idx on public.bullion_faqs (tenant_id, active);

drop trigger if exists bullion_faqs_touch on public.bullion_faqs;
create trigger bullion_faqs_touch before update on public.bullion_faqs
  for each row execute function public.touch_updated_at();

alter table public.bullion_faqs enable row level security;
drop policy if exists anon_all_bullion_faqs on public.bullion_faqs;
create policy anon_all_bullion_faqs on public.bullion_faqs for all to anon using (true) with check (true);

-- ── Seed placeholder FAQs — edit the `answer` column in the CRM FAQs tab.
insert into public.bullion_faqs (tenant_id, keywords, answer, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'showroom address, location, where, shop, visit, kahan, pata, google pin, maps',
   '[PLACEHOLDER — edit in CRM] Sun Sea Jewellers, Karol Bagh, New Delhi. Google Maps: (paste link here).', 10),
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'timings, hours, open, close, kab khulta, kab band',
   '[PLACEHOLDER — edit in CRM] We are open 11 AM to 7 PM, all days.', 20),
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'payment, bank, account number, upi, cash, neft, how to pay',
   '[PLACEHOLDER — edit in CRM] Payment modes accepted at showroom: UPI / NEFT / Cash. For bank transfer, ask at showroom — we share details only in person for safety.', 30),
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'buyback, old gold, exchange, sell, bechna',
   '[PLACEHOLDER — edit in CRM] Yes, we do old-gold buyback at best market rate. Please bring your item to the showroom for assessment.', 40),
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'purity, hallmark, bis, 995, 9999, real',
   '[PLACEHOLDER — edit in CRM] All our MMTC coins are 99.99% (9999) pure. Our own Sun Sea coins are 99.5% (995). Both are BIS hallmarked.', 50),
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'parking, car, gaadi, park',
   '[PLACEHOLDER — edit in CRM] Parking is available near the showroom. Please call ahead if you''d like us to arrange assistance.', 60);
