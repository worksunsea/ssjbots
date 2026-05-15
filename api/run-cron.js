// POST /api/run-cron
// Manually triggers the cron from the CRM dashboard.
// Protected by x-crm-secret. Calls /api/cron internally with CRON_SECRET
// so the browser never sees the cron secret.

import { checkCrmSecret } from "./_lib/config.js";

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET || "";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  if (checkCrmSecret(req, res)) return;

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://ssjbot.gemtre.in";
    const r = await fetch(`${baseUrl}/api/cron`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const data = await r.json().catch(() => ({}));
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
