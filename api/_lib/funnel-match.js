// Match an inbound WhatsApp message to a funnel by keywords.
// Keywords are stored comma-separated on funnels.match_keywords.
// Match is case-insensitive substring.

export function matchFunnelByKeywords(msg, funnels) {
  const body = String(msg || "").toLowerCase();
  if (!body) return null;

  let best = null;
  let bestScore = 0;

  for (const f of funnels) {
    if (!f.match_keywords) continue;
    const kws = String(f.match_keywords)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    let score = 0;
    for (const k of kws) {
      if (body.includes(k)) score++;
    }
    // Prefer funnels with more matches; tie-break on first found.
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  return bestScore > 0 ? best : null;
}
