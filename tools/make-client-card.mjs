// Builds the print-ready client-details card (front + back, 90x55 mm with 3 mm bleed).
// Usage: node tools/make-client-card.mjs [outputPath]
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import fs from "node:fs";

const OUT = process.argv[2] || "client-details-card.pdf";
const URL = "https://ssjbot.gemtre.in/profile?src=card";
const BLEED = 3;
const W = 90 + BLEED * 2;
const H = 55 + BLEED * 2;
const NAVY = [20, 33, 61];
const GOLD = [184, 145, 63];
const CREAM = [250, 246, 238];

const qr = await QRCode.toDataURL(URL, { errorCorrectionLevel: "M", margin: 1, width: 900, color: { dark: "#14213d", light: "#ffffff" } });

const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [W, H] });
const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
const text = (c) => doc.setTextColor(c[0], c[1], c[2]);
const draw = (c) => doc.setDrawColor(c[0], c[1], c[2]);

// ── Front: brand ──
fill(NAVY); doc.rect(0, 0, W, H, "F");
draw(GOLD); doc.setLineWidth(0.4); doc.rect(BLEED + 3, BLEED + 3, 84, 49);
text(GOLD);
doc.setFont("times", "bold"); doc.setFontSize(22);
doc.text("SUN SEA", W / 2, BLEED + 22, { align: "center", charSpace: 1.5 });
doc.setFontSize(13); doc.setFont("times", "normal");
doc.text("J E W E L L E R S", W / 2, BLEED + 29.5, { align: "center" });
doc.setLineWidth(0.3); doc.line(W / 2 - 12, BLEED + 33, W / 2 + 12, BLEED + 33);
text(CREAM); doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
doc.text("Solitaires  |  Diamond Jewellery  |  Hallmarked Gold  |  Gemstones", W / 2, BLEED + 38.5, { align: "center" });
doc.setFontSize(6);
doc.text("2659 Gurudwara Rd, Beadonpura, Karol Bagh, New Delhi 110005", W / 2, BLEED + 44, { align: "center" });

// ── Back: scan to share details ──
doc.addPage([W, H], "landscape");
fill(CREAM); doc.rect(0, 0, W, H, "F");
fill(NAVY); doc.rect(0, 0, W, 4 + BLEED, "F");
doc.addImage(qr, "PNG", BLEED + 5, BLEED + 8, 36, 36);
draw(GOLD); doc.setLineWidth(0.4); doc.rect(BLEED + 4, BLEED + 7, 38, 38);

text(NAVY); doc.setFont("times", "bold"); doc.setFontSize(12.5);
doc.text("Be part of our family", BLEED + 47, BLEED + 14);
doc.setFont("helvetica", "normal"); doc.setFontSize(7);
text([60, 60, 60]);
const lines = [
  "Scan with your phone camera",
  "and share your details:",
  "",
  "-  Name, birthday and anniversary",
  "-  Address for gifts and deliveries",
  "-  Family special days",
  "-  Friends you would like to gift",
];
lines.forEach((l, i) => doc.text(l, BLEED + 47, BLEED + 20 + i * 4));
text(GOLD); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
doc.text("Refer a friend: 50 mg gold gift", BLEED + 47, BLEED + 49);
text(NAVY); doc.setFont("helvetica", "normal"); doc.setFontSize(6);
doc.text("+91 88608 66000  |  sunseajewellers.com", BLEED + 47, BLEED + 52.5);

// Fit check: right column on the back must stay inside the safe area (right edge = W - BLEED - 3).
const RIGHT_EDGE = W - BLEED - 3;
const fits = (s, size, style, font, x) => {
  doc.setFont(font, style); doc.setFontSize(size);
  const end = x + doc.getTextWidth(s);
  if (end > RIGHT_EDGE) console.warn(`OVERFLOW ${(end - RIGHT_EDGE).toFixed(1)}mm: "${s}"`);
};
fits("Be part of our family", 12.5, "bold", "times", BLEED + 47);
lines.forEach((l) => fits(l, 7, "normal", "helvetica", BLEED + 47));
fits("Refer a friend: 50 mg gold gift", 7, "bold", "helvetica", BLEED + 47);
fits("+91 88608 66000  |  sunseajewellers.com", 6, "normal", "helvetica", BLEED + 47);

fs.writeFileSync(OUT, Buffer.from(doc.output("arraybuffer")));
console.log("wrote", OUT, `${W}x${H} mm incl. ${BLEED} mm bleed`, URL);
