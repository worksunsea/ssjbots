// GET  /api/solitaire-designs?action=designs             — public. Lists active
//      design concepts (+ their APPROVED variants only) for a category.
// GET  /api/solitaire-designs?action=admin-designs       — staff-only. Same,
//      but variants of every status (for the AI Design Generator to review).
// GET  /api/solitaire-designs?action=labgrown-prices      — public. Lab-grown
//      price grid, used by the client-side pricing util.
// GET  /api/solitaire-designs?action=rates                — public. Live gold
//      rates + USD/INR (parsed from the same sheet the Calculator uses).
// POST /api/solitaire-designs?action=lead                 — public. Lead capture
//      + funnel enrollment, mirrors corporate-gifting's lead action.
// POST /api/solitaire-designs?action=generate-variant      — staff-only (x-crm-secret).
//      Calls the AI Design Generator for one design x gold-colour x shape combo.
//      Accepts optional promptOverride + referenceImageBase64 + viewKeys
//      (e.g. ["front"] for a cheap single-view preview batch).
// POST /api/solitaire-designs?action=generate-category-cover — staff-only. Generates
//      the public landing page's category-picker hero image (deterministic path).
// POST /api/solitaire-designs?action=update-variant        — staff-only. Edit
//      est_gold_weight_g / approve / reject a generated variant.
// POST /api/solitaire-designs?action=update-labgrown-price — staff-only. Edit
//      the lab-grown price grid.
// GET  /api/solitaire-designs?action=pricing-config       — public. Making
//      charge (₹/g), natural-diamond sell discount (%), side-diamond price
//      (₹/ct) — all admin-editable.
// POST /api/solitaire-designs?action=update-pricing-config — staff-only.
// POST /api/solitaire-designs?action=set-design-gold-weight — staff-only.
//      Applies one gold weight estimate to every variant of a design.
// POST /api/solitaire-designs?action=update-design         — staff-only. Rename
//      a design and/or edit concept prompt / side-diamond flag + weight (ct).
// POST /api/solitaire-designs?action=generate-size-chart   — staff-only. One
//      wide image per design showing .30ct-5ct size progression side by side.
// POST /api/solitaire-designs?action=suggest-design-name    — staff-only. Vision
//      model looks at the design's actual generated image and suggests a name.
// POST /api/solitaire-designs?action=generate-design-candidates — staff-only. Spins
//      up N whole NEW sibling designs (own concept + one preview image each),
//      inactive until approved — for reviewing brand-new products, not variants.
// GET  /api/solitaire-designs?action=pending-designs        — staff-only. Lists
//      not-yet-approved candidate designs (active=false) for a category.
// POST /api/solitaire-designs?action=approve-design-candidate — staff-only. Activates
//      a candidate design and approves its preview variant.
// POST /api/solitaire-designs?action=delete-design          — staff-only. Deletes
//      a design (and its variants via FK cascade) — used to reject a candidate.
// POST /api/solitaire-designs?action=save-selection        — public. Saves a
//      client's finished configuration (like "Save Estimate").

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID, checkCrmSecret } from "./_lib/config.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { generateSolitaireDesignViews, generateCategoryCoverImage, generateSizeChartImage, suggestDesignName, suggestDesignVariationConcept } from "./_lib/solitaireImageGen.js";
import { getRates } from "./_lib/rates.js";

// 120s — sequential per-view generation with 429 retry/backoff (see
// solitaireImageGen.js) can take a while under real rate-limit pressure;
// 60s was cutting some generate-variant calls off mid-retry.
export const config = { maxDuration: 120 };

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
  // Newly created/approved designs were mysteriously not appearing in the
  // admin list on some devices — every data-changing action here is
  // immediately followed by a re-fetch of the same GET endpoint, so any
  // caching layer (mobile carrier proxy, browser HTTP cache) serving a
  // stale response would show exactly this symptom. Force no caching.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  // ── GET action=designs — public catalogue: designs + their approved
  // variants, optionally filtered by category. ─────────────────────────
  if (req.method === "GET" && action === "designs") {
    const category = req.query?.category;
    let query = sb.from("solitaire_designs").select("*").eq("tenant_id", TENANT_ID).eq("active", true)
      .order("category", { ascending: true }).order("design_number", { ascending: true });
    if (category) query = query.eq("category", category);
    const { data: designs, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    const ids = (designs || []).map((d) => d.id);
    let variants = [];
    if (ids.length) {
      const { data: vRows, error: vErr } = await sb.from("solitaire_design_variants")
        .select("*").eq("tenant_id", TENANT_ID).eq("status", "approved").in("design_id", ids);
      if (vErr) return res.status(500).json({ ok: false, error: vErr.message });
      variants = vRows || [];
    }

    const byDesign = {};
    for (const v of variants) (byDesign[v.design_id] ||= []).push(v);

    const result = (designs || []).map((d) => ({
      id: d.id,
      category: d.category,
      designNumber: d.design_number,
      name: d.name,
      hasSideDiamonds: d.has_side_diamonds,
      sideDiamondWeightCt: d.side_diamond_weight_ct,
      sizeChartImageUrl: d.size_chart_image_url,
      variants: (byDesign[d.id] || []).map((v) => ({
        id: v.id,
        goldColor: v.gold_color,
        diamondShape: v.diamond_shape,
        caratSize: v.carat_size,
        viewImages: v.view_images,
        estGoldWeightG: v.est_gold_weight_g,
      })),
    }));
    return res.status(200).json({ ok: true, designs: result });
  }

  // ── GET action=admin-designs — staff-only. Same as action=designs but
  // includes variants of every status (generated/approved/rejected), so the
  // AI Design Generator can show freshly generated, not-yet-approved
  // variants for review. (action=designs stays approved-only — that's the
  // public client-facing feed.) ─────────────────────────────────────────
  if (req.method === "GET" && action === "admin-designs") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const category = req.query?.category;
    let query = sb.from("solitaire_designs").select("*").eq("tenant_id", TENANT_ID).eq("active", true)
      .order("category", { ascending: true }).order("design_number", { ascending: true });
    if (category) query = query.eq("category", category);
    const { data: designs, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    const ids = (designs || []).map((d) => d.id);
    let variants = [];
    if (ids.length) {
      const { data: vRows, error: vErr } = await sb.from("solitaire_design_variants")
        .select("*").eq("tenant_id", TENANT_ID).in("design_id", ids).order("created_at", { ascending: false });
      if (vErr) return res.status(500).json({ ok: false, error: vErr.message });
      variants = vRows || [];
    }

    const byDesign = {};
    for (const v of variants) (byDesign[v.design_id] ||= []).push(v);
    // Sibling designs (created via "Create N New Designs to Review") nest
    // under their root design in the UI rather than showing as flat
    // top-level dropdown entries — this is what groups them.
    const childrenByParent = {};
    for (const d of designs || []) if (d.parent_design_id) (childrenByParent[d.parent_design_id] ||= []).push(d);

    const result = (designs || []).map((d) => ({
      id: d.id,
      category: d.category,
      designNumber: d.design_number,
      name: d.name,
      conceptPrompt: d.concept_prompt,
      hasSideDiamonds: d.has_side_diamonds,
      sideDiamondWeightCt: d.side_diamond_weight_ct,
      sizeChartImageUrl: d.size_chart_image_url,
      parentDesignId: d.parent_design_id,
      children: (childrenByParent[d.id] || []).map((c) => ({
        id: c.id, name: c.name, variantCount: (byDesign[c.id] || []).length,
      })),
      variants: (byDesign[d.id] || []).map((v) => ({
        id: v.id,
        goldColor: v.gold_color,
        diamondShape: v.diamond_shape,
        caratSize: v.carat_size,
        viewImages: v.view_images,
        estGoldWeightG: v.est_gold_weight_g,
        status: v.status,
        referenceImageUrl: v.reference_image_url,
        promptOverride: v.prompt_override,
      })),
    }));
    return res.status(200).json({ ok: true, designs: result });
  }

  // ── GET action=labgrown-prices — public price grid ───────────────────
  if (req.method === "GET" && action === "labgrown-prices") {
    const { data, error } = await sb.from("solitaire_labgrown_prices")
      .select("carat_size, shape, price_per_ct").eq("tenant_id", TENANT_ID).order("carat_size", { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, prices: data || [] });
  }

  // ── GET action=rates — public. Live gold/silver spot rates for the
  // pricing panel (same source the Calculator tab uses). ───────────────
  if (req.method === "GET" && action === "rates") {
    const rates = await getRates();
    return res.status(200).json({ ok: true, rates });
  }

  // ── POST action=lead — public lead capture + funnel enrollment ───────
  if (req.method === "POST" && action === "lead") {
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone || phone.length !== 10) return res.status(400).json({ ok: false, error: "invalid_phone" });
    const name = body.name ? String(body.name).trim().slice(0, 100) : null;
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    const email = body.email ? String(body.email).trim().slice(0, 200) : null;

    const { data: existing } = await sb.from("bullion_leads")
      .select("id").eq("tenant_id", TENANT_ID).eq("phone", phone).maybeSingle();

    let leadId = existing?.id;
    if (existing) {
      await sb.from("bullion_leads").update({
        name, email: email || undefined, source: "solitaire_jewellery", funnel_id: "solitaire_jewellery",
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      const { data: newLead, error: insErr } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name, email,
        status: "new", source: "solitaire_jewellery", funnel_id: "solitaire_jewellery",
      }).select("id").single();
      if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
      leadId = newLead.id;
    }

    const { data: funnel } = await sb.from("funnels").select("*").eq("id", "solitaire_jewellery").maybeSingle();
    if (funnel?.active) {
      await enrollLeadInDrip({ lead: { id: leadId, name, phone, funnel_id: "solitaire_jewellery" }, funnel });
    }
    return res.status(200).json({ ok: true, leadId });
  }

  // ── POST action=create-design — staff-only. Adds a new design concept.
  // Categories are NOT capped at the original 25 seeded designs — admins
  // can keep adding as many named designs as they want per category, each
  // gets its own full gold-colour x shape x carat combo set. designNumber
  // is auto-assigned (next free number in the category) unless supplied. ─
  if (req.method === "POST" && action === "create-design") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { category, hasSideDiamonds } = body;
    let { designNumber, name, conceptPrompt } = body;
    if (!category) return res.status(400).json({ ok: false, error: "category_required" });
    if (!designNumber) {
      const { data: maxRow } = await sb.from("solitaire_designs").select("design_number")
        .eq("tenant_id", TENANT_ID).eq("category", category).order("design_number", { ascending: false }).limit(1).maybeSingle();
      designNumber = (maxRow?.design_number || 0) + 1;
    }
    // Both name and concept prompt are optional — a nice name can be
    // suggested later from the actual generated image (action=suggest-
    // design-name), and the concept prompt just needs SOME style direction
    // to seed the AI generator with, admin can refine it anytime.
    if (!name) name = `${category.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} Design ${designNumber}`;
    if (!conceptPrompt) conceptPrompt = `an elegant solitaire ${category.replace("_", " ")} design, classic and refined styling`;
    const { data, error } = await sb.from("solitaire_designs").insert({
      tenant_id: TENANT_ID, category, design_number: designNumber, name,
      concept_prompt: conceptPrompt, has_side_diamonds: !!hasSideDiamonds,
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, design: data });
  }

  // ── POST action=update-design — staff-only. Rename a design and/or edit
  // its concept prompt / side-diamond flag / side-diamond weight. Product
  // names are AI-suggested (or admin-typed) at creation but always editable
  // afterward — this is that edit path. ────────────────────────────────
  if (req.method === "POST" && action === "update-design") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { designId, name, conceptPrompt, hasSideDiamonds, sideDiamondWeightCt } = body;
    if (!designId) return res.status(400).json({ ok: false, error: "designId_required" });
    const update = {};
    if (name != null) update.name = String(name).trim().slice(0, 150);
    if (conceptPrompt != null) update.concept_prompt = String(conceptPrompt).trim();
    if (hasSideDiamonds != null) update.has_side_diamonds = !!hasSideDiamonds;
    if (sideDiamondWeightCt != null) update.side_diamond_weight_ct = Number(sideDiamondWeightCt);
    if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: "nothing_to_update" });
    const { data, error } = await sb.from("solitaire_designs").update(update).eq("id", designId).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, design: data });
  }

  // ── POST action=generate-variant — staff-only. Calls the AI Design
  // Generator for one design x gold-colour x shape (± carat) combo. ────
  if (req.method === "POST" && action === "generate-variant") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { designId, goldColor, diamondShape, caratSize, generatedBy, promptOverride, referenceImageBase64, matchReferenceDesign, includeWorn, viewKeys, quality } = body;
    if (!designId || !goldColor || !diamondShape) {
      return res.status(400).json({ ok: false, error: "designId_goldColor_diamondShape_required" });
    }

    const { data: design } = await sb.from("solitaire_designs").select("*").eq("id", designId).maybeSingle();
    if (!design) return res.status(404).json({ ok: false, error: "design_not_found" });

    const variantIdPlaceholder = `${Date.now()}`;
    let referenceImageUrl = null;
    if (referenceImageBase64) {
      const refPath = `uploads/solitaire-designs/${designId}/${variantIdPlaceholder}/reference.png`;
      const { error: refErr } = await sb.storage.from("media").upload(refPath, Buffer.from(referenceImageBase64, "base64"), { contentType: "image/png", upsert: true });
      if (!refErr) referenceImageUrl = sb.storage.from("media").getPublicUrl(refPath).data.publicUrl;
    }

    let views;
    try {
      views = await generateSolitaireDesignViews({
        conceptPrompt: design.concept_prompt,
        promptOverride: promptOverride || null,
        category: design.category,
        goldColor, diamondShape, caratSize,
        hasSideDiamonds: design.has_side_diamonds,
        referenceImageBase64,
        matchReferenceDesign: !!matchReferenceDesign,
        includeWorn: includeWorn !== false, // default true — cascade calls explicitly pass false
        viewKeys: Array.isArray(viewKeys) ? viewKeys : undefined,
        quality: quality || "low",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "generation_failed", detail: String(e.message || e) });
    }

    const viewImages = {};
    for (const v of views) {
      const path = `uploads/solitaire-designs/${designId}/${variantIdPlaceholder}/${v.key}.png`;
      const { error: upErr } = await sb.storage.from("media").upload(path, Buffer.from(v.base64, "base64"), { contentType: "image/png", upsert: true });
      if (upErr) continue;
      const { data: pub } = sb.storage.from("media").getPublicUrl(path);
      viewImages[v.key] = pub.publicUrl;
    }
    if (!Object.keys(viewImages).length) return res.status(500).json({ ok: false, error: "no_images_saved" });

    const { data: variant, error } = await sb.from("solitaire_design_variants").insert({
      tenant_id: TENANT_ID, design_id: designId, gold_color: goldColor, diamond_shape: diamondShape,
      carat_size: caratSize ?? null, view_images: viewImages, generated_by: generatedBy || null,
      reference_image_url: referenceImageUrl, prompt_override: promptOverride || null,
      generation_prompt: views[0]?.prompt || null, status: "generated",
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, variant });
  }

  // ── POST action=generate-category-cover — staff-only. Generates one
  // attractive editorial hero image for a category, used on the public
  // landing page's category-picker tiles. Deterministic storage path
  // (upsert) — calling it again just replaces the image. ────────────────
  if (req.method === "POST" && action === "generate-category-cover") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const category = body.category;
    if (!["ring", "gents_ring", "pendant", "earring"].includes(category)) {
      return res.status(400).json({ ok: false, error: "invalid_category" });
    }
    let image;
    try {
      image = await generateCategoryCoverImage(category);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "generation_failed", detail: String(e.message || e) });
    }
    const path = `uploads/solitaire-designs/category-covers/${category}.png`;
    const { error: upErr } = await sb.storage.from("media").upload(path, Buffer.from(image.base64, "base64"), { contentType: "image/png", upsert: true });
    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
    const { data: pub } = sb.storage.from("media").getPublicUrl(path);
    // Same deterministic-path caching issue as the size chart — bust it.
    const imageUrl = `${pub.publicUrl}?v=${Date.now()}`;
    return res.status(200).json({ ok: true, category, imageUrl });
  }

  // ── POST action=generate-size-chart — staff-only. One wide image per
  // design showing the same setting with diamonds from .30ct to 5ct side by
  // side, so the size progression is visible in a single photo. Stored on
  // the design, not a variant (it's design-level, not gold-colour/shape
  // specific). Deterministic path (upsert). ────────────────────────────
  if (req.method === "POST" && action === "generate-size-chart") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const designId = body.designId;
    if (!designId) return res.status(400).json({ ok: false, error: "designId_required" });

    const { data: design } = await sb.from("solitaire_designs").select("*").eq("id", designId).maybeSingle();
    if (!design) return res.status(404).json({ ok: false, error: "design_not_found" });

    let image;
    try {
      image = await generateSizeChartImage({ conceptPrompt: design.concept_prompt, category: design.category, hasSideDiamonds: design.has_side_diamonds });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "generation_failed", detail: String(e.message || e) });
    }
    const path = `uploads/solitaire-designs/${designId}/size-chart.png`;
    const { error: upErr } = await sb.storage.from("media").upload(path, Buffer.from(image.base64, "base64"), { contentType: "image/png", upsert: true });
    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
    const { data: pub } = sb.storage.from("media").getPublicUrl(path);
    // Deterministic upsert path = same URL every regeneration, so browsers
    // (and any CDN in front of Storage) keep serving the stale cached image
    // even though the file was overwritten. Append a cache-busting query
    // param so each regeneration is a genuinely new URL.
    const imageUrl = `${pub.publicUrl}?v=${Date.now()}`;
    const { error: updErr } = await sb.from("solitaire_designs").update({ size_chart_image_url: imageUrl }).eq("id", designId);
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });
    return res.status(200).json({ ok: true, designId, imageUrl });
  }

  // ── POST action=suggest-design-name — staff-only. Looks at the design's
  // actual generated front-view image (approved variant preferred, else any
  // generated one) and suggests a name — admin reviews/edits via
  // action=update-design, this does NOT save anything itself. ──────────
  if (req.method === "POST" && action === "suggest-design-name") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const designId = body.designId;
    if (!designId) return res.status(400).json({ ok: false, error: "designId_required" });

    const { data: design } = await sb.from("solitaire_designs").select("*").eq("id", designId).maybeSingle();
    if (!design) return res.status(404).json({ ok: false, error: "design_not_found" });

    const { data: variants } = await sb.from("solitaire_design_variants")
      .select("view_images, status").eq("tenant_id", TENANT_ID).eq("design_id", designId)
      .order("status", { ascending: true }); // "approved" sorts before "generated"/"rejected" alphabetically
    const withImage = (variants || []).find((v) => v.status === "approved" && v.view_images?.front)
      || (variants || []).find((v) => v.view_images?.front);
    if (!withImage) return res.status(400).json({ ok: false, error: "no_image_yet", detail: "Generate at least one variant for this design first." });

    let name;
    try {
      name = await suggestDesignName({ imageUrl: withImage.view_images.front, category: design.category, conceptPrompt: design.concept_prompt });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "suggestion_failed", detail: String(e.message || e) });
    }
    return res.status(200).json({ ok: true, name });
  }

  // ── POST action=generate-design-candidates — staff-only. Creates ONE new
  // sibling design (own name/concept, inactive until approved) with ONE
  // cheap front-view preview variant. Called once per candidate wanted —
  // the client loops this N times with pacing, same pattern as the variant
  // preview batch, to stay within OpenAI rate limits. ───────────────────
  if (req.method === "POST" && action === "generate-design-candidates") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const baseDesignId = body.baseDesignId;
    // standalone=true: create a fresh ROOT design (own top-level dropdown
    // entry), only using baseDesignId for style/category inspiration — used
    // by "Create 1 New Design per Category", where each result should stand
    // on its own rather than nesting under whatever design #1 happened to
    // be. Default (false): nests under baseDesignId as a sibling, used by
    // "Create N New Designs to Review" for the currently selected design.
    const standalone = !!body.standalone;
    if (!baseDesignId) return res.status(400).json({ ok: false, error: "baseDesignId_required" });

    const { data: base } = await sb.from("solitaire_designs").select("*").eq("id", baseDesignId).maybeSingle();
    if (!base) return res.status(404).json({ ok: false, error: "base_design_not_found" });

    let concept;
    try {
      concept = await suggestDesignVariationConcept({ baseConceptPrompt: base.concept_prompt, category: base.category });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "concept_generation_failed", detail: String(e.message || e) });
    }

    const { data: maxRow } = await sb.from("solitaire_designs").select("design_number")
      .eq("tenant_id", TENANT_ID).eq("category", base.category).order("design_number", { ascending: false }).limit(1).maybeSingle();
    const designNumber = (maxRow?.design_number || 0) + 1;

    let name, parentDesignId;
    if (standalone) {
      parentDesignId = null;
      name = `${base.category.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} Concept ${designNumber}`;
    } else {
      // Nest under the true ROOT design, never a grandchild — if "base" is
      // itself already a sibling (e.g. generating more variations while
      // viewing "Classic Solitaire Ring 6"), new candidates still attach to
      // the original "Classic Solitaire Ring", keeping the hierarchy 2 levels.
      const rootId = base.parent_design_id || base.id;
      const rootName = base.parent_design_id ? base.name.replace(/\s+\d+$/, "") : base.name;
      const { count: siblingCount } = await sb.from("solitaire_designs")
        .select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("parent_design_id", rootId);
      parentDesignId = rootId;
      name = `${rootName} ${(siblingCount || 0) + 2}`; // +2: "2" is the first sibling name (root itself is "1")
    }

    const { data: newDesign, error: insErr } = await sb.from("solitaire_designs").insert({
      tenant_id: TENANT_ID, category: base.category, design_number: designNumber, name,
      concept_prompt: concept, has_side_diamonds: base.has_side_diamonds, active: false, // pending review
      parent_design_id: parentDesignId,
    }).select("*").single();
    if (insErr) return res.status(500).json({ ok: false, error: insErr.message });

    let views;
    try {
      views = await generateSolitaireDesignViews({
        conceptPrompt: concept, category: base.category, goldColor: "yellow", diamondShape: "Round",
        hasSideDiamonds: base.has_side_diamonds, viewKeys: ["front"], quality: body.quality || "low",
      });
    } catch (e) {
      // Design row exists but with no preview image — surface it as a
      // failure the client can retry (delete-design + try again), rather
      // than leaving a silently image-less candidate.
      return res.status(500).json({ ok: false, error: "image_generation_failed", detail: String(e.message || e), design: newDesign });
    }

    const variantIdPlaceholder = `${Date.now()}`;
    const viewImages = {};
    for (const v of views) {
      const path = `uploads/solitaire-designs/${newDesign.id}/${variantIdPlaceholder}/${v.key}.png`;
      const { error: upErr } = await sb.storage.from("media").upload(path, Buffer.from(v.base64, "base64"), { contentType: "image/png", upsert: true });
      if (upErr) continue;
      const { data: pub } = sb.storage.from("media").getPublicUrl(path);
      viewImages[v.key] = pub.publicUrl;
    }
    if (!Object.keys(viewImages).length) return res.status(500).json({ ok: false, error: "no_images_saved", design: newDesign });

    const { data: variant, error: varErr } = await sb.from("solitaire_design_variants").insert({
      tenant_id: TENANT_ID, design_id: newDesign.id, gold_color: "yellow", diamond_shape: "Round",
      view_images: viewImages, status: "generated",
    }).select("*").single();
    if (varErr) return res.status(500).json({ ok: false, error: varErr.message, design: newDesign });

    return res.status(200).json({ ok: true, design: newDesign, variant });
  }

  // ── GET action=pending-designs — staff-only. Candidate designs not yet
  // approved (active=false) for a category, with their preview variant. ─
  if (req.method === "GET" && action === "pending-designs") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const category = req.query?.category;
    let query = sb.from("solitaire_designs").select("*").eq("tenant_id", TENANT_ID).eq("active", false)
      .order("created_at", { ascending: false });
    if (category) query = query.eq("category", category);
    const { data: designs, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    const ids = (designs || []).map((d) => d.id);
    let variants = [];
    if (ids.length) {
      const { data: vRows } = await sb.from("solitaire_design_variants").select("*").eq("tenant_id", TENANT_ID).in("design_id", ids);
      variants = vRows || [];
    }
    const byDesign = {};
    for (const v of variants) (byDesign[v.design_id] ||= []).push(v);

    const result = (designs || []).map((d) => ({
      id: d.id, category: d.category, name: d.name, conceptPrompt: d.concept_prompt, hasSideDiamonds: d.has_side_diamonds,
      variants: (byDesign[d.id] || []).map((v) => ({ id: v.id, goldColor: v.gold_color, diamondShape: v.diamond_shape, viewImages: v.view_images, estGoldWeightG: v.est_gold_weight_g })),
    }));
    return res.status(200).json({ ok: true, designs: result });
  }

  // ── POST action=approve-design-candidate — staff-only. Activates a
  // candidate design (now shows up as a real, sellable design) and
  // approves its preview variant. The client then kicks off that
  // variant's normal cascade (all other gold-colour x shape combos). ───
  if (req.method === "POST" && action === "approve-design-candidate") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const designId = body.designId;
    if (!designId) return res.status(400).json({ ok: false, error: "designId_required" });

    const { error: actErr } = await sb.from("solitaire_designs").update({ active: true }).eq("id", designId);
    if (actErr) return res.status(500).json({ ok: false, error: actErr.message });

    const { data: variant, error: varErr } = await sb.from("solitaire_design_variants")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("design_id", designId).select("*").limit(1).single();
    if (varErr) return res.status(500).json({ ok: false, error: varErr.message });

    return res.status(200).json({ ok: true, variant });
  }

  // ── POST action=delete-design — staff-only. Deletes a design and its
  // variants (FK cascade) — used to reject a candidate, or remove a
  // mistaken design entirely. Storage objects are left orphaned (same as
  // rejected variants elsewhere in this file — no cleanup job exists yet). ─
  if (req.method === "POST" && action === "delete-design") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const designId = body.designId;
    if (!designId) return res.status(400).json({ ok: false, error: "designId_required" });
    const { error } = await sb.from("solitaire_designs").delete().eq("id", designId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── POST action=update-variant — staff-only. Edit gold weight estimate
  // and/or approve/reject a generated variant. Approving one variant
  // auto-rejects any OTHER (unapproved) variant for the same design x
  // gold-colour x shape combo — admins can generate multiple alternate
  // "takes" of the same combo to pick a favourite, but only one can ever
  // be the live approved version a client sees. ────────────────────────
  if (req.method === "POST" && action === "update-variant") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { variantId, estGoldWeightG, status } = body;
    if (!variantId) return res.status(400).json({ ok: false, error: "variantId_required" });
    const update = { updated_at: new Date().toISOString() };
    if (estGoldWeightG != null) update.est_gold_weight_g = Number(estGoldWeightG);
    if (status && ["generated", "approved", "rejected"].includes(status)) update.status = status;
    const { data, error } = await sb.from("solitaire_design_variants").update(update).eq("id", variantId).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    if (status === "approved") {
      await sb.from("solitaire_design_variants")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("design_id", data.design_id).eq("gold_color", data.gold_color).eq("diamond_shape", data.diamond_shape)
        .neq("id", data.id).neq("status", "approved");
    }
    return res.status(200).json({ ok: true, variant: data });
  }

  // ── POST action=delete-variant — staff-only. Deletes ONE combo (a single
  // gold-colour x shape x carat variant/take), e.g. one generated before the
  // reference-image anchoring fix that no longer matches the approved
  // design. Storage objects are left orphaned (same as delete-design). ────
  if (req.method === "POST" && action === "delete-variant") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { variantId } = body;
    if (!variantId) return res.status(400).json({ ok: false, error: "variantId_required" });
    const { error } = await sb.from("solitaire_design_variants").delete().eq("id", variantId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── POST action=update-labgrown-price — staff-only ────────────────────
  if (req.method === "POST" && action === "update-labgrown-price") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { caratSize, shape, pricePerCt, updatedBy } = body;
    if (caratSize == null || pricePerCt == null) return res.status(400).json({ ok: false, error: "caratSize_pricePerCt_required" });

    const { data: existing } = await sb.from("solitaire_labgrown_prices")
      .select("id").eq("tenant_id", TENANT_ID).eq("carat_size", caratSize)
      .eq("shape", shape || null).maybeSingle();

    if (existing) {
      const { data, error } = await sb.from("solitaire_labgrown_prices")
        .update({ price_per_ct: Number(pricePerCt), updated_by: updatedBy || null, updated_at: new Date().toISOString() })
        .eq("id", existing.id).select("*").single();
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, price: data });
    }
    const { data, error } = await sb.from("solitaire_labgrown_prices").insert({
      tenant_id: TENANT_ID, carat_size: caratSize, shape: shape || null,
      price_per_ct: Number(pricePerCt), updated_by: updatedBy || null,
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, price: data });
  }

  // ── GET action=pricing-config — public. Making charge (₹/g) + natural
  // diamond sell discount (%), admin-editable via bullion_dropdowns (same
  // "insert new row, read latest by updated_at" convention as rapaport_data).
  // These were previously hardcoded (350/g, 30%) in the client — real values
  // must come from here now. ────────────────────────────────────────────
  if (req.method === "GET" && action === "pricing-config") {
    const [mc, sd, sdc, iq] = await Promise.all([
      sb.from("bullion_dropdowns").select("value, updated_at").eq("tenant_id", TENANT_ID)
        .eq("field", "solitaire_making_charge_per_gram").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("bullion_dropdowns").select("value, updated_at").eq("tenant_id", TENANT_ID)
        .eq("field", "solitaire_sell_disc_pct").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("bullion_dropdowns").select("value, updated_at").eq("tenant_id", TENANT_ID)
        .eq("field", "solitaire_side_diamond_price_per_ct").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("bullion_dropdowns").select("value, updated_at").eq("tenant_id", TENANT_ID)
        .eq("field", "solitaire_image_quality").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return res.status(200).json({
      ok: true,
      makingChargePerGram: mc.data?.value ? Number(mc.data.value) : 350,
      sellDiscPct: sd.data?.value ? Number(sd.data.value) : 30,
      sideDiamondPricePerCt: sdc.data?.value ? Number(sdc.data.value) : 0,
      // OpenAI image cost lever — "low"/"medium"/"high" (no separate "mini"
      // image model exists). Defaults to "low" while cost/quality is being
      // evaluated; switch back to "medium" here once decided.
      imageQuality: iq.data?.value || "low",
    });
  }

  // ── POST action=update-pricing-config — staff-only. Sets makingChargePerGram,
  // sellDiscPct, sideDiamondPricePerCt, and/or imageQuality. ────────────
  if (req.method === "POST" && action === "update-pricing-config") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const writes = [];
    if (body.makingChargePerGram != null) {
      writes.push(sb.from("bullion_dropdowns").insert({ tenant_id: TENANT_ID, field: "solitaire_making_charge_per_gram", value: String(Number(body.makingChargePerGram)) }));
    }
    if (body.sellDiscPct != null) {
      writes.push(sb.from("bullion_dropdowns").insert({ tenant_id: TENANT_ID, field: "solitaire_sell_disc_pct", value: String(Number(body.sellDiscPct)) }));
    }
    if (body.sideDiamondPricePerCt != null) {
      writes.push(sb.from("bullion_dropdowns").insert({ tenant_id: TENANT_ID, field: "solitaire_side_diamond_price_per_ct", value: String(Number(body.sideDiamondPricePerCt)) }));
    }
    if (body.imageQuality != null && ["low", "medium", "high"].includes(body.imageQuality)) {
      writes.push(sb.from("bullion_dropdowns").insert({ tenant_id: TENANT_ID, field: "solitaire_image_quality", value: body.imageQuality }));
    }
    if (!writes.length) return res.status(400).json({ ok: false, error: "nothing_to_update" });
    const results = await Promise.all(writes);
    const hardError = results.find((r) => r.error && r.error.code !== "23505");
    if (hardError) return res.status(500).json({ ok: false, error: hardError.error.message });
    return res.status(200).json({ ok: true });
  }

  // ── POST action=set-design-gold-weight — staff-only. Applies one gold
  // weight estimate to EVERY variant of a design (all gold-colours/shapes
  // share the same setting size — only the diamond/metal-colour differ),
  // so the admin only has to enter it once per design instead of per variant. ─
  if (req.method === "POST" && action === "set-design-gold-weight") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { designId, estGoldWeightG } = body;
    if (!designId || estGoldWeightG == null) return res.status(400).json({ ok: false, error: "designId_estGoldWeightG_required" });
    const { error } = await sb.from("solitaire_design_variants")
      .update({ est_gold_weight_g: Number(estGoldWeightG), updated_at: new Date().toISOString() })
      .eq("tenant_id", TENANT_ID).eq("design_id", designId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── POST action=save-selection — public. Saves the client's finished
  // configuration, mirrors the Calculator's "Save Estimate" flow. ──────
  if (req.method === "POST" && action === "save-selection") {
    const body = parseBody(req);
    const {
      leadId, createdBy, designId, variantId, category, shape, caratSize,
      diamondSource, diamondColor, diamondClarity, goldKarat, goldPurityPct,
      goldColor, priceBreakdown, tryonImageUrl, metadata,
    } = body;
    if (!designId || !variantId || !category || !shape || !caratSize || !diamondSource || !goldColor) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }
    const { data, error } = await sb.from("solitaire_design_selections").insert({
      tenant_id: TENANT_ID, lead_id: leadId || null, created_by: createdBy || null,
      design_id: designId, variant_id: variantId, category, shape, carat_size: caratSize,
      diamond_source: diamondSource, diamond_color: diamondColor || null, diamond_clarity: diamondClarity || null,
      gold_karat: goldKarat || null, gold_purity_pct: goldPurityPct ?? null, gold_color: goldColor,
      price_breakdown: priceBreakdown || {}, tryon_image_url: tryonImageUrl || null, metadata: metadata || {},
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, selection: data });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
