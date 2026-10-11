// Pushes the freshly loaded price grid to the standalone Diapri calculator app.
// OFF unless DIAPRI_FEED_ENABLED=true — keep it off until the data may be republished.

/** Only plain numbers leave the CRM: date + round/fancy tables, nothing else. */
export function toIngestPayload(stored) {
  if (!stored?.date || !stored.rounds) return null;
  return { date: stored.date, rounds: stored.rounds, ...(stored.fancy ? { fancy: stored.fancy } : {}) };
}

export function feedEnabled(env = process.env) {
  return String(env.DIAPRI_FEED_ENABLED || "").toLowerCase() === "true" && Boolean(env.DIAPRI_APP_URL) && Boolean(env.DIAPRI_INGEST_SECRET);
}

/**
 * @returns {Promise<{ pushed: boolean, reason?: string }>} never throws — a failed push must not undo the CRM load.
 */
export async function pushToDiapriApp(stored, env = process.env, fetchFn = fetch) {
  if (!feedEnabled(env)) return { pushed: false, reason: "feed disabled" };
  const payload = toIngestPayload(stored);
  if (!payload) return { pushed: false, reason: "nothing to send" };
  try {
    const r = await fetchFn(`${String(env.DIAPRI_APP_URL).replace(/\/+$/, "")}/api/ingest-diapri`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": env.DIAPRI_INGEST_SECRET },
      body: JSON.stringify(payload),
    });
    return r.ok ? { pushed: true } : { pushed: false, reason: `app answered HTTP ${r.status}` };
  } catch (e) {
    return { pushed: false, reason: "app unreachable" };
  }
}
