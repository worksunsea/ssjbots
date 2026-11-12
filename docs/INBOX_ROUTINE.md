# Document Inbox - hourly Claude routine

Staff upload photos in the CRM (Inbox tab). The cloud routine talks ONLY to `POST https://ssjbot.gemtre.in/api/inbox-agent`
with header `x-inbox-token: <INBOX_TOKEN>` (Vercel env var). It has no database key and cannot write contacts.

Actions (JSON body):
- `{"action":"pending"}` -> `{items:[{id,kind,note,image_urls}]}` (status=new, oldest first, max 10)
- `{"action":"lookup","phones":[],"names":[],"emails":[]}` -> `{contacts:[...]}` existing contacts matching any
- `{"action":"submit","id":"<item id>","proposal":{"people":[...],"notes":""}}` -> saves the proposal, status becomes `proposed`

Download each image URL with curl to a temp file and view it with the Read tool.

## Steps
1. Call `pending`. Nothing new -> stop.
2. For each row view every image URL. `kind` = vip_sheet | vendor_card | other, `note` = uploader's hint.
3. vip_sheet: for each person on the form build one entry:
   `{ match_id, match_label, fields:{name,phone,mobile2,email,bday,anniversary,profession,spouse_name,spouse_mobile,spouse_dob,address_house,address_locality,city,address_state,address_pincode}, extra:{reference,misc,old_address,gift,gift_received}, tags:["Diwali 2026 Gift"], questions:[], skip:false }`
   - Call `lookup` with the phones, names and emails on the form to find existing contacts (matches phone, phone 2, spouse phone, name, email). Set `match_id`/`match_label` when found; never merge duplicates yourself - put a question instead.
   - Gift rules: circled **N** top-left, or "Bhumi" written on top (or the uploader note says so) -> gift "5 Elements Basket", gift_received "Yes". Circled number top-right -> gift "Free Gift", gift_received blank.
   - Clean names. Extra text in name/profession -> extra.reference or extra.misc. Old name -> extra.reference. Old address -> extra.old_address.
   - Dates: YYYY-MM-DD when year known, MM-DD otherwise. City "New Delhi", state "Delhi" (Gurgaon -> Haryana, Ghaziabad/Noida -> Uttar Pradesh). Fill pincode from area when blank.
   - Spouse: spouse_name/spouse_mobile on the same person (no separate contact). Spouse-only records are not tagged.
   - Anything unclear (handwriting, phone digit mismatch, year, duplicates) -> add a plain-language entry to `questions`. Do not guess.
   - Only put fields you read from the form or know; leave others empty (blank never erases existing data).
4. vendor_card / other: list what you read in `proposal.notes`, `people` may be empty.
5. Call `submit` with `{id, proposal:{people:[...], notes:'...'}}`. If an image is unreadable submit `people:[]` and say why in `notes`.
