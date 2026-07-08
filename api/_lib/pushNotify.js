// Server-to-server push notifications — routes through ssj-hr's existing
// /api/push + push_subscriptions table (shared Supabase project) rather
// than standing up a separate native push pipeline for this app. No CORS
// needed since this always runs server-side.
//
// userId: a real staff.id, "admin" (all superadmin/admin staff), or "all".
export async function sendPushNotification({ userId, title, body, url }) {
  try {
    const res = await fetch('https://hr.gemtre.in/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, body, url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `http_${res.status}` };
    return { ok: true, sent: data.sent };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}
