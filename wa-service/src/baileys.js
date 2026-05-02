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

      // For LID JIDs (post-2024 WA privacy update), Baileys exposes the real
      // phone via key.senderPn / participantPn when known. Use that as the
      // canonical phone; fall back to the JID localpart only if PN is absent.
      const senderPn = msg.key?.senderPn || msg.key?.participantPn || "";
      const lidLocal = jid.split("@")[0];
      const isLid = jid.endsWith("@lid");
      const phone = senderPn ? String(senderPn).split("@")[0] : (isLid ? lidLocal : lidLocal);
      const name = msg.pushName || "";
      const msgId = msg.key.id || "";

      try {
        if (onIncoming) await onIncoming({ clientId, phone, body, name, msgId, jid, senderPn });
      } catch (err) {
        console.error(`[baileys:${clientId}] onIncoming error`, err);
      }
    }
  });

  return sess;
}

function resolveJid(target) {
  if (String(target).includes("@")) return String(target);
  let clean = String(target).replace(/\D/g, "");
  if (!clean) throw new Error("invalid_phone");
  if (clean.length === 10) clean = "91" + clean;
  return `${clean}@s.whatsapp.net`;
}

export async function sendForClient(clientIdRaw, target, message) {
  const clientId = sanitize(clientIdRaw);
  const sess = sessions.get(clientId);
  if (!sess?.sock || !sess.connected) throw new Error(`not_connected:${clientId}`);
  if (!target) throw new Error("invalid_target");
  return sess.sock.sendMessage(resolveJid(target), { text: String(message) });
}

// Send an image, video, or document from a URL.
export async function sendMediaForClient(clientIdRaw, { target, mediaUrl, mediaType = "image", caption = "", filename }) {
  const clientId = sanitize(clientIdRaw);
  const sess = sessions.get(clientId);
  if (!sess?.sock || !sess.connected) throw new Error(`not_connected:${clientId}`);
  if (!target || !mediaUrl) throw new Error("target_and_mediaUrl_required");

  const jid = resolveJid(target);
  let content;
  if (mediaType === "image") {
    content = { image: { url: mediaUrl }, caption };
  } else if (mediaType === "video") {
    content = { video: { url: mediaUrl }, caption };
  } else {
    const ext = (mediaUrl.split("?")[0].split(".").pop() || "bin").toLowerCase();
    const mimeMap = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    content = { document: { url: mediaUrl }, mimetype: mimeMap[ext] || "application/octet-stream", fileName: filename || `file.${ext}`, caption };
  }
  return sess.sock.sendMessage(jid, content);
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
  if (s) {
    try { await s.sock?.logout(); } catch {}
    sessions.delete(clientId);
  }
  // Always remove auth dir, even if session wasn't in memory (disconnected state)
  try { fs.rmSync(clientDir(clientId), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

export function defaultClientId() {
  return sanitize(DEFAULT_CLIENT_ID);
}
