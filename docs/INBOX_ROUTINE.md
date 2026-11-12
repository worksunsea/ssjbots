# Document Inbox - hourly Claude routine

Staff upload photos in the CRM (Inbox tab). Table `doc_inbox`, tenant `a1b2c3d4-0000-0000-0000-000000000001`.
Every hour this routine reads rows with `status='new'`, looks at each image in `image_urls`, and writes a
`proposal` + sets `status='proposed'`. A person then reviews/edits in the app and saves as final.
The routine NEVER writes to `bullion_leads` or `bullion_vendors`.

## Steps
1. GET `doc_inbox?status=eq.new&order=created_at` (service key, PostgREST). Nothing new -> stop.
2. For each row view every image URL. `kind` = vip_sheet | vendor_card | other, `note` = uploader's hint.
3. vip_sheet: for each person on the form build one entry:
   `{ match_id, match_label, fields:{name,phone,mobile2,email,bday,anniversary,profession,spouse_name,spouse_mobile,spouse_dob,address_house,address_locality,city,address_state,address_pincode}, extra:{reference,misc,old_address,gift,gift_received}, tags:["Diwali 2026 Gift"], questions:[], skip:false }`
   - Look up existing contacts in `bullion_leads` by phone (phone, mobile2, spouse_mobile), name and email. Set `match_id`/`match_label` when found; never merge duplicates yourself - put a question instead.
   - Gift rules: circled **N** top-left, or "Bhumi" written on top (or the uploader note says so) -> gift "5 Elements Basket", gift_received "Yes". Circled number top-right -> gift "Free Gift", gift_received blank.
   - Clean names. Extra text in name/profession -> extra.reference or extra.misc. Old name -> extra.reference. Old address -> extra.old_address.
   - Dates: YYYY-MM-DD when year known, MM-DD otherwise. City "New Delhi", state "Delhi" (Gurgaon -> Haryana, Ghaziabad/Noida -> Uttar Pradesh). Fill pincode from area when blank.
   - Spouse: spouse_name/spouse_mobile on the same person (no separate contact). Spouse-only records are not tagged.
   - Anything unclear (handwriting, phone digit mismatch, year, duplicates) -> add a plain-language entry to `questions`. Do not guess.
   - Only put fields you read from the form or know; leave others empty (blank never erases existing data).
4. vendor_card / other: list what you read in `proposal.notes`, `people` may be empty.
5. PATCH the row: `{status:'proposed', proposal:{people:[...], notes:'...'}, processed_at: now}`.
   If an image is unreadable: `{status:'proposed', proposal:{people:[], notes:'Could not read: ...'}}`.
