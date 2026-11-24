/**
 * Cvdapp + Rapnet Drive proxy for the Hostinger server (ssjbots). Runs as the Drive owner.
 * Deployed 2026-11-24 as a Web app (Execute as: Me, Who has access: Anyone) from work.sunsea@gmail.com.
 * Its /exec URL is CVD_APPS_SCRIPT_URL and RAPNET_APPS_SCRIPT_URL in /opt/stack/ssjbots/.env.
 * CVD actions need the token; Rapnet actions only serve price-list PDFs from the Rapnet folder.
 * The real token lives in credentials.local.md (gitignored) and the server .env, never in git.
 * To redeploy: paste this file, replace SET_TOKEN_HERE with CVD_APPS_SCRIPT_TOKEN, Deploy -> Manage deployments.
 */
var CVD_FOLDER_ID = '1mS8k7pKuckNjPwo6DJ8p9qJyuqx0SmUI';
var RAP_FOLDER_ID = '152rXtP8ioZ3lcsrsmQJ9w9qpA0ApgLEY';
var SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
var CVD_TOKEN = 'SET_TOKEN_HERE';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var a = String(p.action || '').toLowerCase();
  try {
    if (a === 'files' || a === 'file') return out(rapnet(a, p));
    if (!p.token || p.token !== CVD_TOKEN) return out({ ok: false, error: 'unauthorized' });
    if (a === 'cvdfiles') return out({ ok: true, files: listFiles(CVD_FOLDER_ID) });
    if (a === 'cvdfile') { var r = readFile(p.id, CVD_FOLDER_ID); if (r.ok) r.data = r.content; return out(r); }
    return out({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rapnet(a, p) {
  if (a === 'files') return { ok: true, files: listFiles(RAP_FOLDER_ID).filter(function (f) { return f.mimeType === 'application/pdf'; }) };
  return readFile(p.id, RAP_FOLDER_ID);
}

function listFiles(folderId) {
  var it = DriveApp.getFolderById(folderId).getFiles();
  var files = [];
  while (it.hasNext()) {
    var f = it.next();
    files.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), modified: f.getLastUpdated().toISOString() });
  }
  return files;
}

function readFile(id, folderId) {
  if (!id) return { ok: false, error: 'id_required' };
  var f = DriveApp.getFileById(id);
  var inFolder = false, parents = f.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
  if (!inFolder) return { ok: false, error: 'not_in_folder' };
  var blob;
  if (f.getMimeType() === SHEET_MIME) {
    var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'export_failed_' + res.getResponseCode() };
    blob = res.getBlob();
  } else {
    blob = f.getBlob();
  }
  return { ok: true, encoding: 'base64', content: Utilities.base64Encode(blob.getBytes()) };
}

function authorizeOnce() { DriveApp.getFolderById(CVD_FOLDER_ID).getName(); DriveApp.getFolderById(RAP_FOLDER_ID).getName(); UrlFetchApp.fetch('https://www.google.com'); }
