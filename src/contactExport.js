// Pure helpers for the Contacts Export / Print modal — no React, unit-tested.

const text = (v) => String(v ?? "").trim();

export const addressOf = (c) =>
  [c.address_house, c.address_locality, c.city, c.address_state, c.address_pincode].map(text).filter(Boolean).join(", ");

/** Fixed columns in the order they are offered. `get` returns plain text. */
export const BASE_COLUMNS = [
  { key: "name", label: "Name", get: (c) => text(c.name) },
  { key: "phone", label: "Phone", get: (c) => text(c.phone) },
  { key: "mobile2", label: "Phone 2", get: (c) => text(c.mobile2) },
  { key: "spouse_mobile", label: "Phone 3", get: (c) => text(c.spouse_mobile) },
  { key: "email", label: "Email", get: (c) => text(c.email) },
  { key: "address", label: "Address", get: addressOf },
  { key: "city", label: "City", get: (c) => text(c.city) },
  { key: "address_pincode", label: "Pincode", get: (c) => text(c.address_pincode) },
  { key: "bday", label: "Birthday", get: (c) => text(c.bday) },
  { key: "anniversary", label: "Anniversary", get: (c) => text(c.anniversary) },
  { key: "spouse_name", label: "Spouse", get: (c) => text(c.spouse_name) },
  { key: "profession", label: "Profession", get: (c) => text(c.profession) },
  { key: "company", label: "Company", get: (c) => text(c.company) },
  { key: "client_rating", label: "VIP Score", get: (c) => (c.client_rating ? "★".repeat(Number(c.client_rating) || 0) : "") },
  { key: "source", label: "Source", get: (c) => text(c.source) },
  { key: "tags", label: "Tags", get: (c) => (c.tags || []).join(", ") },
];

/** Base columns plus one per custom field (Reference, Gift, Gift Received, ...). */
export function allColumns(customFields = []) {
  return [
    ...BASE_COLUMNS,
    ...customFields.map((f) => ({ key: `cf_${f.key}`, label: f.label || f.key, get: (c) => text(c.extra_fields?.[f.key]) })),
  ];
}

/** One-click column sets. Keys that don't exist (e.g. a deleted custom field) are skipped later. */
export const PRESETS = [
  { label: "Gift list", keys: ["name", "phone", "address", "cf_gift", "cf_gift_received"] },
  { label: "Phone book", keys: ["name", "phone", "mobile2", "email", "city"] },
  { label: "Birthdays", keys: ["name", "phone", "bday", "anniversary"] },
];

/** Header + rows for the chosen columns, in the order the columns are offered. */
export function buildTable(contacts, columns, keys, { tick = false, sign = false } = {}) {
  const chosen = columns.filter((c) => keys.includes(c.key));
  const header = [...chosen.map((c) => c.label), ...(tick ? ["Done"] : []), ...(sign ? ["Signature"] : [])];
  const rows = contacts.map((c) => [...chosen.map((col) => col.get(c)), ...(tick ? [""] : []), ...(sign ? [""] : [])]);
  return { header, rows };
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV with a BOM so Excel reads accents (Jiménez, Böer) correctly. */
export function toCsv({ header, rows }) {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A4 print sheet; header row repeats on every page. Client text is escaped. */
export function toPrintHtml(title, { header, rows }) {
  const head = header.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:11px;color:#111}
h1{font-size:15px;margin:0 0 6px}table{width:100%;border-collapse:collapse}thead{display:table-header-group}
th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}
td.n{width:24px;color:#666}tr{page-break-inside:avoid}</style></head><body>
<h1>${escapeHtml(title)} (${rows.length})</h1><table><thead><tr><th>#</th>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`;
}
