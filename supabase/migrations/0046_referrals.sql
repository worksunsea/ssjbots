-- bullion_referrals: track customer referrals for the 50mg gold gift program.
-- Each referral = one friend's phone that a client has referred.
-- Gift redeemable 6 months after friend starts using the Sun Sea Jewellers app.

CREATE TABLE public.bullion_referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  referrer_lead_id uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  referred_phone   text NOT NULL,
  referred_lead_id uuid REFERENCES public.bullion_leads(id),
  status           text DEFAULT 'pending',
    -- pending | wa_sent | registered | redeemable | redeemed
  wa_sent_at       timestamptz,
  registered_at    timestamptz,  -- when friend downloads & registers on app
  redeemable_at    timestamptz,  -- registered_at + 6 months
  redeemed_at      timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX bullion_referrals_referrer_idx ON public.bullion_referrals (referrer_lead_id);
CREATE INDEX bullion_referrals_phone_idx    ON public.bullion_referrals (referred_phone);
CREATE UNIQUE INDEX bullion_referrals_unique_idx ON public.bullion_referrals (referrer_lead_id, referred_phone);

ALTER TABLE public.bullion_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_tenant ON public.bullion_referrals FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());
