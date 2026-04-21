-- Full funnel ecosystem: acquisition (entry points) + lifecycle (auto-transitions)
-- + calendar (bday/anniversary) funnels. Every funnel knows where a lead should
-- go next — on conversion (→ after-sales) or on drip exhaustion (→ follow-up).

-- ── 1. Schema
alter table public.funnels
  add column if not exists kind text default 'acquisition',   -- acquisition | hot_followup | nurture | cold_revive | after_sales | birthday | anniversary | test
  add column if not exists next_on_convert text,              -- funnel to enroll into when a lead converts
  add column if not exists next_on_exhaust text;              -- funnel to enroll into when drip exhausts without conversion

alter table public.bullion_leads
  add column if not exists source text;                       -- "Meta ad", "Google ad", "walk-in", "referral — <name>"

-- Retire old f1 / f2 (gold / silver split) — merge into single 'bullion' funnel.
delete from public.bullion_scheduled_messages where funnel_id in ('f1','f2');
delete from public.bullion_funnel_steps where funnel_id in ('f1','f2');
delete from public.funnels where id in ('f1','f2');

-- Refresh f3 test funnel shape
update public.funnels set kind = 'test' where id = 'f3';
delete from public.bullion_funnel_steps where funnel_id = 'f3';

-- ── 2. Acquisition funnels (entry points from ads/referrals)
insert into public.funnels (id, tenant_id, name, description, wa_number, wbiztool_client, product_focus, persona_id, active, goal, kind, match_keywords, next_on_convert, next_on_exhaust) values
  ('bullion',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Bullion — Gold & Silver Coins / Bars',
   'Primary bullion funnel covering gold and silver coins, bars, biscuits (MMTC 9999 / Sun Sea 995). Most investment-oriented buyers.',
   '8860866000', '7560', 'bullion',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Book showroom visit within 48 hours OR close sale',
   'acquisition',
   'bullion, gold coin, silver coin, gold bar, silver bar, biscuit, mmtc, 9999, ginni, 22kt, 24kt, sona, chandi, AKT-BULLION, AKT-GOLD, AKT-SILVER',
   'after_sales', 'hot_followup'),
  ('wedding',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Wedding Jewellery',
   'Couples planning wedding / bridal jewellery — bridal sets, mangal sutra, necklaces, kamarbandh.',
   '8860866000', '7560', 'wedding',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Showroom visit for bridal consultation',
   'acquisition',
   'wedding, shaadi, bridal, groom, pheras, bride, nikah, mangalsutra, sangeet, AKT-WEDDING',
   'after_sales', 'hot_followup'),
  ('gemstone',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Gemstone Buyer',
   'Buyers of certified natural gemstones — emerald, ruby, sapphire, pearl, coral, etc. Often astrology-driven purchases.',
   '8860866000', '7560', 'gemstone',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Showroom visit for stone viewing',
   'acquisition',
   'gemstone, gem stone, ruby, emerald, sapphire, panna, manik, pukhraj, neelam, moonga, pearl, moti, blue sapphire, yellow sapphire, AKT-GEM',
   'after_sales', 'hot_followup'),
  ('solitaire',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Diamond Solitaires',
   'Premium diamond buyers looking for IGI/GIA certified solitaires, engagement rings, studs.',
   '8860866000', '7560', 'solitaire',
   (select id from public.personas where name = 'Priya — young advisor' limit 1),
   true, 'Showroom consultation with certified pieces',
   'acquisition',
   'solitaire, diamond, diamond ring, engagement ring, heera, IGI, GIA, certified diamond, AKT-SOLITAIRE',
   'after_sales', 'hot_followup'),
  ('lab_diamond',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Lab-grown Diamonds',
   'Budget-conscious or ethics-first buyers interested in CVD / HPHT lab-grown diamonds.',
   '8860866000', '7560', 'lab_diamond',
   (select id from public.personas where name = 'Priya — young advisor' limit 1),
   true, 'Showroom side-by-side demo',
   'acquisition',
   'lab grown, lab-grown, cvd, hpht, lab diamond, synthetic diamond, AKT-LABDIA',
   'after_sales', 'hot_followup'),
  ('gold_plain',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Plain Gold Jewellery',
   'Plain gold chains, bangles, kadas, basic rings — everyday utility buyers.',
   '8860866000', '7560', 'gold_plain',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Showroom visit / direct sale',
   'acquisition',
   'plain gold, chain, bangle, kada, churi, gold chain, gold bangle, AKT-PLAIN',
   'after_sales', 'hot_followup'),
  ('antique',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Antique Jewellery',
   'Kundan, polki, temple, Nizami, Rajasthani traditional designs. High-ticket emotional buyers.',
   '8860866000', '7560', 'antique',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Showroom viewing for craftsmanship',
   'acquisition',
   'antique, kundan, polki, temple jewellery, nakshi, nizami, rajasthani, traditional, AKT-ANTIQUE',
   'after_sales', 'hot_followup'),
  ('silver_jew',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Silver Jewellery',
   'Everyday silver jewellery — chains, bracelets, rings, anklets.',
   '8860866000', '7560', 'silver_jew',
   (select id from public.personas where name = 'Priya — young advisor' limit 1),
   true, 'Showroom visit / direct sale',
   'acquisition',
   'silver jewellery, silver chain, silver bracelet, silver ring, silver anklet, payal, AKT-SILVERJEW',
   'after_sales', 'hot_followup'),
  ('destination',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Destination Wedding Jewellery',
   'Bulk jewellery for destination weddings — guest favours, bridesmaid sets, matching family pieces.',
   '8860866000', '7560', 'destination',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Personal consultation for bulk order',
   'acquisition',
   'destination wedding, destination jewellery, bulk wedding, bridesmaid, guest favour, AKT-DEST',
   'after_sales', 'hot_followup'),
  ('silver_gift',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Silver Gifts',
   'Silver coins, idols, small gifting sets for occasions (Diwali, corporate, weddings).',
   '8860866000', '7560', 'silver_gift',
   (select id from public.personas where name = 'Priya — young advisor' limit 1),
   true, 'Close sale over WhatsApp or showroom',
   'acquisition',
   'silver gift, silver coin gift, silver idol, corporate gift, diwali gift, gifting, small gift, AKT-GIFT',
   'after_sales', 'hot_followup');

-- ── 3. Lifecycle funnels (auto-transitioned — not entry points; keyword match disabled)
insert into public.funnels (id, tenant_id, name, description, wa_number, wbiztool_client, product_focus, persona_id, active, goal, kind, match_keywords, next_on_convert, next_on_exhaust) values
  ('hot_followup',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Hot Follow-up',
   'Leads who engaged but didn''t convert on first touch. 7-day personal follow-up sequence.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Saurav-mode — direct owner voice' limit 1),
   true, 'Re-engage the lead; surface objections; drive to showroom',
   'hot_followup', null, 'after_sales', 'nurture_30d'),
  ('nurture_30d',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Nurturing — 30 day',
   'Warm-reach-outs for leads still quiet after hot follow-up. Soft touches, not salesy.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Stay top of mind; invite without pressure',
   'nurture', null, 'after_sales', 'cold_revive'),
  ('cold_revive',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Cold Revive',
   'Long-silent leads (60+ days). Occasional gentle outreach; high bar before we stop.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Final re-engagement attempts',
   'cold_revive', null, 'after_sales', null),
  ('after_sales',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'After-Sales & Feedback',
   'Post-purchase customer care, feedback, care tips, referral nudges.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Delight the customer; earn referrals and repeat visits',
   'after_sales', null, null, null);

-- ── 4. Calendar funnels (cron enrolls leads whose bday/anniversary is in current month)
insert into public.funnels (id, tenant_id, name, description, wa_number, wbiztool_client, product_focus, persona_id, active, goal, kind, match_keywords, next_on_convert, next_on_exhaust) values
  ('birthday',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Birthday Month Wishes',
   'Automated warm birthday-month outreach. Positions a small gift/offer to nudge visits.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Delight + bring to showroom during bday month',
   'birthday', null, 'after_sales', null),
  ('anniversary',
   'a1b2c3d4-0000-0000-0000-000000000001',
   'Anniversary Month Wishes',
   'Automated anniversary outreach. Primary cross-sell opportunity for partner gifts.',
   '8860866000', '7560', 'all',
   (select id from public.personas where name = 'Rajesh Bhai — 40yr veteran' limit 1),
   true, 'Anniversary-gift sale OR showroom visit',
   'anniversary', null, 'after_sales', null);

-- ── 5. Drip steps — every funnel gets a sensible default sequence.
--     Delays are in minutes (for after_prev_step / after_enrollment / after_last_inbound).
--     "after_last_purchase" uses delay_minutes from bullion_leads.last_purchase_at.

-- Acquisition funnels: 3-step default (3h / 1d / 3d)
insert into public.bullion_funnel_steps (tenant_id, funnel_id, step_order, name, delay_minutes, trigger_type, condition, message_template, active) values
  -- bullion
  ('a1b2c3d4-0000-0000-0000-000000000001','bullion',1,'3h follow-up',180,'after_enrollment','always',
   'Hello Sir/Ma''am {{name}}, you had asked me for the pricing earlier — I was waiting for your confirmation. Is there any concern I can help address? I will try my best to get you the most competitive rate by checking with our seniors.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','bullion',2,'24h nudge',1440,'after_prev_step','always',
   'Sir/Ma''am {{name}}, our rates lock at today''s close. If you can visit Sun Sea Jewellers at Karol Bagh today, I will personally ensure you get the best deal.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','bullion',3,'3d check-in',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any specific weight or purity you had in mind? I can send a couple of curated options — happy to help you decide.',true),

  -- wedding
  ('a1b2c3d4-0000-0000-0000-000000000001','wedding',1,'Same-day warm reply',120,'after_enrollment','always',
   'Congratulations on your upcoming wedding, Sir/Ma''am {{name}}! Would you like bridal sets, mangal sutra, or specific pieces? I will curate our finest options for you.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','wedding',2,'2d invite',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, our bridal collection has been handcrafted over 40+ years. Do visit — we will take you through personalised options. Karol Bagh, 11 AM – 7 PM.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','wedding',3,'7d soft close',7200,'after_prev_step','always',
   'Sir/Ma''am {{name}}, checking in on your wedding plans — any specific budget or style preference? Happy to share a personalised catalogue.',true),

  -- gemstone
  ('a1b2c3d4-0000-0000-0000-000000000001','gemstone',1,'3h follow-up',180,'after_enrollment','always',
   'Sir/Ma''am {{name}}, you had asked about gemstones — our collection includes certified natural gems. Which specific stone and carat are you considering? I will share options.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','gemstone',2,'2d visit invite',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, all our gemstones come with authentic certification. Do visit for a closer inspection — we will arrange a personal viewing for you.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','gemstone',3,'7d alt-options',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, if budget or carat flexibility is a concern, happy to share alternatives within your range. Please let me know.',true),

  -- solitaire
  ('a1b2c3d4-0000-0000-0000-000000000001','solitaire',1,'2h curated offer',120,'after_enrollment','always',
   'Sir/Ma''am {{name}}, you enquired about our solitaires — each piece is IGI/GIA certified. May I know your size preference and budget so I can send 2-3 curated options?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','solitaire',2,'2d private viewing',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, solitaires are best appreciated in person. Please visit us at Karol Bagh — happy to arrange a private viewing at your convenience.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','solitaire',3,'7d season offer',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, our season offers close shortly — would love to help you lock in the right piece. Any questions I can answer?',true),

  -- lab_diamond
  ('a1b2c3d4-0000-0000-0000-000000000001','lab_diamond',1,'2h education',120,'after_enrollment','always',
   'Sir/Ma''am {{name}}, our lab-grown (CVD) diamonds offer the same brilliance as mined at significantly better value. What size / shape are you considering?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','lab_diamond',2,'2d side-by-side',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, do visit — we will show you mined vs lab side-by-side so you can see the quality yourself. Karol Bagh, 11 AM – 7 PM.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','lab_diamond',3,'7d catalogue',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, I can share a PDF catalogue with rates if helpful. Just say the word.',true),

  -- gold_plain
  ('a1b2c3d4-0000-0000-0000-000000000001','gold_plain',1,'3h qualifier',180,'after_enrollment','always',
   'Sir/Ma''am {{name}}, you enquired about our plain gold collection. Which item interests you (chain / bangle / kada) and approx weight preference?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','gold_plain',2,'2d visit',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, we offer BIS hallmarked plain gold with transparent making charges. Visit us at Karol Bagh to see the range.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','gold_plain',3,'7d making-offer',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, our current making-charge offer ends soon. Please let me know if you''d like to visit before that.',true),

  -- antique
  ('a1b2c3d4-0000-0000-0000-000000000001','antique',1,'2h style ask',120,'after_enrollment','always',
   'Sir/Ma''am {{name}}, our antique collection includes kundan, polki, and temple designs. What occasion is it for? I will curate pieces accordingly.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','antique',2,'3d in-person',4320,'after_prev_step','always',
   'Sir/Ma''am {{name}}, antique pieces truly shine in person. Please do visit our Karol Bagh showroom — we will walk you through the collection.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','antique',3,'7d regional preference',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any specific regional style you prefer (South Indian / Rajasthani / Nizami)? I can show you more focused options.',true),

  -- silver_jew
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_jew',1,'3h follow-up',180,'after_enrollment','always',
   'Sir/Ma''am {{name}}, our silver jewellery range is perfect for everyday wear and gifting. What specific items are you considering?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_jew',2,'2d visit',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, do visit us — we have an exclusive silver range you will love. Karol Bagh, 11 AM – 7 PM.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_jew',3,'7d nudge',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any budget range I can work with? Happy to send a few curated picks.',true),

  -- destination
  ('a1b2c3d4-0000-0000-0000-000000000001','destination',1,'3h qualifier',180,'after_enrollment','always',
   'Sir/Ma''am {{name}}, our destination-wedding jewellery comes with bulk-order rates and delivery planning. What is the event date and approx quantity?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','destination',2,'2d consultation',2880,'after_prev_step','always',
   'Sir/Ma''am {{name}}, for bulk destination orders, a personal consultation works best. Please visit us or share a time and we will set up a call.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','destination',3,'7d timeline',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, sharing your event date helps us plan delivery properly. Please let me know when you are finalising.',true),

  -- silver_gift
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_gift',1,'2h occasion',120,'after_enrollment','always',
   'Sir/Ma''am {{name}}, our silver gifting range — coins, idols, elegant small sets — is perfect for any occasion. What is the gifting occasion?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_gift',2,'1d bulk',1440,'after_prev_step','always',
   'Sir/Ma''am {{name}}, for bulk corporate or wedding gifting, we offer attractive rates. Let me know your quantity and I will share pricing.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','silver_gift',3,'3d final',4320,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any specific budget or gift theme in mind? I''ll tailor options accordingly.',true),

  -- hot_followup (post-exhaust of any acquisition funnel)
  ('a1b2c3d4-0000-0000-0000-000000000001','hot_followup',1,'Day 1 personal',1440,'after_enrollment','always',
   'Sir/Ma''am {{name}}, I wanted to personally follow up — is there any specific concern holding you back from your purchase decision? I''ll try my best to address it.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','hot_followup',2,'Day 3 price talk',4320,'after_prev_step','always',
   'Sir/Ma''am {{name}}, if pricing is a concern, I''d love to discuss a flexible approach in person. Please do visit us once.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','hot_followup',3,'Day 7 final',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, one final note — our doors are always open. Drop by anytime, or just reply here and I''ll take care of the rest.',true),

  -- nurture_30d (post-hot_followup exhaust)
  ('a1b2c3d4-0000-0000-0000-000000000001','nurture_30d',1,'Day 14 hello',20160,'after_enrollment','always',
   'Sir/Ma''am {{name}}, warm hello from Sun Sea Jewellers — if you are still considering, we have some beautiful new arrivals that may interest you.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','nurture_30d',2,'Day 30 soft invite',23040,'after_prev_step','always',
   'Sir/Ma''am {{name}}, a small reminder — we value our visitors and would love to host you whenever convenient. Rates fluctuate daily; our service stays consistent.',true),

  -- cold_revive (60+ days quiet)
  ('a1b2c3d4-0000-0000-0000-000000000001','cold_revive',1,'Immediate gentle',0,'after_enrollment','always',
   'Sir/Ma''am {{name}}, it has been a while! Sun Sea Jewellers is still here and would love to serve you. Is there anything specific we can help with today?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','cold_revive',2,'Day 30 final',43200,'after_prev_step','always',
   'Sir/Ma''am {{name}}, a final friendly check-in — if you are ever in Karol Bagh, do drop by. Best wishes from all of us.',true),

  -- after_sales (post-purchase)
  ('a1b2c3d4-0000-0000-0000-000000000001','after_sales',1,'Day 1 thanks',1440,'after_enrollment','always',
   'Sir/Ma''am {{name}}, hope you enjoyed your recent purchase from Sun Sea Jewellers! We would love your feedback — was everything as expected?',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_sales',2,'Day 7 care',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any questions about care or storage of your piece? Also — we offer complimentary polishing and maintenance whenever you need it.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_sales',3,'Day 30 referral',43200,'after_prev_step','always',
   'Sir/Ma''am {{name}}, a warm hello! If you or your family need anything else, we are always happy to serve. Referrals from you are our biggest compliment.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_sales',4,'Day 90 occasion',129600,'after_prev_step','always',
   'Sir/Ma''am {{name}}, any upcoming occasion we can help plan for? Anniversary, festival, loved one''s birthday — we''d love to curate something.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','after_sales',5,'Year 1 thank you',525600,'after_prev_step','always',
   'Sir/Ma''am {{name}}, it has been a year since your purchase with us — thank you! We''d love to welcome you back anytime.',true),

  -- birthday (calendar-triggered)
  ('a1b2c3d4-0000-0000-0000-000000000001','birthday',1,'Month-start warm',0,'after_enrollment','always',
   'Happy Birthday month, Sir/Ma''am {{name}}! 🎉 Warmest wishes from all of us at Sun Sea Jewellers. As a small token, do drop by our showroom — we have something lovely set aside for you.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','birthday',2,'Birthday-week nudge',10080,'after_prev_step','always',
   'Sir/Ma''am {{name}}, your birthday is around the corner — if you are planning to gift yourself something special, we''d be honoured to help pick it out.',true),

  -- anniversary (calendar-triggered)
  ('a1b2c3d4-0000-0000-0000-000000000001','anniversary',1,'Month-start nudge',0,'after_enrollment','always',
   'Sir/Ma''am {{name}}, your anniversary is coming up this month! 💍 Looking for something memorable for your partner? We would love to help you pick a perfect piece.',true),
  ('a1b2c3d4-0000-0000-0000-000000000001','anniversary',2,'Anniversary wish',10080,'after_prev_step','always',
   'Happiest anniversary, Sir/Ma''am {{name}}! 🌹 Wishing you and your partner many more beautiful years together.',true);
