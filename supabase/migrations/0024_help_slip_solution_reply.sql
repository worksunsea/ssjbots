-- Help slip: mandatory "what have you tried / what do you propose" field +
-- inline admin reply + raiser-seen flag for next-login popup.

ALTER TABLE public.help_slips
  ADD COLUMN IF NOT EXISTS solution_proposed text,
  ADD COLUMN IF NOT EXISTS reply text,
  ADD COLUMN IF NOT EXISTS reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_by text,
  ADD COLUMN IF NOT EXISTS raiser_seen_reply boolean NOT NULL DEFAULT true;
