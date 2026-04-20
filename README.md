# SSJ Bullion Bot

WhatsApp AI sales bot + admin CRM for **Sun Sea Jewellers, Karol Bagh, New Delhi** (est. 1984).

Built on **Supabase + Vercel + GitHub** — same stack as ssj-hr and fms-tracker. No n8n, no Synology, no servers to keep alive.

## Architecture

```
   WhatsApp (user)
        ↕
   WbizTool ──incoming webhook──→ POST /api/webhook  (Vercel Function)
                                         │
              ┌──────────────────────────┼────────────────────────────┐
              ↓                          ↓                            ↓
        Supabase Postgres         Claude Haiku API              WbizTool send API
        · personas                (model picked per funnel)     (after 30–45s delay)
        · funnels
        · bullion_leads
        · bullion_messages
                  ↑
                  │ reads/writes
                  │
           Admin CRM (Vite + React — same Vercel project)

      Google Sheet "new" tab ──→ Apps Script rates proxy (read-only)
```

Everything in one Vercel project:
- **Frontend** — Vite + React 19 CRM, single-file `src/App.jsx`.
- **Backend** — Vercel Functions under `api/`. The webhook handler does the full bot loop synchronously (~30–45s per message).
- **DB** — shared Sun Sea Supabase project `uppyxzellmuissdlxsmy`, tenant `a1b2c3d4-...-0001`.

## Repo layout

```
ssjbots/
├── src/App.jsx              single-file CRM (Login · Leads · Funnels · Personas · Rates · Analytics)
├── src/main.jsx
├── api/
│   ├── webhook.js           POST handler — the whole bot loop
│   ├── health.js            GET /api/health — env + deploy sanity check
│   └── _lib/                shared server modules (supabase, claude, wbiztool, prompt, rates, config)
├── package.json             Vite + React 19 + @supabase/supabase-js only
├── vite.config.js
├── vercel.json              SPA rewrites (API routes auto-detected by Vercel)
├── supabase/
│   ├── migrations/
│   │   ├── 0001_bullion_bot.sql     tables + view + RLS
│   │   └── 0002_rpc_upsert_lead.sql the RPC the webhook calls
│   └── seed.sql             3 personas, 3 funnels
├── apps-script/Code.gs      rates-only proxy (already deployed)
└── docs/setup-checklist.md
```

## Environment variables (Vercel)

Set these in Vercel → Project → Settings → Environment Variables (Production + Preview):

| Name | Where it's used | Source |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | all writes from `/api/*` | Supabase dashboard → Settings → API → service_role |
| `ANTHROPIC_API_KEY` | Claude call in webhook | https://console.anthropic.com |
| `WEBHOOK_SECRET` | guards `/api/webhook?secret=...` | any random string you pick |
| `WBIZTOOL_API_KEY` | send (optional override) | already has default `0be8d83d92aceaef87` |
| `CLAUDE_MODEL` | override model (optional) | default `claude-haiku-4-5-20251001` |
| `OWNER_ALERT_PHONE` | handoff alert destination | default `8860866000` |
| `OWNER_ALERT_WA_CLIENT` | handoff alert WA client | default `7560` |

Frontend env vars: none. The browser only talks to Supabase with the public anon key (hardcoded, RLS-gated).

## Local dev

```bash
npm install
npm run dev                 # Vite at :5173 — frontend only
npx vercel dev              # Vite + /api/* together (needs Vercel CLI + env vars)
```

For local webhook testing, expose `vercel dev` via `ngrok http 3000` and point WbizTool at the ngrok URL.

## Deploy

One-time:
1. Push to GitHub.
2. Import repo on Vercel (Framework preset: Vite).
3. Add env vars above.
4. Deploy.
5. Copy the production URL → paste into WbizTool dashboard as the **Incoming message webhook** for clients `7560` (prod) and `7563` (test). Path: `https://<prod>.vercel.app/api/webhook?secret=<WEBHOOK_SECRET>`.

See [`docs/setup-checklist.md`](docs/setup-checklist.md) for the full checklist.

## Adding a new funnel (no code change)

1. Log into the CRM → **Funnels** tab → **+ New funnel**.
2. Pick a persona (or create a new one in the Personas tab).
3. Fill in description + goal + WhatsApp client id.
4. Save. The bot starts responding to that WA client immediately.

## Credentials / ids

- Supabase URL: `https://uppyxzellmuissdlxsmy.supabase.co`
- Tenant id: `a1b2c3d4-0000-0000-0000-000000000001`
- WbizTool client id: `13004`
- WA client 7560 = production (8860866000)
- WA client 7563 = test (9312839912)

Service keys live only in Vercel env vars — never in this repo.
