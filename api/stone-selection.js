// /api/stone-selection — private client selections of website stones.
//
// PUBLIC (the client's personal link, token = credential):
//   GET  ?token=T                      -> { selection:{client_name,note,max_picks,status,picked}, stones:[public stone fields] }
//   POST {action:"pick", token, idToken, picks:[sku..], finalise:bool}
//        idToken = Firebase ID token from "Continue with Google". The first Google account to sign in claims the link;
//        only that account can save or finalise afterwards. Viewing the stones needs only the link.
//        picks must be a subset of the offered stones and at most max_picks; finalise needs exactly
//        max_picks (or every available stone when fewer remain). A finalised selection is locked.
// STAFF (x-crm-secret):
//   POST {action:"create", client_name, client_phone?, note?, skus:[..], max_picks}  -> { token }
//   GET  ?action=list                  -> every selection with the client's picks
//   POST {action:"reopen"|"close"|"delete", id}
// Only PUBLIC_COLUMNS are ever returned to the client - never cost, discount or other stock.

import { randomBytes } from "node:crypto";
import { supa } from "./_lib/supabase.js";
import { TENANT_ID, CRM_SECRET, OWNER_PHONE } from "./_lib/config.js";
import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { PUBLIC_COLUMNS, withGst } from "./_lib/cvdStock.js";
import { verifyFirebaseIdToken } from "./_lib/firebaseAdmin.js";

const COLS = PUBLIC_COLUMNS.join(",");
const MAX_SKUS = 200;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const SKU_RE = /^(CVD|VIB|NAR)-[A-Za-z0-9]+$/;

const isStaff = (req) => Boolean(CRM_SECRET) && req.headers["x-crm-secret"] === CRM_SECRET;
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const decorate = (s) => {
  const out = { ...s, ...withGst(Number(s.price_inr), Number(s.carat)) };
  if (s.stone_type !== "natural") { delete out.rap_used_usd; delete out.sell_disc_pct; delete out.usd_rate_used; }
  return out;
};

async function stonesFor(sb, skus) {
  if (!skus.length) return [];
  const { data, error } = await sb.from("cvd_stones").select(COLS).eq("tenant_id", TENANT_ID).in("sku", skus);
  if (error) throw new Error(error.message);
  const by = new Map(data.map((s) => [s.sku, s]));
  // Keep the order staff chose; stones that vanished from stock are flagged, not dropped.
  return skus.map((sku) => (by.get(sku) ? decorate(by.get(sku)) : { sku, status: "delisted" }));
}

async function getByToken(sb, token) {
  if (!TOKEN_RE.test(token || "")) return null;
  const { data } = await sb.from("stone_selections").select("*").eq("tenant_id", TENANT_ID).eq("token", token).maybeSingle();
  return data || null;
}

const publicView = (sel) => ({ client_name: sel.client_name, note: sel.note, max_picks: sel.max_picks, status: sel.status, picked: sel.picked_skus, finalised_at: sel.finalised_at, claimed_by: sel.google_email ? maskEmail(sel.google_email) : null });
const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, "$1***$2");

async function publicGet(sb, req, res) {
  const sel = await getByToken(sb, String(req.query.token || ""));
  if (!sel || sel.status === "closed") return res.status(404).json({ ok: false, error: "not_found" });
  await sb.from("stone_selections").update({ view_count: (sel.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq("id", sel.id);
  return res.status(200).json({ ok: true, selection: publicView(sel), stones: await stonesFor(sb, sel.skus) });
}

async function publicPick(sb, body, res) {
  const sel = await getByToken(sb, String(body.token || ""));
  if (!sel || sel.status === "closed") return res.status(404).json({ ok: false, error: "not_found" });
  if (sel.status === "finalised") return res.status(409).json({ ok: false, error: "already_finalised", selection: publicView(sel) });

  const who = await verifyFirebaseIdToken(body.idToken);
  if (!who) return res.status(401).json({ ok: false, error: "sign_in_required" });
  if (sel.google_uid && sel.google_uid !== who.uid) return res.status(403).json({ ok: false, error: "linked_to_other_account", selection: publicView(sel) });

  const picks = [...new Set((Array.isArray(body.picks) ? body.picks : []).map(String))];
  if (picks.some((p) => !sel.skus.includes(p))) return res.status(400).json({ ok: false, error: "pick_not_offered" });
  if (picks.length > sel.max_picks) return res.status(400).json({ ok: false, error: `choose at most ${sel.max_picks}` });

  const finalise = body.finalise === true;
  const patch = { picked_skus: picks, updated_at: new Date().toISOString(), google_uid: who.uid, google_email: who.email, google_name: who.name };
  if (finalise) {
    const live = (await stonesFor(sb, sel.skus)).filter((s) => s.status !== "delisted").length;
    const need = Math.min(sel.max_picks, live);
    if (picks.length !== need) return res.status(400).json({ ok: false, error: `choose exactly ${need} to finalise` });
    const gone = (await stonesFor(sb, picks)).filter((s) => s.status === "delisted");
    if (gone.length) return res.status(409).json({ ok: false, error: "a chosen stone is no longer available" });
    patch.status = "finalised"; patch.finalised_at = patch.updated_at;
  }
  const { error } = await sb.from("stone_selections").update(patch).eq("id", sel.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (finalise && OWNER_PHONE) {
    try { await sendWhatsAppWbiz({ phone: OWNER_PHONE, msg: `${sel.client_name} finalised their stone selection: ${picks.join(", ")}`, whatsappClient: null }); } catch { /* best effort */ }
  }
  return res.status(200).json({ ok: true, selection: publicView({ ...sel, ...patch, picked_skus: picks }) });
}

// Sign in with Google and claim (or re-enter) the link without changing the picks.
async function publicClaim(sb, body, res) {
  const sel = await getByToken(sb, String(body.token || ""));
  if (!sel || sel.status === "closed") return res.status(404).json({ ok: false, error: "not_found" });
  const who = await verifyFirebaseIdToken(body.idToken);
  if (!who) return res.status(401).json({ ok: false, error: "sign_in_required" });
  if (sel.google_uid && sel.google_uid !== who.uid) return res.status(403).json({ ok: false, error: "linked_to_other_account", selection: publicView(sel) });
  if (!sel.google_uid) {
    const { error } = await sb.from("stone_selections").update({ google_uid: who.uid, google_email: who.email, google_name: who.name, updated_at: new Date().toISOString() }).eq("id", sel.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    sel.google_email = who.email;
  }
  return res.status(200).json({ ok: true, selection: publicView(sel), me: { email: who.email, name: who.name } });
}

async function staffCreate(sb, body, res) {
  const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).map(String))];
  const name = clean(body.client_name, 80);
  const maxPicks = Math.max(1, Math.min(Number(body.max_picks) || 1, skus.length || 1));
  if (!name) return res.status(400).json({ ok: false, error: "client_name required" });
  if (!skus.length || skus.length > MAX_SKUS || skus.some((s) => !SKU_RE.test(s))) return res.status(400).json({ ok: false, error: "choose 1 to 200 valid stones" });
  const token = randomBytes(18).toString("base64url");
  const { data, error } = await sb.from("stone_selections").insert({
    tenant_id: TENANT_ID, token, client_name: name, client_phone: clean(body.client_phone, 20) || null, note: clean(body.note, 400) || null,
    skus, max_picks: maxPicks, created_by: clean(body.created_by, 60) || null,
  }).select("id,token").single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, id: data.id, token: data.token, url: `https://ssj.in/my-selection/${data.token}` });
}

async function staffList(sb, res) {
  const { data, error } = await sb.from("stone_selections").select("*").eq("tenant_id", TENANT_ID).neq("status", "closed").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, selections: data.map((s) => ({ ...s, url: `https://ssj.in/my-selection/${s.token}` })) });
}

async function staffChange(sb, body, res) {
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const q = sb.from("stone_selections");
  const { error } = body.action === "delete"
    ? await q.delete().eq("tenant_id", TENANT_ID).eq("id", id)
    : body.action === "unlink"
    ? await q.update({ google_uid: null, google_email: null, google_name: null, updated_at: new Date().toISOString() }).eq("tenant_id", TENANT_ID).eq("id", id)
    : await q.update(body.action === "close" ? { status: "closed" } : { status: "open", finalised_at: null, updated_at: new Date().toISOString() }).eq("tenant_id", TENANT_ID).eq("id", id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  const sb = supa();
  try {
    if (req.method === "GET") {
      if (req.query.action === "list") return isStaff(req) ? await staffList(sb, res) : res.status(401).json({ ok: false, error: "unauthorized" });
      return await publicGet(sb, req, res);
    }
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action === "pick") return await publicPick(sb, body, res);
    if (body.action === "claim") return await publicClaim(sb, body, res);
    if (!isStaff(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (body.action === "create") return await staffCreate(sb, body, res);
    if (["reopen", "close", "delete", "unlink"].includes(body.action)) return await staffChange(sb, body, res);
    return res.status(400).json({ ok: false, error: "unknown_action" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
