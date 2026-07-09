# SSJ CRM Master Plan — Research + Custom Implementation
**For:** Sun Sea Jewellers (ssjbot.gemtre.in) · **Date:** 2026-07-09
**Purpose:** What the world's top jewellery CRMs do end-to-end (enquiry → sale → after-sales → upsell), and a step-by-step plan to implement the same in ssjbots — mapped against what is already built.

---

## PART 1 — TOP 5 CRMs USED IN THE JEWELLERY INDUSTRY

| # | CRM | Type | Why jewellers use it | What to copy into ssjbots |
|---|-----|------|---------------------|---------------------------|
| 1 | **Clientbook** (~$295/mo) | Jewellery-only clienteling | The #1 clienteling app for independent jewellers. "Today page" tells each salesperson exactly who to contact today and why (birthday, anniversary, going-cold deal, 90-day dormant). Sales attributed to associate activity. | The **Today page** concept, automated life-event follow-ups, associate-level sales attribution |
| 2 | **The Edge** | Jewellery POS + CRM | Most widely used jewellery store system (US) since 2004 — POS, inventory, repairs, customer history in one. Weakness: poor follow-up automation. | Purchase-history-on-lead-card; repair/order tracking tied to customer record |
| 3 | **Jewel360** | All-in-one cloud jewellery platform | POS + inventory + repairs + appraisals + CRM for independents. One customer record across every touchpoint. | Single unified customer timeline (calls + WA + visits + purchases) |
| 4 | **Salesforce** | Enterprise CRM | Used by luxury chains (Tiffany/Cartier tier). Strength: strict pipeline stages, lead scoring, assignment rules, field-level security, full audit trail. Too heavy/costly for independents. | **Field-level security, audit trail, lead scoring discipline** (you already have scoring) |
| 5 | **Zoho CRM / HubSpot** | General CRM (most common in India) | Affordable, strong automation, WhatsApp + Google/Meta ads integrations, GST-friendly. Requires jewellery fields built from scratch — which ssjbots already has natively. | **Ad-form → CRM auto-capture, web-form capture, email/WA sequences, deal-stage reports** |

India-specific specialists worth knowing (not top-5 but relevant): **Zithara AI** (jewellery retail CRM — QR-code walk-in capture, WhatsApp campaigns, AI agent) and **LeadSquared** (Indian sales CRM — instant ad-lead capture + telecaller workflows, same model as your telecaller queue).

**Key insight from research:** No single product does everything. Jewellery-specific tools (Clientbook, Edge) win at after-sales/clienteling; general CRMs (Salesforce, Zoho) win at lead capture and pipeline discipline. **ssjbots already combines both patterns** — 16-state pipeline + WA bot + telecaller queue. The gaps are mostly in capture, after-sales, and security hardening.

---

## PART 2 — THE END-TO-END LIFECYCLE (how top CRMs convert)

```
CAPTURE → ASSIGN → FIRST CONTACT (5-min rule) → QUALIFY → SHOW/QUOTE
→ NEGOTIATE → VISIT → CLOSE → DELIVER → AFTER-SALES (7d/30d/90d)
→ LIFE-EVENT UPSELL (birthday/anniversary/festival) → REFERRAL → REPEAT
```

### Stage-by-stage: industry standard vs ssjbots today

| Stage | Industry standard (top CRMs) | ssjbots today | Gap |
|-------|------------------------------|---------------|-----|
| **1. Capture** | Every source lands in CRM in <1 min: walk-in (QR/tablet), website form, Google/Meta lead ads, WhatsApp, phone call, exhibition | WA bot auto-captures; walk-in entry modal; `crm_source` field exists | ❌ No Google/Meta lead-ads webhook · ❌ no website form endpoint · ❌ no walk-in QR code |
| **2. Assign** | Load-balanced routing to a named salesperson, instantly, with notification | ✅ Load-balanced round-robin (`api/_lib/assign.js`) | ❌ No instant WA/push alert to the assigned telecaller |
| **3. First contact** | **Speed-to-lead: contact within 5 minutes** (industry's single biggest conversion lever) | ✅ Cadence engine attempt 1 at +5 min; lag tracking (INSTANT→MISSED) | Enforce it: manager alert when a NEW lead crosses 15 min untouched |
| **4. Qualify** | Script-guided discovery: occasion, budget, metal/stone preference, timeline, for-whom | ✅ 9 dispositions + scripts in `bullion_dropdowns`; budget/occasion fields | ❌ Scripts not stage-specific; no mandatory qualification checklist |
| **5. Show/Quote** | Send catalog images/video in-chat; log quote with validity; price-drop follow-up | ✅ PRODUCT_SHARED, QUOTED states; WA via Baileys | ❌ No quote record (amount, items, validity, rate-of-day) |
| **6. Visit** | Appointment booking + confirmation call 1 day before + no-show recovery | ✅ VISIT_SCHEDULED state | ❌ VISIT_CONFIRM task (already in your roadmap §14) |
| **7. Close** | Conversion logged with value, items, salesperson credit | ✅ CONVERTED state | ❌ Sale value/items not captured at close |
| **8. After-sales** | Auto: thank-you (day 1) → care tips (day 7) → review/referral ask (day 14) → check-in (day 90) | Roadmap item only (POST_SALE call, §14) | ❌ Not built — this is the biggest revenue gap |
| **9. Life-event upsell** | Birthday/anniversary reminders 2–3 weeks ahead ("a well-timed message before an occasion converts at an extraordinary rate" — clienteling research); festival campaigns (Akshaya Tritiya, Dhanteras, Diwali, wedding season) | Nothing structured | ❌ No birthday/anniversary fields on lead · ❌ no occasion calendar engine |
| **10. Referral/repeat** | Referral ask at delight moment (delivery + 7d); dormant reactivation at 90d | `cold_revive` funnel exists for dead leads | ❌ No referral tracking; no dormant-**customer** (post-sale) reactivation |

---

## PART 3 — STEP-BY-STEP IMPLEMENTATION PLAN

Ordered by revenue impact ÷ effort. Each phase is independently shippable; everything stays configurable via `bullion_dropdowns` (no-deploy changes), so it can be custom-tailored later.

### PHASE 1 — Close every capture hole (Week 1–2)
1. **`api/lead-intake.js`** — one public endpoint (secret-guarded) accepting `{name, phone, source, message, budget, occasion}`. Creates demand → auto-assigns → sets priority. Reuse `api/demand.js` logic.
2. **Website form** → posts to lead-intake.
3. **Meta Lead Ads webhook** — Facebook/Instagram lead forms deliver to lead-intake within seconds (direct Graph API webhook; this "ad click → sales dashboard in real time" pattern is exactly what LeadSquared/Zithara sell).
4. **Google Ads lead form webhook** — same endpoint, `source=online_google`.
5. **Walk-in QR code** — QR at the counter → WA deep-link to the bot ("Hi, I visited SSJ today"). Bot tags `crm_source=walkin`. (Zithara's signature feature — trivial for you since the WA bot exists.)
6. **Instant assignment alert** — on assign, send WA message to the telecaller's own number via Baileys: name, phone, source, budget, ready-made opening line.

### PHASE 2 — Discipline the middle of the funnel (Week 3–4)
7. **15-minute SLA alert** — cron (Vercel) checks NEW leads >15 min untouched → WA alert to manager. Speed-to-lead is the single highest-leverage conversion factor.
8. **Stage-specific talk tracks** (see Part 4) — extend `bullion_dropdowns` scripts keyed by lead state, shown automatically in LogCallModal for the lead's current state.
9. **Mandatory qualification mini-form** — on first `answered_interested`: occasion, buying-for, budget band, metal (gold/diamond/silver), timeline. 5 dropdowns, 20 seconds. Powers all later targeting.
10. **Quote record** — `bullion_quotes` table: items, amount, gold rate that day, validity. Auto follow-up 48h before expiry ("rate may change") — a jewellery-specific urgency lever no generic CRM has.
11. **Visit confirmation + no-show recovery** — VISIT_CONFIRM call task 1 day before (roadmap §14); if VISITED_NO_BUY or no-show → auto 48h "still thinking?" WA + call task.
12. **Manager dashboard + analytics** (roadmap §14 high-priority): queue depth, overdue calls, lag heatmap, conversion by `crm_source`, lost-reason breakdown.

### PHASE 3 — After-sales engine (Week 5–6) ← biggest untapped revenue
13. **Capture at close:** sale value, items, **customer birthday + anniversary**, spouse name (optional). Two extra date fields = the whole clienteling engine.
14. **Post-sale funnel** (`post_sale`, WA drip like cold_revive): Day 1 thank-you + care tips → Day 7 satisfaction call task (POST_SALE) → Day 14 Google-review + referral ask → Day 90 check-in with new-arrivals.
15. **Occasion calendar engine** — daily cron: birthdays/anniversaries 21 days out → create call task + suggested WA message ("Bhabhi ji's birthday is on the 28th — last year you chose earrings; shall I set aside a few matching pieces?"). This is Clientbook's core product, reproduced with one cron + two date columns.
16. **Festival campaign broadcasts** — dropdown-configured campaign dates (Akshaya Tritiya, Raksha Bandhan, Dhanteras, wedding season); segment by budget band/metal preference/last purchase → WA broadcast → replies become hot demands.
17. **Dormant-customer revival** — converted customers with no purchase in 12 months → yearly funnel touch (old-gold exchange offer works well in India).

### PHASE 4 — Security hardening (Week 7) — see Part 5
### PHASE 5 — Optimize (ongoing)
18. Script A/B tracking (roadmap §14) · referral-source tracking on demands (`referred_by`) · associate leaderboard (revenue attributed per telecaller, like Clientbook) · repeat-purchase rate as the north-star metric.

---

## PART 4 — LEAD ROUTING + WHAT SALESPEOPLE SHOULD SAY

Routing is already solved (load-balanced round-robin + priority queue). What top CRMs add is **the script attached to the moment**. Store these in `bullion_dropdowns` keyed by state so you can edit without deploys:

| Lead state | Goal of the call | Talk track skeleton |
|------------|-----------------|---------------------|
| NEW / ATTEMPTING | Reach + build comfort in 30 sec | "Namaste __, I'm __ from Sun Sea Jewellers, Karol Bagh — since 1984. You enquired about __ [on Instagram/our website]. Is this a good time for 2 minutes?" |
| CONTACTED → INTERESTED | Qualify (occasion, for-whom, budget, timeline) | "Lovely! Is this for a special occasion? … For yourself or a gift? … So I show you the right pieces, what range are you comfortable with? … When do you need it by?" |
| PRODUCT_SHARED | Get reaction, narrow to 2–3 pieces | "Did any of the designs I sent catch your eye? The __ is moving fast this season. Shall I send a short video of it?" |
| QUOTED | Create honest urgency | "Today's gold rate is ₹__. The quote I sent holds for 48 hours — rates have been moving. Shall I reserve the piece?" |
| NEGOTIATION | Protect margin, trade value not price | "I can't move much on making charges, but I can include free lifetime polishing + a certified card. Alternatively, exchange old gold at full value." |
| VISIT_SCHEDULED | Confirm + reduce no-show | (Day before) "Confirming your visit tomorrow at __. I've kept the __ pieces aside and will personally receive you. Please save my number." |
| VISITED_NO_BUY | Learn objection, keep warm | "Thank you for visiting! Was there something that didn't feel right — design, price, or timing? I'd rather fix it than lose you." → set structured lost/nurture reason |
| POST_SALE (day 7) | Delight + referral | "How is the __ being liked? … If anyone in the family is planning jewellery, I'd be honoured — mention your name and they get __." |
| Occasion call (21d before) | Upsell to a moment | "Sir, __'s birthday is on the __. Last time you chose __ — I've set aside 3 pieces that pair beautifully. Shall I WhatsApp photos?" |

**Objection bank** (also dropdown-stored, shown in LogCallModal): price ("making charges vs purity — we hallmark everything"), competitor ("compare our BIS certificate and buyback policy side by side"), timing ("no problem — shall I alert you when rates dip?"), trust ("40 years in Karol Bagh; here are our Google reviews").

---

## PART 5 — DATA SECURITY: NO LEAKAGE, NO THEFT

Threat model for a jewellery CRM: a salesperson exporting/photographing customer lists (names + numbers + budgets) and taking them to a competitor, plus outside breach. Already in place: role-based `app_permissions`, staff deactivation flag, 15-day forced reauth, office-TOTP device gate, service keys only in Vercel env. Add, in priority order:

1. **Telecallers see only their own leads** — enforce **in API queries** (`assigned_staff_id = session staff`) on every demand/lead endpoint, not just UI tabs. Field-level security is Salesforce's core discipline; replicate it server-side.
2. **Phone-number masking** — telecallers see `98XXXXX412`; full number revealed only via a "Call" action that logs the reveal (who/when/which lead) to an `bullion_access_log` table. Managers see full numbers. This single measure kills most list-theft value.
3. **No export for non-admins** — CSV export (roadmap §14) super-admin only. No bulk list views >50 rows for telecaller role.
4. **Audit log + anomaly alerts** — log reveals, searches, and record-views per staff per day; daily cron flags anomalies (e.g., >60 reveals/day, activity at odd hours, views of unassigned leads) → WA alert to you. (Classic insider-threat detection: "salesperson downloading five years of data on a Sunday night".)
5. **Rate-limit the API per staff token** — caps scripted scraping even with valid credentials.
6. **Offboarding checklist** — deactivate staff → auto-reassign their open demands (bulk-reassign, roadmap §14) → verify audit log for a 30-day lookback of unusual access.
7. **Supabase RLS on `bullion_*` tables** — currently the anon key is browser-exposed and RLS-gated; verify policies deny telecaller-role reads of unassigned rows, so even a leaked anon key + API bypass leaks nothing.
8. **Watermarking (cheap deterrent)** — render the logged-in staff name faintly across list screens; screenshots become traceable.
9. **Process rules** — no personal-phone WhatsApp with customers (all WA through the bot's numbers, so history stays in CRM); signed confidentiality clause in staff contracts; quarterly permission review.

---

## PART 6 — WHAT TO BUILD FIRST (if you do only 5 things)

1. Meta/Google/website lead intake endpoint (Phase 1) — stop losing ad money.
2. Phone masking + own-leads-only API enforcement (Phase 4) — stop theft before scaling the team.
3. Post-sale funnel + birthday/anniversary capture at close (Phase 3) — repeat business is where jewellery margins live.
4. 15-minute SLA alert (Phase 2) — speed-to-lead is the #1 conversion lever.
5. Occasion calendar cron (Phase 3) — the Clientbook "Today page," free.

---

## SOURCES

- [Clientbook — What CRM do most independent jewelry stores use?](https://www.clientbook.com/blog/what-crm-do-most-independent-jewelry-stores-use)
- [Clientbook — Best jewelry clienteling software 2026](https://www.clientbook.com/blog/the-best-jewelry-store-clienteling-software-in-2026)
- [Clientbook — Six steps to a perfect jewelry sales pitch](https://www.clientbook.com/blog/six-steps-to-a-perfect-jewelry-sales-pitch)
- [The Edge for Jewelers](https://www.theedgeforjewelers.com/)
- [Jewel360 — CRM software for the jewelry industry](https://jewel360.com/blog/crm-software-for-jewelry-industry)
- [Zithara — Best CRM for jewellery stores 2026](https://zithara.ai/blogs/best-crm-for-jewellery-stores-2026)
- [LeadSquared — AI-powered sales CRM](https://www.leadsquared.com/)
- [Capterra — Jewelry store management software 2026](https://www.capterra.com/jewelry-store-management-software/)
- [National Jeweler — Clienteling is an essential business model](https://nationaljeweler.com/articles/13884-clienteling-isn-t-a-buzzword-it-s-an-essential-business-model)
- [JCK — Jewelry retailers & clienteling](https://www.jckonline.com/article-long/jewelry-retailers-clienteling/)
- [Stellabots — Double jewelry sales with private clienteling](https://www.stellabots.com/blog/how-to-double-your-jewelry-stores-sales-with-private-clienteling-9dd67)
- [BigContacts — CRM data security](https://www.bigcontacts.com/blog/crm-data-security/)
- [Krypto IT — What if your top salesperson leaves with your data?](https://www.kryptocybersecurity.com/what-if-your-top-salesperson-leaves-with-your-data/)
- [Nutshell — CRM security best practices](https://www.nutshell.com/blog/managing-data-privacy-and-security)
