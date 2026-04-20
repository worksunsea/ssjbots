# SSJ WA Service

A tiny Node.js service that pairs with WhatsApp Web (via Baileys) and:

1. **Receives** every incoming message and forwards it to the Vercel bot at `/api/webhook`.
2. **Sends** text messages when Vercel (or the CRM) calls `POST /send`.

This replaces WbizTool as the inbound+outbound channel. WbizTool docs confirm they're send-only, so this service is the missing "receive" piece.

## Endpoints

| Method | Path    | Auth        | Purpose |
|--------|---------|-------------|---------|
| GET    | /health | none        | Liveness |
| GET    | /status | none        | Connection state |
| GET    | /qr     | none        | HTML page with a QR code to scan (once per pair) |
| POST   | /send   | x-service-secret header | `{phone, message}` → sends WhatsApp text |
| POST   | /logout | x-service-secret header | Disconnects + requires re-pair |

## Deploy on Synology

```bash
# SSH into the NAS, then:
cd /volume1/docker
git clone https://github.com/worksunsea/ssjbots.git
cd ssjbots/wa-service
cp .env.example .env
# Fill in SERVICE_SECRET (openssl rand -hex 16) and WA_CLIENT_ID

docker compose up -d --build

# Watch boot logs
docker logs -f ssj-wa-service
# When you see "QR ready — open /qr to scan", open http://<nas-ip>:3021/qr
# and scan with the phone for the WhatsApp number you want to pair.
```

## Expose to Vercel

Vercel Functions need to reach `POST /send`. Options:
- **Cloudflared tunnel** (recommended — you already run one for n8n). Add a subdomain like `wa.orvialuxe.com` pointing to `http://localhost:3021`.
- Or open NAS port 3021 via DDNS/port-forward (less secure, needs TLS too).

## Multiple WhatsApp numbers

Run one container per number:
- `docker compose -p ssj-test up -d` with `WA_CLIENT_ID=ssj-test` + port `3021`
- `docker compose -p ssj-prod up -d` with `WA_CLIENT_ID=ssj-prod` + port `3022` + different auth volume

The `WA_CLIENT_ID` is what gets sent as `whatsapp_client` in the forward — which the bot uses to look up the right funnel in Supabase.

## Session persistence

Baileys credentials live in `./auth` (mounted into the container). **Back this folder up.** If you lose it, you have to re-scan the QR and the lead gets a new session.

## Terms of use

This uses the unofficial WhatsApp Web protocol, same as WbizTool. Meta can ban a number they flag. Mitigations:
- Use `./auth` from one phone, don't share it
- Don't mass-blast — 30–45s between sends, 5–10 min breaks per 20 msgs (already enforced in the bot)
- Test on the test number (9312839912) first before pairing the production SIM
- Have a Meta Cloud API fallback for production longevity

## Tech

- [Baileys](https://github.com/WhiskeySockets/Baileys) 6.x — WebSocket client for WhatsApp Web
- [Fastify](https://fastify.dev/) 5.x — HTTP server
- Node 20 on Alpine
