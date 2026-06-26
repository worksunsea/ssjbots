-- Extend bullion_visits with session tracking fields
ALTER TABLE bullion_visits
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS temperature text,
  ADD COLUMN IF NOT EXISTS party_size int,
  ADD COLUMN IF NOT EXISTS time_out timestamptz,
  ADD COLUMN IF NOT EXISTS price_quoted numeric,
  ADD COLUMN IF NOT EXISTS followup_required boolean DEFAULT false;

-- Link estimates to visit sessions
ALTER TABLE bullion_estimates
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES bullion_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bullion_visits_date_idx ON bullion_visits (tenant_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS bullion_estimates_visit_idx ON bullion_estimates (visit_id);
