-- Corporate Gifting FAQs — lets the pure-FAQ WA bot answer/pitch corporate
-- coin gifting when a client asks a loosely-related question (pricing,
-- MOQ, turnaround, logo branding) that isn't an exact keyword hit in the
-- webhook.js deterministic branch (see migration 0109). Always points to
-- the live /corporategiftingcoins catalogue for products + today's price
-- instead of a static number, since gold/silver rates move daily.

insert into public.bullion_faqs (tenant_id, keywords, answer, sort_order) values

('a1b2c3d4-0000-0000-0000-000000000001',
 'corporate gift, corporate gifting, client gifting, employee gifting, bulk gift, gift for clients, gift for employees, customer gifting, diwali gifting, festival gifting, business gift, gifting for business',
 'Yes! Sun Sea Jewellers offers bulk corporate gold & silver coin gifting — MMTC gold/silver coins, bars, and shagun coins, custom-branded with your company logo, for gifting to clients or employees. Browse the live catalogue with today''s pricing and place your enquiry here: https://ssjbot.gemtre.in/corporategiftingcoins',
 510),

('a1b2c3d4-0000-0000-0000-000000000001',
 'corporate gifting price, corporate gift price, bulk gift price, gifting coin price, how much corporate gift, corporate gifting cost, gifting coin rate',
 'Corporate gifting coin prices move with the daily gold/silver rate, same as our regular coins. See live, up-to-date pricing across all categories (gold bars, gold coins, silver bars, silver coins, shagun coins) here: https://ssjbot.gemtre.in/corporategiftingcoins',
 520),

('a1b2c3d4-0000-0000-0000-000000000001',
 'corporate gifting moq, minimum order corporate gift, minimum quantity gifting, bulk order minimum, how many pieces minimum',
 'No fixed minimum — order any quantity for corporate/bulk gifting. Browse products and add what you need on our live catalogue: https://ssjbot.gemtre.in/corporategiftingcoins',
 530),

('a1b2c3d4-0000-0000-0000-000000000001',
 'logo on coin, custom logo, branded coin, company logo gift, logo branding, put our logo, custom branding coin, logo design',
 'Yes — we custom-brand corporate gifting coins with your company logo, free of charge. Upload your logo and generate design mockups directly on our corporate gifting page: https://ssjbot.gemtre.in/corporategiftingcoins',
 540),

('a1b2c3d4-0000-0000-0000-000000000001',
 'corporate gifting delivery time, how long corporate gift, turnaround time, gifting order time, when will it arrive corporate, corporate gift delivery',
 'Corporate/bulk gifting orders (including custom logo branding) typically take 2–3 weeks from order confirmation to delivery. Place your enquiry here and our team will confirm exact timelines: https://ssjbot.gemtre.in/corporategiftingcoins',
 550),

('a1b2c3d4-0000-0000-0000-000000000001',
 'increase my sales, increase sales, boost sales, boost my sales, grow my business, grow my store, grow my shop, increase business, increase footfall, clothing store, retail store sales, how to grow business',
 'One proven way businesses build client & employee loyalty (and repeat business) is corporate gold/silver coin gifting — custom-branded with your logo. See live pricing and products here: https://ssjbot.gemtre.in/corporategiftingcoins',
 560);
