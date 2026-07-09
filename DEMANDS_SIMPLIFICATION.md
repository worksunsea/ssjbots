# Demands Tab Simplification Spec
**Date:** 2026-07-09 · **Problem:** Staff find demand/walk-in cards confusing — too much info, too many buttons.
**Files:** `src/App.jsx` — `DemandsScreen` (~1238), `ConversationPane` (~631), `WalkinEntryModal` (~2092)

---

## 1. WHAT'S ON SCREEN TODAY (the overload, counted)

### Collapsed card — up to 15 elements
Bulk checkbox · name · temp pill · VIP pill · walk-in pill · urgency pill (days-left) · call-attempts pill (📞 2/6 OVERDUE) · bot pill · description · for-whom · product pill · occasion pill · budget pill · visit pill · assigned pill · step name · timestamp — plus a colored urgency border.

**Redundancy:** temperature, urgency-days, OVERDUE, and border color are 4 ways of saying the same thing (how urgent). Bot pill vs step name say the same thing (who's handling it).

### Expanded pane (ConversationPane) — 5 info strips + 17 buttons
Strips: header (status, phone, funnel, exchanges, city/email/bday/anniv/custom fields, stage bar) → VIP banner → demand context (9+ pills + temp-override buttons) → funnel flow (funnel dropdown + every step + next-step line) → call cadence (dots, past attempts list, tried-to-call button).

Buttons in one flat row: Pause bot · Opt Out · Merge duplicate · Edit contact · **Converted · Lost · Not interested · Junk · Supplier** · Reassign · Log call · Schedule visit · Send design · Mark step complete · Undo last step · Handoff · Dead.

**Redundancy/confusion:** 5 separate close buttons + "Dead" + "Opt Out" = 7 ways to end a demand. "Handoff" and "Pause bot" overlap. "Mark step complete" is meaningless on call steps. A telecaller uses ~4 of the 17 buttons daily.

### Walk-in form — ~30 fields
Contact (8) + demand (8) + visit tracking (7: party size, in/out time, items seen, price quoted, not-bought reason, competitor) + per-item enquiry rows + exchange (3) + design ref upload. The staff member fills this while the customer stands at the counter.

---

## 2. DESIGN PRINCIPLE

A salesperson's card answers exactly 3 questions: **WHO · WHAT · WHAT DO I DO NEXT.** Everything else is manager information or history — available on open, never on the card. (This is Clientbook's "Today page" model: one prescribed action per client per day.)

---

## 3. NEW CARD — 3 lines, 1 button

```
[left border = urgency color]
Line 1:  Name           [Hot] [VIP]              [ NEXT-STEP BUTTON ]
Line 2:  one-liner: description · occasion + date · ₹budget
```

### Keep (5 things)
1. Name
2. ONE status chip: Hot / Warm / Cold (temperature already encodes overdue + urgency — trust it)
3. VIP chip when old client
4. One-liner: `description · occasion date · budget` as plain text, not pills
5. ONE next-step button (see §4)

### Remove from card (move to expanded view or delete)
| Element | Where it goes |
|---|---|
| Bulk checkbox | Manager role only (hide for telecallers) |
| Walk-in pill | Into one-liner text ("Walk-in ·"), or drop — source filter exists |
| Urgency days pill | Folded into next-step button text ("overdue 2h" / "due in 3d") |
| 📞 2/6 attempts pill | Expanded view (cadence strip already shows it) |
| 🤖 Bot pill + step name | Replaced by next-step button state ("Bot chatting — no action") |
| Product/occasion/budget pills | Plain text one-liner (3 pills → 0) |
| for-whom | One-liner |
| Visit pill | Becomes the next-step button when visit is the next step |
| Assigned pill | Manager view only — telecaller sees only own demands |
| Timestamp | Expanded view |

### Interaction
- Tap **button** → do the action directly (open LogCallModal / confirm-visit / chat)
- Tap **card** → expanded view (full history)

---

## 4. THE NEXT-STEP ENGINE (core change)

One function `nextStep(demand)` returns `{ label, color, action }`. Priority order — first match wins:

| # | Condition | Button | Action |
|---|-----------|--------|--------|
| 1 | callback promised & due | 🔴 "Call back NOW — promised {time}" | LogCallModal |
| 2 | call step & next_call_at ≤ now | 🔴 "Call now · overdue {2h}" | LogCallModal |
| 3 | call step & future | ⚪ "Call at {5:30pm}" (disabled until due) | LogCallModal |
| 4 | visit today | 🟢 "Visit TODAY {11am} — prepare pieces" | expanded view |
| 5 | visit tomorrow & !visit_confirmed | 🟠 "Confirm visit for tomorrow" | confirm call/WA |
| 6 | visit passed & no outcome | 🟠 "Visited — mark result" | outcome picker |
| 7 | lead.status = handoff | 🔴 "Reply personally — bot handed off" | expanded chat |
| 8 | message/bot step | grey text "Bot chatting · no action" (no button) | — |
| 9 | quote sent > 48h, no reply | 🟠 "Follow up quote — rate changing" | LogCallModal |

Sort the list by: has-action-due first (by priority score), then bot-handled. **The top card is always "do this now."** This also makes My Queue and Demands consistent — same card, same button.

---

## 5. EXPANDED VIEW — regroup 17 buttons → 3

1. **Primary button** (big, colored): whatever `nextStep()` says — Log call / Confirm visit / Reply
2. **"Close demand ▾"** dropdown: ✅ Converted · ❌ Lost… · 🤔 Not interested · 🗑 Junk · 🏷 Supplier
   (Also absorbs "Dead" — delete that button; Lost/Junk already set the lead dead. "Opt Out/DNC" lives inside Lost reasons.)
3. **"⋯ More"** menu: Schedule visit · Send design · Edit contact · Reassign · Pause/Resume bot · Merge duplicate · Mark step complete / Undo step · Handoff

Strips: keep header + demand context (merge VIP banner into header as the ⭐ chip + one tooltip line). Funnel flow strip and funnel-change dropdown → collapse behind a "Funnel ▾" disclosure, admin/manager only. Cadence strip stays (it's useful) but past-attempts list collapses to "3 attempts ▾".

Role rule: telecaller sees primary + Close + More(Log-related only). Manager/admin sees everything.

---

## 6. WALK-IN FORM — 2-step split

**Step 1 — while customer is at the counter (30 seconds, 6 fields):**
Name* · Phone* · What are they looking for (description) · Product category · Budget · Occasion + date. Save → demand created + assigned.

**Step 2 — "Complete visit details" (optional, after customer leaves):**
Everything else — city/email/bday/anniversary, party size, in/out time, items seen, price quoted, not-bought reason, competitor, per-item enquiries, exchange, design ref. Reached via the card's More menu or a "finish details" nudge on the card for 24h.

Old-client path stays: phone search → prefill → skip to description.

---

## 7. BUILD ORDER (each shippable alone)

1. `nextStep(demand)` helper + replace card body markup (§3–4) — biggest win, pure frontend
2. Regroup ConversationPane action bar into Primary/Close/More (§5)
3. Role-gate: hide bulk checkbox, assigned pill, funnel strip for telecallers
4. Split WalkinEntryModal into 2 steps (§6)
5. Delete redundant buttons: Dead (dup of Lost), standalone Opt Out (→ Lost reason DNC)

Nothing here touches the DB or API — it is all presentation + one helper function, so it can be tuned per feedback without migrations.
