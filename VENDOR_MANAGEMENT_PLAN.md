# Vendor Management — Feature Plan
**Date:** 2026-07-10 · **Goal:** scan a supplier's business card at an exhibition, auto-fill their details, tag what they deal in, and record item-wise making charges — so later, when sourcing a product, you can pull up every vendor who supplies it and their terms in one screen.

---

## 1. The workflow this enables

**At the exhibition:** photograph the card → fields auto-fill → you just add "deals in" tags and item rows → save. Under a minute per vendor.

**Back at the store, when ordering:** open Vendors → filter by product/category → see every matching supplier side by side with their making charge and whether they supply on approval → decide who to call.

---

## 2. Data model

Follows existing conventions in this repo: `tenant_id` (default `a1b2c3d4-0000-0000-0000-000000000001`), `anon`-role RLS policy per table, `touch_updated_at` trigger, and the `bullion_dropdowns` table (`field`/`value` pairs) already used for every other owner-editable option list.

### `bullion_vendors` — one row per company
| Column | Notes |
|---|---|
| company_name | required |
| contact_person, designation | |
| phone, phone2, email, website | |
| address, city, state | |
| gstin | often printed on the card |
| card_image_url | photo of the card itself, kept for reference |
| payment_terms | dropdown-driven: Advance / Credit / **On Approval** / COD |
| on_approval_days | if on-approval, how many days before pay-or-return |
| source, exhibition_name | e.g. "IIJS Mumbai 2026" — lets you later ask "who did we meet at X" |
| notes, rating, active | |

### `bullion_vendor_dealings` — join table (vendor ↔ "deals in" tag)
`vendor_id, category` — category values come from `bullion_dropdowns` (`field='vendor_deals_in'`), same get-or-create pattern already used elsewhere (`_upsertDropdown`), so the list is customisable anytime without a migration.

### `bullion_vendor_items` — the product/making-charge grid
| Column | Notes |
|---|---|
| vendor_id | FK |
| item_name | e.g. "22K Gold Chain", "CZ Stud Findings" |
| category | optional link to the same dropdown list as dealings, for filtering |
| making_charge | numeric |
| making_charge_unit | per_gram / per_piece / percentage / fixed |
| price_note | free text — MOQ, base rate, discount slab, etc. |
| active | soft-delete, matches the rest of the app |

Storage: card photos go in the existing `media` bucket under `uploads/vendors/…`, reusing `secureImageUpload()` from `src/utils/imageUpload.js` — no new upload code needed.

---

## 3. Card-scan auto-fill flow

1. "Scan Vendor Card" → `<input type="file" accept="image/*" capture="environment">` (same idiom already used for the estimate item-photo picker — opens the phone camera directly, no new component).
2. Image uploads via `secureImageUpload(file, supabase, "vendors")`.
3. New endpoint `api/vendor-card-scan.js` sends the image to OpenAI vision (extend `api/_lib/ai.js`'s `askAI` to accept an `image_url` content block — it's currently text-only) with a prompt to extract `{company_name, contact_person, phone, email, address, website, designation, gstin}` as JSON, parsed with the existing `parseBotJson()` helper.
4. Form pre-fills; user reviews/corrects (OCR on card layouts is good but not perfect — this stays a human-confirms step, not silent auto-save).
5. User adds "deals in" tags + item rows, saves.

---

## 4. UI screens

- **Vendors list** — searchable/filterable by category, item name, city, payment terms. Card-style rows like the existing Demands screen.
- **Vendor detail** — contact info, card photo, deals-in chips, editable items table (item · category · making charge · unit · notes).
- **Scan & Add Vendor** — the capture → AI prefill → edit → save flow above, built for one-handed use standing at a booth.
- **Dropdown admin** — extend the existing config editor in `AnalyticsScreen` (same add/remove pattern as "Extra Salesperson Names", `src/App.jsx:7235`) with a "Vendor Categories" section for `field='vendor_deals_in'`.

---

## 5. Build order (each phase independently shippable)

1. **Migration** — create the three tables + storage RLS for `uploads/vendors/%`.
2. **Manual vendor entry** (no OCR yet) — list, detail, add/edit form. Usable immediately to backfill vendors you already have.
3. **Card-scan capture + AI auto-fill** — `api/vendor-card-scan.js`, vision support in `ai.js`, capture input + prefill.
4. **Dropdown admin UI** for deals-in categories.
5. **Product search for ordering** — filter Vendors by item/category so the "who supplies this" lookup is one screen.

---

## 6. Open decisions

- **Payment terms** modeled vendor-level (one vendor = one default: Advance/Credit/On Approval/COD). If some vendors give *some* items on approval and others not, that needs an `on_approval` override on `bullion_vendor_items` instead — flag if that's the real case.
- **OCR provider**: plan assumes reusing the existing OpenAI wrapper (vision-capable models support image input) rather than adding a new dependency. Confirm that's fine, or if a dedicated OCR/vision API is preferred.
- **Category taxonomy**: kept independent from `catalogue_item_types` (finished-product taxonomy) since vendors often sell raw materials/findings, not finished SKUs. Can be linked later if useful.
