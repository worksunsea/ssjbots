# SSJ Stable Features — Do Not Break
**App:** ssjbot.gemtre.in · Supabase + Vercel + React/Vite  
**Last updated:** 2026-09-03  
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

**Demands tab UI (simplified 2026-07-10):**
- `nextStepFor(demand)` helper (App.jsx ~line 199) is the single source of truth for "what should staff do right now" — priority order: callback-promised-and-due → call-overdue → call-scheduled(disabled) → visit-today → confirm-visit-tomorrow → mark-visit-result → handoff-reply → bot-chatting(no action). Drives both the card's one-button and ConversationPane's primary action — **do not re-derive urgency logic elsewhere; call this function.**
- Collapsed demand card = 2 lines: name+temp chip+VIP chip+next-step button, then a plain-text one-liner (description · occasion+date · budget). All the old pills (call-attempts, bot pill, product/occasion/budget/visit/assigned pills, step name, timestamp) were deliberately removed — do not re-add without re-checking the simplification intent.
- Card's next-step button auto-selects the demand and passes `autoOpen="call"` to `ConversationPane`, which opens `LogCallModal` on mount — this is why `ConversationPane` is given `key={d.id}` in the map (forces remount so the auto-open effect fires per-selection).
- `ConversationPane` action row was regrouped from 17 flat buttons into 3: Primary (nextStepFor), "Close demand ▾" dropdown (Converted/Lost/Not interested/Junk/Supplier/Opt-Out-DNC), "⋯ More" dropdown (Schedule visit/Send design/Edit contact + manager-only: Reassign/Pause bot/Merge duplicate/Mark step complete/Undo step/Handoff). Standalone "Dead" button was deleted (duplicate of Close→Lost).
- Role gating: `isManagerPlus = ["superadmin","admin","manager"].includes(loadUser()?.role)`. Bulk-select checkbox (card list) and the More-menu's manager items are hidden for telecallers. Funnel-flow strip is manager+-only and collapsed by default (`funnelFlowOpen`); past call attempts collapse behind a count toggle (`attemptsOpen`) for everyone.
- `WalkinEntryModal` is now a 2-step form: Step 1 (always visible) = Name/Phone/Product category/Estimate/Description/Occasion+date. Step 2 = everything else (city/email/bday/anniversary/rating/tags/is_client/for-whom/product-types/items-enquired/exchange/funnel/attended-by/discovery-source/design-ref/visit-scheduling/visit-tracking/outcome/competitor/followup/activate-bot), behind a "▼ Complete visit details" toggle (`expanded` state), collapsed by default. There's no backend-persisted "finish later" reminder — Step 2 is just collapsed in the same modal, not a separate reopenable flow.

**Key features:**
- AI-personalized opening WA message sent on demand creation (Claude Haiku)
- Visit scheduling: D-1 reminder + D-day morning reminder (both auto-approved)
- Authority assets: auto-sends brochure/intro video to new leads (`bullion_media_assets`)
- Post-sale WA: on CONVERTED → schedules D+3 feedback, D+7 Google review, D+30 check-in
- Missed call auto-reply from `bullion_dropdowns.missed_call_auto_reply`
- Multi-item enquiries: `enquiry_items` jsonb array on `bullion_demands`, each `{product, purity, weightG, notes}` (migration `0055`, replaces the old single metal/stone/item_category/ring_size/purity/hallmark_pref fields — **do not resurrect the old flat fields**, DemandEntryModal/WalkinEntryModal now render a repeatable item list instead)
- Exchange/trade-in: has_exchange, exchange_desc, exchange_value
- Design notes: log of designs sent to client
- Duplicate demand guard (returns existing if bot_active=true, unless `allowDuplicate=true`)
- Lead merge/dedup: MergeLeadsModal → re-points all demands/messages/logs to primary

**Key files:** `api/demand.js`, `api/demand-outcome.js`, `api/merge-leads.js`

---

## 6b. LEAD SOURCE WEBHOOKS (2026-07-02)

**What it does:** `api/lead.js?token=<webhook_token>` accepts inbound leads directly from external portals — no service-secret needed, the token (from `bullion_lead_sources.webhook_token`) is the auth.

**Supported source types:** `facebook`/`instagram` (Meta lead-gen, incl. `hub.challenge` GET verification), `indiamart`, `justdial`, `googleads`, and a generic field-mapped fallback (`bullion_lead_sources.field_map`).

**Config per source (`bullion_lead_sources` table):** `name`, `source_type`, `webhook_token` (unique), `field_map`, `default_funnel_id`, `enroll_drip`, `active`.

**The existing service-secret POST path on `api/lead.js` (used by internal tools/imports) is unchanged** — the token path is purely additive, gated on `req.query.token` being present.

**Migration:** `0049_lead_sources.sql`

**Key file:** `api/lead.js`

---

## 7. CONTACTS MODULE

**Contacts = `bullion_leads` table (also stores WA leads/demands).**
10k+ contacts imported from 14 Excel/CSV files (Phase C, April 2026).

**Key features:**
- List view (default) + card view; sortable/filterable columns
- Fixed fields: name, phone, mobile2, spouse_mobile, city, email, bday, anniversary, source, tags, VIP Score, is_client
- Custom fields: defs in `bullion_dropdowns` (`field='contact_custom_fields'`, one JSON-array row per tenant; `field='contact_field_order'` for ordering) — read via `fetchContactFieldDefs()`, shared `ContactFieldsContext` feeds both ContactEditModal and WalkinEntryModal. Values live in `extra_fields` JSONB per lead.
  - ⚠️ Was localStorage (`ssj_contact_custom_fields`) until commit `a2685f0` (2026-06-16) moved it to DB — that migration did NOT copy old localStorage defs forward, so any field def that existed only in one browser's localStorage was silently orphaned (values in `extra_fields` survived fine, just no def → no label/input rendered anywhere). Lost fields `company_name`, `what_they_do`, `affiliate_links`, `where_can_they_help`, `misc` recovered 2026-07-16 by reverse-engineering keys out of `extra_fields` and reseeding the dropdown row.
  - **Rule: never swap a config/def storage backend without a one-time script that copies existing values into the new store first.** Check this section is current before changing where custom-field defs live again.
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

**Logout/reconnect race fix (2026-07-02, commit `039b186`):** `logoutClient` now marks the session `destroyed = true` and clears the reconnect timer BEFORE calling `sock.logout()`. The `connection.update` close handler checks `sess.destroyed` and skips the auto-reconnect if set — previously the close event could race the logout call and re-create the session from stale auth files before they were removed. `bootAllSessions` also no longer force-adds `DEFAULT_CLIENT_ID` — it only boots sessions with an existing auth directory, so a session removed via the Connections tab actually stays removed after a NAS restart.

**Media-service:** ffmpeg is now installed in the Docker image (`media-service/Dockerfile: RUN apk add --no-cache ffmpeg`) instead of bind-mounted from the NAS host — do not remove the `/usr/bin/ffmpeg` / `/usr/lib` host mounts from `docker-compose.yml` without keeping this Dockerfile line, and vice versa.

**wa-service default client id:** `WA_CLIENT_ID` env default is `main` (was `ssj-test`).

**Docker volume paths (`wa-service/docker-compose.yml`, `media-service/docker-compose.yml`) are Synology NAS paths (`/volume1/...`) — do NOT commit local dev machine paths (e.g. `C:/docker-data/...`) into these files, that breaks the NAS deploy.**

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
| 0038 | May 14 2026 | Security hardening — RLS enabled on all 18 bot tables, tenant-scoped policies, search_path on SECURITY DEFINER fn, view operator-precedence bug fix ✅ |
| 0039 | May 14 2026 | Fix SECURITY DEFINER views — bullion_active_leads_view + bullion_funnel_metrics → security_invoker=true ✅ |
| 0040 | May 14 2026 | Drop leftover open anon_all_* policies; fix role_permissions + score_commitments; HR app tables ✅ |
| 0041 | May 14 2026 | Type cast fix (::text) for HR tables with text tenant_id — rolled back, superseded by 0042 |
| 0042 | May 14 2026 | Final HR RLS policies — all tables with tenant_id scoped; petty_cash_txns via runner_id, training_progress via staff_id subquery ✅ |
| 0043 | May 14 2026 | Remove SECURITY DEFINER from bullion_upsert_lead; drop rls_auto_enable() + ensure_rls event trigger ✅ |
| 0047 | — | Post-birthday/anniversary step +3d → +7d — file not yet committed, run status unconfirmed |
| 0049 | — | bullion_lead_sources table for lead webhook intake ✅ |
| 0055 | — | enquiry_items jsonb on bullion_demands ✅ |
| 0056 | 2026-07-02 | staff.active + tenant_security_settings + trusted_devices + device_verifications (§19 session security) — run in Supabase before deploy |
| 0061 | 2026-07-11 | bullion_vendors, bullion_vendor_dealings, bullion_vendor_items + uploads/vendors/% storage RLS (§24 Vendor Management) ✅ |
| 0062 | 2026-07-11 | Vendor Management v2 — contacts jsonb (multi-contact), dual card images, custom_fields jsonb, catalogue_item_types.customer_visible (§24) ✅ |
| 0063 | 2026-07-12 | bullion_vendors.vendor_kind (jewellery/service/other) — AI-classified from the same card scan, no extra token cost (§24) ✅ |

---

## 11. SUPABASE SECURITY HARDENING (2026-05-14)

**All Supabase Security Advisor warnings cleared (migrations 0038–0043).**

**What was done:**
- RLS enabled on all 18 bot tables (previously had no row-level security)
- All `USING (true)` open policies replaced with tenant-scoped policies (`tenant_id = ssj_tenant_id()`)
- HR app tables (salary, staff, attendance, leaves, etc.) locked to SSJ tenant
- `bullion_active_leads_view` + `bullion_funnel_metrics` converted to `security_invoker=true`
- `bullion_upsert_lead` `SECURITY DEFINER` removed — now `SECURITY INVOKER`
- `rls_auto_enable()` function + `ensure_rls` event trigger dropped
- `bullion_active_leads_view` AND/OR operator precedence bug fixed

**ssj_tenant_id() helper function:**
```sql
SELECT 'a1b2c3d4-0000-0000-0000-000000000001'::uuid
```
Used in all RLS policies. Do not change the tenant UUID.

**Do NOT create new tables without enabling RLS and adding a tenant-scoped policy.**

---

## DEPLOY CHECKLIST

1. **Run migration in Supabase SQL Editor first**
2. `git push` → Vercel auto-deploys
3. Verify the affected feature on ssjbot.gemtre.in

**Vercel env vars:** `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `WEBHOOK_SECRET`, `WA_SERVICE_URL`, `WA_SERVICE_SECRET`, `CRM_SECRET`, `TENANT_ID`, `BOT_NUMBERS`, `CLAUDE_MODEL`, `OWNER_ALERT_PHONE`


## 12. APPROVALS SCREEN — EDIT NAME OPENS FULL CONTACT MODAL

**Edit name in Approvals tab opens the full ContactEditModal — NOT inline edit.**

Click ✏️ Edit next to a person's name → ContactEditModal opens (same as Contacts screen).
Works in both "group by person" header and "group by date" card.
After save, local state (name/phone) refreshes via `onContactSaved`.

**Do NOT replace with inline name input for the edit button in ApprovalsScreen.**

---

## 13. UPCOMING EVENTS — ENROLL BUTTON

**"🎯 Enroll" button appears on "⚠️ not enrolled" contacts in the Upcoming Events (🎂) screen.**

Click Enroll → calls `POST /api/cron?action=enroll_calendar` with `{ leadId, funnelType: 'birthday'|'anniversary' }`.
Computes next occurrence of the event date and calls `enrollLeadInDrip`.
After success, the event row refreshes and shows "📅 queued" instead of "⚠️ not enrolled".

**Do NOT auto-enroll in bulk from this screen — enrollment is always one contact at a time by manual action.**

---

## 14. ROTATION POOL + EXTRA SALESPERSON NAMES (Analytics screen)

**Rotation Pool** (Analytics → "📞 Telecaller Rotation Pool" section):
- Shows all staff. Toggle "Add to pool / Remove" updates `staff.app_permissions.fms` to include/exclude `"telecaller"`.
- `assign.js` uses `isTelecallerStaff()` to pick from the pool for new demands.
- Do NOT change the pool logic in `assign.js` without updating the UI toggle too.

**Extra Salesperson Names** (Analytics → "🧑‍💼 Extra Salesperson Names" section):
- Stored in `bullion_dropdowns` where `field='extra_salesperson'`, `active=true`.
- Names appear in "Attended by" dropdown on demand forms (DemandEntryModal + WalkInModal).
- Selecting an extra name sets `assigned_to = <name>` and `assigned_staff_id = null` (no staff record needed).
- Select option value format: `"extra:<Name>"` — stripped to name on form submission.
- Do NOT remove the `"extra:"` prefix handling in form submission code.

---

## 16. RAPAPORT PDF PARSER (api/rapaport-upload.js + api/rapaport-sync.js)

**Function:** `parseRapTable(text)` — parses both Round and Fancy Pear PDFs.

**Round PDF fix (2026-06-27, commit 828f34c):** 5 bugs fixed:
1. `estimateTokenVals` — ≤35 heuristic (not floor(len/2)) to count values in merged tokens
2. Pre-join `nextToks.length >= 2` (was 4) — fixes .30ct J/K/L/M rows that split across 2 lines
3. Two-phase `expandMerged`: phase1 uses ≤35 heuristic; phase2 (ceil-division) fallback for large brackets
4. `estimatedCount` in `tryParseDataRow` uses same heuristic
5. Control-char filter: rejects garbage lines (from PDF page boundaries) that contained `)` and `` etc.

**Fancy PDF fix (2026-06-27):** Two additional expandMerged fixes for the Pear Price List PDF:
- **Phase 1b**: if phase1 gives exactly N-1 values, re-split 2-char expansions ≥10 (e.g., "432"→[4,32]→[4,3,2]) until count matches targetCount. Fixes .30ct M row.
- **New phase2**: proportional allocation across ALL merged tokens. Old phase2 split only the FIRST long token; 2ct+ rows have multiple merged tokens (e.g., "215200185175160135", "103826930", "16"). New phase2 splits each proportionally by char-length share. Handles all 8 large fancy brackets correctly.

**10ct bracket excluded (2026-06-27):** `WEIGHT_RANGES` = 11 brackets (.30–5.00 only, no "10.00"). 10ct chart not parsed, not stored. Lookup in `rapLookup()` also caps at 5ct (`Math.min(weight, 5.0)`). Any stone >5ct gets 5ct pricing. This applies to both upload.js + sync.js + App.jsx seed + App.jsx lookup constants.

**PDF structure notes:**
- Small brackets (.30-.70ct): values ≤43, all merged into ONE token per row (e.g., "2321191716151311976")
- Large brackets (.90ct-5.00ct): 2-3 merged tokens per row, last 1-2 values as separate short tokens
- Fancy PDF has .18-.22 and .23-.29 extra brackets (decimal values) — excluded by WEIGHT_RANGES + `tokens.some(t => t.includes('.'))` filter
- SI3 column (col 7) is in raw data but skipped during storage

**Do NOT change the ≤35 heuristic, phase1b, proportional phase2, or 10ct exclusion without explicit instruction.**

---

## 15. FORM BUILDER SCREEN

**Location:** 🛠️ Form Builder tab — visible to manager / admin / superadmin.

**What it does:**
- Configure which fields appear in CRM forms: Walk-in/New Demand, Lead/Contact Entry, Lead CSV Import.
- Left panel: form template list. Right panel: field editor (tabs + fields).
- ⚙ fields = system fields (map to real DB columns, key/type locked, cannot be deleted).
- Custom fields (non-⚙) can be added, reordered, deleted, marked required.
- Select / Multi-Select field types support inline options list.

**Storage:** `bullion_dropdowns` table — `field='form_spec_walkin'` / `'form_spec_lead_entry'` / `'form_spec_lead_import'`, `value` = JSON.stringify(spec).

**Spec format:**
```json
{
  "tabs": [{"k": "basic", "l": "Basic Info"}],
  "required": ["phone"],
  "fields": {
    "basic": [["Label","key","type",null|["opt1"],isFixed]]
  }
}
```

**Key components:** `FormBuilderScreen`, `SsjFormFieldEditor`, `SSJ_FORM_DEFS` (default specs).

**Do NOT make fields with `isFixed=true` editable** — those are DB column mappings.

---

## 17. CRM TAB LISTS — TWO PARALLEL DEFINITIONS, KEEP THEM IN SYNC

**There are two separate tab-key lists in `src/App.jsx` and they MUST stay identical in tab keys:**
- `ALL_TABS` / `ROLE_DEFAULT_TABS` (~line 10060) — drives the actual tab bar + which screen renders.
- `CRM_ALL_TABS` / `CRM_ROLE_DEFAULT_TABS` (~line 123) — drives the Staff & Access screen's per-tab toggle chips.

**Bug fixed 2026-07-02 (commit `d2837d9`):** `CRM_ALL_TABS`/`CRM_ROLE_DEFAULT_TABS` was missing the `calculator` and `walkin` keys entirely. Any manager whose access was ever customized in Staff & Access lost the Calculator tab and it couldn't even be re-granted (the toggle chip didn't exist). Managers who never had custom permissions set were unaffected (they fall back to `ROLE_DEFAULT_TABS`, which did have `calculator`).

**When adding a new tab to `ALL_TABS`, always add the same key to `CRM_ALL_TABS` (and to both `manager`/`staff` default arrays if it should be a role default) in the same change — otherwise Staff & Access silently can't grant it.**

---

## 18. JEWELLERY CALCULATOR — SIZE/NOTES + CAMERA CAPTURE (2026-07-02)

**Added to the jewellery tab in CalculatorScreen (commit `d2837d9`):**
- `jw.size` — free-text size field (e.g. ring size) next to Vendor Code.
- `jw.notes` — free-text notes textarea above the Results panel.
- Both persist automatically — `saveEstimate` spreads the whole `jw` object into `items[0]`, and `loadEstimateForEdit` maps `it.size`/`it.notes` back in. The "🔄 New" reset button also resets both.
- Item photo `<input type="file">` now has `capture="environment"` so mobile browsers open the camera directly instead of the gallery picker (desktop ignores the attribute, falls back to file picker as before).

---

## 19. SESSION SECURITY — OFFICE-TOTP DEVICE GATE, DEACTIVATION LOGOUT, 15-DAY REAUTH (2026-07-02)

**⚠️ Shared-database feature — see "Shared staff-table contract for sibling repos" at the end of this section. Only implemented in ssjbots so far; ssj-hr/fms-tracker/jewelbos each need their own client-side enforcement added separately before deactivation/reauth is honored there too.**

### Background / why this exists
ssjbots has no server session, no JWT, no Supabase Auth — login is a direct browser query (`sb.from("staff")...eq("password",p).single()`, `LoginScreen`) and the entire `staff` row is cached in `localStorage["ssj_bullion_user"]`. Authorization for data access is Postgres RLS scoped by `tenant_id`, not by the cached user object (that's UI-gating only). This section adds three linked controls on top of that architecture without introducing Supabase Auth.

### 1. Office-TOTP "new device" gate
One shared TOTP secret (NOT per-user) lives on a physical phone kept in the office, generating a single 6-digit code for the whole team. When staff log in (existing password flow) from a device that hasn't been verified before, they're additionally prompted for that code (`LoginScreen` `stage:"totp"`). Once verified, the device is trusted for `device_trust_days` (default 30) and isn't asked again until that window lapses.
- **Feature is OFF by default** (`tenant_security_settings.totp_enabled = false` until a superadmin explicitly generates a secret) — deploying this code changes nothing until turned on.
- Device identity = a random `crypto.randomUUID()` stored in `localStorage["ssj_device_token"]` (`getDeviceToken()`, `src/utils/session-security.js`). Clearing site storage / a different browser = a new device, will re-prompt.
- **The shared secret never reaches the browser.** `tenant_security_settings` has RLS enabled with zero anon policies — only the service-role client in `api/device-check.js` / `api/security-settings.js` can read/write it. Do NOT add an anon SELECT policy to this table.
- Trust is **device-scoped, not user-scoped** (judgment call): once any staff member verifies a browser, other staff on that same browser skip TOTP too. `verified_by_staff_id`/`verified_by_name` on `trusted_devices` + the `device_verifications` audit table record who first verified each device.
- Superadmin setup UI: `SecurityPanel` component, rendered inside the Staff & Access screen for superadmin only (`isSuperadmin` check via `loadUser()?.role`). Generate/Rotate shows the QR + secret text **once** (scan into the office phone's authenticator app — Google Authenticator, Authy, etc), then it's gone from the client.
- **SSO logins (postMessage from fms.gemtre.in etc) skip the TOTP step** — the parent app is the trust boundary for iframed sessions — but SSO sessions still get `authAt` stamped and are subject to deactivation/reauth checks below. This is a deliberate judgment call, not an oversight.

### 2. Deactivated staff → logged out of all devices
`staff.active boolean DEFAULT true` (migration `0056`). Login checks `active === false` and refuses with a clear message. For **already-open sessions**, the existing focus/visibilitychange effect (`src/App.jsx`, ~line 10007) now also re-selects `active` (alongside `app_permissions`) and force-logs-out if deactivated. A `setInterval(SESSION_POLL_MS)` (5 min) was added alongside it so a tab left open all day gets caught too, not just on tab-switch/focus.
- **Honest limitation:** this is client-side enforcement against a public anon key + RLS-by-tenant (not per-user) architecture — it was never a hard security boundary and this feature doesn't change that. The realistic goal is stopping a *deactivated non-technical employee* from continuing to use their existing session, which it achieves. True per-user server enforcement would require Supabase Auth — explicitly out of scope for this change.

### 3. 15-day forced reauth (superadmin exempt)
`login()`/SSO stamp `authAt = Date.now()` onto the cached user. `isSessionExpired(user, nowMs, reauthDays)` (`src/utils/session-security.js`, pure + unit-tested) returns `false` unconditionally for `role === "superadmin"`; for everyone else, an absent or >15-day-old `authAt` forces logout back to `LoginScreen` with a "session expired" message.
- **Deployment grandfather clause:** existing cached sessions from before this feature shipped have no `authAt` at all. Rather than treating that as "already expired" and mass-logging-out every manager/telecaller mid-shift the moment this deploys, the top-level `App` component's initial `useState(loadUser)` lazy initializer stamps `authAt = Date.now()` once on first load if it's missing, so the 15-day clock starts fresh from deploy time instead of retroactively. **Do not remove this grandfather stamp** — without it, shipping any future change to this logic could mass-logout the whole team without warning.
- Device-trust (30d) and reauth (15d) are **separate timers with different lengths on purpose**: reauth re-proves password identity; device-trust controls whether the office TOTP code is asked again. Making them equal would mean every 15-day reauth also re-triggers TOTP, defeating the "don't ask again on this device" point of the feature.

### Schema (migration `0056_device_trust_and_active.sql`)
- `staff.active boolean NOT NULL DEFAULT true` — **on the shared table**, non-breaking default.
- `tenant_security_settings (tenant_id pk, totp_secret, totp_enabled, reauth_days default 15, device_trust_days default 30, updated_at, updated_by)` — RLS on, no anon policies.
- `trusted_devices (id, tenant_id, device_token, label, verified_by_staff_id, verified_by_name, trusted_until, last_seen_at, created_at, unique(tenant_id, device_token))` — RLS on, no anon policies.
- `device_verifications (id, tenant_id, staff_id, staff_name, device_token, ip, device, verified_at)` — audit log, RLS on, no anon policies.

### Endpoints
- `POST /api/device-check` — `x-crm-secret` gated. `{tenantId, deviceToken, staffId?, staffName?, code?}` → trust lookup, then TOTP verify + trust-minting if `code` sent. Called from `LoginScreen` right after password success.
- `GET/POST /api/security-settings` — `x-crm-secret` gated + independently re-verifies `staff.role === "superadmin"` server-side (never trusts a client-sent role, since there's no server session). `generate`/`rotate`/`enable`/`disable`/`revoke_device` actions.

### Key files
`src/utils/session-security.js` (pure logic — `getDeviceToken`, `isSessionExpired`, `shouldForceLogout`, `isTrustedUntilValid`, tested in `src/__tests__/session-security.test.js`), `api/device-check.js`, `api/security-settings.js`, `src/App.jsx` (`LoginScreen`, `SecurityPanel`, `login`/`logout`, focus/interval effect, SSO handler), `supabase/migrations/0056_device_trust_and_active.sql`.

### Shared staff-table contract for sibling repos (ssj-hr, fms-tracker, jewelbos)
These apps read the same Supabase project/`staff` table but each has its own separate login/session code — **none of the enforcement above happens automatically in those apps.**
1. **`staff.active` now exists tenant-wide.** Any app authenticating against `staff` should treat `active === false` as "reject login, expire any cached session." Defaults to `true`, so nothing breaks until each app adds the check — but deactivating someone today only takes effect in ssjbots.
2. **`tenant_security_settings.totp_secret` is server-only, by design.** Never add an anon-readable policy. If auth is consolidated later (e.g. into `jewelbos`), reuse `tenant_security_settings`/`trusted_devices` rather than inventing parallel tables.
3. **`ssj_device_token` / `authAt` / the 15-day clock are ssjbots client-cache conventions**, not shared state — other apps would need their own equivalent local implementation of `isSessionExpired`/`shouldForceLogout` (the logic in `src/utils/session-security.js` is small and pure, safe to copy).
4. ssj-hr already has a **different**, pre-existing **per-user** TOTP setup (`staff.totp_secret`, `staff.totp_enabled`, `api/verify-totp.js`) — that is unrelated to `tenant_security_settings` (the shared office secret) and both can coexist; don't conflate them.

---

## 20. CALCULATOR — SILVER PURITY, "SEND ESTIMATE" GATED ON SAVE, PDF DOWNLOAD (2026-07-04)

**Applies to all three CalculatorScreen tabs (jewellery, solitaire, quotation).**

1. **Silver purity option.** `PURITIES` (module scope, near line 10419) now has `{ l: "Silver (999)", rateKey: "silver" }`. `parseLiveRatesForCalc` parses the same Google Sheet "Silver Rate" row already used by `api/_lib/rates.js` (`parseRates`) — looks for the `"Silver Rate"` label, then the next numeric row `> 10000` (price per kg) and divides by 1000 for ₹/g. `liveRates.silver` flows through the existing generic `getGoldRatePg` lookup unchanged — no separate silver code path needed downstream.
2. **"📤 Send Estimate" button is now gated on `justSaved`** (new state, same scope as `saving`/`saveModal`). Previously the "📱 Send WA" button next to Save was active as soon as a contact was linked, even before the estimate was actually saved — it could send stale/unsaved numbers. Now:
   - Clicking "💾 Save/Update Estimate" first sets `justSaved(false)`.
   - A successful insert or update sets `justSaved(true)` — button turns solid green and enables.
   - `loadEstimateForEdit` also sets `justSaved(true)` (loading an already-saved estimate is inherently "saved").
   - "🔄 New" (jewellery tab) resets `justSaved(false)`.
   - "📤 Send Estimate" itself now sends the generated PDF as a WhatsApp document (see point 4), not just text — same 8860866000 Baileys session either way, no server/session changes needed.
3. **"📄 Download PDF" button** added next to Print in all three tabs. Uses `jspdf` (new dependency, `npm install jspdf`) via the module-level `downloadEstimatePdf({ title, clientName, rows, total })` helper (near `openEstimateSlipWindow`, ~line 10675) — draws a plain text A5 PDF and triggers a direct browser download (`doc.save(...)`), no print dialog. This is separate from the existing "🖨️ Print" button (which still opens a print window for the fancier styled slip / physical printing).
4. **"📤 Send Estimate" attaches the PDF on WhatsApp (2026-07-04, same day follow-up).**
   - `buildEstimatePdfDoc({ title, clientName, sections })` is the shared builder behind both the download and the WA-send path — `sections: [{ heading?, rows, total }]`. A single section with no `heading` renders like a plain one-estimate PDF (used by `downloadEstimatePdf`); multiple headed sections render a multi-estimate PDF (used by the multi-select send below).
   - `sendEstimatePdfOnWA({ phone, clientName, title, sections, caption })` builds the PDF, gets it as a `Blob` (`doc.output("blob")`), wraps it in a `File`, and uploads via `secureNonImageUpload(file, sb, "estimates", ["application/pdf"], 10)` — lands under `uploads/estimates/*` in the `media` bucket (see migration `0053_estimates_storage_policy.sql`, already public-readable). Then POSTs to the new `/api/send-media` endpoint with the public URL.
   - **New endpoint `api/send-media.js`** — mirrors `api/send.js` but calls `sendWhatsAppMedia` (`api/_lib/wa.js`) instead of `sendWhatsApp`, gated by `checkCrmSecret`. Always passes `client: "8860866000"` because wa-service (`wa-service/src/index.js`) only exposes `/clients/:id/send-media`, not a default-session `/send-media` route — omitting `client` would 404.
   - `mediaType: "document"` → wa-service's `sendMediaForClient` (`wa-service/src/baileys.js`) builds a Baileys document message with `mimetype: "application/pdf"`, already supported before this change (used for other doc sends).
   - Quotation tab's WA caption now includes the linked client's name (`For: {name}`), matching jewellery/solitaire — previously it didn't.
   - The client-history "multi-select past estimates → send" feature (in the "Active client banner" → history panel) now builds one combined multi-section PDF (one section per selected estimate, headed by label + date) and sends it as a single WA document, instead of a text-only summary. Button renamed 📱→📤, disabled while sending (`sendingEst` state, shared across all three tabs + this panel).
   - New state `sendingEst` (alongside `justSaved`) disables the Send button and shows "Sending…" while the PDF is being built/uploaded/sent, since this is now an async network round-trip instead of a synchronous `wa.me` open.

---

## 21. CALCULATOR — SILVER RATE SOURCE FIX, 92.5 = 999 PRICE, PCS MOVED TO JEWELLERY (2026-07-04, corrected same-day)

This section supersedes an earlier same-day pass that got two things wrong — corrected after checking the live rates feed directly and getting explicit store-policy clarification.

1. **Silver rate parsing was reading the wrong cell — fixed in BOTH places.** `parseLiveRatesForCalc` (src/App.jsx, calculator) originally read the row under the `"Silver Rate"` section header (`row.gold`, e.g. `237500` → ÷1000 → ~₹237.5/g) — that field is the raw MCX/wholesale-linked spot rate with no retail markup, and was showing ~₹236/g in the app against an actual shop rate of ~₹250/g. Fetching `${APPS_SCRIPT_URL}?action=rates` directly and inspecting the rows around the silver section showed the correct retail ₹/g figure sits in a distinct row immediately after the silver-coin table, marked by `row[""] === "ESTIMATED"` (e.g. `{"gold":249.5,"estimated":"","":"ESTIMATED"}`) — that's the one now used for `out.silver`. `api/_lib/rates.js` (`parseRates`, used by the WA bot via `getRates()`/`ratesForPrompt()`) had the identical bug reading the same wrong `"Silver Rate"` row into `spot.silverPerGram` — fixed the same way (2026-07-04, same-day follow-up once the user asked to also fix the bot): the `"ESTIMATED"` row now feeds `spot.silverPerGram` (the correct retail figure), and the old wholesale row is kept separately as `spot.silverSpotWholesalePerGram` (not used for quotes, reference only). Verified against a live fetch: `silverPerGram: 249.5`, `silverSpotWholesalePerGram: 237.5`.

> **⚠️ SILVER RATE SOURCE — read this before adding any new silver feature (bot, calculator, reports, anything).**
> The live rates sheet (`${APPS_SCRIPT_URL}?action=rates`) has TWO silver ₹/g-shaped numbers and they are NOT interchangeable:
> - **Retail rate** (correct, customer-facing): the row marked `row[""] === "ESTIMATED"`, sitting right after the silver coin table. ~₹249-250/g as of 2026-07-04.
> - **Wholesale/MCX spot** (do NOT quote to customers): the row under the `"Silver Rate"` section header. Noticeably lower (~₹237/g same day) — no retail markup applied.
> - **Both 999 (fine) and 92.5 (sterling/Argentium-style) silver purities bill at this SAME retail ₹/g — no purity discount.** Store policy, confirmed explicitly by the owner. Do not add a `mult`/discount multiplier for 92.5 unless told the policy changed again.
> - This exact mix-up (reading the wholesale row instead of the retail row) was made independently in both `src/App.jsx` and `api/_lib/rates.js` — it's an easy mistake because the wholesale row is right there under a header literally named "Silver Rate". If you're parsing this sheet in a new module, grep for `"ESTIMATED"` in `api/_lib/rates.js` or `src/App.jsx`'s `parseLiveRatesForCalc` to see the working pattern, and use `spot.silverPerGram` / `liveRates.silver` — never re-derive from the `"Silver Rate"` section.
2. **92.5 silver bills at the same ₹/g as 999 — no discount.** Store policy: silver ornaments (92.5) are priced at the same rate as fine (999) silver, just labeled differently on the estimate. The `mult` field tried earlier (0.925 discount) was removed from the `PURITIES` entry; `purityRatePg()` (module scope, right after `PURITIES`) still exists as the one place a future `mult`-based purity would apply a scale factor, but nothing currently uses a non-1 `mult`.
3. **Pcs (qty) belongs on jewellery, not on quotation/solitaire rows.** Reasoning: bulk orders are identical gold/silver *pieces* (e.g. 50 of the same bangle design) — that's a jewellery-tab concept. Solitaire/quotation rows are individual certified stones, which don't get a quantity multiplier.
   - Reverted from quotation tab: the `qty`/"Pcs" column, the `qty` field on `newSolRow()`, and the "Pcs" part of the toggle label (kept as "▼ Notes" — Notes stays on quotation, only Pcs moved out).
   - Added to jewellery tab: `jw.qty` (default `"1"`), a "Pcs (for bulk orders)" input next to Gross Weight. `jwCalc` now computes `perPieceTotal` (the existing per-item subtotal+GST) and `qty`, and `total = perPieceTotal * qty` — every consumer of `jwCalc.total` (results panel, save, print, Download PDF, Send Estimate PDF/caption) automatically reflects the bulk grand total with no separate wiring. When `qty > 1`, the results panel and printed/PDF/WA output show both "Per-piece Total" and "Pcs" alongside the grand total.
   - `loadEstimateForEdit` restores `jw.qty` from the saved item; "🔄 New" resets it to `"1"`.
   - Fixed the same qty-aware total in the **reprint window's "📊 New estimate — today's rate" recalc button** (`openEstimateSlipWindow`, module scope) — its inline `recalcToday()` JS previously recomputed only the per-piece subtotal and ignored quantity entirely, which would have under-quoted a re-priced bulk order by the pcs factor. Now takes a `QTY` var and multiplies correctly, plus shows the Pcs/per-piece breakdown rows.
   - **Also deleted `_openEstimateSlipOLD`**, a ~110-line fully-dead duplicate of `openEstimateSlipWindow` left over from an earlier refactor (confirmed zero call sites) that was found while fixing the recalc bug — there were two near-identical copies of the print/recalc logic and only one (`openEstimateSlipWindow`, called via the `openEstimateSlip` wrapper) was ever reachable.

---

## 22. JEWELLERY TAB — "SILVER" LABEL FIX + MAKING RATE SHOWN SEPARATELY FROM TOTAL (2026-07-04, same-day follow-up)

1. **Picking a silver purity still said "Gold Value"/"Gold Rate" everywhere.** All the jewellery-tab metal labels were hardcoded to "Gold". New module-level `metalLabel(purityIdx)` (right after `purityRatePg`, checks `/silver/i` against `PURITIES[idx].l`) now drives every one of: results panel ("Net {metal} Weight", "{metal} Value", live-rate hint), `handleJwPrint`, `jwPdfRows`/`jwCaption` (Download PDF + Send Estimate), and the **reprint window** (`openEstimateSlipWindow` + its inline `recalcToday()` — passed through as a `METAL` JS var since that code runs in the opened print window, not React). Solitaire's optional gold/silver setting got the same treatment for its one combined line (`{metal} + Making`, keyed off `it.goldPurityIdx`/`sol.goldPurityIdx`) — the rest of the solitaire tab's setting-metal labels ("Include Gold Setting", "Gold Gross Weight") were left as-is (out of scope for this pass, solitaire settings are gold in practice).
2. **Making charges now show Rate and Total as two separate lines, not one.** Previously "Making (₹/g)" showed only the computed ₹ total, with the actual per-gram (or %) rate visible only in the input form, not in print/PDF/WA. New `makingRateLabel(makingR, mode)` (next to `metalLabel`) renders `"₹1500/g"` or `"15%"`; `jwCalc` now also returns `makingR` and `makingMode` so every consumer can show both "Making Rate" and "Making Total" rows — updated in the results panel, `handleJwPrint`, `jwPdfRows`/`jwCaption`, and the reprint window/`recalcToday()`.
   - For **already-saved estimates** (before this change), `it.makingMode` won't exist — the reprint path falls back to an *effective* per-gram rate derived as `making ÷ netGold`, labeled "(effective)" so it's not confused with a rate the staff actually typed in. Estimates saved from now on persist `makingR`/`makingMode` directly (via `items = [{ ...jw, ...jwCalc }]` in `saveEstimate`), so future reprints show the exact configured rate instead of the derived one.

---

## 26. AD CAMPAIGN TRACKING — ADLEADS TAB (2026-07-13, migration 0065)

Click-to-WhatsApp ads land with a pre-filled message. This attributes them and keeps them out of the regular Demands inbox.

- **`bullion_lead_sources`** — existed only as migration `0049`, never actually run. The whole Lead Sources tab was silently non-functional until this migration ran it for real.
- **`bullion_lead_sources.wa_keyword`** (comma-separated) — matched case-insensitively against a brand-new lead's FIRST inbound message only (not every message). Staff configure this themselves in the Lead Sources tab (superadmin/admin only — not in the manager tab list) alongside a `default_funnel_id` and `enroll_drip` toggle that already existed on that table.
- **`bullion_leads.lead_source_id`** — set once at lead-creation time in `api/webhook.js`, independent of whether `create_demand` ever fires. On match: lead gets `lead_source_id` + `funnel_id` (from the source's `default_funnel_id`), and is auto-enrolled via the EXISTING `enrollLeadInDrip()` helper (`api/_lib/drip.js`) — not reimplemented.
- **`DemandsScreen`** takes a new `adOnly` prop (default `false`). Regular Demands now excludes `lead.lead_source_id != null` (same precedent as walk-in exclusion, §25). New `adleads` tab renders the exact same component with `adOnly` — zero duplicated logic, both share card grid / due-date chips / `nextStepFor` / `ConversationPane`. Campaign name shows as a purple badge on each card (`d.lead.lead_source.name`, joined via `bullion_lead_sources`).
- **Why this answers "5 campaigns + organic chat without clutter"**: each campaign auto-routes into its own funnel (isolated step/drip sequence) AND its own tab (AdLeads vs Demands vs Walk-ins) — no manual sorting needed day to day.
- Nav wiring follows the exact same 5-spot pattern as every other tab addition in this file (tabs array x2, role defaults x2, pinned tabs, screen mount) — see §24/Vendors for the reference pattern if adding another tab later.

---

## 25. DEMANDS SCREEN REDESIGN — CARD GRID + ON-TIME TRACKING (2026-07-13)

`DemandsScreen` (`src/App.jsx`, right after `demandEnquiryLine` helper) rewritten from a dense full-width stacked list to a small-card grid, per owner request to separate walk-in-client attention from demand-enquiry attention and make sure nothing due gets missed.

- **Walk-ins hard-excluded, always** — `openBase`/`closedFiltered` memos filter `d.lead?.source !== "walk_in"` unconditionally (was previously a `filterSource` toggle mixing them in by default). Walk-ins live only in the Walk-ins tab now. The `filterSource` state/selector was removed entirely from this screen.
- **`dueDateBucket(d)` / `dueDateRank(b)` / `DUE_BUCKET_META`** (module scope, right after `tempRank`) — new due-date urgency buckets (`overdue|today|week|later|none`) off `occasion_date`, promoted from what used to be dead code (`urgencyBorder`/`urgencyLabel` were computed but only `urgencyBorder` was actually wired into a card's border color; `urgencyLabel` was never rendered anywhere). These now drive BOTH the summary chip counts and `load()`'s primary sort order — due-date urgency first, `tempRank` (temperature) is the tiebreaker, not the primary key like before.
- **On-time summary strip** — clickable count chips (🔴 Overdue / 🟠 Due Today / 🟡 Due This Week / ⚪ No Date Set) above the grid. Counts come from `openBase` (before the chip's own filter), tapping a chip sets `activeDueFilter` which narrows `filtered`. This is the actual mechanism for "make sure nothing is left" — check this strip, not the raw list, to know what's slipping.
- **Card content** (exactly 4 things, matches the Calculator's "Recent Estimates" grid pattern — `repeat(auto-fill, minmax(240px, 1fr))`): client name + due-bucket pill, temperature pill, `demandEnquiryLine(d)` (description → else summarizes `enquiry_items[0]` + "+N more" → else `product_category`), "Due: {occasion} · {date}" or "No Date Set", and `nextStepFor(d)`'s label as the action button — **do not re-derive any of this logic, all four reuse existing module-scope functions** (`demandTemperature`, `nextStepFor`, `demandEnquiryLine`).
- **Manager bulk-select/reassign moved behind a new "⋯ Manage" toggle** (`manageMode` state, manager+ only via existing `isManagerPlus`), off by default — still fully functional, just not part of the everyday view. Closed/Converted section behavior unchanged (still collapsed by default via `showClosed`).
- Clicking a card still opens the exact same `ConversationPane` (call log, WA history, notes, close/reassign, more-menu) as before — no change to that flow, just reached from a card instead of a list row.
- `Card` component (`src/App.jsx` ~407) now forwards `onClick`/`...rest` — needed to make the new cards clickable. Backward compatible; existing `Card` usages elsewhere (e.g. `VendorsScreen`) only ever passed `children`/`style` so nothing else changes behavior.

---

## 24. VENDOR MANAGEMENT (2026-07-11)

Scan supplier business cards → auto-fill contact details via AI vision → tag "deals in" categories → record item-wise making charges → later search "who supplies X" when sourcing.

- **Tables:** `bullion_vendors` (one row per company — contact info, payment terms, card photo), `bullion_vendor_dealings` (join to `catalogue_item_types` — reuses the EXISTING product catalogue taxonomy, no separate vendor-category dropdown), `bullion_vendor_items` (item-wise making charges, `item_type_id` nullable so a charge can be recorded before formal categorization). Migration `0061_vendor_management.sql` — **must be run in Supabase before deploy** (see MIGRATION STATUS table).
- **Storage:** card photos in the `media` bucket under `uploads/vendors/%`, RLS policies added in the same migration. Upload via existing `secureImageUpload(file, sb, "vendors", opts)` — no new upload code.
- **Screen:** `VendorsScreen` (`src/App.jsx`, right before `CatalogueScreen`) — two modes: "📇 Directory" (add/edit/browse, filter by category/payment terms/search) and "🔎 Find Supplier" (sourcing search — filter by category and/or item name, results sorted cheapest-first, tap-to-call). Nav tab `vendors` registered for `manager`/`staff`/`admin`/`superadmin` (not `telecaller` — back-office task), pinned by default alongside `catalogue`.
- **Card scan:** `api/vendor-card-scan.js` — reuses the existing OpenAI wrapper (`askAI`/`parseBotJson` from `api/_lib/ai.js`), no new AI service. Camera-capture input follows the exact pattern already used for estimate item photos (`<input type="file" accept="image/*" capture="environment">`). AI-extracted fields only fill blank form fields — never overwrite what the user already typed. This is a human-confirms step, not silent auto-save.
- **Payment terms are vendor-level only** (no per-item override) — a vendor quotes one set of terms (advance/on_approval/credit/cod/other), not per item.
- **Category linkage:** deliberately reuses `catalogue_item_types` (the finished-product collection taxonomy already managed in the Catalogue tab) instead of a new dropdown list — so there's one taxonomy to maintain, and "who supplies Rings" can search across both the product catalogue and the vendor directory consistently. `bullion_vendor_dealings`/`bullion_vendor_items` sync on save via delete-then-insert (simplest correct approach at this scale — a handful of categories/items per vendor).

**v2 additions (2026-07-11, same-day follow-up, migration `0062_vendor_management_v2.sql`):**
- `contacts` jsonb array replaces the old singular `contact_person`/`phone`/`alt_phone`/`designation` columns — a card can list multiple people. `card_image_url` renamed `card_image_front_url` + added `card_image_back_url` — 2-sided card capture, both sides sent to AI vision together when both are present. `exhibition_name` is now independent of `source` (always editable, not gated on `source==="exhibition"`) — a card scanned AT an exhibition still has `source:"card_scan"`.
- **Offline-first capture:** `VendorsScreen` module scope has a small hand-rolled IndexedDB queue (`ssj_vendor_offline` DB, no library) — `idbPutDraft`/`idbGetAllDrafts`/`idbDeleteDraft`. If `saveVendor()` (new-vendor path only, not edits) fails or `navigator.onLine` is false, the ENTIRE draft (typed fields + dealingIds + itemRows + raw front/back photo Blobs if those never made it to Supabase Storage either) queues locally instead of erroring. Auto-syncs on the `online` event, every 60s while `VendorsScreen` is mounted, and once on mount — `syncDrafts()` uploads any queued blobs, runs AI card extraction if it hasn't yet (`draft.aiAttempted`), then calls the same `persistNewVendor()` insert path used by the live save, deleting the draft only on full success (left queued + retried next pass on any failure). A "📴 N pending sync" pill in the header shows count + lets staff force a retry. This exists specifically because exhibitions routinely have no signal — see conversation 2026-07-11.
- `mergeCardFields()`/`persistNewVendor()` are shared module-level functions (not component-local) precisely so the live-scan path and the offline-sync path can't drift out of sync with each other or with schema changes.
- **`custom_fields`** jsonb (`[{label, value}]`) — deliberately NOT a form-builder (field types, admin-configurable schema). A full form-builder was explicitly considered and rejected as over-engineering for this scale; this is the intentional lightweight alternative.
- **`catalogue_item_types.customer_visible`** (boolean, default `true`) — added because vendor categories aren't always jewellery product lines (packaging, equipment, cleaning chemicals, etc.), and `catalogue_item_types` doubles as the CUSTOMER-FACING product taxonomy on shared catalogue links. `VendorsScreen`'s inline "+ New Category / Subcategory" quick-add defaults new categories to `customer_visible:false` (checkbox to opt in). `CatalogueScreen.loadTaxonomy` and `CalculatorScreen`'s catalogue-linking item-type fetch both filter `.eq("customer_visible", true)` — `VendorsScreen`'s own itemTypes fetch stays unfiltered (vendors need to see every category, service ones included). Confirmed via `api/catalogue.js` read: customers only ever see a category name attached to a specific shared *product*, never a raw browsable category list — so the actual risk was internal admin clutter, not a customer-facing leak, but the flag is cheap insurance either way.

**v3: `vendor_kind` (2026-07-12, migration `0063_vendor_kind.sql`):** `bullion_vendors.vendor_kind` text CHECK `jewellery|service|other`, default `jewellery`. Coarse top-level classification, separate from the detailed `bullion_vendor_dealings` category tags — lets staff filter the Directory to "just service/supply vendors" without tagging every category. Set by `api/vendor-card-scan.js`'s AI extraction as one extra JSON key in the SAME scan call (negligible added tokens — the AI already reads the whole card for company_name/contacts/etc), merged in via `mergeCardFields()` using an "still at default" check (not a blank check, since the field always has a value) so a manual pre-scan pick isn't clobbered. Editable via a dropdown in the vendor form regardless — AI classification is a starting guess, not a lock.

**v4 bug-fix pass (2026-07-14) — real case: same card scanned by owner + staff at same visit produced two permanent "Lalit Gems" rows, one of them missing a second contact and with a truncated address:**
- **Offline-sync had NO duplicate check at all** — `duplicateWarning` (the phone/company-name match banner) only ran while the live Add/Edit form was open; `syncDrafts()` called `persistNewVendor()` directly with zero dedupe. Fixed by extracting the match logic into module-level `findDuplicateVendorMatch(vendorList, form, excludeId)` and the merge-writes into module-level `mergeFormIntoVendor(tid, target, form, dealingIds, itemRows, deactivateVendorId)` — both the live "Merge into existing" button and `syncDrafts()` now share the same functions, so an offline draft that matches an existing vendor gets folded in instead of inserted as a new row. `syncDrafts` now depends on `vendors` (previously omitted from its `useCallback` deps) so the match check sees the current list, not a stale one from first mount.
- **`api/vendor-card-scan.js` was sending card photos at `detail: "low"`** to the vision model — that downsamples to ~512px before the model sees anything, which is almost certainly why a second (smaller-print) contact and full address lines were getting missed/truncated. Changed to `detail: "high"`. Prompt also now explicitly instructs the model to scan the entire image for multiple name+phone pairs (not just the most prominent one) and to capture the complete address (street/area/landmark/city/state/PIN), not just a city fragment.
- **Card photo previews enlarged** (40px → 90px) and made click-to-open-full-size (`window.open` on the Storage URL) in the Add/Edit modal — previously the only place to review a scanned card later was a barely-visible thumbnail.
- **WhatsApp messaging added:** a 💬 wa.me link next to every contact's phone (Directory card's primary contact, and every contact row in the edit modal) opens a WA chat with that number directly, no `tel:`-only limitation. A "📤 Send" button next to each card photo (front/back) prompts for a number and sends the actual image via WhatsApp using the existing `/api/send-media` endpoint (`mediaType:"image"`) — same wa-service path already used for estimate PDFs, just reused for an already-hosted image URL (no re-upload needed). New shared function: `sendVendorCardOnWA({ phone, mediaUrl, caption })`.
- Note: the two pre-existing "Lalit Gems" duplicate rows from before this fix were NOT auto-merged (a data mutation on two real production rows isn't something to do silently) — use the Directory's own "Merge into existing" UI to fold them together, which now works correctly for this fix going forward too.
- Directory card's click-to-open-edit handler (`<div onClick={() => openEdit(v)}>`) was code-reviewed for the "clicking a card did nothing" report — wiring is correct and `openEdit`/the edit Modal show no crash risk for any vendor row shape (confirmed against the actual duplicate rows' data). No root cause found in code; if it recurs, it's likely worth a screen-recording since it wasn't reproducible from a static read.

---

## 23. GOLDMENU / DIAMONDMENU STATIC PAGES — DO NOT TOUCH (2026-07-11)

**PROTECTED — owner explicitly asked these must never go down again, regardless of unrelated app changes.**

- Live at `ssjbot.gemtre.in/goldmenu` and `ssjbot.gemtre.in/diamondmenu` (also reachable at the literal `.html` paths).
- Files: `public/goldmenu.html`, `public/diamondmenu.html` — fully self-contained static HTML (no build step, no React, no API calls), plus their images/PDFs in `public/menus/` (`gold.jpg`, `gold.pdf`, `diamond-food.jpg`, `diamond-drinks.jpg`, `diamond.pdf`).
- Routing: `vercel.json` → `rewrites` has two explicit entries (`/goldmenu` → `/goldmenu.html`, `/diamondmenu` → `/diamondmenu.html`) placed **before** the catch-all SPA rewrite (`"/(.*)" → "/"`). The catch-all only rewrites extension-less paths that Vercel's static lookup didn't already resolve — without these two explicit entries ahead of it, the bare URLs 404 into the CRM shell (this exact bug happened once already — see git history around 2026-07-11).
- **History**: these pages were built 2026-07-02 but only ever existed in an uncommitted `git stash` — never actually deployed until 2026-07-11, when they were recovered and committed for real, and the routing bug above was fixed at the same time.
- **Rule going forward**: any change to `vercel.json`'s `rewrites` array MUST keep these two entries ahead of the catch-all. Do not delete, rename, or move `public/goldmenu.html` / `public/diamondmenu.html` / `public/menus/*` without the owner explicitly asking for it — these are static assets, not app logic, they have zero reason to be touched by unrelated CRM feature work.

---

## 24. SOLITAIRE JEWELLERY DESIGNER — `/solitairejewellery` (2026-07-23)

**Status: built, migrations 0081–0088 applied via `supabase db query` (CLI push wouldn't run cleanly — see note below). Not yet populated with approved variants.**

- Public route `/solitairejewellery` (same pattern as `/corporategiftingcoins`: early-return in `App()` before the auth gate, `vercel.json`'s catch-all already covers it, no new rewrite entry needed). Lead-capture popup for anonymous visitors; skipped when a staff/associate session (`loadUser()`) already exists.
- **Visual theme deliberately matches `CATALOGUE_FONTS_CSS`** (the corporate-gifting/public-catalogue "Luxury Serif" theme in `App.jsx`): Cormorant + Montserrat, gold accent `#CA8A04`, forced white background (no dark-mode variant — Saurav asked for white only, unlike the catalogue page which does support dark mode).
- New standalone file `src/SolitaireJewellery.jsx` (NOT folded into `App.jsx`) — exports `SolitaireJewelleryScreen` (public flow) and `SolitaireAdminGenerator` (staff-only AI design tool, mounted as the `solitairedesigns` tab, superadmin/admin/manager only).
- Pricing logic lives in `src/utils/solitairePricing.js` — an independent copy of `App.jsx`'s Rapaport lookup constants/`rapLookup()` (not a refactor of the Calculator, to avoid touching stable code), plus new lab-grown/gold-purity math.
- Four categories: `ring`, `gents_ring`, `pendant`, `earring` — 25 seeded design concepts each (100 total; gents_ring category + CHECK constraint added in migration `0086`, seeded in `0088`).
- Tables: `solitaire_designs`, `solitaire_design_variants` (AI-generated image sets per design × gold-colour × shape — gates client-facing pricing; a combo with no `approved` variant shows no price; `reference_image_url`/`prompt_override` columns added in `0087` for traceability), `solitaire_labgrown_prices` (admin-editable ₹/ct grid, seeded with 0 — **must be filled in from the admin screen before go-live**), `solitaire_design_selections`.
- **Admin generator (`SolitaireAdminGenerator`) fetches `action=admin-designs`, NOT `action=designs`** — the latter is approved-variants-only (correct for the public page) which was the actual cause of the "generate button looks broken" report: a freshly generated variant never appeared in the review grid because it was filtered out as not-yet-approved. `admin-designs` is staff-only (`x-crm-secret`) and returns every variant status.
- Admin can now: write/override the generation prompt per variant (`promptOverride`, sent to `generate-variant`), attach an optional reference image (converted to base64 client-side, `api/_lib/solitaireImageGen.js` switches from `images/generations` to `images/edits` with that reference when present, same OpenAI pattern as `imageGen.js`'s corporate-gifting box reference).
- **Auto-cascade**: approving the FIRST variant for a design triggers `cascadeRemaining()` in `SolitaireAdminGenerator`, which sequentially generates + auto-approves every other gold-colour × shape combo for that design (3 gold colours × 10 `DIAMOND_SHAPES` = up to 29 more generations, each 3 images) using the just-approved variant's `est_gold_weight_g` as the starting estimate. This is expensive (up to ~90 OpenAI image calls per design) — client-side sequential loop with a visible progress counter, not a single backend call, to stay clear of the 60s function timeout.
- USD/INR rate is now LIVE, not admin-set — `api/_lib/rates.js`'s `parseRates()` reads it from the same sheet cell the Calculator tab already parses client-side (`parseLiveRatesForCalc`'s "USD" label in col C, value in the next row), returned as `rates.usdInr` from `action=rates`. The earlier admin-editable `bullion_dropdowns` override (`action=config`/`update-config`) was removed as redundant.
- Try-on uses `face-api.js` (new dependency) loaded client-side with models fetched from a public CDN (`cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js`) — no new backend, degrades to plain photo capture if face detection fails to load.
- **Migration note**: `supabase db push` refused to run cleanly because of a pre-existing, unrelated ordering issue with two `0012_*.sql` files (one never marked applied on remote). Rather than force `--include-all` and risk re-running an old unrelated migration, each new solitaire migration was applied individually via `supabase db query --linked -f <file>`. If more migrations are added later, prefer the same targeted approach over a blind `db push --include-all` until that `0012` history issue is investigated separately.
- **Before this is usable**: generate + approve at least one variant per design via the `solitairedesigns` admin tab (the cascade will fill in the rest of that design's combos automatically), and fill in the lab-grown price grid (currently seeded at ₹0/ct for every carat size).

---

## 27. CLIENT + ASSOCIATE PLATFORM FOR SSJ.IN (2026-07-30, migrations 0094–0095)

**Status: all 6 phases built and deployed. Full detail + pending review items live in `ssj-website` repo's own `SSJ_WEBSITE_FEATURES.md` — this entry is a pointer, not a duplicate.**

- Public client site (`ssj-website`, ssj.in) gained: WhatsApp-OTP client login (`/account`), live rates + daily-rate subscribe + price alerts (`/rates`), a "Sun Sea Brand Associate" referral/affiliate program (`/become-associate`, `/associate`), a floating AI chatbot (FAQ-grounded on the existing `bullion_faqs` table + OpenAI), and a Kitty Scheme interest placeholder (`/kitty-scheme`).
- New tables in THIS repo's Supabase project (shared with ssj-website): `bullion_associates`, `bullion_referral_visits`, `bullion_commissions`, `bullion_price_alerts`, `bullion_otp_codes` (migration `0094`); `associate_recruitment` funnel + steps, seeded **inactive** pending copy review (migration `0095`).
- New API files: `client-auth.js`, `rates.js`, `price-alerts.js`, `associates.js`, `chatbot.js`, `kitty-interest.js`, `_lib/clientAuth.js`, `_lib/referralAttribution.js`. All CORS-open (`Access-Control-Allow-Origin: *`) since ssj-website calls them cross-origin, same pattern as `bridal-lead.js`.
- New CRM tab: **Client Platform** (`src/ClientPlatformAdminScreen.jsx`) — Clients / New Signups / Associates (approve applicants) / Kitty Interest / Rate Subscribers & Alerts.
- `api/cron.js` gained step 0c: checks active `bullion_price_alerts` every tick against live rates, fires a one-time WA message on cross.
- **Before fully live**: review the associate-recruitment WA nurture copy (migration `0095`, currently `active: false`) and flip it on; decide on the daily-rate Google Sheet integration (currently CRM-tag-only); everything else is functional as shipped. Full "needs your review" list is in ssj-website's `SSJ_WEBSITE_FEATURES.md`.

---

## 28. HOLIDAY CALENDAR + LEAVE-AWARE CHECKLIST REMINDERS (2026-09-03)

**Status: built and deployed. `holidays` table migration lives in the `ssj-hr` repo, applied live via `supabase db query` (CLI `db push` is blocked repo-wide by an out-of-sync migration history — see note below).**

- `api/_lib/holidays.js`: `isHolidayToday()` (checks the `holidays` table, owned/managed from `ssj-hr`'s Holidays panel) and `staffOnLeaveToday()` (checks `leaves.status='Approved'` rows covering today, same table ssj-hr's Leave Management screen already writes).
- Wired into all three staff checklist/task reminder crons — `morning-due-today-push.js`, `evening-completion-reminder.js`, `staff-task-reminders.js` — each now skips the whole run on a declared holiday, and skips individual staff who are on approved leave that day.
- `holidays` table (defined + applied from the `ssj-hr` repo's migrations, not this one — see that repo's `SSJ_STABLE_FEATURES.md` §Holidays) has a one-click "Add yearly calendar" seeding Republic Day/Independence Day/Gandhi Jayanti (fixed) + Holi/Raksha Bandhan/Dussehra/Diwali (looked-up actual dates, 2026–2030) from the Holidays panel.
- **Migration tooling note**: `supabase db push` fails across this project with "Remote migration versions not found in local migrations directory" — the tracked migration history and the actual DB have drifted out of sync (long predates today's work). Rather than run the suggested `migration repair` across 90+ versions blind, new one-off SQL is now applied directly with `supabase db query --linked --file <path>` (or `--linked "<sql>"` for one-liners), bypassing the migration-history table entirely. Keep doing this until the drift is deliberately investigated and fixed — do not attempt a blind `db push --include-all`.

## 29. KITTY — BULK MONTHLY RATE BACKFILL FOR RATE-LOCK SCHEMES (2026-09-03)

- Kitty Admin → Enrollments tab → pick a scheme → a "Rate month" field (independent of the Export-month picker, any past month works) + **"💰 Set [month] rate for this kitty"** button. Applies one ₹/g rate to every already-`paid` installment of that scheme in the chosen month in one shot — built for Golden Sparkle (rate-lock-day scheme) where staff were re-typing the same day's booked rate per person per payment.
- Backend: `api/kitty.js` `action=set-monthly-rate` (POST, `x-crm-secret`). Individual per-installment correction still goes through the existing `update-installment` action, unchanged.

## 30. SWARN SURAKSHA — ONLINE GOLD-SAVINGS SCHEME VIA RAZORPAY (2026-09-03, migrations 0110–0111)

**Status: DB + backend + ssj.in client page all built and deployed. Not yet usable for real money — blocked on the Razorpay merchant account (proprietor confirmed, no company-entity deposit-rule blocker, but Prize Chits Act / SEBI / hallmarking / GST still apply regardless — see conversation history / memory, not re-litigated here). Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Vercel env once the account exists — every payment action fails cleanly with `razorpay_not_configured` until then, nothing here can move real money yet.**

- New scheme row in `kitty_schemes` (slug `swarn-suraksha`, grams-based, `perks.daily_gram_cap_g=10`, `perks.max_duration_months=11`, `perks.redemption="in_store_only"`). Reuses the existing `kitty_enrollments`/`kitty_installments` tables generically — no new tables, only new columns.
- Clients (logged into `ssj.in` via WA-OTP) buy gold at that day's live rate anytime, one-time via Razorpay Checkout — server-enforced 10g/client/day cap (checked at quote time AND again server-side before the order is created; a webhook-side race guard also flags same-day double-booking over the cap to `OWNER_ALERT_PHONE` for manual review since a captured payment can't be un-charged).
- Auto-debit subscription: client picks **daily, weekly, every 15 days, or monthly**, and their own amount (min ₹100, no forced ₹5,000-multiple like the older fixed-monthly schemes) — one active mandate at a time, cancel anytime. Razorpay has no native fortnightly period; that cadence is built as `period=daily, interval=15`.
- 11-month RBI-style freeze: `api/kitty-cron.js` daily sweep proactively freezes (`frozen_at` set, `status='completed'`, `claim_status='unclaimed'`) any enrollment past its 11-month window and WA-nudges the client to redeem **in-store only** — no online redemption flow exists or is planned. Any payment (top-up or subscription charge) that still lands after freeze auto-opens a fresh enrollment cycle for the same client (`api/_lib/swarnSuraksha.js`'s `ensureUnfrozenEnrollment()`), so a stray late charge never gets stranded on a dead enrollment.
- New files: `api/_lib/razorpay.js` (thin REST wrapper, no SDK — orders/customers/plans/subscriptions/webhook-signature-verify), `api/_lib/swarnSuraksha.js` (shared daily-cap + freeze/rollover logic, used identically by both the client API and the webhook so they can't drift), `api/kitty-payment.js` (client-session-gated: enroll/quote/create-topup-order/create-subscription/cancel-subscription — every amount re-derived server-side, never trusted from the client), `api/razorpay-webhook.js` (HMAC-verified `payment.captured` / `subscription.charged` handling, idempotent via a unique index on `razorpay_payment_id`, `bodyParser` disabled to verify against the exact raw bytes Razorpay signed).
- `ssj-website` repo: new `/swarn-suraksha` page (self-serve buy/subscribe UI, login-gated) — see that repo's `SSJ_WEBSITE_FEATURES.md` for detail, not duplicated here.
- **Before this is usable**: (1) Razorpay merchant account + the 3 env vars above; (2) confirm Bliss/Bloom's separate lucky-draw legal exposure with a CA/lawyer is out of scope for this entry but was flagged in conversation the same day.

---
