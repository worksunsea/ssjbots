// Builds the printable "Client Details Card" (A5, one side) that clients fill in by hand.
// Staff later photograph it and scan it into the CRM (Contacts -> Scan client card).
// Usage: node tools/make-client-form.mjs [outputPath]
import { jsPDF } from "jspdf";
import fs from "node:fs";

const OUT = process.argv[2] || "client-details-form.pdf";
const W = 148;
const H = 210;
const M = 8;
const NAVY = [20, 33, 61];
const GOLD = [184, 145, 63];
const GREY = [110, 110, 110];
const LINE = [150, 150, 150];

const doc = new jsPDF({ unit: "mm", format: [W, H] });
const color = (setter, c) => doc[setter](c[0], c[1], c[2]);

function label(text, x, y) {
  color("setTextColor", GREY); doc.setFont("helvetica", "normal"); doc.setFontSize(6);
  doc.text(text, x, y);
}

function box(x, y, w, h = 7) {
  color("setDrawColor", LINE); doc.setLineWidth(0.25); doc.rect(x, y, w, h);
}

function field(text, x, y, w, h = 7) {
  label(text, x, y + 2.2);
  box(x, y + 3, w, h);
}

/** Row of separate character cells — easier for handwriting recognition than a free line. */
function comb(text, x, y, cells, cell = 5.4) {
  label(text, x, y + 2.2);
  color("setDrawColor", LINE); doc.setLineWidth(0.25);
  for (let i = 0; i < cells; i += 1) doc.rect(x + i * cell, y + 3, cell, 7);
  return x + cells * cell;
}

/** DD MM YYYY cells with slash separators. */
function dateCells(text, x, y, cell = 5) {
  label(text, x, y + 2.2);
  color("setDrawColor", LINE); doc.setLineWidth(0.25);
  const groups = [2, 2, 4];
  let cx = x;
  groups.forEach((n, gi) => {
    for (let i = 0; i < n; i += 1) { doc.rect(cx, y + 3, cell, 7); cx += cell; }
    if (gi < groups.length - 1) {
      color("setTextColor", GREY); doc.setFontSize(9); doc.text("/", cx + 1, y + 8.2); cx += 3;
    }
  });
}

function section(text, y) {
  color("setTextColor", GOLD); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  doc.text(text, M, y);
  color("setDrawColor", GOLD); doc.setLineWidth(0.3);
  doc.line(M, y + 1.2, W - M, y + 1.2);
}

// ── Header ──
color("setFillColor", NAVY); doc.rect(0, 0, W, 16, "F");
color("setTextColor", GOLD); doc.setFont("times", "bold"); doc.setFontSize(15);
doc.text("SUN SEA JEWELLERS", W / 2, 8.2, { align: "center", charSpace: 1 });
doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(250, 246, 238);
doc.text("CLIENT DETAILS CARD  -  please write in BLOCK LETTERS, one letter per box", W / 2, 13, { align: "center" });

// ── About you ──
section("ABOUT YOU", 21);
field("Full name", M, 23, W - 2 * M);
comb("Mobile number", M, 34, 10);
field("Email address", 72, 34, W - M - 72);
dateCells("Birthday  (year optional)", M, 45);
dateCells("Anniversary  (year optional)", 72, 45);

// ── Address ──
section("ADDRESS FOR GIFTS & DELIVERIES", 59);
field("House / Flat / Shop no. and Street", M, 61, W - 2 * M);
field("Area / Locality / Colony", M, 72, 66);
field("City", 78, 72, W - M - 78);
field("State", M, 83, 58);
comb("Pincode", 70, 83, 6, 6);

// ── Family ──
section("FAMILY MEMBERS  (spouse, children, parents ...)  -  so we can wish them too", 98);
const cols = [
  { t: "Relation", w: 24 },
  { t: "Name", w: 48 },
  { t: "Birthday  DD / MM / YYYY", w: 34 },
  { t: "Mobile (optional)", w: 26 },
];
let cx = M;
cols.forEach((c) => { label(c.t, cx + 1, 103); cx += c.w; });
for (let r = 0; r < 6; r += 1) {
  cx = M;
  cols.forEach((c) => { box(cx, 104 + r * 8, c.w, 8); cx += c.w; });
}

// ── Referrals ──
section("GIFT A FRIEND  -  50 mg gold for each friend who joins", 158);
for (let r = 0; r < 3; r += 1) {
  const y = 160 + r * 8.5;
  if (r === 0) { label("Friend's name", M + 1, y + 1.6); label("Friend's mobile", 77, y + 1.6); }
  box(M, y + 2.4, 66, 6.2); box(74, y + 2.4, W - M - 74, 6.2);
}

// ── Consent + signature ──
color("setTextColor", NAVY); doc.setFont("helvetica", "normal"); doc.setFontSize(6.3);
doc.text("I agree to receive WhatsApp / call updates and greetings from Sun Sea Jewellers.", M, 188);
label("Signature", M, 191.2); box(M, 192, 62, 8);
label("Date", 76, 191.2); box(76, 192, 30, 8);

// ── Office use ──
doc.setFillColor(244, 241, 234);
doc.rect(0, 202, W, 8, "F");
color("setTextColor", GREY); doc.setFontSize(6);
doc.text("FOR OFFICE USE   Card no. ________    Attended by ____________    Entered in CRM:  [  ]", M, 207);

fs.writeFileSync(OUT, Buffer.from(doc.output("arraybuffer")));
console.log("wrote", OUT, `${W}x${H} mm (A5)`);
