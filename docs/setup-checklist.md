# SSJ Bullion Bot — Setup Checklist

Ordered from blank repo to live WhatsApp bot. Stack: **Supabase + Vercel + GitHub** — no other infra.

## 1. Supabase schema (2 min)

1. Open [Supabase SQL editor](https://supabase.com/dashboard/project/uppyxzellmuissdlxsmy/sql/new).
2. Run `supabase/migrations/0001_bullion_bot.sql`.
3. Run `supabase/migrations/0002_rpc_upsert_lead.sql`.
4. Run `supabase/seed.sql`.
5. Sanity: `select id, name, active from public.funnels;` → 3 rows (f1, f2 active; f3 off).

## 2. Apps Script rates proxy (already deployed)

No action unless you want to redeploy the trimmed `apps-script/Code.gs`. Current URL still serves rates.

## 3. GitHub (2 min)

```bash
cd /Users/sg/ssjbots
git init
git add .
git commit -m "Initial commit"
gh repo create ssjbots --private --source=. --remote=origin --push
```

## 4. Vercel deploy (3 min)

1. On Vercel dashboard → **Add New Project** → import the `ssjbots` repo.
2. Framework preset: **Vite** (auto-detected).
3. Before the first deploy, set **Environment Variables** (Production + Preview):
   - `SUPABASE_SERVICE_KEY` = Supabase → Settings → API → `service_role` secret
   - `ANTHROPIC_API_KEY` = your Claude API key
   - `WEBHOOK_SECRET` = any random string (e.g. `openssl rand -hex 16`)
4. Deploy.
5. After deploy: `curl https://<your-app>.vercel.app/api/health` → all three env flags should be `true`.

## 5. WbizTool incoming webhook (2 min)

1. Log into WbizTool dashboard.
2. For each WhatsApp client (7560 production, 7563 test), set the **Incoming webhook URL** to:
   ```
   https://<your-app>.vercel.app/api/webhook?secret=<WEBHOOK_SECRET>
   ```
3. Save.

## 6. End-to-end smoke test (5 min)

1. CRM → Funnels → enable **f3 (Test)**.
2. From your personal phone, WhatsApp the test number **9312839912** with "hi".
3. Within ~45 seconds you should get a reply.
4. Check the CRM:
   - **Leads** tab → new lead appears within 15s (polling interval).
   - Click it → see both messages in the thread, stage updated by Claude.
5. In Supabase SQL editor: `select * from bullion_messages order by created_at desc limit 5;` → both in and out rows.

## 7. Go live (1 min)

1. Funnels → confirm **f1 (Gold)** and **f2 (Silver)** are active.
2. Funnels → **disable f3** unless you want test traffic hitting the bot.
3. Point Meta/Google ads at WhatsApp 8860866000.
4. Watch the CRM.

## 8. Iterate on personas (ongoing)

- CRM → **Analytics** — per-funnel conversion % + stage drop-off.
- If a funnel's conversion is low → **Personas** → edit that funnel's persona system prompt.
- Create a new persona instead of editing the default if you want to A/B (clone the funnel, pick different persona, disable the old one).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `curl /api/health` shows `supabase_service_key: false` | Env var not set on Vercel. Set it + redeploy. |
| WhatsApp sent but no CRM lead row | Check Vercel → Logs → `/api/webhook` for errors. Most common: Supabase RPC not created — re-run migration 0002. |
| Bot replies with "Thanks! Our team will get back shortly" only | Claude API failed. Check `ANTHROPIC_API_KEY` + Vercel logs. |
| `action` is always HANDOFF | Claude returned non-JSON. Tighten the persona `system_prompt` to re-emphasize JSON-only output. |
| Outside-hours replies | The bot replies 24/7 by default. If you want a window, add a time-check in `api/webhook.js` near the sleep. |
| Rates stale in replies | Update the Google Sheet "new" tab. There's a 60s in-function cache, next reply picks up fresh rates. |
| WbizTool send returns `status: 0` | Wrong `wbiztool_client` id for the funnel. Check WbizTool dashboard → Whatsapp Phones. |

## What lives where

- **CRM source** — `src/App.jsx`
- **Bot source** — `api/webhook.js` + `api/_lib/*`
- **DB schema** — `supabase/migrations/*.sql`
- **Rates** — Google Sheet tab `new` → Apps Script `?action=rates`
- **Auth for CRM** — `public.staff` table (reused from ssj-hr). Role must be `superadmin` or `admin`.
- **Credentials** — only in Vercel env vars, never in the repo.

## Rotate Anthropic key after launch

The Anthropic key used during setup was sourced from an older credentials file that was exposed in a Claude Code chat. After the bot is running, rotate it:

1. https://console.anthropic.com → Settings → API Keys → delete old key.
2. Generate new key.
3. Vercel → Project → Settings → Environment Variables → update `ANTHROPIC_API_KEY`.
4. Redeploy (or hit **Redeploy latest** in Vercel UI).
