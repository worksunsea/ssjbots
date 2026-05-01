// Load-balanced telecaller assignment for demands that hit a `call` step.
//
// Strategy: pick the telecaller with the fewest currently-open (no outcome) demands.
// On a tie, fall back to round-robin via bullion_telecaller_rotation so we don't
// always pick the same person. Telecallers are staff rows whose app_permissions
// JSONB contains "telecaller" or whose `role` column is 'telecaller'.

import { supa } from "./supabase.js";

const isTelecaller = (s) => {
  if (!s) return false;
  if (s.role === "telecaller") return true;
  const p = s.app_permissions;
  if (!p || typeof p !== "object") return false;
  for (const v of Object.values(p)) {
    if (Array.isArray(v) && v.includes("telecaller")) return true;
  }
  return false;
};

/**
 * Pick the lowest-load telecaller and write the assignment onto the demand.
 *
 * Load = number of active demands (outcome IS NULL) assigned to that telecaller.
 * On a tie, we pick the next one after the last round-robin pointer so the same
 * person isn't always chosen when everyone has the same load.
 *
 * Returns the chosen staff row, or null if no telecallers are configured.
 */
export async function assignNextTelecaller(tenantId, demandId) {
  if (!tenantId || !demandId) return null;
  const sb = supa();

  // 1) Get all telecallers sorted by id (stable order for round-robin tiebreak)
  const { data: staffList } = await sb.from("staff")
    .select("id, name, username, role, app_permissions")
    .eq("tenant_id", tenantId);
  const telecallers = (staffList || [])
    .filter(isTelecaller)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!telecallers.length) {
    console.warn("assignNextTelecaller: no telecallers configured for tenant", tenantId);
    return null;
  }

  // 2) Count open demands per telecaller
  const { data: loadRows } = await sb.from("bullion_demands")
    .select("assigned_staff_id")
    .eq("tenant_id", tenantId)
    .is("outcome", null)
    .in("assigned_staff_id", telecallers.map((s) => s.id));

  const loadMap = {};
  for (const tc of telecallers) loadMap[tc.id] = 0;
  for (const row of loadRows || []) {
    if (row.assigned_staff_id) loadMap[row.assigned_staff_id] = (loadMap[row.assigned_staff_id] || 0) + 1;
  }

  // 3) Find minimum load
  const minLoad = Math.min(...Object.values(loadMap));

  // 4) Candidates with minimum load
  const candidates = telecallers.filter((s) => loadMap[s.id] === minLoad);

  // 5) Round-robin tiebreak among candidates
  const { data: rotRow } = await sb.from("bullion_telecaller_rotation")
    .select("last_staff_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const lastId = rotRow?.last_staff_id || null;

  let picked;
  if (candidates.length === 1) {
    picked = candidates[0];
  } else {
    const lastIdx = candidates.findIndex((s) => s.id === lastId);
    picked = candidates[(lastIdx + 1) % candidates.length];
  }

  // 6) Write assignment onto demand + update rotation pointer
  await sb.from("bullion_demands")
    .update({
      assigned_staff_id: picked.id,
      assigned_to: picked.name || picked.username || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", demandId);

  await sb.from("bullion_telecaller_rotation")
    .upsert(
      { tenant_id: tenantId, last_staff_id: picked.id, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    );

  return picked;
}
