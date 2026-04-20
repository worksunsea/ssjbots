// Baileys wrapper — maintains one WhatsApp Web session, forwards incoming
// messages via a callback, exposes a send() helper.
//
// Session credentials persist in AUTH_DIR across restarts so the QR scan
// is only needed on first pair / after logout.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";

let sock = null;
let currentQr = null;
let connected = false;
let onIncoming = null;
let reconnectTimer = null;

const AUTH_DIR = process.env.AUTH_DIR || "./auth";

const logger = pino({ level: process.env.BAILEYS_LOG || "warn" });

export async function connectWA(opts = {}) {
  if (opts.onIncoming) onIncoming = opts.onIncoming;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["SSJ Bullion Bot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentQr = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      console.log("[baileys] QR ready — open /qr to scan");
    }
    if (connection === "open") {
      connected = true;
      currentQr = null;
      console.log("[baileys] connected as", sock.user?.id);
    }
    if (connection === "close") {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log("[baileys] closed, code=", code, "loggedOut=", loggedOut);
      if (!loggedOut) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectWA({ onIncoming }), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;
    for (const msg of m.messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid || "";
      if (jid.endsWith("@g.us")) continue; // skip groups
      if (jid === "status@broadcast") continue;

      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.buttonsResponseMessage?.selectedDisplayText ||
        msg.message?.listResponseMessage?.title ||
        "";

      if (!body) continue;

      const phone = jid.split("@")[0];
      const name = msg.pushName || "";
      const msgId = msg.key.id || "";

      try {
        if (onIncoming) await onIncoming({ phone, body, name, msgId, jid });
      } catch (err) {
        console.error("[baileys] onIncoming error", err);
      }
    }
  });

  return sock;
}

export async function sendMessage(phone, message) {
  if (!sock || !connected) throw new Error("wa_not_connected");
  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone) throw new Error("invalid_phone");
  const jid = `${cleanPhone}@s.whatsapp.net`;
  return sock.sendMessage(jid, { text: String(message) });
}

export function getQr() {
  return currentQr;
}

export function getStatus() {
  return {
    connected,
    hasQr: Boolean(currentQr),
    me: connected ? (sock?.user?.id || null) : null,
  };
}

export async function logout() {
  if (!sock) return;
  try {
    await sock.logout();
  } catch (err) {
    console.error("[baileys] logout error", err);
  }
}
