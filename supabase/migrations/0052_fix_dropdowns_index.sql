-- The existing unique index on (tenant_id, field, value) prevents storing large JSON values
-- (btree max 2704 bytes). Drop it and replace with (tenant_id, field) only.

ALTER TABLE bullion_dropdowns
  DROP CONSTRAINT IF EXISTS bullion_dropdowns_tenant_id_field_value_key;

DROP INDEX IF EXISTS bullion_dropdowns_tenant_id_field_value_key;

CREATE UNIQUE INDEX IF NOT EXISTS bullion_dropdowns_tenant_field_key
  ON bullion_dropdowns(tenant_id, field);
