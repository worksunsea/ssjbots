-- kitty_message_queue previously only ever got a row when a send FAILED
-- (queue-on-failure). Staff had no way to see who actually got a
-- successfully-sent Kitty WhatsApp (rate-booked notice, unpaid reminder,
-- etc) — only the failures were visible. Now every send attempt is logged,
-- success or failure, so the message log screen has the full picture.
-- client_used records which WhatsApp session actually delivered it (kitty
-- number, or the Clientmessage fallback number if the kitty number failed).

alter table public.kitty_message_queue add column if not exists client_used text;
