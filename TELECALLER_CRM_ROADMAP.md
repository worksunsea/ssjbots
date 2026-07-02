# SSJ Jew CRM — Telecaller System Roadmap
**Project:** ssjbot.gemtre.in · Same Supabase DB · Same Vercel deployment · Same React/Vite frontend  
**Last updated:** 2026-05-01  
**Super Admin:** Saurav, Sun Sea Jewellers, Karol Bagh

---

## 1. STACK (do not change)

| Layer | Tech |
|-------|------|
| Frontend | React + Vite — single file `src/App.jsx` (~6100 lines) |
| Backend | Vercel serverless functions — `api/*.js` (ES module `import/export`) |
| Database | Supabase (PostgreSQL) — all tables prefixed `bullion_*` |
| WA messaging | Baileys service on Synology NAS — accessed via `/api/wa-proxy` |
| Config store | `bullion_dropdowns` table — cadence offsets, scripts, dispositions (no deploy needed to change) |
| Auth | Staff table + `app_permissions` JSONB for role-based access. Plus (2026-07-02): `staff.active` deactivation flag, 15-day forced reauth (superadmin exempt), office-TOTP new-device gate — see `SSJ_STABLE_FEATURES.md` §19 |
| Tenant | `a1b2c3d4-0000-0000-0000-000000000001` (SSJ default) |

---

## 2. CORE DESIGN — 16-STATE LEAD MACHINE

Every lead moves through these states. The telecaller system primarily handles the first 9.

```
NEW → ATTEMPTING → CONTACTED → INTERESTED → PRODUCT_SHARED → QUOTED
  → NEGOTIATION → VISIT_SCHEDULED → VISITED_NO_BUY → CONVERTED
  → NURTURE_WARM → NURTURE_COLD → LOST → JUNK → DNC → DEAD
```

**Temperature buckets** (computed by `demandTemperature()` in App.jsx):
- `hot` — call overdue ≤36h, or visit today, or brand new (<1h), or handoff status
- `warm` — active conversation <24h, or visit within 7 days
- `cold` — silent >24h, or no reply
- `converted` / `dead` — terminal

---

## 3. PRIORITY SCORE FORMULA

Used to sort the telecaller's call queue. Stored in `bullion_demands.priority_score`, recomputed on every call log and on demand creation.

```
score = (temperature_weight × 40)
      + (days_overdue × 15, capped at 45)
      + (is_callback_promised × 50)
      + source_weight
      − (attempt_number × 5, capped at 25)
```

**Temperature weights:** hot=40, warm=20, cold=5  
**Source weights:** online_google=15, online_instagram=15, referral=12, walkin=10, exhibition=10, old_client=8, other=5  
**Callback bonus:** +50 (highest urgency — customer asked to be called at a specific time)

---

## 4. CALL CADENCE ENGINE

6 attempts per demand. Offsets stored in `bullion_dropdowns` (field=`telecaller_cadence_minutes`).  
Default offsets (minutes from previous attempt): `[5, 120, 1320, 3960, 6480, 9720]`

| Disposition | What happens |
|------------|--------------|
| `answered_interested` | Advance to next funnel step (bot resumes messaging) |
| `answered_not_now` | Schedule callback at time telecaller sets; stay on call step |
| `callback_requested` | Same as above; `is_callback_promised = true` (+50 priority) |
| `answered_not_interested` | Transition to `funnel.next_on_not_interested` |
| `no_answer` / `voicemail_left` | Schedule next attempt per cadence offset |
| `busy` | Retry in 15 min; **does NOT count** toward 6-attempt budget |
| `wrong_number` | Outcome=lost; lead→dead |
| `dnc` | Outcome=lost; lead→dead; `dnd=true` |
| Attempt 6 with no answer | Auto-transition to `cold_revive` funnel |

---

## 5. LAG & TALK TRACKING

Captured in `bullion_call_logs` on every call.

**Call lag** = time between `demand.next_call_at` (when call was *due*) and `opened_at` (when telecaller *opened* the modal):

| Bucket | Lag |
|--------|-----|
| `INSTANT` | < 5 min |
| `FAST` | 5–30 min |
| `SLOW` | 30 min – 2 h |
| `DELAYED` | 2 h – 24 h |
| `MISSED` | > 24 h |

**Talk time** = `completed_at − opened_at` (auto-calculated by frontend timer):

| Bucket | Duration |
|--------|---------|
| `GHOST` | < 10 sec — probably didn't connect |
| `SHORT` | 10–60 sec |
| `NORMAL` | 1–5 min |
| `LONG` | > 5 min |

**Suspicious flag:** `is_suspicious = true` when disposition is an "answered" type but `duration_sec < 8`. Signals fake call logging.

---

## 6. ASSIGNMENT — LOAD-BALANCED ROUND-ROBIN

File: `api/_lib/assign.js`

Who is a telecaller: `role='telecaller'` OR `app_permissions` JSONB contains `"telecaller"` in any array value.

**Algorithm:**
1. Count open demands (`outcome IS NULL`) per telecaller
2. Find minimum load
3. Among tied candidates → pick next after `bullion_telecaller_rotation.last_staff_id`
4. Write `assigned_staff_id` + `assigned_to` on demand
5. Update rotation pointer

This replaced the old pure round-robin which ignored load.

---

## 7. STRUCTURED LOST REASONS

When clicking ❌ Lost, a modal now appears before closing the demand. Reasons stored in `bullion_demands.lost_reason`:

| Code | Meaning |
|------|---------|
| `LOST_PRICE` | Price too high |
| `LOST_TIMING` | Bad timing / not ready |
| `LOST_COMPETITOR` | Went to competitor |
| `LOST_NOT_INTERESTED` | Not interested at all |
| `LOST_BUDGET` | Budget too low |
| `LOST_NO_SHOW` | No show / ghosted |
| `LOST_JUNK` | Junk / wrong number |

---

## 8. CRM SOURCE FIELD

`bullion_demands.crm_source` — how the customer found SSJ. Added to DemandEntryModal.  
Values: `online_google`, `online_instagram`, `online_other`, `walkin`, `referral`, `old_client`, `exhibition`, `broadcast`, `other`

Used in priority scoring (source weight) and analytics.

---

## 9. TELECALLER QUEUE SCREEN

New tab: **📞 My Queue** — mobile-first, one-card-at-a-time view.

- Fetches from `GET /api/demand-queue?staffId=<id>` — only this telecaller's demands, only call-step, only due now
- Sorted by `priority_score DESC` then `next_call_at ASC`
- Shows: lead name + phone, temperature badge, priority score bar, attempt #, next-due label, description, budget, occasion
- "📝 Log Call" opens LogCallModal — after saving, auto-advances to next card
- "Skip →" to move to next without calling
- Telecallers auto-land on this tab on login

**Role routing:**
- `telecaller` role OR `app_permissions` containing `"telecaller"` → default screen = `queue`, default tabs = `["queue", "demands"]`
- Everyone else → unchanged

---

## 10. LOG CALL MODAL — CHANGES

- **Before:** Telecaller manually typed duration in seconds
- **After:** `openedAtRef = useRef(Date.now())` captures mount timestamp; live `⏱ 0:00` timer shown; duration auto-calculated on submit as `(Date.now() - openedAt) / 1000`
- `openedAt` ISO string sent to `/api/log-call` for lag calculation on the server

---

## 11. FUNNELS REQUIRED BY THE SYSTEM

These three funnels must exist. Migration 0027 creates them if missing (inheriting `wa_number` from an existing funnel):

| Funnel ID | Purpose | `next_on_lost` | `next_on_not_interested` |
|-----------|---------|----------------|--------------------------|
| `hot_followup` | Intensive follow-up for hot leads | `cold_revive` | `nurture_warm` |
| `cold_revive` | 12-touch WA sequence for cold leads (no calls) | `dead_archive` | `dead_archive` |
| `nurture_warm` | 8-touch WA sequence for warm not-ready leads | `cold_revive` | `cold_revive` |

You also need `dead_archive` funnel or just point lost/cold leads to a terminal state in your funnels UI.

---

## 12. ALL FILES CHANGED

### New files
```
supabase/migrations/0027_telecaller_enhancements.sql
api/demand-queue.js
```

### Modified files
```
api/log-call.js          — lag tracking, talk buckets, suspicious flag, priority recalc, is_callback_promised
api/demand-outcome.js    — accepts + stores lost_reason
api/_lib/assign.js       — load-balanced assignment (replaces pure round-robin)
api/demand.js            — stores crm_source, sets initial priority_score on creation
src/App.jsx              — LogCallModal timer, LostReasonModal, TelecallerQueueScreen, crm_source field, queue tab
```

### Migration summary (0027)
New columns on `bullion_call_logs`:
- `opened_at` timestamptz
- `lag_minutes` numeric(8,2)
- `lag_bucket` text CHECK IN ('INSTANT','FAST','SLOW','DELAYED','MISSED')
- `talk_bucket` text CHECK IN ('GHOST','SHORT','NORMAL','LONG')
- `is_first_call` boolean default false
- `is_suspicious` boolean default false

New columns on `bullion_demands`:
- `crm_source` text CHECK IN ('online_google','online_instagram','online_other','walkin','referral','old_client','exhibition','broadcast','other')
- `lost_reason` text CHECK IN ('LOST_PRICE','LOST_TIMING','LOST_COMPETITOR','LOST_NOT_INTERESTED','LOST_BUDGET','LOST_NO_SHOW','LOST_JUNK','LOST_WRONG_NUMBER')
- `priority_score` integer default 0
- `is_callback_promised` boolean default false

New indexes:
- `idx_demands_queue` ON bullion_demands(assigned_staff_id, outcome, priority_score DESC) WHERE outcome IS NULL
- `idx_demands_callback_promised` ON bullion_demands(is_callback_promised, next_call_at) WHERE is_callback_promised = true AND outcome IS NULL

---

## 13. WHAT WAS ALREADY BUILT (DO NOT TOUCH)

These were already working before this session:

| Feature | File |
|---------|------|
| Call cadence engine (6 attempts, busy retry) | `api/log-call.js` |
| Funnel transitions on outcomes | `api/_lib/drip.js` → `transitionLeadToFunnel()` |
| Round-robin rotation table | `bullion_telecaller_rotation` |
| Demand creation + AI opening message | `api/demand.js` |
| All 9 dispositions + scripts + objections in LogCallModal | `src/App.jsx` |
| Conditional callback datetime picker | `src/App.jsx` (LogCallModal) |
| Call logs table | `bullion_call_logs` |
| demandTemperature() function | `src/App.jsx` |
| ConversationPane with outcome buttons | `src/App.jsx` |
| Walk-in entry modal | `src/App.jsx` |
| Reassign telecaller UI | `src/App.jsx` |
| app_permissions JSONB role-based tabs | `src/App.jsx` |
| SSO via postMessage (fms.gemtre.in iframe) | `src/App.jsx` |
| Baileys WA proxy | `api/wa-proxy.js` |

---

## 14. PENDING / NEXT STEPS

### High priority
- [ ] **Analytics tab for managers** — call lag heatmap by telecaller (INSTANT vs MISSED), talk_bucket distribution, suspicious call flag report, conversion by crm_source, calls per day per telecaller
- [ ] **Manager dashboard** — live queue depth per telecaller, overdue calls count, today's calls count
- [ ] **`dead_archive` funnel** — create it in Funnels UI or migration so cold_revive/hot_followup have a valid terminal target
- [ ] **Priority score display on DemandsScreen** — show score badge on demand cards in the main list view

### Medium priority
- [ ] **Callback promised alerts** — when `is_callback_promised=true` and `next_call_at` is now, surface it prominently in TelecallerQueueScreen with a distinct visual (red card border, sound/vibration on mobile)
- [ ] **Visit confirmation call step** — add `VISIT_CONFIRM` task type: 1 day before visit, auto-create a call task assigned to the telecaller for that lead
- [ ] **Post-sale follow-up** — after `CONVERTED`, auto-create a `POST_SALE` call task 7 days later for feedback + referral ask
- [ ] **crm_source on demand cards** — show source pill on DemandsScreen demand cards (already saved to DB, just not displayed)
- [ ] **Bulk reassign** — manager can select multiple demands and reassign them all to a different telecaller

### Low priority
- [ ] **Whisper notes** — manager can leave a private note on a demand visible only to the assigned telecaller (not in conversation history)
- [ ] **Script A/B tracking** — track which script version (S1/S2/S3) led to `answered_interested` more often
- [ ] **Export** — download call logs as CSV for payroll/performance review

---

## 15. DEPLOY CHECKLIST

Every time you push changes:

1. **Run migration first** — Supabase Dashboard → SQL Editor → paste the migration SQL → Run
2. **Git push** — Vercel auto-deploys on push to main
   ```bash
   cd /Users/sg/ssjbots
   git add -A
   git commit -m "your message"
   git push
   ```
3. **Verify** — open ssjbot.gemtre.in, login as a telecaller, check the 📞 My Queue tab appears

---

## 16. HANDOFF CONTEXT FOR CLAUDE CODE

If continuing in Claude Code terminal, paste this at the start:

> "I'm working on `/Users/sg/ssjbots` — a Vercel serverless + Supabase PostgreSQL + React/Vite CRM (ssjbot.gemtre.in) for Sun Sea Jewellers. The app is a single `src/App.jsx` file (~6100 lines) with all UI. API is `api/*.js` ES module serverless functions. All DB tables are prefixed `bullion_*`. I recently added a telecaller queue system — see `TELECALLER_CRM_ROADMAP.md` in the project root for the full spec and all changed files."
