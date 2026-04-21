-- Do-Not-Disturb flag + one FAQ template so the bot handles angry/reporting
-- users with one polite apology message and then goes silent on that number.

alter table public.bullion_leads
  add column if not exists dnd boolean default false,
  add column if not exists dnd_reason text,
  add column if not exists dnd_at timestamptz;

-- DND FAQ — the bot uses this verbatim as its apology, then the webhook
-- sets lead.dnd=true, pauses the bot, and cancels pending drip messages.
insert into public.bullion_faqs (tenant_id, keywords, answer, sort_order)
values (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'do not disturb, dont disturb, don''t disturb, stop messaging, remove me, unsubscribe, i will report, complain, spam, block me, harassment, angry, disturb me, dnd',
  'Sir/Ma''am {{name}}, we are truly sorry if our messages caused any inconvenience. Please help us understand what went wrong from our side so we can improve — your feedback is very important to us. I am removing your number from all further communications right away. Warm regards from Sun Sea Jewellers.',
  5
);
