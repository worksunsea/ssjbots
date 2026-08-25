# WhatsApp Rules — ssjbots

Canonical reference for every rule governing outbound/inbound WhatsApp in this repo: which number sends what, when a message is allowed to fire, when it's blocked, and every documented incident that shaped a rule. Update this file whenever WA send logic, gating, or number routing changes — it should never go stale.

## 1. Numbers and channels

Two completely separate send systems:

- **Baileys / wa-service** (self-hosted, Synology NAS) — `sendWhatsApp`/`sendWhatsAppMedia` in `api/_lib/wa.js`. Used for bot replies and all internal/staff/owner messaging.
- **WbizTool** (paid third-party API) — `sendWhatsAppWbiz`/`sendWhatsAppMediaWbiz` in `api/_lib/wa.js`. Used for lead-facing outreach: drip, demand opening, authority assets, visit reminders, broadcasts.

### The 5 numbers and their intended purpose (owner policy, 2026-08-21)

| Number | Purpose | Config identifier |
|---|---|---|
| **8860866000** | Client-facing chatbot ONLY | `BOT_NUMBERS`, `WA_SESSION_CLIENT_ID`="Reception", `WBIZTOOL_DEFAULT_CLIENT`="7560" |
| **8448271248** | Internal communications + order messages to vendors/clients, step-wise as needed | `TASKS_WA_CLIENT_ID` (intended — falls back to Reception until paired) |
| **8588867820** | Backup for 8448271248 if that number goes down | not yet wired in code |
| **9899226225** | Birthday/anniversary + other general client communications (policy) | **owner decision 2026-08-25: leave birthday/anniversary/after-marriage funnels on 8860866000 for now — do not move to 9899226225.** Revisit only if explicitly asked again. |
| **9953229430** | Admin bot: internal documentation + owner bot replies only, never client-facing | not currently in `BOT_NUMBERS` |

**2026-08-25 fix:** `api/staff-otp-send.js`, `api/send-profile-link.js`, and `api/staff-profile-reminders.js` were hardcoded to `WA_SESSION_CLIENT_ID` (the client-facing Reception number) instead of `TASKS_WA_CLIENT_ID` — confirmed by the owner receiving a staff OTP from 8860866000 instead of 8448271248. All three switched to `TASKS_WA_CLIENT_ID`, matching every other internal staff-facing sender in the table below.

**Still-open gap:** `TASKS_WA_CLIENT_ID` (`api/_lib/config.js`) falls back to the Reception session (`WA_SESSION_CLIENT_ID`) whenever the env var itself isn't set. The code fix above only matters if `TASKS_WA_CLIENT_ID` is actually set to 8448271248's paired Baileys session in Vercel env vars — **verify that env var directly** (not checkable from this session) if messages still arrive from 8860866000 after this fix deploys.

### Per-category channel map

| Category | File | Channel | Client/session |
|---|---|---|---|
| Bot FAQ replies (inbound) | `api/webhook.js` | Baileys | `BOT_NUMBERS` only |
| Owner WA commands | `api/webhook.js`, `api/_lib/ownerCommand.js` | Baileys | `waClient \|\| WA_SESSION_CLIENT_ID` |
| Funnel drip / birthday / anniversary / after-marriage | `api/cron.js` | WbizTool | `funnel.wbiztool_client` (falls back to `WBIZTOOL_DEFAULT_CLIENT`) |
| Demand opening + authority assets + visit reminders | `api/demand.js` (sent via `api/cron.js`) | WbizTool | `funnel.wbiztool_client` |
| Broadcast campaigns | `api/broadcast-send.js` (sent via `api/cron.js`) | WbizTool | funnel's client |
| Kitty due/claim/rollover reminders (proactive) | `api/kitty-cron.js`, `api/kitty.js` `send-installment-reminder` | **Baileys** (not Wbiz — inconsistent with other lead-facing sends) | default session — DND-checked since 2026-08-25 |
| Kitty redemption code / confirmation (transactional) | `api/kitty.js` | Baileys | default session — deliberately NOT DND-gated, member is actively mid-redemption |
| Staff task/KRA reminder | `api/staff-task-reminders.js` | Baileys | `TASKS_WA_CLIENT_ID` |
| Evening completion reminder | `api/evening-completion-reminder.js` | Baileys | `TASKS_WA_CLIENT_ID` |
| Task-assigned notify | `api/notify-task-assigned.js`, `api/_lib/taskCommand.js` | Baileys | `TASKS_WA_CLIENT_ID` |
| Schedule reminders (Saurav's calendar) | `api/schedule-reminders.js` | Baileys | `TASKS_WA_CLIENT_ID` |
| Staff profile-completion nudge | `api/staff-profile-reminders.js` | Baileys | `TASKS_WA_CLIENT_ID` |
| Owner morning/evening digest | `api/digest-ping.js` | Baileys | `WA_SESSION_CLIENT_ID` |
| Connection/session-down alert | `api/connection-alert.js` | **WbizTool** (deliberate — Baileys may be the thing that's down) | none |
| Contact-update referral | `api/contact-update.js` | WbizTool | none |
| Catalogue send | `api/catalogue.js` | WbizTool | none |
| Generic CRM send (`/api/send`, `/api/send-media`) | `api/send.js`, `api/send-media.js` | Baileys | caller-supplied or default |
| Missed-call / job-enquiry auto-reply | `api/webhook.js` | Baileys | inbound session |
| Staff OTP / profile link | `api/staff-otp-send.js`, `api/send-profile-link.js` | Baileys | `TASKS_WA_CLIENT_ID` |

No WA sender found for corporate-gifting or calculator-estimate flows in this repo — confirm whether those are handled elsewhere or genuinely don't send WA.

## 2. Approval gate (the master switch for lead-facing sends)

`api/cron.js`'s send loop only picks up rows where:
```
status = 'pending' AND approved = true AND send_at <= now
```
This gates **every** funnel drip step, birthday/anniversary/after-marriage message, and any row inserted by `enrollLeadInDrip` (`api/_lib/drip.js`) without an explicit `approved` field.

- **Auto-approved** (no human step): broadcast rows, visit-day/visit-reminder rows created at demand creation.
- **Requires manual approval**: everything else — regular funnel steps, AI-drafted calendar birthday/anniversary messages. No endpoint in this repo flips `approved` to true for these; that happens in the CRM's Approvals screen. AI preview generation only drafts the message text — it does not approve.

**2026-08-25: the entire unapproved backlog (1,658 rows, oldest from mid-July) was cancelled** (`status: canceled, canceled_reason: owner_cleared_unapproved_backlog_2026-08-25`) — a deliberate reset, not a bug fix. The approval queue starts clean from this date forward. If it grows unattended again, re-run the same cancel (filter `status='pending' AND approved=false`) rather than letting it silently pile up for months.

Diagnostic-only endpoints (do not approve anything): `action=approvals_audit`, `action=reject_stale_calendar`, `action=calendar_enroll_audit`.

## 3. Per-row send-time guards (inside the cron loop, after atomic claim)

1. Atomic `UPDATE ... WHERE status='pending'` claim — prevents double-send races (see incident #1 below).
2. `funnel.active` must be true, else canceled `funnel_inactive`.
3. `lead.dnd` must be false, else canceled `dnd`.
4. `lead.status` not in `converted`/`dead`, else canceled `lead_<status>`.
5. `lead.bot_paused` must be false, else canceled `bot_paused`.
6. **Reply-during-drip guard**: if the lead replied after the row's `send_at` was computed but before it actually sent, the message is canceled, all other pending drips for that lead are canceled too, lead flips to `status: "handoff"`, owner gets an alert.
7. `is_reminder` rows skip all lead-targeting guards — relayed straight to `reminder_phone || OWNER_ALERT_PHONE` (staff/owner-facing, not customer-facing).

Self-healing dedup runs every tick: cancels duplicate pending rows with identical `(lead_id, funnel_id, step_id)`, keeping the earliest.

## 4. Rate / batch limits

- Cron drip loop: **5 messages/tick, 4s apart** (~75/hour ceiling, since cron fires once a minute).
- Calendar enrollment: 500 leads/field/tick cap (bday, anniversary separately); after-marriage capped at 10/tick.
- Broadcast: 500 leads/invocation.
- Staff reminder crons (task/evening/profile): 9 people/invocation, 30s apart (fits Vercel's 280s function limit); dedup log tables prevent double-pings within the reminder window.
- Kitty claim reminders: re-nudge every 14 days. Staff profile reminders: every 15 days.
- No global "max 1 WA per lead per day" governor exists — the closest thing is the reply-during-drip guard plus the dnd/converted/dead/bot_paused/funnel_inactive checks above.
- `HARD_EXCHANGE_CAP = 100` — per-lead conversational cap (bot auto-pauses after 100 exchanges with no manual pause), not a volume/rate limit.

## 5. Opt-out / DND

Column: `bullion_leads.dnd` + `dnd_reason` + `dnd_at`.

**Checked in:** `api/cron.js` send loop, calendar-enrollment queries, `api/broadcast-send.js` recipient query, `api/webhook.js` inbound bot-reply path.

**Fixed 2026-08-25**: `api/kitty-cron.js` (due reminder, unclaimed-benefit reminder, batch-rollover nudge) and `api/kitty.js`'s staff-triggered `send-installment-reminder` now check `lead.dnd` before sending — these are proactive nudges. Kitty's redemption-code and redemption-confirmation sends deliberately stayed unguarded — those are transactional responses to an action the member is actively taking, not proactive outreach.

**Still NOT checked in** (confirmed by grep): `api/demand.js`, `api/catalogue.js`, `api/notify-task-assigned.js`, `api/send.js`, `api/send-media.js`, `api/send-profile-link.js`, `api/digest-ping.js`, staff-*-reminders crons, `api/schedule-reminders.js`. Demand-opening messages route through `bullion_scheduled_messages` and ARE covered by the master `cron.js` dnd check (§3) — the gap there is only for a hypothetical direct/immediate send path, which doesn't currently exist for demands. `send.js`/`send-media.js` are staff-discretion sends (a human is choosing to send, similar reasoning to redemption codes). `catalogue.js`/`contact-update.js` are on-demand responses to a client request. Staff/owner-facing crons (task reminders, digest, schedule) are internal, not lead-facing — DND is a lead concept, doesn't apply.

**No hardcoded "STOP" keyword matcher exists.** DND is entirely AI-classifier-driven: the system prompt (`api/_lib/prompt.js`) instructs the model to set `action: "DND"` on stop/unsubscribe/complaint/abuse language; `webhook.js` reads that field and sets `dnd: true`. **If the AI call fails, the fallback reply is a generic "will get back to you" with `action: "CONTINUE"` — DND does NOT get set even if the user's message said "STOP".** There is no regex safety net.

DND also gets set independently when a telecaller marks a call disposition as `dnc` (`api/log-call.js`) — unrelated to WA text parsing.

DND does not proactively cancel already-scheduled pending rows the moment it's set — cancellation happens lazily, one row at a time, when each row's `send_at` comes due and hits the guard.

## 6. Timing

### Cron schedule (vercel.json, times in IST)
| Cron | Schedule | Sends WA? |
|---|---|---|
| `/api/cron` | every minute | Yes — main drip/calendar/broadcast/price-alert flush |
| `/api/schedule-reminders` | every 5 min | Yes |
| `/api/digest-ping?mode=morning` | 9:00am | Yes |
| `/api/digest-ping?mode=evening` | 10:00pm | Yes |
| `/api/evening-completion-reminder` | 4 ticks, 7:30–8:15pm | Yes |
| `/api/staff-task-reminders` | 6 ticks, 11:00–11:50am | Yes |
| `/api/staff-profile-reminders` | 6:30am | Yes |
| `/api/kitty-cron` | 7:30am | Yes |
| `/api/morning-due-today-push` | 4 ticks, 11:00–11:45am | No (push only) |
| `/api/fms-delay-push` | every 2h | No (push only) |
| `/api/catalogue-backup` | 2:00am | No |

Several of these fire more often than the message should actually go — the endpoint itself checks the clock and no-ops outside its real window (e.g. staff-task-reminders only sends when IST hour === 11 exactly), so the cron schedule and the actual send window are not the same thing — always check both.

### Business-hours clamp (lead-facing sends)
- Funnel drip/calendar steps: valid window **9am–8pm IST**; outside that, pushed to **10:30am IST next day** (`api/_lib/drip.js`).
- Broadcasts: same 9am–8pm window, but pushes to **9:30am IST next day** (`api/broadcast-send.js`) — minor inconsistency with drip's 10:30am snap, not necessarily a bug but worth knowing.

### Calendar (birthday/anniversary) specifics
- Enrollment window: `-5 <= daysUntil <= 40` relative to the event date.
- Same-day leads staggered 7 minutes apart so approvals/sends don't burst.

### Per-step cadence (`bullion_funnel_steps.trigger_type`)
`after_prev_step` (default), `after_enrollment`, `after_last_inbound`, `after_last_purchase` (step skipped if no purchase on record), `specific_datetime`, `calendar_event` (signed day-offset from birthday/anniversary, with a same-day catch-up rule: if computed time is past but the target day is still today IST, fires in 5 minutes instead of being dropped). Any computed send time in the past is bumped to now+60s — never schedules into the past.

### Telecaller callback cadence (`api/log-call.js`)
- `MAX_ATTEMPTS = 6` — after 6 non-busy attempts, demand auto-flips to `outcome: "lost"`.
- `BUSY_RETRY_MIN = 15` — busy disposition retries in 15 min, doesn't count toward the 6-attempt budget.
- Default cadence table (`telecaller_cadence_minutes`, per-tenant configurable): `[5, 120, 1320, 3960, 6480, 9720]` minutes ≈ 5min, 2h, ~22h, ~2.75d, ~4.5d, ~6.75d.
- `callback_requested`/`answered_not_now` use the telecaller-supplied time verbatim instead of the cadence table.

## 7. Bot-reply restriction (BOT_NUMBERS)

`BOT_NUMBERS = ["8860866000"]` only. All other numbers are send-only — must never auto-reply.

**Gate 1** (`api/webhook.js`, before any AI call): checks `session_phone` (the real connected device number from wa-service — authoritative) against `BOT_NUMBERS`. Falls back to matching `wbiztool_client` on a funnel's `wa_number` if `session_phone` isn't present. Rejects with `non_bot_session`/`unknown_session`/`non_bot_number` otherwise.

**Gate 2** (owner-command branch specifically): `isOwnerCommandSession = !waClient || (ownerSessionPhone && BOT_NUMBERS.includes(ownerSessionPhone))` — this check is independent of Gate 1 and was once missing (see incident #3).

No DB override exists for `BOT_NUMBERS` — hardcoded intentionally after incident #2.

`OWNER_ALERT_PHONE` self-loop guard: if the inbound sender IS `OWNER_ALERT_PHONE`, webhook returns immediately (prevents the bot replying to its own alerts).

**Adding 9953229430 as the admin bot's reply number means adding it to `BOT_NUMBERS` — a real behavior change, that number starts auto-replying to inbound messages. Do not do this without confirming wa-service has a paired session for it first.**

## 8. Known incidents that shaped these rules

1. **Duplicate birthday send** (Meena Mehta, 2026-07-11, 2m24s apart, two message IDs) — race condition, fixed by atomic claim-before-send.
2. **Wrong number auto-replying** (2026-07-15) — 9312839912 was replying alongside 8860866000; `BOT_NUMBERS` hardcoded to just the intended number.
3. **All Baileys sessions replying to admin owner-commands** (2026-07-28) — owner-command branch was missing the same-session check that Gate 1 already had; fixed.
4. **Vercel cron auth completely missing** — `x-vercel-cron` header is not a trusted auth signal per Vercel docs; the real mechanism is `Authorization: Bearer <CRON_SECRET>`. This was missing entirely at some point, meaning every real Vercel cron tick 401'd silently and NONE of the cron-driven WA logic ran automatically until fixed. Worth re-verifying this is still correct on every new cron endpoint added.
5. **After-marriage funnel double-classification** — shared `kind="anniversary"` with the separate Anniversary Month Wishes funnel, non-deterministically flooding non-newlyweds with the 6-step after-marriage sequence. Fixed with its own `kind="after_marriage"` plus a permanent self-healing cleanup and a one-off audit that surfaces already-wrongly-sent recipients for manual apology follow-up (already-sent messages can't be recalled).
6. **Stale calendar messages firing on mass-approve** — unapproved birthday/anniversary rows with a past `send_at` would all fire at once (with stale dates) the moment someone approved the backlog. Manual cleanup action added (`reject_stale_calendar`) to cancel stale-dated pending rows before approval.
7. **Duplicate scheduled-message rows** — enrollment race or re-run could create dupes; self-healing dedup + manual audit/fix pair added.
8. **Supabase outage leaked raw HTML into a WA reply** (2026-07-09) — an edge outage produced a message body containing `<!DOCTYPE html>...`; `sanitizeErrorForWA()` now strips/replaces HTML-looking error bodies before they can reach a customer.
9. **Telecaller call misattribution** — `staffId` used to come from the request body (spoofable); now comes from the verified session token.
10. **Karigars incorrectly targeted by staff WA reminders** — karigars (type=artisan) aren't staff and never get app logins; every staff-facing reminder cron now explicitly excludes them.
11. **WhatsApp link-preview caching stale content** — digest-ping's reporting link now has a cache-busting query param since WA kept showing the first-ever scraped preview for that URL.
12. **`bot_paused` vs `status:"handoff"` confusion** — marking a lead "handoff" in the CRM UI is only a label; it does NOT stop the bot on its own. `bot_paused` is the real gate.

## Maintenance

Update this file whenever: a number's purpose changes, a new WA-send code path is added, an approval/gating rule changes, or a new incident forces a fix. Treat any point-in-time counts in this file as snapshots, not live state — re-verify before quoting them.

**Still open, no action taken (need info before touching):**
- `TASKS_WA_CLIENT_ID` (8448271248) — never confirmed paired to a live Baileys session in Vercel env vars; falls back to Reception (8860866000) if unset. Verify the env var directly.
- 8588867820 as backup for 8448271248 — no failover logic exists in code.
- 9953229430 as admin-bot reply number — would require adding it to `BOT_NUMBERS`, a real behavior change (starts auto-replying). Confirm a wa-service session is paired first.
- Kitty sends use Baileys while other lead-facing sends use WbizTool — inconsistent but not confirmed broken; left as-is.
