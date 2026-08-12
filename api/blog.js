// GET  /api/blog?action=list        — public. Published posts only
//      (published_at <= now), newest first. Used by ssj-website's blog
//      index, homepage teaser, and api/sitemap.js.
// GET  /api/blog?action=get&slug=.. — public. One published post by slug.
//      Returns { ok:false } (not the post) if it's unpublished/future-dated
//      or doesn't exist — mirrors the old client-side isPublished() gate,
//      now enforced server-side instead.
// GET  /api/blog?action=admin-list  — staff-only (x-crm-secret). All posts,
//      any status/date, for the CRM Blog Admin list screen.
// GET  /api/blog?action=admin-get&id=.. — staff-only. One post by id
//      (including unpublished), for the admin edit form.
// POST /api/blog?action=create      — staff-only. Body: the post fields
//      (slug, category, title, description, heroImage, heroImageAlt,
//      ctaHeading, ctaText, ctaHref, ctaLabel, body[], publishedAt).
// POST /api/blog?action=update      — staff-only. Body: { id, ...fields }.
// POST /api/blog?action=delete      — staff-only. Body: { id }.

import { supa } from "./_lib/supabase.js";
import { TENANT_ID, checkCrmSecret } from "./_lib/config.js";

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

const ROW_TO_POST = (row) => ({
  id: row.id,
  slug: row.slug,
  category: row.category,
  title: row.title,
  description: row.description,
  heroImage: row.hero_image,
  heroImageAlt: row.hero_image_alt,
  ctaHeading: row.cta_heading,
  ctaText: row.cta_text,
  ctaHref: row.cta_href,
  ctaLabel: row.cta_label,
  body: row.body,
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
});

const POST_TO_ROW = (p) => ({
  slug: p.slug,
  category: p.category,
  title: p.title,
  description: p.description,
  hero_image: p.heroImage,
  hero_image_alt: p.heroImageAlt,
  cta_heading: p.ctaHeading || null,
  cta_text: p.ctaText || null,
  cta_href: p.ctaHref || null,
  cta_label: p.ctaLabel || null,
  body: p.body || [],
  published_at: p.publishedAt || new Date().toISOString(),
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  if (req.method === "GET" && action === "list") {
    const { data, error } = await sb
      .from("blog_posts")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, posts: (data || []).map(ROW_TO_POST) });
  }

  if (req.method === "GET" && action === "get") {
    const slug = req.query?.slug;
    if (!slug) return res.status(400).json({ ok: false, error: "slug_required" });
    const { data, error } = await sb
      .from("blog_posts")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .eq("slug", slug)
      .lte("published_at", new Date().toISOString())
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(200).json({ ok: false, error: "not_found" });
    return res.status(200).json({ ok: true, post: ROW_TO_POST(data) });
  }

  if (req.method === "GET" && action === "admin-list") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const { data, error } = await sb
      .from("blog_posts")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("published_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, posts: (data || []).map(ROW_TO_POST) });
  }

  if (req.method === "GET" && action === "admin-get") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const id = req.query?.id;
    if (!id) return res.status(400).json({ ok: false, error: "id_required" });
    const { data, error } = await sb.from("blog_posts").select("*").eq("tenant_id", TENANT_ID).eq("id", id).maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "not_found" });
    return res.status(200).json({ ok: true, post: ROW_TO_POST(data) });
  }

  if (req.method === "POST" && action === "create") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.slug || !body.title || !body.category) return res.status(400).json({ ok: false, error: "slug_title_category_required" });
    const row = { ...POST_TO_ROW(body), tenant_id: TENANT_ID, created_by: body.createdBy || null };
    const { data, error } = await sb.from("blog_posts").insert(row).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, post: ROW_TO_POST(data) });
  }

  if (req.method === "POST" && action === "update") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const row = { ...POST_TO_ROW(body), updated_at: new Date().toISOString() };
    const { data, error } = await sb.from("blog_posts").update(row).eq("tenant_id", TENANT_ID).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, post: ROW_TO_POST(data) });
  }

  if (req.method === "POST" && action === "delete") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return;
    const body = parseBody(req);
    if (!body.id) return res.status(400).json({ ok: false, error: "id_required" });
    const { error } = await sb.from("blog_posts").delete().eq("tenant_id", TENANT_ID).eq("id", body.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
