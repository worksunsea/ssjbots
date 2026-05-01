-- Phase E: Telecaller flow + post-outcome funnel routing.
-- See plan: /Users/sg/.claude/plans/why-not-take-the-elegant-ladybug.md
--
-- Adds:
--   • next_on_lost / next_on_not_interested on funnels (mirror existing next_on_convert).
--   • assigned_staff_id, outcome, call_attempts, next_call_at on bullion_demands.
--   • bullion_call_logs    — every call attempt (telecaller, disposition, notes).
--   • bullion_telecaller_rotation — round-robin pointer per tenant.
--   • Seed cadence offsets, disposition list, scripts, objections via bullion_dropdowns.

-- ── 1. Funnel outcome routing ────────────────────────────────────────────────
ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS next_on_lost text,            -- e.g. 'cold_revive' funnel id
  ADD COLUMN IF NOT EXISTS next_on_not_interested text;  -- e.g. 'hot_followup' funnel id

-- ── 2. Demand-level call/assignment fields ───────────────────────────────────
ALTER TABLE public.bullion_demands
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome text,                  -- converted | lost | not_interested
  ADD COLUMN IF NOT EXISTS call_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_call_at timestamptz;

CREATE INDEX IF NOT EXISTS bullion_demands_assigned_idx ON public.bullion_demands (tenant_id, assigned_staff_id);
CREATE INDEX IF NOT EXISTS bullion_demands_next_call_idx ON public.bullion_demands (tenant_id, next_call_at) WHERE next_call_at IS NOT NULL;

-- ── 3. Call logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bullion_call_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  demand_id    uuid NOT NULL REFERENCES public.bullion_demands(id) ON DELETE CASCADE,
  lead_id      uuid NOT NULL REFERENCES public.bullion_leads(id) ON DELETE CASCADE,
  staff_id     uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  attempt_no   int NOT NULL,
  called_at    timestamptz NOT NULL DEFAULT now(),
  duration_sec int,
  disposition  text NOT NULL,                 -- answered_interested | answered_not_now | answered_not_interested
                                              -- no_answer | busy | voicemail_left | callback_requested
                                              -- wrong_number | dnc
  notes        text,
  next_callback_at timestamptz
);
CREATE INDEX IF NOT EXISTS bullion_call_logs_demand_idx ON public.bullion_call_logs (demand_id, called_at DESC);
CREATE INDEX IF NOT EXISTS bullion_call_logs_staff_idx  ON public.bullion_call_logs (staff_id, called_at DESC);
ALTER TABLE public.bullion_call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_call_logs ON public.bullion_call_logs;
CREATE POLICY anon_all_call_logs ON public.bullion_call_logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── 4. Round-robin pointer ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bullion_telecaller_rotation (
  tenant_id     uuid PRIMARY KEY,
  last_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bullion_telecaller_rotation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_rotation ON public.bullion_telecaller_rotation;
CREATE POLICY anon_all_rotation ON public.bullion_telecaller_rotation FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── 5. Seed cadence + dispositions + scripts + objections via bullion_dropdowns
-- Cadence offsets (in minutes from enquiry creation). Index = attempt# - 1.
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','5',          1),  -- attempt 1: +5 min
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','120',        2),  -- attempt 2: +2 h
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','1320',       3),  -- attempt 3: next day 10:30 (~22h)
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','3960',       4),  -- attempt 4: day 3 evening
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','6480',       5),  -- attempt 5: day 5 mid-day
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_cadence_minutes','9720',       6)   -- attempt 6: day 7 evening
ON CONFLICT DO NOTHING;

-- Dispositions
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_interested',     10),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_not_now',        20),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','answered_not_interested', 30),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','no_answer',               40),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','busy',                    50),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','voicemail_left',          60),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','callback_requested',      70),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','wrong_number',            80),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_disposition','dnc',                     90)
ON CONFLICT DO NOTHING;

-- Scripts (one row per script slot — S1 first contact, S2 follow-up, S3 final)
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s1',
   'Namaste {name} ji, main {staff_name} bol rahi hoon Sun Sea Jewellers, Karol Bagh se. Aapne abhi humari WhatsApp pe {product_category} ke liye enquiry ki thi — bas confirm karne ke liye call kiya hai. Kya aap thoda bata sakte hain — kis occasion ke liye dekh rahe hain, aur kab tak chahiye? … Theek hai, main aapko WhatsApp pe options bhej deti hoon. Ek baar showroom visit ka time tay kar lein? Hum aapko personally dikha sakte hain.',
   1),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s2',
   'Namaste {name} ji, main {staff_name} from Sun Sea Jewellers. Pehle bhi try kiya tha aapko — aapne {product_category} ke baare mein pucha tha. Bas ek minute lagega — kya abhi baat kar sakte hain ya kuch der baad call karoon?',
   1),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_script_s3',
   'Namaste {name} ji, {staff_name} from Sun Sea Jewellers — yeh meri last call hai. Agar aap interested hain to bas yes bol dein, main detail bhej doongi. Warna koi baat nahin, hum aapko WhatsApp pe occasionally update bhejte rahenge — convenient ho to wapas connect ho jaayenge.',
   1)
ON CONFLICT DO NOTHING;

-- Objection responses (Q | A separated by " ||| ")
INSERT INTO public.bullion_dropdowns (tenant_id, field, value, sort_order) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Abhi busy hoon ||| Bilkul, sirf 30 second. Kya 6 baje free honge? Tab call karoon?', 10),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Rate WhatsApp pe bhejo ||| Bilkul, abhi bhej rahi hoon. Visit ke saath aap design aur weight personally check kar sakte hain — kab tak aana convenient hoga?', 20),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Sirf dekh rahe hain ||| Koi pressure nahin, samajh sakti hoon. Kya aap kisi specific design ya budget ke baare mein soch rahe hain? Hum WhatsApp pe options share kar sakte hain — koi obligation nahin.', 30),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Mahanga lagta hai ||| Samajh aaya. Hum customisation aur exchange options bhi dete hain — purana gold dene se kaafi adjustment ho jaata hai. Kya appointment fix karein discuss karne ke liye?', 40),
  ('a1b2c3d4-0000-0000-0000-000000000001','telecaller_objection','Sochenge / consult karenge ||| Bilkul. Main aapko WhatsApp pe details + pricing bhej deti hoon — family ke saath dekh sakte hain. 2-3 din baad ek follow-up karoon?', 50)
ON CONFLICT DO NOTHING;
