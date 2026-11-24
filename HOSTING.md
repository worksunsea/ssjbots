# HOSTING (read first)

**Production for this app is the owner's Hostinger server (srv2184647), with a self-hosted Supabase database and file storage on the same server.**
It does NOT run on Vercel, and the old cloud Supabase projects are stale (read-only history). SSJ bots / CRM API (ssjbot.gemtre.in).

## Rules for every developer and every Claude session
- Do NOT deploy to Vercel. Do not run the `vercel` CLI, do not push expecting Vercel to build, do not add `VERCEL_TOKEN` or Vercel steps to CI.
- Do NOT connect to, query, migrate or upload files to any `*.supabase.co` project. Never paste SQL into the old Supabase dashboard.
- Database changes: run the repo's schema scripts against the server database only (owner-run, after a backup). See `C:\projects\server-ops` notes.
- Uploads and files go to the self-hosted storage on the server (the app's `.env` on the server points there). Never to cloud buckets.
- Secrets live only in `/opt/stack/ssjbots/.env` on the server. Never commit them or print them.

## How a change goes live
1. Commit and push to GitHub as usual (branch -> review -> `master`/`main`). GitHub is source control only; it does not deploy.
2. Owner deploys from the NUC over Tailscale: `sh C:\projects\server-ops\deploy-app.sh ssjbots <path to this repo>`
   (ships tracked files, builds the docker image on the server, restarts the container).
3. Check: the site answers and `docker ps` on the server shows the `ssjbots` container healthy. The server watchdog also alerts the owner on WhatsApp.

## Developers (not the owner)
- Work on your own machine. Never ask for production secrets.
- To see your branch running: push a branch named `preview`; the owner's preview script builds it on the server and you open it over Tailscale (ports 9441+). Your access list is `/etc/preview/access.conf`.
- Local `.env.local` must NOT point at a `*.supabase.co` URL. Ask the owner for a preview environment instead.

## Server facts
- Server: `ssh -i ~/.ssh/hostinger_ed25519 root@100.97.29.122` (Tailscale only). App files and env: `/opt/stack/ssjbots/`.
- Reverse proxy: Caddy (docker, host network). Database gateway for the browser: `/sb/` on the app's domain.
- `vercel.json` (if present) is kept only as the source list for server cron jobs (`server-ops/make-crons.js`) and route rewrites.
