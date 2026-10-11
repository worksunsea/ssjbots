// GET /api/rapaport-pdf
// Streams the Rapaport PDF the current prices were loaded from. Staff only —
// the sheet is copyrighted, so it is not served to anonymous visitors.
//
// Accepted proof of staff identity (either):
//   1. a valid signed session token (Authorization: Bearer <token>, or ?t=), or
//   2. the app's x-crm-secret header plus an x-staff-id that is an active staff row.
// (2) exists because staff who enter through the parent apps (SSO) never receive
// a session token, only their staff record.

import { verifySession } from "./_lib/session.js";
import { fetchRapPdf } from "./_lib/rapSeed.js";
import { CRM_SECRET, TENANT_ID } from "./_lib/config.js";
import { supa } from "./_lib/supabase.js";

async function isActiveStaff(req) {
  if (!CRM_SECRET || req.headers["x-crm-secret"] !== CRM_SECRET) return false;
  const staffId = String(req.headers["x-staff-id"] || "");
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return false;
  const { data } = await supa().from("staff").select("id, active").eq("id", staffId).eq("tenant_id", TENANT_ID).maybeSingle();
  return Boolean(data) && data.active !== false;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const allowed = Boolean(verifySession(bearer || String(req.query.t || ""))) || (await isActiveStaff(req));
  if (!allowed) return res.status(401).json({ ok: false, error: "Please log in again" });

  const pdf = await fetchRapPdf();
  if (!pdf?.b64) {
    return res.status(404).json({ ok: false, error: "No PDF stored yet — it is saved the next time prices are synced or uploaded" });
  }
  const safeName = String(pdf.name || "rapaport.pdf").replace(/[^\w. -]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.status(200).send(Buffer.from(pdf.b64, "base64"));
}
