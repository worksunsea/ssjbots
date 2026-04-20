// HTTP API on top of Baileys.
//   GET  /health           — sanity check
//   GET  /status           — connection state
//   GET  /qr               — HTML page with QR code (only when not connected)
//   POST /send             — {phone, message} → sends text (requires secret)
//   POST /logout           — disconnect (requires secret)

import Fastify from "fastify";
import { connectWA, sendMessage, getQr, getStatus, logout } from "./baileys.js";

const PORT = Number(process.env.PORT || 3000);
const SERVICE_SECRET = process.env.SERVICE_SECRET || "";
const VERCEL_WEBHOOK_URL = process.env.VERCEL_WEBHOOK_URL || "";
const VERCEL_WEBHOOK_SECRET = process.env.VERCEL_WEBHOOK_SECRET || "";
const WA_CLIENT_ID = process.env.WA_CLIENT_ID || "ssj-default";

const app = Fastify({ logger: { level: "info" } });

// Simple shared-secret guard for write endpoints
function requireSecret(req, reply) {
  if (!SERVICE_SECRET) return;
  const header = req.headers["x-service-secret"];
  if (header !== SERVICE_SECRET) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return reply;
  }
}

app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

app.get("/status", async () => ({ ok: true, ...getStatus(), client: WA_CLIENT_ID }));

app.get("/qr", async (req, reply) => {
  const qr = getQr();
  const status = getStatus();
  if (status.connected) {
    reply.type("text/html").send(
      `<!doctype html><meta charset="utf-8"><title>WA connected</title>
       <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#f8f9fa">
       <h2>✅ WhatsApp connected</h2>
       <p>Signed in as <code>${status.me || "unknown"}</code></p>
       <p style="color:#888">Client id: ${WA_CLIENT_ID}</p>
       </body>`
    );
    return;
  }
  if (!qr) {
    reply.code(503).type("text/html").send(
      `<!doctype html><meta charset="utf-8"><title>Waiting for QR</title>
       <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
       <h2>⏳ Waiting for QR code…</h2>
       <p>Refresh in a few seconds.</p>
       <script>setTimeout(()=>location.reload(),3000)</script></body>`
    );
    return;
  }
  reply.type("text/html").send(
    `<!doctype html><meta charset="utf-8"><title>Scan to pair</title>
     <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;background:#fff">
     <h2>Pair WhatsApp</h2>
     <img src="${qr}" style="width:320px;height:320px;border:1px solid #eee;border-radius:12px"/>
     <ol style="max-width:320px;color:#555;font-size:14px">
       <li>Open WhatsApp on the phone for <b>${WA_CLIENT_ID}</b>.</li>
       <li>Settings → Linked Devices → Link a device.</li>
       <li>Scan the QR above.</li>
     </ol>
     <script>setTimeout(()=>location.reload(),15000)</script></body>`
  );
});

app.post("/send", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  const { phone, message } = req.body || {};
  if (!phone || !message) return reply.code(400).send({ ok: false, error: "phone_and_message_required" });
  try {
    const res = await sendMessage(phone, message);
    return { ok: true, msgId: res?.key?.id || null, client: WA_CLIENT_ID };
  } catch (err) {
    req.log.error(err, "send_failed");
    return reply.code(502).send({ ok: false, error: String(err.message || err) });
  }
});

app.post("/logout", async (req, reply) => {
  const guarded = requireSecret(req, reply);
  if (guarded) return;
  await logout();
  return { ok: true };
});

// Boot
await connectWA({
  onIncoming: async ({ phone, body, name, msgId }) => {
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
          body,
          name,
          msg_id: msgId,
          whatsapp_client: WA_CLIENT_ID,
        }),
      });
      if (!r.ok) app.log.warn({ status: r.status }, "forward_non_2xx");
    } catch (err) {
      app.log.error(err, "forward_failed");
    }
  },
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`wa-service listening on :${PORT}`);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.log.info("shutting down");
    await app.close();
    process.exit(0);
  });
}
