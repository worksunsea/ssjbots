// GET /api/digest-ping?mode=morning|evening — fired by cron-job.org at 9am/10pm IST.
// No AI here beyond the email summary (already generated earlier by
// emailDigest.js and just read back) — plain counts + a link to ssj-hr's
// /reporting dashboard.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { sendPushNotification } from "./_lib/pushNotify.js";
import { runEmailDigest } from "./_lib/emailDigest.js";
import { getUpcomingEvents, formatEventsLine } from "./_lib/birthdays.js";
import { getOverdueDelegations, getOpenHelpSlips, getPendingLeaves, getWalkinStats } from "./_lib/reportQueries.js";
import { OWNER_PHONE, DIGEST_EXTRA_RECIPIENTS, DIGEST_CRON_SECRET, REPORTING_URL, WA_SESSION_CLIENT_ID } from "./_lib/config.js";

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true; // dev mode
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!OWNER_PHONE) return res.status(200).json({ ok: false, error: "OWNER_PHONE not configured" });

  const mode = req.query?.mode === "evening" ? "evening" : "morning";
  const sb = supa();

  try {
    // Shared with the on-demand "give me reporting" WA command and the
    // /reporting dashboard, so these three surfaces can't drift apart again.
    const [delegations, slips, leaves, walkins] = await Promise.all([
      getOverdueDelegations(sb),
      getOpenHelpSlips(sb),
      getPendingLeaves(sb),
      getWalkinStats(sb),
    ]);
    const { count: pendingPettyCash } = await sb
      .from("petty_cash_txns")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    const parts = [];
    if (delegations.length) parts.push(`${delegations.length} overdue delegation${delegations.length > 1 ? "s" : ""}`);
    if (slips.length) parts.push(`${slips.length} help slip${slips.length > 1 ? "s" : ""}`);
    if (leaves.length) parts.push(`${leaves.length} leave${leaves.length > 1 ? "s" : ""}`);
    if (pendingPettyCash) parts.push(`${pendingPettyCash} petty cash`);

    const events = await getUpcomingEvents(sb, 2).catch((err) => {
      console.error("digest-ping: birthday/anniversary lookup failed", err);
      return [];
    });
    const eventsLine = formatEventsLine(events);
    const walkinLine = `🏪 Walk-ins: ${walkins.today} today, ${walkins.yesterday} yesterday`;

    const greeting = mode === "morning" ? "🔔 Morning check-in" : "🌙 Evening check-in";
    const teaser = parts.length ? `${parts.join(" + ")} pending` : "all clear";

    const emailResults = await runEmailDigest(sb).catch((err) => {
      console.error("digest-ping: email digest failed", err);
      return [];
    });
    const emailLines = emailResults
      .filter((r) => r.status === "ok" && r.summaryText && r.summaryText !== "Nothing urgent.")
      .map((r) => `📧 ${r.email}:\n${r.summaryText}`);

    // Cache-busting param — WhatsApp caches link previews per exact URL, so a
    // static link kept showing the stale first-ever preview (the page's
    // "Loading…" skeleton, scraped before og tags existed on the page).
    const cacheBust = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) + "-" + mode;
    const reportLink = `${REPORTING_URL}${REPORTING_URL.includes("?") ? "&" : "?"}d=${cacheBust}`;

    const msg = [
      `${greeting} — ${teaser} → ${reportLink}`,
      walkinLine,
      eventsLine,
      ...emailLines,
    ].filter(Boolean).join("\n\n");

    // OWNER_PHONE stays a single trusted number (webhook.js depends on strict
    // equality for owner WA commands) — extra digest recipients come from a
    // separate env var instead. Known extras get a name greeting.
    const RECIPIENT_NAMES = { "9810442333": "Sanjeev sir", "9990942333": "Seema mam" };
    const recipients = [OWNER_PHONE, ...DIGEST_EXTRA_RECIPIENTS.split(",")].map((p) => p.trim()).filter(Boolean);
    const results = await Promise.all(
      recipients.map((phone) => {
        const name = RECIPIENT_NAMES[phone.replace(/\D/g, "").slice(-10)];
        return sendWhatsApp({ phone, msg: name ? `Hi ${name},\n\n${msg}` : msg, client: WA_SESSION_CLIENT_ID });
      })
    );
    const sendErrors = [];
    results.forEach((wa, i) => {
      if (wa.status !== 1) {
        console.error(`digest-ping: WhatsApp send failed for ${recipients[i]}`, wa.message);
        sendErrors.push({ phone: recipients[i], error: wa.message });
      }
    });

    // App push for the owner — pending help slips and delegations, in
    // addition to the WhatsApp text above, so it also shows on the
    // installed app's lock screen.
    if (delegations.length || slips.length) {
      const pushParts = [];
      if (slips.length) pushParts.push(`${slips.length} pending help slip${slips.length > 1 ? "s" : ""}`);
      if (delegations.length) pushParts.push(`${delegations.length} pending delegation${delegations.length > 1 ? "s" : ""}`);
      await sendPushNotification({
        userId: "admin",
        title: mode === "morning" ? "🔔 Morning check-in" : "🌙 Evening check-in",
        body: pushParts.join(" + "),
        url: "/reporting",
      });
    }

    return res.status(200).json({
      ok: true,
      mode,
      sent: results.some((wa) => wa.status === 1),
      sendErrors,
      emailAccountsChecked: emailResults.length,
      upcomingEvents: events.length,
      overdueDelegations: delegations.length,
      walkinsToday: walkins.today,
    });
  } catch (err) {
    console.error("digest-ping error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
