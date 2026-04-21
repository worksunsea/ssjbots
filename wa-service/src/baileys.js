// Multi-session Baileys manager. Each "client" is an independent paired
// WhatsApp number with its own socket + auth subfolder.
//
// Directory layout:
//   AUTH_DIR/
//     <client_id_1>/   creds.json, pre-keys, etc.
//     <client_id_2>/   ...
//
// Backwards-compat: if AUTH_DIR contains `creds.json` directly (old
// single-session layout), migrate it into `AUTH_DIR/<DEFAULT_CLIENT_ID>/`
// on boot so the existing pairing survives the upgrade.

import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import fs from "fs";
import path from "path";

const AUTH_ROOT = process.env.AUTH_DIR || "./auth";
const DEFAULT_CLIENT_ID = process.env.WA_CLIENT_ID || "default";

const logger = pino({ level: process.env.BAILEYS_LOG || "warn" });

// clientId -> { sock, connected, qrDataUrl, me, reconnectTimer }
const sessions = new Map();
let onIncoming = null;

function clientDir(clientId) {
  return path.join(AUTH_ROOT, sanitize(clientId));
}
function sanitize(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

// On boot: if AUTH_ROOT has creds.json (old layout), move all files into
// AUTH_ROOT/<DEFAULT_CLIENT_ID>/ so the existing pairing is preserved.
function migrateLegacyAuth() {
  try {
    fs.mkdirSync(AUTH_ROOT, { recursive: true });
    const credsTopLevel = path.join(AUTH_ROOT, "creds.json");
    if (!fs.existsSync(credsTopLevel)) return;

    const target = clientDir(DEFAULT_CLIENT_ID);
    fs.mkdirSync(target, { recursive: true });
    const entries = fs.readdirSync(AUTH_ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        const src = path.join(AUTH_ROOT, e.name);
        const dst = path.join(target, e.name);
        if (!fs.existsSync(dst)) fs.renameSync(src, dst);
      }
    }
    console.log(`[baileys] migrated legacy auth → ${target}`);
  } catch (err) {
    console.error("[baileys] legacy auth migration failed", err);
  }
}

function listClientDirs() {
  try {
    if (!fs.existsSync(AUTH_ROOT)) return [];
    return fs.readdirSync(AUTH_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export async function bootAllSessions(opts = {}) {
  if (opts.onIncoming) onIncoming = opts.onIncoming;
  migrateLegacyAuth();

  // Ensure default client exists as a known session (even if not paired)
  const clients = new Set(listClientDirs());
  clients.add(sanitize(DEFAULT_CLIENT_ID));

  for (const id of clients) {
    connectClient(id).catch((err) => console.error(`[baileys] connect ${id} failed`, err));
  }
}

export async function connectClient(clientIdRaw) {
  const clientId = sanitize(clientIdRaw);
  if (!clientId) throw new Error("invalid_client_id");

  // Idempotency: if already connecting/connected, return existing state
  const existing = sessions.get(clientId);
  if (existing?.sock && existing.connected) return existing;

  const dir = clientDir(clientId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: [`SSJ Jew CRM — ${clientId}`, "Chrome", "1.0"],
  });

  const sess = {
    sock,
    connected: false,
    qrDataUrl: null,
    me: null,
    reconnectTimer: null,
  };
  sessions.set(clientId, sess);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      sess.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      console.log(`[baileys:${clientId}] QR ready`);
    }
    if (connection === "open") {
      sess.connected = true;
      sess.qrDataUrl = null;
      sess.me = sock.user?.id || null;
      console.log(`[baileys:${clientId}] connected as`, sess.me);
    }
    if (connection === "close") {
      sess.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[baileys:${clientId}] closed code=${code} loggedOut=${loggedOut}`);
      if (!loggedOut) {
        clearTimeout(sess.reconnectTimer);
        sess.reconnectTimer = setTimeout(() => connectClient(clientId).catch(() => {}), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;
    for (const msg of m.messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid || "";
      if (jid.endsWith("@g.us")) continue;
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
        if (onIncoming) await onIncoming({ clientId, phone, body, name, msgId, jid });
      } catch (err) {
        console.error(`[baileys:${clientId}] onIncoming error`, err);
      }
    }
  });

  return sess;
}

export async function sendForClient(clientIdRaw, target, message) {
  const clientId = sanitize(clientIdRaw);
  const sess = sessions.get(clientId);
  if (!sess?.sock || !sess.connected) throw new Error(`not_connected:${clientId}`);
  if (!target) throw new Error("invalid_target");

  if (String(target).includes("@")) {
    return sess.sock.sendMessage(String(target), { text: String(message) });
  }
  let cleanPhone = String(target).replace(/\D/g, "");
  if (!cleanPhone) throw new Error("invalid_phone");
  if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
  const jid = `${cleanPhone}@s.whatsapp.net`;
  return sess.sock.sendMessage(jid, { text: String(message) });
}

export function getClients() {
  const out = [];
  // Include all live sessions
  for (const [id, s] of sessions.entries()) {
    out.push({ client_id: id, connected: s.connected, has_qr: Boolean(s.qrDataUrl), me: s.me });
  }
  // Also include dirs that exist but haven't booted yet
  for (const id of listClientDirs()) {
    if (!sessions.has(id)) {
      out.push({ client_id: id, connected: false, has_qr: false, me: null });
    }
  }
  return out;
}

export function getClientState(clientIdRaw) {
  const clientId = sanitize(clientIdRaw);
  const s = sessions.get(clientId);
  return {
    client_id: clientId,
    connected: Boolean(s?.connected),
    has_qr: Boolean(s?.qrDataUrl),
    qr_data_url: s?.qrDataUrl || null,
    me: s?.me || null,
  };
}

export async function logoutClient(clientIdRaw) {
  const clientId = sanitize(clientIdRaw);
  const s = sessions.get(clientId);
  if (!s) return { ok: false, error: "no_session" };
  try { await s.sock?.logout(); } catch {}
  sessions.delete(clientId);
  // remove auth dir so next pair starts fresh
  try { fs.rmSync(clientDir(clientId), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

export function defaultClientId() {
  return sanitize(DEFAULT_CLIENT_ID);
}
