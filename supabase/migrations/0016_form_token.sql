-- Add form_token to bullion_leads for the customer profile update link.
ALTER TABLE bullion_leads ADD COLUMN IF NOT EXISTS form_token uuid DEFAULT gen_random_uuid();
UPDATE bullion_leads SET form_token = gen_random_uuid() WHERE form_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bullion_leads_form_token_idx ON bullion_leads (form_token);
