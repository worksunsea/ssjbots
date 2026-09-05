-- Swarn Suraksha — online gold-savings scheme. Clients pay via Razorpay
-- (one-time top-ups anytime, or a fixed-amount monthly auto-debit
-- subscription on a chosen date) and buy gold at that day's prevailing
-- rate, capped at 10g/client/day. RBI digital-gold-scheme guidance caps an
-- online-sold scheme at 11 months — after that the enrollment freezes
-- (same "completed" + claim_status flow as every other kitty scheme) and
-- any further payment auto-opens a new enrollment cycle. Redemption is
-- in-store only, same as the rest of the kitty module — no online
-- redemption flow exists or is planned here.

alter table public.kitty_enrollments
  add column razorpay_customer_id     text,
  add column razorpay_subscription_id text,
  add column cycle_number             int not null default 1,
  add column frozen_at                timestamptz,
  add column previous_enrollment_id   uuid references public.kitty_enrollments(id);

alter table public.kitty_installments
  add column grams_purchased    numeric,
  add column source             text not null default 'staff', -- staff | topup | subscription
  add column razorpay_payment_id text,
  add column razorpay_order_id   text;

-- Idempotency for Razorpay webhook retries — a payment/subscription-charge
-- event can legitimately arrive more than once; this stops it being applied twice.
create unique index kitty_installments_razorpay_payment_idx
  on public.kitty_installments (razorpay_payment_id) where razorpay_payment_id is not null;
create index kitty_installments_razorpay_order_idx
  on public.kitty_installments (razorpay_order_id) where razorpay_order_id is not null;
create index kitty_enrollments_razorpay_sub_idx
  on public.kitty_enrollments (razorpay_subscription_id) where razorpay_subscription_id is not null;

insert into public.kitty_schemes (tenant_id, name, slug, monthly_amount, duration_months, perks, description, sort_order) values
  ('a1b2c3d4-0000-0000-0000-000000000001'::uuid, 'Swarn Suraksha', 'swarn-suraksha', null, 11,
   '{"unit": "grams", "online_purchase": true, "daily_gram_cap_g": 10, "max_duration_months": 11, "redemption": "in_store_only", "auto_subscribe": true}'::jsonb,
   'Pay online anytime via Razorpay and buy gold at that day''s rate — up to 10g/day. Optional monthly auto-debit on a date you pick, plus top-ups whenever you like. Runs 11 months per RBI guidance, then freezes; redeem in-store only.', 6)
on conflict (tenant_id, slug) do nothing;
