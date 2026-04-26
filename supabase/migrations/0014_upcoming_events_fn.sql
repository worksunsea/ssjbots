-- Returns upcoming birthdays and anniversaries within the next N days for a tenant.
-- next_occurrence is always in the current or next calendar year.
CREATE OR REPLACE FUNCTION upcoming_events(p_tenant_id uuid, p_days int DEFAULT 30)
RETURNS TABLE (
  id         uuid,
  name       text,
  phone      text,
  city       text,
  event_type text,   -- 'bday' | 'anniversary'
  raw_date   text,
  days_until int,
  next_date  date
) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      l.id, l.name, l.phone, l.city,
      'bday'        AS event_type,
      l.bday        AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.bday IS NOT NULL AND l.bday <> ''
    UNION ALL
    SELECT
      l.id, l.name, l.phone, l.city,
      'anniversary' AS event_type,
      l.anniversary AS raw_date
    FROM bullion_leads l
    WHERE l.tenant_id = p_tenant_id AND l.anniversary IS NOT NULL AND l.anniversary <> ''
  ),
  parsed AS (
    SELECT
      b.*,
      -- Handle MM-DD (length 5) and YYYY-MM-DD (length 10)
      CASE
        WHEN length(b.raw_date) = 5
          THEN to_date(extract(year FROM current_date)::text || '-' || b.raw_date, 'YYYY-MM-DD')
        WHEN length(b.raw_date) = 10
          THEN to_date(extract(year FROM current_date)::text || '-' || substring(b.raw_date FROM 6), 'YYYY-MM-DD')
        ELSE NULL
      END AS this_year_date
    FROM base b
  ),
  next_occ AS (
    SELECT
      p.*,
      CASE
        WHEN p.this_year_date >= current_date THEN p.this_year_date
        ELSE p.this_year_date + interval '1 year'
      END AS next_date
    FROM parsed p
    WHERE p.this_year_date IS NOT NULL
  )
  SELECT
    n.id, n.name, n.phone, n.city,
    n.event_type,
    n.raw_date,
    extract(day FROM (n.next_date - current_date))::int AS days_until,
    n.next_date
  FROM next_occ n
  WHERE extract(day FROM (n.next_date - current_date))::int <= p_days
    AND extract(day FROM (n.next_date - current_date))::int >= 0
  ORDER BY n.next_date ASC, n.name ASC;
$$;
