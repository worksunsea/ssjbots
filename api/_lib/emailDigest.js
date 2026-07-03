// Email inbox triage — IMAP fetch (subjects/senders only) + Claude Haiku summary.
// Raw email content is NEVER persisted: fetched transiently from IMAP, fed to
// Claude, then discarded. Only the generated summary text is written to
// email_digest_cache. Accounts (email + app password) live in ssj-hr's
// email_digest_accounts table, editable from the ssj-hr settings UI — not env vars.

import { ImapFlow } from "imapflow";
import { askClaude } from "./claude.js";
import { TENANT_ID, CLAUDE_MODEL } from "./config.js";

const WINDOW_MS = 13 * 60 * 60 * 1000; // covers the gap between the 9am/10pm runs
const RETENTION_DAYS = 15;
const MAX_MESSAGES_PER_ACCOUNT = 40;

function inferImapHost(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (domain === "gmail.com") return "imap.gmail.com";
  if (domain === "yahoo.com" || domain === "yahoo.co.in" || domain === "ymail.com") return "imap.mail.yahoo.com";
  return null;
}

async function fetchRecentHeaders(account) {
  const host = account.imap_host || inferImapHost(account.email);
  if (!host) throw new Error(`no imap host known for ${account.email}`);

  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.app_password },
    logger: false,
  });

  const headers = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - WINDOW_MS);
      const uids = await client.search({ since }, { uid: true });
      const slice = (uids || []).slice(-MAX_MESSAGES_PER_ACCOUNT);
      if (slice.length) {
        for await (const msg of client.fetch(slice, { envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0];
          headers.push({
            from: from ? `${from.name || ""} <${from.address || ""}>`.trim() : "unknown",
            subject: msg.envelope?.subject || "(no subject)",
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return headers;
}

async function summarize(email, headers) {
  if (!headers.length) return "No new mail in this window.";
  const list = headers.map((h, i) => `${i + 1}. From: ${h.from} — Subject: ${h.subject}`).join("\n");
  const system = [
    "You triage a business owner's inbox. You are given only sender + subject lines, no email bodies.",
    "List only what genuinely needs his personal attention today, as 3-6 short bullets (use '-' prefix).",
    "Ignore newsletters, marketing, automated notifications, and anything routine.",
    "If nothing needs attention, reply with exactly: Nothing urgent.",
    "No preamble, no markdown headers — just the bullets or that one line.",
  ].join("\n");
  try {
    const { text } = await askClaude({
      system,
      messages: [{ role: "user", content: `Inbox: ${email}\n\n${list}` }],
      maxTokens: 300,
      model: CLAUDE_MODEL,
    });
    return text.trim() || "Nothing urgent.";
  } catch (err) {
    return `Summary unavailable — ${String(err.message || err)}`;
  }
}

// Runs the full email-digest cycle: load accounts, fetch+summarize each,
// write results to email_digest_cache, prune rows older than 15 days.
export async function runEmailDigest(sb) {
  const { data: accounts } = await sb
    .from("email_digest_accounts")
    .select("email, app_password, imap_host")
    .eq("tenant_id", TENANT_ID);

  const results = [];
  for (const account of accounts || []) {
    let summaryText, status;
    try {
      const headers = await fetchRecentHeaders(account);
      summaryText = await summarize(account.email, headers);
      status = "ok";
    } catch (err) {
      summaryText = `Inbox check failed — ${String(err.message || err)}. Password may need updating.`;
      status = "error";
    }
    results.push({ email: account.email, summaryText, status });
  }

  if (results.length) {
    await sb.from("email_digest_cache").insert(
      results.map((r) => ({
        tenant_id: TENANT_ID,
        account_email: r.email,
        summary_text: r.summaryText,
        status: r.status,
      }))
    );
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  await sb.from("email_digest_cache").delete().eq("tenant_id", TENANT_ID).lt("created_at", cutoff);

  return results;
}
