-- Fix birthday + anniversary funnel step offsets.
--
-- Root cause: steps were using after_enrollment/after_prev_step so
-- they fired relative to enrollment time, not the actual event date.
-- post-bday arrived BEFORE event; week-nudge arrived AFTER event.
--
-- Fix: all steps → calendar_event with correct signed minute offsets.
-- Negative = before event, positive = after event.
--
-- Birthday sequence:
--   -28800 min (-20d)  Month-start warm        (start of birthday month)
--   -10080 min (-7d)   Birthday-week nudge     (1 week before)
--        0             bday wish               (day of birthday)
--    +4320 min (+3d)   post bday               (3 days after)
--
-- Anniversary sequence:
--   -28800 min (-20d)  Month-start nudge       (start of anniversary month)
--        0             Anniversary wish        (day of anniversary)
--    +4320 min (+3d)   followup                (3 days after)

do $$
declare
  tid uuid;
begin
  foreach tid in array array[
    'a1b2c3d4-0000-0000-0000-000000000001'::uuid,
    'a1b2c3d4-0000-0000-0000-000000000002'::uuid
  ] loop

    -- ── Birthday steps ─────────────────────────────────────────────────────
    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = -28800
      where tenant_id = tid and funnel_id = 'birthday'
        and lower(name) like '%month%start%';

    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = -10080
      where tenant_id = tid and funnel_id = 'birthday'
        and lower(name) like '%week%nudge%';

    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = 0
      where tenant_id = tid and funnel_id = 'birthday'
        and lower(name) like '%bday%wish%';

    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = 4320
      where tenant_id = tid and funnel_id = 'birthday'
        and lower(name) like '%post%bday%';

    -- ── Anniversary steps ──────────────────────────────────────────────────
    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = -28800
      where tenant_id = tid and funnel_id = 'anniversary'
        and lower(name) like '%month%start%';

    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = 0
      where tenant_id = tid and funnel_id = 'anniversary'
        and lower(name) like '%anniversary%wish%';

    update public.bullion_funnel_steps
      set trigger_type = 'calendar_event', delay_minutes = 4320
      where tenant_id = tid and funnel_id = 'anniversary'
        and lower(name) like '%followup%';

  end loop;
end $$;

-- ── Cancel all pending birthday/anniversary scheduled messages ────────────
-- Wrong offsets → wrong dates. Cron will re-enroll using correct offsets.
-- Sent messages are left as-is (history).
update public.bullion_scheduled_messages
set status = 'canceled', canceled_reason = 'step_offset_fix_0035'
where status = 'pending'
  and funnel_id in ('birthday', 'anniversary');
