# Session Log — Kitty Rates, Messaging & Contacts (Sept 2026)

**Repo:** ssjbots (ssjbot.gemtre.in) · **Period:** 2026-09-09 → 2026-09-21
**All items below are committed to `main` and live in production unless noted.**

---

## 1. Kitty monthly-rate fixes

- **Bug fixed:** monthly rate bulk-set matched installments by `paid_at` (drifts on backfilled entries) instead of `due_date`. Root cause of wrong gold weight showing for members. → `due_date`-based matching.
- **Per-person rate edit** now takes the ₹/g rate directly instead of grams.
- **Rate validation** widened from exactly-5-digits to a 5000–35000 ₹/g range.
- **Protection added:** running the monthly-rate tool no longer overwrites a rate a staff member already individually punched at payment time — only fills installments where `rate_locked` is still null. Confirm-popup wording and preview count fixed to match (previously said "overwrites all," which was stale).
- **Already-punched rates view**: one place to see rates already set, before the client list, with computed gold weight shown before applying.

## 2. Kitty WhatsApp messaging system (new)

- **Queue + retry**: any Kitty WA send that fails is queued (`kitty_message_queue`), not silently dropped. Admin nudge to staff when messages are pending. "Pending Messages" tab — send one-by-one or all (paced).
- **WA fallback number**: every Kitty send tries the dedicated Kitty number first, auto-retries on the `Clientmessage` number if that fails, before being queued as failed. Applies to live sends and manual retries.
- **Full send log**: every attempt (sent AND failed) is now recorded, not just failures — previously successes were invisible.
- **New "✉️ Messages" tab** (Kitty Admin, next to Pending Messages):
  - **Templates** — edit the wording of every automated message ({{placeholder}}-driven), reset to default anytime.
  - **Log** — full send history: context, recipient, status, which WA number sent it, error, retry button.
  - **Send Now** — one-off message to any member by name/phone search, outside any automated flow.
- **Rate-cut notifications**: paid members get a WA with their rate + gold added; unpaid members get a separate warm-but-urgent nudge ("pay today to lock this rate, or call us if you already paid").
- **Due-today urgent nudge**: new daily 10am IST cron hit (`/api/kitty-cron?only=due_today`) — anyone due today and still unpaid gets a same-day nudge, separate from the advance reminders.
- **Two separate advance reminders**: 7-day heads-up AND a 3-day urgent nudge, each with its own stamp column and template — one does not replace the other.
- **Delivery-status messages**: physical coin/gold delivery (single toggle and bulk FIFO `deliver-coins`) now sends an explicit "✅ WITH YOU" WhatsApp confirmation — previously silent. Redemption thank-you message updated to clearly say "✅ COMPLETE."
- **Advance Pay Months** (fixed-schedule schemes): pay several upcoming months in one action, all at the same today's rate. Since reminders only fire on `status='due'`, advance-paid months automatically stop generating reminders — no separate suppression needed. One consolidated WA confirmation sent.
- **Gullak coin entry**: logging a 1g/2g/etc. MMTC coin purchase now offers today's live MMTC rate (fetched from Rates) to auto-fill the amount, instead of typing it manually; declining falls back to manual entry, leaving the rate to be picked up by the monthly-rate run later.

## 3. Kitty Admin UI

- Installment chips are now color-coded: 🔴 overdue · 🟠 due this calendar month · 🟢 paid/free · 🟡 due but further out (upcoming) · gray = waived/other. Each chip also shows its due month/year underneath.

## 4. Contact merge rebuild

- Old merge (prompt-based, instant, no review) replaced with: checkbox-select 2 contacts → "🔗 Merge" button → manager+ requests, superadmin approves. Phone-mismatch warning shown before requesting.
- Approval now opens the **full** rich merge modal (both complete records, demand history, field-by-field diff table) instead of a bare name/phone row — SA can actually review before deciding.
- Merge no longer silently drops conflicting data: secondary's phone fills primary's `mobile2` if free; other differing non-blank fields are preserved in `extra_fields.merge_conflicts`, surfaced as a dismissable warning banner on the contact.

## 5. Birthday/Anniversary messaging

- **Tag-driven footer + salutation**: staff-editable rules (Upcoming Events tab) map a tag combination (e.g. `sanjeev_sir` + `rotary`) to a custom WhatsApp sign-off and salutation-before-name, used by the AI message generator instead of the fixed default. Fully add/edit/delete from the UI, not hardcoded.
- **Calling script rewritten** to Saurav's new SOP ("Sun Sea Special Moments") — wish → relationship line → curiosity hook (never reveal the surprise on the call) → jewellery preference question → day/time drill-down → golden closing. Old version led with a discount offer in the same breath as the wish. Added a collapsible on-screen objection-handling cheat sheet + call-outcome code legend.

## 6. Misc fixes

- WA sessions crash-looping together + CRM hiding disconnected sessions on a transient fetch failure — fixed.
- Deleted WA client sessions (denylist) were still appearing in `/clients` — filter fixed.
- Rapaport diamond price changes now auto-flagged on next Calculator load.
- Broadcast: recipient checkbox list (untick individuals before send), salutation/company merge-field placeholders.

---

## Not yet built (flagged during this session, not requested/started)

- CRM outcome-status tracking per call (Visit Confirmed / Not Interested / etc.) and the automated Day 2-3 / Day 5-7 follow-up cadence from the calling SOP — reference/display only right now.
- Literal numbered phone1/phone2/phone3... fields for merge (used `mobile2` + alias table + `extra_fields.merge_conflicts` instead — flagged as a design tradeoff, not yet confirmed).
- Rotary directory image-scan import (planned, not started — separate plan file).
- Teachers Circle group Kitty scheme (planned only — see separate plan doc, not built).
