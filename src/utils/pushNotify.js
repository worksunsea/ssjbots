// Push notifications from the browser — routes through ssj-hr's /api/push +
// shared push_subscriptions table (same Supabase project), CORS-enabled for
// this app's origin, so lead/demand assignment (a client-side action here)
// can notify the assignee without a round-trip through our own backend.
//
// userId: a real staff.id, "admin" (all superadmin/admin staff), or "all".
export async function sendPushNotification({ userId, title, body, url }) {
  try {
    const res = await fetch("https://hr.gemtre.in/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, title, body, url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `http_${res.status}` };
    return { ok: true, sent: data.sent };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}
