# Calculator Module — Living Documentation

## Status: Phase 1 Complete ✅

---

## What's Built

### Tab Registration
- `{ k: "calculator", l: "Calculator", icon: "💎" }` added to `ALL_TABS` in `App.jsx`
- Role access: superadmin, admin, manager, staff — NOT telecaller
- Render: `{activeScreen === "calculator" && <CalculatorScreen />}`

### CalculatorScreen (`src/App.jsx`)
Three sub-modes accessible via tab switcher:

#### 💍 Jewellery Estimate
- Gross weight input
- Purity: 22kt (91.6%), 18kt (75%), 14kt (58.5%), Custom %
- Gold rate: auto-fetched from live rates (₹/10g), overridable
- Making charges: toggle ₹/g or % (saved in localStorage)
- Diamond 1, Diamond 2, Stone: weight (ct or g toggle) + rate (₹/g)
- Misc deductions 1–3: label + weight + "Deduct from gross?" checkbox (deducted but NOT priced)

**Formula:**
```
net_gold_g = gross_g − dia1_g − dia2_g − stone_g − sum(misc where deduct=true)
gold_value   = net_gold_g × (gold_rate_per_10g / 10) × purity_fraction
making       = (₹/g mode) → net_gold_g × rate  |  (% mode) → gold_value × pct/100
dia_total    = dia1_g×rate + dia2_g×rate + stone_g×rate
grand_total  = gold_value + making + dia_total
```

#### 💎 Solitaire Calculator (Rapaport)
- Stone fields: Shape (Round + 21 fancy shapes), Weight (ct), Certificate (IGI/GIA/HRD/Non-Cert)
- Colour: D, E, F, G, H, I, J, K, L, M, N (all 11)
- Clarity: FL, IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2 (FL maps to IF row)
- Cut: Excellent, Very Good, Good, Fair, None
- Buy disc % + Sell disc % (auto = buy_disc − spread; spread default 8, configurable, saved in localStorage)
- Internal fields (not shown in print/WA): Vendor Code, Purchase Price, Notes
- "Include Gold Setting" toggle: adds jewellery cost inline → combined grand total

**Formula:**
```
rap_100       = lookup(weight, color, clarity, isRound)   ← hundreds of $/ct from table
rap_inr_per_ct = rap_100 × 100 × usd_inr
buy_ppc        = rap_inr_per_ct × (1 − buy_disc/100)
sell_ppc       = rap_inr_per_ct × (1 − sell_disc/100)
sell_total     = sell_ppc × weight_ct
```
- Negative disc = premium above rap

#### 📋 Solitaire Quotation Sheet
- Multi-row table, one row per stone
- Same fields as Solitaire: Shape, Weight, Colour, Clarity, Cut, Cert, Sell Disc%, auto Rap INR/ct, Sell Price
- No grand total row (by design)
- "+ Add Stone" button
- Per-row sell disc override (yellow if using default)

### Rapaport Price Data
- Source: June 19, 2026 PDFs from Rapnet Drive folder
- Stored as seed constant `RAP_SEED` in App.jsx
- Also loaded from `bullion_dropdowns` (field = `rapaport_data`) at runtime — DB takes precedence over seed
- Structure: `{ date, rounds: { "0.30": [[10×11]], ... }, fancy: {...} }`
- **10 clarities (rows):** IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2, I3
- **11 colors (cols):** D, E, F, G, H, I, J, K, L, M, N
- **12 weight ranges:** 0.30, 0.40, 0.50, 0.70, 0.90, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00, 10.00
- Values in hundreds of $/ct (multiply × 100 for $/ct)
- Stale warning if data > 7 days old

### Rapaport Sync API (`api/rapaport-sync.js`)
- `GET /api/rapaport-sync?action=seed` — writes hardcoded seed data to DB (no Drive credentials needed)
- `GET /api/rapaport-sync` (no ?action) — reads latest Round + Pear PDFs from Rapnet Drive folder by modifiedTime, parses, upserts to DB
- Auth: `Authorization: Bearer <CRM_SECRET>` header (skipped if env var absent)
- Requires `GOOGLE_SERVICE_ACCOUNT_JSON` (base64 JSON) for Drive access
- Drive folder: `152rXtP8ioZ3lcsrsmQJ9w9qpA0ApgLEY`

### Save Estimate
- "💾 Save Estimate" button → modal → optional contact search → saves to `bullion_estimates` table
- `created_by` = `loadUser().name`
- Recent estimates (last 8) shown below calculator

### Print
- `window.print()` via 🖨️ button
- Print-only header: "ESTIMATE", Sun Sea Jewellers, contact name/phone, date
- Internal fields (vendor code, purchase price, notes, buy price, margin) excluded from print via CSS

### WhatsApp Send
- Appears when a contact is selected in Save modal
- `POST /api/wa-proxy?path=/clients/8860866000/send`
- Sends formatted text with sell prices only — no internal fields

### DB Migration
- `supabase/migrations/0050_estimates.sql` — `bullion_estimates` table with RLS
- Run in Supabase SQL Editor before deploying

---

## What's Pending

- [ ] **Rapaport PDF auto-sync from Drive**: `api/rapaport-sync.js` written but requires Google Service Account setup:
  1. Create service account in Google Cloud Console
  2. Share Rapnet Drive folder with service account email
  3. Download JSON key → base64 encode → add as `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel env
- [ ] **Admin Upload UI**: button to manually upload a new Rapaport PDF file from browser → trigger parse + store
- [ ] **Weight ranges below 0.30ct**: tables exist in Rapaport PDFs but use different structure (5×8 with color groups); not implemented — users enter price manually for small stones
- [ ] **6ct–9ct ranges**: not in the June 2026 PDFs captured; users enter manually

---

## Known Edge Cases
- Weight < 0.30ct: shows "manual pricing only" warning, Rap lookup returns null
- Negative discount: treated as premium (disc = −5 → 105% of rap)  
- FL clarity: maps to IF row in lookup table
- N color: supported in full 11-column table
- I3 clarity: supported in 10-row table
- Gold rate input accepts ₹/10g (if > 1000) and converts to ₹/g internally
- `sell_disc` field yellow when using auto-default (user hasn't overridden it)

---

## Files Changed
| File | Change |
|---|---|
| `src/App.jsx` | Tab entry, role defaults, render, `function CalculatorScreen()` + constants |
| `supabase/migrations/0050_estimates.sql` | `bullion_estimates` table + RLS |
| `api/rapaport-sync.js` | Rapaport sync endpoint |
| `calculator.md` | This file |
