-- Birthday and anniversary funnel steps were missing use_ai_message = true.
-- cron.js step-5 preview loop skips rows where use_ai_message is false/null,
-- so edited_body was never filled in and messages never appeared in Approvals
-- with AI-generated text.

UPDATE public.bullion_funnel_steps
SET use_ai_message = true
WHERE funnel_id IN ('birthday', 'anniversary')
  AND active = true;
