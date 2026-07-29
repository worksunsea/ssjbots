-- Associate recruitment nurture funnel — enrolled when someone submits the
-- public "Become a Sun Sea Associate" interest form on ssj.in
-- (source: "associate_recruitment"). Seeded INACTIVE — draft message copy
-- below, holding for the user's review/approval before it goes live (per
-- "batch approvals for the morning" instruction, 2026-07-30). Staff can
-- flip `active` to true once copy is confirmed; no code change needed.

insert into funnels (id, tenant_id, name, description, kind, active, goal, product_focus, wa_number, wbiztool_client)
values (
  'associate_recruitment',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Associate Recruitment',
  'Nurture sequence for people who apply to become a Sun Sea Brand Associate via the ssj.in interest form, until staff approve them.',
  'acquisition',
  false,
  'Get the applicant to a staff approval call/visit',
  'associate_program',
  '8860866000',
  '7560'
)
on conflict (id) do nothing;

insert into bullion_funnel_steps (tenant_id, funnel_id, step_order, name, delay_minutes, trigger_type, message_template, active) values
  ('a1b2c3d4-0000-0000-0000-000000000001', 'associate_recruitment', 1, 'Welcome', 5, 'after_enrollment',
   'Hi {{name}}, thank you for your interest in becoming a Sun Sea Brand Associate! We''ll reach out shortly to walk you through how it works. In the meantime, feel free to ask us anything here. - Sun Sea Jewellers', true),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'associate_recruitment', 2, 'Follow-up', 2880, 'after_prev_step',
   'Hi {{name}}, just checking in — would you like to schedule a quick call to discuss the Sun Sea Brand Associate program? - Sun Sea Jewellers', true),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'associate_recruitment', 3, 'Final nudge', 7200, 'after_prev_step',
   'Hi {{name}}, we''d still love to have you as a Sun Sea Brand Associate. Reply here anytime and our team will set things up for you. - Sun Sea Jewellers', true)
on conflict do nothing;
