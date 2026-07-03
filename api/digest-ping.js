// GET /api/digest-ping?mode=morning|evening — fired by cron-job.org at 9am/10pm IST.
// No AI here: just plain counts + a link to ssj-hr's /reporting dashboard.
// Also refreshes the email-digest cache (the one place AI is used) so the
// dashboard has a same-day summary ready when Saurav opens it.

import { supa } from "./_lib/supabase.js";
import { sendWhatsApp } from "./_lib/wa.js";
import { runEmailDigest } from "./_lib/emailDigest.js";
import { TENANT_ID, OWNER_PHONE, DIGEST_CRON_SECRET, REPORTING_URL } from "./_lib/config.js";

function checkAuth(req) {
  if (!DIGEST_CRON_SECRET) return true; // dev mode
  const header = req.headers["x-cron-secret"] || req.headers["x-vercel-cron"] || "";
  const query = req.query?.secret || "";
  return header === DIGEST_CRON_SECRET || query === DIGEST_CRON_SECRET || Boolean(req.headers["x-vercel-cron"]);
}

async function count(sb, table, build) {
  let q = sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
  if (build) q = build(q);
  const { count: n } = await q;
  return n || 0;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!OWNER_PHONE) return res.status(200).json({ ok: false, error: "OWNER_PHONE not configured" });

  const mode = req.query?.mode === "evening" ? "evening" : "morning";
  const sb = supa();

  try {
    const [pendingDelegations, pendingSlips, pendingLeaves] = await Promise.all([
      count(sb, "tasks", (q) => q.ilike("assigned_by", "Saurav").in("status", ["Pending", "In Progress", "Pending Approval"])),
      count(sb, "help_slips", (q) => q.ilike("assigned_to", "Saurav").neq("status", "Resolved")),
      count(sb, "leaves", (q) => q.eq("status", "Pending")),
    ]);
    // petty_cash_txns has no tenant_id column — count separately, unfiltered.
    const { count: pendingPettyCash } = await sb
      .from("petty_cash_txns")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    const parts = [];
    if (pendingDelegations) parts.push(`${pendingDelegations} task${pendingDelegations > 1 ? "s" : ""}`);
    if (pendingSlips) parts.push(`${pendingSlips} help slip${pendingSlips > 1 ? "s" : ""}`);
    if (pendingLeaves) parts.push(`${pendingLeaves} leave${pendingLeaves > 1 ? "s" : ""}`);
    if (pendingPettyCash) parts.push(`${pendingPettyCash} petty cash`);

    const greeting = mode === "morning" ? "🔔 Morning check-in" : "🌙 Evening check-in";
    const teaser = parts.length ? `${parts.join(" + ")} pending` : "all clear";
    const msg = `${greeting} — ${teaser} → ${REPORTING_URL}`;

    const wa = await sendWhatsApp({ phone: OWNER_PHONE, msg });

    const emailResults = await runEmailDigest(sb).catch((err) => {
      console.error("digest-ping: email digest failed", err);
      return [];
    });

    return res.status(200).json({ ok: true, mode, sent: wa.status === 1, emailAccountsChecked: emailResults.length });
  } catch (err) {
    console.error("digest-ping error", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
