/**
 * SSJ Bullion Bot — Apps Script rates proxy
 *
 * This is now a read-only proxy for the Google Sheet "new" tab (live bullion rates).
 * All CRM/lead data lives in Supabase — see /supabase/migrations/0001_bullion_bot.sql.
 *
 * Deploy: Extensions → Apps Script → Deploy → New deployment → Web app
 *   Execute as: Me · Who has access: Anyone
 */

const SHEET_ID  = '1CWxal5GomBMobwSqNjNSK-FhKodACqDzWbp7dEe8vd0';
const RATES_TAB = 'new';

function doGet(e) {
  try {
    const action = ((e && e.parameter && e.parameter.action) || '').toLowerCase();
    const p = (e && e.parameter) || {};
    switch (action) {
      case 'ping':  return json({ ok: true, ts: new Date().toISOString() });
      case 'rates': return json(getRates(p.q));
      case 'quote': return json(getQuote(p.q, p.qty));
      default:      return json({ error: 'unknown_action', action: action, supported: ['ping', 'rates', 'quote'] });
    }
  } catch (err) {
    return json({ error: String(err), stack: err && err.stack });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects(tab) {
  const values = tab.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  }).filter(function (o) {
    return Object.values(o).some(function (v) { return v !== '' && v !== null; });
  });
}

function getRates(q) {
  const tab = SpreadsheetApp.openById(SHEET_ID).getSheetByName(RATES_TAB);
  if (!tab) return { error: 'rates_tab_missing', tab: RATES_TAB };
  const rows = sheetToObjects(tab);
  if (!q) return { ok: true, count: rows.length, rates: rows };
  const needle = String(q).toLowerCase();
  const filtered = rows.filter(function (r) {
    return Object.values(r).some(function (v) { return String(v).toLowerCase().indexOf(needle) !== -1; });
  });
  return { ok: true, count: filtered.length, q: q, rates: filtered };
}

function getQuote(q, qty) {
  const r = getRates(q);
  if (r.error) return r;
  if (!r.count) return { ok: false, message: 'No matching products', q: q };
  const qtyNum = Number(qty) || 0;
  const top = r.rates.slice(0, 3);
  const lines = top.map(function (row) {
    const label = row.product || row.name || row.description || row.item || Object.values(row)[0];
    const rate  = row.rate || row.price || row.per_gram || row['rate_per_gram'] || Object.values(row)[1];
    const rateN = Number(String(rate).replace(/[^0-9.]/g, '')) || 0;
    const total = qtyNum && rateN ? '  (\u20B9' + Math.round(qtyNum * rateN).toLocaleString('en-IN') + ' for ' + qtyNum + 'g)' : '';
    return '\u2022 ' + label + ' \u2014 \u20B9' + (rateN ? rateN.toLocaleString('en-IN') : rate) + '/g' + total;
  });
  const msg = [
    '*Today\u2019s rates* \u2728',
    lines.join('\n'),
    '',
    '_Rates live & GST extra. Reply with qty to lock in._'
  ].join('\n');
  return { ok: true, message: msg, products: top, qty: qtyNum };
}
