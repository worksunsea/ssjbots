# SSJ Stable Features — Do Not Break
**App:** ssjbot.gemtre.in · Supabase + Vercel + React/Vite  
**Last updated:** 2026-05-13  
**Owner:** Saurav, Sun Sea Jewellers, Karol Bagh  
**Super Admin email:** work.sunsea@gmail.com

Read this before making any changes to the codebase.
Do not alter logic, DB columns, or UI behaviour listed here without explicit instruction.

---

## ARCHITECTURE SNAPSHOT

```
WhatsApp (user)
     ↕
Baileys (wa-service on Synology NAS) — self-hosted, multi-session
     ↕ HTTP
Vercel Functions (api/*.js) — webhook, cron, demand, log-call, etc.
     ↕
Supabase PostgreSQL — all tables prefixed bullion_*
     ↑
React/Vite CRM (src/App.jsx — single ~7000-line file)
```

**Two tenants on same Supabase project:**
- SSJ = `a1b2c3d4-0000-0000-0000-000000000001` (Sun Sea Jewellers)
- Gemtre = `a1b2c3d4-0000-0000-0000-000000000002` (separate client)

---

## 1. BOT — PURE FAQ RESPONDER (since 2026-05-04)

**Current architecture (reset in `96b3984`):**
- Bot is a pure FAQ responder — answers questions about rates, products, store hours, Gold Gullak scheme
- NO auto funnel assignment, NO handoff action, NO auto-assignment to telecaller
- New leads stored in `bullion_leads` with `funnel_id = null` (inbox)
- Telecallers manually assign funnels from CRM
- Demand auto-created by bot when it captures name + requirement from conversation
- Hard exchange cap = 100; bot never self-pauses
- WA number 8860866000 = production, 9312839912 = test (both receive inbound)

**Key files:** `api/webhook.js`, `api/_lib/prompt.js`

**FAQs in DB:** `bullion_faqs` table — Gold Gullak scheme, jewellery FAQs, Gemtre FAQs (migrations 0032, 0033)

**Do NOT revert to funnel-routing or handoff-on-escalation without explicit instruction.**

---

## 2. APPROVAL WORKFLOW FOR SCHEDULED MESSAGES

**What it does:**
Birthday, anniversary, and drip messages are created in advance (up to 40 days for calendar funnels).
Before any message is sent, Saurav must review and approve it in the **Approvals tab**.

**Flow:**
1. Cron or drip enrollment creates `bullion_scheduled_messages` rows with `approved = false`
2. Cron pre-generates AI message body into `edited_body` for unapproved calendar messages
3. Saurav opens Approvals tab → sees all pending messages grouped by person or date
4. Saurav can edit the message text inline, then clicks ✅ Approve → `approved = true`
5. Cron gate: `.eq("approved", true)` — only sends approved rows
6. Rejected → `status = "canceled"`, `canceled_reason = "rejected_in_approval"`

**Auto-approved (no review needed):**
- Broadcast messages (`broadcast-send.js` inserts `approved: true`)
- Visit reminders / visit-day messages (`demand.js` inserts `approved: true`)

**DB columns on `bullion_scheduled_messages`:**
- `approved boolean NOT NULL DEFAULT false`
- `approved_at timestamptz`
- `approved_by text`
- `edited_body text` — AI-generated or manager-edited version; cron sends this over `body`
- `media_url text` / `media_type text` — for image/video broadcasts

**Migration:** `0037_scheduled_messages_approval.sql`

**Key files:** `src/App.jsx` (ApprovalsScreen), `api/cron.js` line 44, `api/broadcast-send.js`

---

## 3. BIRTHDAY / ANNIVERSARY CALENDAR FUNNELS

**Flow:**
1. cron-job.org fires the cron **once daily in the morning** (not every minute — the daily schedule is set in cron-job.org, not in code)
2. Cron finds contacts with `bday`/`anniversary` within the next **40 days** and enrolls them
3. Steps use `trigger_type = 'calendar_event'` with signed `delay_minutes` offsets
   - Negative = before event, zero = on day, positive = after
4. Enrollment is idempotent — skips leads already enrolled in the last 11 months
5. After enrollment, cron AI preview fills `edited_body` (also fires on the same daily run)
6. Messages appear in Approvals tab the morning after enrollment
7. All calendar messages must be approved by Saurav before cron will send them (§2)

**Important:** The cron code has NO daily time gate — the once-per-day behaviour comes entirely from the cron-job.org schedule. If the schedule is changed to every minute, enrollment would still only happen once (idempotent) but the code comment "daily-ish" would be misleading. Do not add a time gate to the code without explicit instruction.

**Enrollment window:** 40 days ahead (so the −20d step fires in time)

**Current step offsets (migration 0035 — fixed 2026-05-12):**
- Birthday: -28800 min (20d before), -10080 min (7d before), 0 (day of), +4320 min (3d after)
- Anniversary: -28800 min (20d before), 0 (day of), +4320 min (3d after)

**Migration:** `0035_fix_calendar_funnel_steps.sql` — corrected to `calendar_event`; all bad pending messages cancelled.

---

## 4. BROADCAST SEND

**What it does:** Enrolls filtered contacts into a broadcast funnel with staggered WA sends.

**Pace (Baileys unofficial):**
- safe = 1/12s (~5/min) — recommended for numbers < 3 months old
- normal = 1/8s (~7/min)
- fast = 1/5s (~12/min) — Business API only

**Filter options:** tags (ANY), city (partial), statuses, productInterest

**Broadcast messages auto-approved** (no approval review needed).

**Key file:** `api/broadcast-send.js`

---

## 5. TELECALLER QUEUE + CALL CADENCE

**Full spec in:** `TELECALLER_CRM_ROADMAP.md`

**Key behaviours — do not change:**
- 6-attempt call cadence per demand; offsets in `bullion_dropdowns` table
- `busy` disposition does NOT count toward 6-attempt budget
- Priority score: `temperature(40) + days_overdue(cap 45) + callback_bonus(50) + source_weight − attempt_penalty(cap 25)`
- Load-balanced round-robin via `bullion_telecaller_rotation` table
- Telecallers land on 📞 My Queue tab on login
- Call timer auto-starts when LogCallModal opens (`openedAtRef = useRef(Date.now())`)
- `is_suspicious = true` when disposition is "answered" but duration < 8 seconds
- Old clients (`is_client=true` or `crm_source='old_client'`): temperature floor = warm (never drops to cold)
- Temperature override: 🔥🌤❄️ pins in ConversationPane; overrides auto-calculation

**Migration:** `0027_telecaller_enhancements.sql`

**Pending (not built yet):** Analytics tab, manager dashboard, priority score badge on demand cards — see `TELECALLER_CRM_ROADMAP.md §14`

---

## 6. DEMAND CRM

**Demand = a specific purchase enquiry from a contact.**
One contact can have multiple demands (each for a different product/occasion).

**Key features:**
- AI-personalized opening WA message sent on demand creation (Claude Haiku)
- Visit scheduling: D-1 reminder + D-day morning reminder (both auto-approved)
- Authority assets: auto-sends brochure/intro video to new leads (`bullion_media_assets`)
- Post-sale WA: on CONVERTED → schedules D+3 feedback, D+7 Google review, D+30 check-in
- Missed call auto-reply from `bullion_dropdowns.missed_call_auto_reply`
- Jewelry fields: metal, stone, item_category, ring_size, purity, hallmark_pref
- Exchange/trade-in: has_exchange, exchange_desc, exchange_value
- Design notes: log of designs sent to client
- Duplicate demand guard (returns existing if bot_active=true, unless `allowDuplicate=true`)
- Lead merge/dedup: MergeLeadsModal → re-points all demands/messages/logs to primary

**Key files:** `api/demand.js`, `api/demand-outcome.js`, `api/merge-leads.js`

---

## 7. CONTACTS MODULE

**Contacts = `bullion_leads` table (also stores WA leads/demands).**
10k+ contacts imported from 14 Excel/CSV files (Phase C, April 2026).

**Key features:**
- List view (default) + card view; sortable/filterable columns
- Fixed fields: name, phone, mobile2, spouse_mobile, city, email, bday, anniversary, source, tags, VIP Score, is_client
- Custom fields: defined in localStorage (`ssj_contact_custom_fields`), values in `extra_fields` JSONB
- Search: server-side across all fixed fields + extra_fields values
- Tags: multi-tag filter (AND/OR toggle), drag-and-drop reorder, source/segment/flag/custom categories
- Soft delete: `deleted_at`/`deleted_by` — Trash panel + Restore (SA only)
- Bulk: select → delete or tag-update
- Dedup: `bullion_lead_aliases` tracks merged phones

**DB columns on `bullion_leads` (added without migration — now in 0036):**
- `deleted_at timestamptz`
- `deleted_by text`
- `extra_fields jsonb NOT NULL DEFAULT '{}'`

**Migration:** `0036_contacts_soft_delete_extra_fields.sql`

---

## 8. MULTI-SESSION WA (Baileys on Synology NAS)

**What it does:** Self-hosted WhatsApp via Baileys. Multi-session — each funnel/WA number has its own session.

**Connections tab in CRM:** Lists all sessions with status (connected/awaiting scan/offline). Add connection → enter slug → QR iframe. Re-pair action per session.

**Config:**
- `WA_SERVICE_URL` env var (Vercel) → NAS service
- `WA_SERVICE_SECRET` env var for auth
- Multi-session: `/clients/:id/send` — legacy `/send` still works (default session)
- `BOT_NUMBERS` env: `8860866000,9312839912` — these receive inbound + run the FAQ bot

**Key files:** `api/_lib/wa.js`, `wa-service/src/baileys.js`, `wa-service/src/index.js`

---

## 9. ANALYTICS (inside CRM)

- **Pipeline Overview tiles:** Hot/Warm/Cold count + total ₹ budget per temperature bucket
- **Call Performance:** today's calls per telecaller (duration buckets, suspicious flag)
- **Leaderboard:** calls this month, conversion %, target vs actual (inline-editable targets via `staff_targets` table)
- **Config editor:** WA templates (post_sale_day3/7/30, missed_call_auto_reply), Google review link — all stored in `bullion_dropdowns`

---

## 10. HR APP — JEWELLERY TRAINING PLATFORM

**File:** `JewelleryTrainingPlatform.jsx` (committed in `96b3984`)

Gamified MCQ quiz for staff jewellery knowledge. Separate from main CRM. Not yet deployed as part of ssjbot.gemtre.in — standalone component.

---

## FUNNEL SYSTEM

**16-state lead machine:** NEW → ATTEMPTING → CONTACTED → INTERESTED → PRODUCT_SHARED → QUOTED → NEGOTIATION → VISIT_SCHEDULED → VISITED_NO_BUY → CONVERTED → NURTURE_WARM → NURTURE_COLD → LOST → JUNK → DNC → DEAD

**System funnels (must exist):**
| Funnel ID | Purpose |
|-----------|---------|
| `hot_followup` | Intensive follow-up for hot leads |
| `cold_revive` | 12-touch WA for cold leads (no calls) |
| `nurture_warm` | 8-touch WA for warm not-ready leads |
| `dead_archive` | Terminal state |
| `birthday` | Calendar funnel — monthly bday outreach |
| `anniversary` | Calendar funnel — anniversary outreach |

---

## MIGRATION STATUS (confirmed run in Supabase)

| Migration | Date run | What it does |
|-----------|----------|-------------|
| 0001–0011 | Apr 2026 | Initial schema, lead fields, contact CRM |
| 0012–0026 | Apr 2026 | Demands, visits, media, call logs, telecaller |
| 0027 | May 1 2026 | Telecaller enhancements (priority, lag, crm_source) |
| 0028 | May 1 2026 | Jewelry fields + exchange on demands |
| 0029 | May 1 2026 | staff_targets + dead_archive funnel |
| 0030 | May 1 2026 | temperature_override on demands |
| 0031 | May 2 2026 | design_notes on demands |
| 0032–0033 | May 4 2026 | Gullak FAQs + training resources |
| 0034 | May 4 2026 | Inbox lead index |
| 0035 | May 12 2026 | Fix calendar funnel step offsets (calendar_event) |
| 0036 | May 13 2026 | deleted_at, deleted_by, extra_fields on bullion_leads ✅ |
| 0037 | May 13 2026 | approved, edited_body, approved_at, approved_by, media_url, media_type on bullion_scheduled_messages ✅ |

---

## DEPLOY CHECKLIST

1. **Run migration in Supabase SQL Editor first**
2. `git push` → Vercel auto-deploys
3. Verify the affected feature on ssjbot.gemtre.in

**Vercel env vars:** `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `WEBHOOK_SECRET`, `WA_SERVICE_URL`, `WA_SERVICE_SECRET`, `CRM_SECRET`, `TENANT_ID`, `BOT_NUMBERS`, `CLAUDE_MODEL`, `OWNER_ALERT_PHONE`
