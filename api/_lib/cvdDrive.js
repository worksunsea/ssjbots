// Drive access for the CVD stock sync. Two interchangeable providers:
//   1. Apps Script proxy (preferred, same pattern as RAPNET_APPS_SCRIPT_URL):
//      CVD_APPS_SCRIPT_URL + CVD_APPS_SCRIPT_TOKEN. Script source:
//      apps-script/CvdFolder.gs. Runs as the Drive owner, so the folder needs
//      no sharing.
//   2. Google service account: GOOGLE_SERVICE_ACCOUNT_JSON (base64), folder
//      shared with its client_email.
// Both return { files: [{id,name,mimeType,modifiedTime}] } and file bytes as a Buffer.
import { createSign } from "node:crypto";

export const CVD_DRIVE_FOLDER_ID = process.env.CVD_DRIVE_FOLDER_ID || "1mS8k7pKuckNjPwo6DJ8p9qJyuqx0SmUI";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export function driveProvider() {
  if (process.env.CVD_APPS_SCRIPT_URL) return "apps-script";
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return "service-account";
  return null;
}

async function jsonOrThrow(res, what) {
  const text = await res.text();
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`${what}: non-JSON response (${res.status})`); }
  if (!res.ok || d.ok === false || d.error) throw new Error(`${what}: ${d.error || res.status}`);
  return d;
}

// ── Apps Script proxy ───────────────────────────────────────────────────────
function proxyUrl(params) {
  const q = new URLSearchParams({ ...params, token: process.env.CVD_APPS_SCRIPT_TOKEN || "" });
  return `${process.env.CVD_APPS_SCRIPT_URL}?${q}`;
}

async function proxyList() {
  const d = await jsonOrThrow(await fetch(proxyUrl({ action: "cvdfiles" }), { redirect: "follow" }), "Apps Script list");
  return (d.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modified || f.modifiedTime }));
}

async function proxyDownload(file) {
  const d = await jsonOrThrow(await fetch(proxyUrl({ action: "cvdfile", id: file.id }), { redirect: "follow" }), "Apps Script download");
  if (d.encoding !== "base64" || !d.data) throw new Error("Apps Script download: expected base64 data");
  return Buffer.from(d.data, "base64");
}

// ── Service account ─────────────────────────────────────────────────────────
async function saToken() {
  const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(input).sign(sa.private_key.replace(/\\n/g, "\n"), "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function saList() {
  const token = await saToken();
  const q = encodeURIComponent(`'${CVD_DRIVE_FOLDER_ID}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await jsonOrThrow(res, "Drive list");
  return (d.files || []).map((f) => ({ ...f, _token: token }));
}

async function saDownload(file) {
  const token = file._token || (await saToken());
  const url = file.mimeType === SHEET_MIME
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listStockFiles() {
  const p = driveProvider();
  if (!p) throw new Error("No Drive access configured: set CVD_APPS_SCRIPT_URL + CVD_APPS_SCRIPT_TOKEN (preferred) or GOOGLE_SERVICE_ACCOUNT_JSON");
  return p === "apps-script" ? proxyList() : saList();
}

export async function downloadStockFile(file) {
  return driveProvider() === "apps-script" ? proxyDownload(file) : saDownload(file);
}
