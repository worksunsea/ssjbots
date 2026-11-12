// POST /api/inbox-agent  (x-inbox-token header)
// Narrow door for the hourly Claude routine that reads uploaded forms (docs/INBOX_ROUTINE.md).
// It can ONLY: list new inbox items, look up contacts by phone/name/email, and save a proposal.
// It cannot write contacts - a person reviews and saves in the app.
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, TENANT_ID } from "./_lib/config.js";
import { timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 30 };

const LEAD_COLS = "id,name,phone,mobile2,spouse_name,spouse_mobile,email,bday,anniversary,profession,address_house,address_locality,city,address_state,address_pincode,tags,extra_fields";
const sbHeaders = () => ({ apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" });
const clean = (s) => String(s ?? "").replace(/[,()*%\\"]/g, " ").trim();

function tokenOk(req) {
  const want = process.env.INBOX_TOKEN || "";
  const got = String(req.headers["x-inbox-token"] || "");
  if (want.length < 20 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function rest(path, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders(), ...(init?.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!tokenOk(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  try {
    if (body.action === "pending") {
      const rows = await rest(`doc_inbox?select=id,kind,note,image_urls,created_at&tenant_id=eq.${TENANT_ID}&status=eq.new&order=created_at.asc&limit=10`);
      return res.status(200).json({ ok: true, items: rows });
    }
    if (body.action === "lookup") {
      const parts = [];
      for (const p of (body.phones || []).slice(0, 8)) {
        const d = clean(p).replace(/\D/g, "").slice(-10);
        if (d.length >= 6) parts.push(`phone.ilike.*${d}*`, `mobile2.ilike.*${d}*`, `spouse_mobile.ilike.*${d}*`);
      }
      for (const n of (body.names || []).slice(0, 4)) { const c = clean(n); if (c.length >= 3) parts.push(`name.ilike.*${c.replace(/\s+/g, "*")}*`); }
      for (const e of (body.emails || []).slice(0, 4)) { const c = clean(e); if (c.includes("@")) parts.push(`email.ilike.${c}`); }
      if (!parts.length) return res.status(200).json({ ok: true, contacts: [] });
      const rows = await rest(`bullion_leads?select=${LEAD_COLS}&tenant_id=eq.${TENANT_ID}&deleted_at=is.null&or=(${parts.join(",")})&limit=15`);
      return res.status(200).json({ ok: true, contacts: rows.filter((c) => !String(c.name || "").startsWith("[MERGED]")) });
    }
    if (body.action === "submit") {
      const people = body.proposal?.people;
      if (!body.id || !Array.isArray(people)) return res.status(400).json({ ok: false, error: "id_and_proposal.people_required" });
      const proposal = { people, notes: String(body.proposal.notes || "").slice(0, 2000) };
      const out = await rest(`doc_inbox?id=eq.${encodeURIComponent(body.id)}&tenant_id=eq.${TENANT_ID}&status=eq.new`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "proposed", proposal, processed_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, updated: out.length });
    }
    return res.status(400).json({ ok: false, error: "unknown_action" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
