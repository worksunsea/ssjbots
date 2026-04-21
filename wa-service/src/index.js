// HTTP API over multi-session Baileys.
//
// New multi-session routes (primary):
//   GET  /clients                  — list known sessions + status
//   POST /clients                  — body {client_id} — create/pair a new session
//   GET  /clients/:id/status       — single session status
//   GET  /clients/:id/qr           — HTML QR page (auto-refreshes)
//   POST /clients/:id/send         — {phone|jid, message} → send via this session (auth)
//   POST /clients/:id/logout       — disconnect + wipe auth (auth)
//
// Legacy single-session routes (default client fallback — kept for back-compat):
//   GET  /health /status /qr
//   POST /send /logout

import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  bootAllSessions,
  connectClient,
  sendForClient,
  getClients,
  getClientState,
  logoutClient,
  defaultClientId,
} from "./baileys.js";

const PORT = Number(process.env.PORT || 3000);
const SERVICE_SECRET = process.env.SERVICE_SECRET || "";
const VERCEL_WEBHOOK_URL = process.env.VERCEL_WEBHOOK_URL || "";
const VERCEL_WEBHOOK_SECRET = process.env.VERCEL_WEBHOOK_SECRET || "";

const app = Fastify({ logger: { level: "info" } });

// Allow CRM (ssjbots.vercel.app) to iframe/fetch us
await app.register(cors, { origin: true });

function requireSecret(req, reply) {
  if (!SERVICE_SECRET) return;
  const header = req.headers["x-service-secret"];
  if (header !== SERVICE_SECRET) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return reply;
  }
}

// ── Health + default-client compat ─────────────────────────────
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

app.get("/status", async () => ({ ok: true, ...getClientState(defaultClientId()) }));

app.get("/qr", async (req, reply) => qrPage(reply, defaultClientId()));

app.post("/send", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  const { phone, jid, message } = req.body || {};
  const target = jid || phone;
  if (!target || !message) return reply.code(400).send({ ok: false, error: "target_and_message_required" });
  try {
    const res = await sendForClient(defaultClientId(), target, message);
    return { ok: true, msgId: res?.key?.id || null, client: defaultClientId() };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: String(err.message || err) });
  }
});

app.post("/logout", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  return logoutClient(defaultClientId());
});

// ── Multi-session API ─────────────────────────────────────────
app.get("/clients", async () => ({ ok: true, clients: getClients() }));

app.post("/clients", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  const { client_id } = req.body || {};
  if (!client_id) return reply.code(400).send({ ok: false, error: "client_id_required" });
  await connectClient(client_id);
  return { ok: true, ...getClientState(client_id) };
});

app.get("/clients/:id/status", async (req) => {
  const { id } = req.params;
  // Lazily boot the session if not running yet
  const state = getClientState(id);
  if (!state.connected && !state.has_qr) {
    connectClient(id).catch(() => {});
  }
  return { ok: true, ...getClientState(id) };
});

app.get("/clients/:id/qr", async (req, reply) => {
  const { id } = req.params;
  // Boot the session if needed (first /qr visit kicks off the connect)
  connectClient(id).catch(() => {});
  return qrPage(reply, id);
});

app.post("/clients/:id/send", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  const { id } = req.params;
  const { phone, jid, message } = req.body || {};
  const target = jid || phone;
  if (!target || !message) return reply.code(400).send({ ok: false, error: "target_and_message_required" });
  try {
    const res = await sendForClient(id, target, message);
    return { ok: true, msgId: res?.key?.id || null, client: id };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: String(err.message || err) });
  }
});

app.post("/clients/:id/logout", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  return logoutClient(req.params.id);
});

function qrPage(reply, clientId) {
  const state = getClientState(clientId);
  if (state.connected) {
    return reply.type("text/html").send(
      `<!doctype html><meta charset="utf-8"><title>${clientId} connected</title>
       <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#f8f9fa">
       <h2 style="color:#27ae60">✅ WhatsApp connected</h2>
       <p>Session <code>${clientId}</code> is active.</p>
       <p>Signed in as <code>${state.me || "unknown"}</code></p>
       </body>`
    );
  }
  if (!state.qr_data_url) {
    return reply.code(503).type("text/html").send(
      `<!doctype html><meta charset="utf-8"><title>${clientId} — waiting</title>
       <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
       <h2>⏳ Generating QR for <code>${clientId}</code>…</h2>
       <script>setTimeout(()=>location.reload(),3000)</script></body>`
    );
  }
  return reply.type("text/html").send(
    `<!doctype html><meta charset="utf-8"><title>Pair ${clientId}</title>
     <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#fff;margin:0">
     <h2>Pair WhatsApp · <code>${clientId}</code></h2>
     <img src="${state.qr_data_url}" style="width:320px;height:320px;border:1px solid #eee;border-radius:12px"/>
     <ol style="max-width:320px;color:#555;font-size:14px">
       <li>Open WhatsApp on the phone for <b>${clientId}</b>.</li>
       <li>Settings → Linked Devices → Link a device.</li>
       <li>Scan the QR above.</li>
     </ol>
     <script>setTimeout(()=>location.reload(),15000)</script></body>`
  );
}

// ── Boot ─────────────────────────────────────────────────────
await bootAllSessions({
  onIncoming: async ({ clientId, phone, body, name, msgId, jid }) => {
    if (!VERCEL_WEBHOOK_URL) {
      app.log.warn("no VERCEL_WEBHOOK_URL configured — dropping inbound");
      return;
    }
    const url =
      VERCEL_WEBHOOK_URL +
      (VERCEL_WEBHOOK_URL.includes("?") ? "&" : "?") +
      "secret=" +
      encodeURIComponent(VERCEL_WEBHOOK_SECRET);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: phone,
          jid,
          body,
          name,
          msg_id: msgId,
          whatsapp_client: clientId, // session id for this incoming
        }),
      });
      if (!r.ok) app.log.warn({ status: r.status }, "forward_non_2xx");
    } catch (err) {
      app.log.error(err, "forward_failed");
    }
  },
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`wa-service listening on :${PORT} (multi-session)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.log.info("shutting down");
    await app.close();
    process.exit(0);
  });
}
