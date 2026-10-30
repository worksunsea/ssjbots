// GET /api/cvd-stones — public catalogue of CVD certified diamonds for ssj.in.
//   ?action=list   filters: kind=white|fancy, shape, color, clarity, cut, fancy_color,
//                  carat_min, carat_max, price_min, price_max (selling price ex-GST),
//                  status=listed|reserved|all (default all live), q (SKU / stock no),
//                  sort=price_asc|price_desc|carat_asc|carat_desc|new, page, limit (<=60)
//   ?action=get&sku=CVD-123
//   ?action=facets  counts per shape / colour / clarity / kind + price & carat range
//   ?action=skus    every live SKU with its last update (for the website sitemap)
// Only PUBLIC_COLUMNS are ever selected — purchase cost never leaves the server.

import { supa } from "./_lib/supabase.js";
import { TENANT_ID } from "./_lib/config.js";
import { PUBLIC_COLUMNS, withGst } from "./_lib/cvdStock.js";

const COLS = PUBLIC_COLUMNS.join(",");
const MAX_LIMIT = 60;
const SORTS = {
  price_asc: ["price_inr", true], price_desc: ["price_inr", false],
  carat_asc: ["carat", true], carat_desc: ["carat", false], new: ["first_seen_at", false],
};
const FACET_TTL_MS = 5 * 60 * 1000;
let facetCache = { ts: 0, data: null };

const num = (v) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const decorate = (s) => ({ ...s, ...withGst(Number(s.price_inr), Number(s.carat)) });

function applyFilters(q, p) {
  if (p.kind === "white" || p.kind === "fancy") q = q.eq("source_file_kind", p.kind);
  for (const f of ["shape", "color", "clarity", "cut", "fancy_color"]) if (p[f]) q = q.ilike(f, String(p[f]).replace(/[%,]/g, ""));
  const [cMin, cMax, pMin, pMax] = [num(p.carat_min), num(p.carat_max), num(p.price_min), num(p.price_max)];
  if (cMin !== null) q = q.gte("carat", cMin);
  if (cMax !== null) q = q.lte("carat", cMax);
  if (pMin !== null) q = q.gte("price_inr", pMin);
  if (pMax !== null) q = q.lte("price_inr", pMax);
  if (p.status === "listed" || p.status === "reserved") q = q.eq("status", p.status); else q = q.neq("status", "delisted");
  const term = String(p.q || "").replace(/[%,()]/g, "").trim();
  if (term) q = q.or(`sku.ilike.%${term}%,stock_no.ilike.%${term}%`);
  return q;
}

async function list(sb, p, res) {
  const limit = Math.min(Math.max(num(p.limit) || 24, 1), MAX_LIMIT);
  const page = Math.max(num(p.page) || 1, 1);
  const [col, asc] = SORTS[p.sort] || SORTS.new;
  let q = sb.from("cvd_stones").select(COLS, { count: "exact" }).eq("tenant_id", TENANT_ID);
  q = applyFilters(q, p).order(col, { ascending: asc }).order("sku").range((page - 1) * limit, page * limit - 1);
  const { data, count, error } = await q;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, total: count || 0, page, limit, stones: (data || []).map(decorate) });
}

async function getOne(sb, sku, res) {
  if (!sku) return res.status(400).json({ ok: false, error: "sku_required" });
  const { data, error } = await sb.from("cvd_stones").select(COLS).eq("tenant_id", TENANT_ID).eq("sku", sku).maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: "not_found" });
  // Delisted stones keep their URL alive but expose only the fact they are gone.
  if (data.status === "delisted") return res.status(200).json({ ok: true, stone: { sku: data.sku, status: "delisted" } });
  return res.status(200).json({ ok: true, stone: decorate(data) });
}

async function facets(sb, res) {
  if (facetCache.data && Date.now() - facetCache.ts < FACET_TTL_MS) return res.status(200).json(facetCache.data);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("cvd_stones").select("shape,color,clarity,fancy_color,source_file_kind,price_inr,carat")
      .eq("tenant_id", TENANT_ID).neq("status", "delisted").range(from, from + 999);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const count = (key) => Object.entries(rows.reduce((a, r) => (r[key] ? ((a[r[key]] = (a[r[key]] || 0) + 1), a) : a), {})).sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, count: n }));
  const prices = rows.map((r) => Number(r.price_inr)); const carats = rows.map((r) => Number(r.carat));
  const data = {
    ok: true, total: rows.length, shapes: count("shape"), colors: count("color"), fancy_colors: count("fancy_color"), clarities: count("clarity"), kinds: count("source_file_kind"),
    price: rows.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    carat: rows.length ? { min: Math.min(...carats), max: Math.max(...carats) } : null,
  };
  facetCache = { ts: Date.now(), data };
  return res.status(200).json(data);
}

async function skus(sb, res) {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("cvd_stones").select("sku,updated_at,image_url")
      .eq("tenant_id", TENANT_ID).neq("status", "delisted").order("sku").range(from, from + 999);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    out.push(...data);
    if (data.length < 1000) break;
  }
  return res.status(200).json({ ok: true, skus: out });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const sb = supa();
  const action = req.query.action || "list";
  if (action === "list") return list(sb, req.query, res);
  if (action === "get") return getOne(sb, req.query.sku, res);
  if (action === "facets") return facets(sb, res);
  if (action === "skus") return skus(sb, res);
  return res.status(400).json({ ok: false, error: "unknown_action" });
}
