// POST /api/notify-task-assigned — called by ssj-hr's api/notify-task-assigned.js
// server-to-server. Plain template, no AI — sends the assignee a WhatsApp
// text when a delegation is created in the app UI (mirrors what
// taskCommand.js already does for WA-command-created tasks).

import { sendWhatsApp } from "./_lib/wa.js";
import { TASKS_WA_CLIENT_ID } from "./_lib/config.js";

const STAFF_OTP_SECRET = process.env.STAFF_OTP_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!STAFF_OTP_SECRET || req.headers["x-staff-otp-secret"] !== STAFF_OTP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { phone, name, title, due_date, assigned_by } = req.body || {};
  if (!phone || !title) return res.status(400).json({ ok: false, error: "missing_phone_or_title" });

  const dueText = due_date ? ` — due ${due_date}` : "";
  const msg = `📋 Hi ${name || "there"}, new task from ${assigned_by || "your manager"}: "${title}"${dueText}`;
  const wa = await sendWhatsApp({ phone, msg, client: TASKS_WA_CLIENT_ID });

  if (wa.status !== 1) return res.status(502).json({ ok: false, error: wa.message });
  return res.json({ ok: true });
}
