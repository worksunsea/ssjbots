/**
 * CVD stock folder proxy — lets the Vercel daily sync (api/cvd-sync.js) read
 * the supplier stock sheets in the Drive folder "Cvdapp" without sharing the
 * folder with a service account. Runs as the Drive owner.
 *
 * SETUP (one time, signed in as the Google account that owns the Cvdapp folder):
 *  1. script.google.com -> New project -> paste this file.
 *  2. Project Settings -> Script properties -> add  CVD_TOKEN = <long random string>
 *     (same value goes into Vercel env CVD_APPS_SCRIPT_TOKEN).
 *  3. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone.
 *     Copy the /exec URL into Vercel env CVD_APPS_SCRIPT_URL.
 *  "Anyone" only means anyone WITH THE URL AND TOKEN — every call without the
 *  right token is rejected, because the sheets contain purchase prices.
 *
 * Contract:
 *   GET ?action=cvdfiles&token=T            -> { ok, files:[{id,name,mimeType,modified}] }
 *   GET ?action=cvdfile&id=ID&token=T       -> { ok, encoding:"base64", data }   (xlsx bytes;
 *                                              Google Sheets are exported to xlsx)
 */
var CVD_FOLDER_ID = '1mS8k7pKuckNjPwo6DJ8p9qJyuqx0SmUI';
var SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var expected = PropertiesService.getScriptProperties().getProperty('CVD_TOKEN');
    if (!expected || p.token !== expected) return out({ ok: false, error: 'unauthorized' });
    var action = String(p.action || '').toLowerCase();
    if (action === 'cvdfiles') return out({ ok: true, files: listFiles() });
    if (action === 'cvdfile') return out(readFile(p.id));
    return out({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function listFiles() {
  var it = DriveApp.getFolderById(CVD_FOLDER_ID).getFiles();
  var files = [];
  while (it.hasNext()) {
    var f = it.next();
    files.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), modified: f.getLastUpdated().toISOString() });
  }
  return files;
}

function readFile(id) {
  if (!id) return { ok: false, error: 'id_required' };
  var f = DriveApp.getFileById(id);
  // Only files that live in the Cvdapp folder may be read through this proxy.
  var inFolder = false, parents = f.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === CVD_FOLDER_ID) inFolder = true; }
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
  return { ok: true, encoding: 'base64', data: Utilities.base64Encode(blob.getBytes()) };
}
