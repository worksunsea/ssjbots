-- Foundations for the ssj.in client + associate platform (Phase 0):
--   * bullion_associates       — approved "Sun Sea Brand Associate" referrers
--   * bullion_referral_visits  — ?ref=<code> link taps, pre-conversion
--   * bullion_commissions      — manual commission ledger (no payment gateway yet)
--   * bullion_price_alerts     — client-set buy/sell rate triggers
--   * bullion_otp_codes        — WhatsApp OTP codes for client/associate login
--
-- The Phase 5 AI chatbot reuses the existing bullion_faqs table (created in
-- 0007_faqs_and_wa_display_name.sql, already the WA bot's own FAQ knowledge
-- base — keywords/answer/active/sort_order) instead of a new table.

CREATE TABLE public.bullion_associates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  lead_id        uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  phone          text NOT NULL,
  display_name   text NOT NULL,
  headline       text DEFAULT 'Sun Sea Brand Associate',
  status         text NOT NULL DEFAULT 'applicant',
    -- applicant | pending_approval | active | paused
  referral_code  text UNIQUE NOT NULL,
  approved_by    text,
  approved_at    timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX bullion_associates_lead_idx   ON public.bullion_associates (lead_id);
CREATE INDEX bullion_associates_phone_idx  ON public.bullion_associates (phone);
CREATE UNIQUE INDEX bullion_associates_code_idx ON public.bullion_associates (referral_code);

CREATE TABLE public.bullion_referral_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  associate_id    uuid NOT NULL REFERENCES public.bullion_associates(id) ON DELETE CASCADE,
  visitor_lead_id uuid REFERENCES public.bullion_leads(id),
  landing_path    text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX bullion_referral_visits_associate_idx ON public.bullion_referral_visits (associate_id);

CREATE TABLE public.bullion_commissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  associate_id     uuid NOT NULL REFERENCES public.bullion_associates(id) ON DELETE CASCADE,
  referred_lead_id uuid REFERENCES public.bullion_leads(id),
  order_reference  text,
  amount           numeric,
  status           text NOT NULL DEFAULT 'pending',
    -- pending | approved | paid
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX bullion_commissions_associate_idx ON public.bullion_commissions (associate_id);

CREATE TABLE public.bullion_price_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  lead_id      uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  metal        text NOT NULL,
    -- gold | silver
  direction    text NOT NULL,
    -- buy_below | sell_above
  target_rate  numeric NOT NULL,
  status       text NOT NULL DEFAULT 'active',
    -- active | triggered | cancelled
  triggered_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX bullion_price_alerts_lead_idx   ON public.bullion_price_alerts (lead_id);
CREATE INDEX bullion_price_alerts_active_idx ON public.bullion_price_alerts (status) WHERE status = 'active';

CREATE TABLE public.bullion_otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  purpose      text NOT NULL,
    -- client_login | associate_login
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX bullion_otp_codes_phone_idx ON public.bullion_otp_codes (phone, purpose);

ALTER TABLE public.bullion_associates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_referral_visits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_commissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bullion_price_alerts     ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_tenant ON public.bullion_associates FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_referral_visits FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_commissions FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

CREATE POLICY anon_tenant ON public.bullion_price_alerts FOR ALL TO anon
  USING (tenant_id = public.ssj_tenant_id())
  WITH CHECK (tenant_id = public.ssj_tenant_id());

-- bullion_otp_codes has no tenant_id (phone-keyed, short-lived, service-role only) — no anon policy, RLS stays default-deny.
ALTER TABLE public.bullion_otp_codes ENABLE ROW LEVEL SECURITY;
