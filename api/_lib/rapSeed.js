import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./config.js";

const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";

/**
 * The hardcoded seed tables are stored as the PDF prints them:
 * rows = colour (D..M), cols = clarity (IF..I3, 11 cols incl. SI3).
 * rapLookup() reads tables[bracket][clarity][colour] and has no SI3 column,
 * so seed data must be transposed and SI3 (col 7) dropped before use.
 * Without this, every price read from seed data is the wrong cell.
 */
export function orientSeed(seed) {
  const out = {};
  for (const [bracket, rows] of Object.entries(seed)) {
    const table = Array.from({ length: 10 }, () => Array(11).fill(null));
    rows.forEach((row, colorIdx) => {
      row.forEach((val, col) => {
        if (col === 7) return; // SI3 is not stored
        const clarityIdx = col < 7 ? col : col - 1;
        table[clarityIdx][colorIdx] = val;
      });
    });
    out[bracket] = table;
  }
  return out;
}

/** Current rapaport_data row from Supabase, or null. */
export async function fetchExistingRapData() {
  if (!SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT}&select=value&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
  } catch {
    return null;
  }
}
