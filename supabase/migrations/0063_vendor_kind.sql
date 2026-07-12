-- Top-level vendor classification — jewellery-product supplier vs
-- service/supply provider (packaging, equipment, cleaning chemicals, etc.)
-- vs other. Separate from the detailed "deals in" category tags
-- (bullion_vendor_dealings) — this is a coarse filter AI can set from the
-- same card-scan call that already reads company_name/contacts/etc, so it
-- costs no meaningful extra tokens. Staff can always override manually.
ALTER TABLE public.bullion_vendors
  ADD COLUMN vendor_kind text NOT NULL DEFAULT 'jewellery'
  CONSTRAINT bullion_vendors_vendor_kind_chk CHECK (vendor_kind IN ('jewellery', 'service', 'other'));
