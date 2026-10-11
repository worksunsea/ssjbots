// GET /api/rapaport-pdf?t=<session token>
// Streams the Rapaport PDF the current prices were loaded from. Staff only —
// the sheet is copyrighted, so it is not served to anonymous visitors.

import { verifySession } from "./_lib/session.js";
import { fetchRapPdf } from "./_lib/rapSeed.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const session = verifySession(String(req.query.t || ""));
  if (!session) return res.status(401).json({ ok: false, error: "Please log in again" });

  const pdf = await fetchRapPdf();
  if (!pdf?.b64) {
    return res.status(404).json({ ok: false, error: "No PDF stored yet — it is saved the next time prices are synced or uploaded" });
  }
  const safeName = String(pdf.name || "rapaport.pdf").replace(/[^\w.\- ]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.status(200).send(Buffer.from(pdf.b64, "base64"));
}
