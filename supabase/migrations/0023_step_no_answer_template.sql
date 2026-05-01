-- Per-step "tried to call" WhatsApp fallback template.
-- Used when a telecaller logs a no-answer / busy / voicemail disposition and
-- wants to send a quick WA nudge ("Hi, tried calling about your enquiry…").
-- Stored on the step so each call step can carry its own copy. AI/render
-- substitutes {{name}}, {{phone}}, {{staff_name}} like normal templates.

ALTER TABLE public.bullion_funnel_steps
  ADD COLUMN IF NOT EXISTS no_answer_template text;
