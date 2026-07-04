# SSJ Stable Features — Do Not Break
**App:** ssjbot.gemtre.in · Supabase + Vercel + React/Vite  
**Last updated:** 2026-07-02  
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

## 21. CALCULATOR — 92.5 SILVER, QUOTATION PCS/NOTES FOR BULK ORDERS (2026-07-04, same-day follow-up)

1. **92.5 (sterling) silver purity added alongside 999.** `PURITIES` now has two silver entries sharing `rateKey: "silver"` — `{ l: "Silver (999)" }` (full rate) and `{ l: "Silver (92.5%)", mult: 0.925 }`. New optional `mult` field on `PURITIES` entries scales the live rate for purities that are quoted off a shared base rate. `purityRatePg(purityIdx, liveRates)` (module scope, right after `PURITIES`) is the one place that applies `mult` — every rate lookup that used to do `liveRates[PURITIES[idx]?.rateKey]` directly (jewellery `getGoldRatePg`, the live-rate hints/placeholders in both jewellery and solitaire gold-setting forms, and the two `todayRate` calcs in `openEstimateSlipWindow`/print) now goes through `purityRatePg` instead, so 92.5 silver (and any future `mult`-based purity) is correct everywhere without per-call arithmetic. Existing gold purities are unaffected (`mult` defaults to `1` — the sheet's g22/g18/etc. rates are already purity-adjusted, unlike silver which the sheet only quotes at fine/999).
2. **Quotation tab: Pcs + Notes for bulk-manufacture items.** `newSolRow()` now includes `qty: "1"` alongside the existing `notes` field (was already in the row shape but never surfaced in the quotation UI). Both are **hidden by default** behind a "▼ Pcs / Notes (bulk orders)" toggle (`quotShowExtra` state, same collapse pattern as jewellery's `jwShowMisc`/"▼ Extra Weights") — keeps the table uncluttered for ordinary single-stone quotes, expand only when quoting a bulk manufacturing order.
   - Printed quotation (`handleQuotPrint`) always includes Pcs + a notes sub-row (small, italic-gray, full width) per item when `notes` is set, regardless of whether the on-screen toggle is open — the toggle only affects the editing table, not the output.
   - Download PDF and the WA send caption also always include qty (as `× N pcs` when > 1) and notes (as an indented `📝` line) per item, same reasoning.

---
