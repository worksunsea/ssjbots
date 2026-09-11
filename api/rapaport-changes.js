// GET /api/rapaport-changes
// Compares the current live rapaport_data against the most recent snapshot in
// bullion_rapaport_history (written just before each overwrite by
// rapaport-upload.js / rapaport-sync.js) and returns a simple per-bracket
// +/- summary — "what changed since the last report" for the Calculator to
// flag on load. No auth — same public-pricing posture as rapaport-sync GET.

import { SUPABASE_URL, SUPABASE_SERVICE_KEY, TENANT_ID } from "./_lib/config.js";

const WEIGHT_RANGES = ["0.30","0.40","0.50","0.70","0.90","1.00","1.50","2.00","3.00","4.00","5.00"];

function diffShape(oldT, newT) {
  const brackets = [];
  let anyUp = false, anyDown = false;
  for (const bracket of WEIGHT_RANGES) {
    const ot = oldT?.[bracket], nt = newT?.[bracket];
    if (!ot || !nt) continue;
    let sumOld = 0, sumNew = 0, n = 0;
    for (let ci = 0; ci < 10; ci++) {
      for (let coi = 0; coi < 11; coi++) {
        const ov = ot[ci]?.[coi], nv = nt[ci]?.[coi];
        if (ov == null || nv == null) continue;
        sumOld += ov; sumNew += nv; n++;
      }
    }
    if (n === 0) continue;
    const avgOld = sumOld / n, avgNew = sumNew / n;
    const pct = avgOld ? ((avgNew - avgOld) / avgOld) * 100 : 0;
    if (pct > 0.05) anyUp = true;
    if (pct < -0.05) anyDown = true;
    brackets.push({
      bracket,
      direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat",
      pct: Math.round(pct * 100) / 100,
      inrOldPerCt: Math.round(avgOld * 100 * 96),
      inrNewPerCt: Math.round(avgNew * 100 * 96),
    });
  }
  return { brackets, overall: anyUp && anyDown ? "mixed" : anyUp ? "up" : anyDown ? "down" : "flat" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

  const [currentRes, historyRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/bullion_dropdowns?field=eq.rapaport_data&tenant_id=eq.${TENANT_ID}&select=value`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/bullion_rapaport_history?tenant_id=eq.${TENANT_ID}&select=date,rounds,fancy&order=created_at.desc&limit=1`, { headers }),
  ]);

  if (!currentRes.ok) return res.status(500).json({ ok: false, error: "failed_to_load_current_rapaport_data" });
  const currentRows = await currentRes.json().catch(() => []);
  if (!currentRows?.[0]?.value) return res.status(200).json({ ok: true, hasChanges: false, reason: "no_current_data" });
  const current = JSON.parse(currentRows[0].value);

  if (!historyRes.ok) return res.status(200).json({ ok: true, hasChanges: false, reason: "no_history_yet" });
  const historyRows = await historyRes.json().catch(() => []);
  const previous = historyRows?.[0];
  if (!previous || previous.date === current.date) {
    return res.status(200).json({ ok: true, hasChanges: false, reason: "no_prior_snapshot_or_same_date" });
  }

  const rounds = diffShape(previous.rounds, current.rounds);
  const fancy = diffShape(previous.fancy, current.fancy);
  const hasChanges = rounds.overall !== "flat" || fancy.overall !== "flat";

  return res.status(200).json({
    ok: true,
    hasChanges,
    previousDate: previous.date,
    currentDate: current.date,
    rounds,
    fancy,
  });
}
