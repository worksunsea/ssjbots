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
//      Accepts optional promptOverride + referenceImageBase64.
// POST /api/solitaire-designs?action=update-variant        — staff-only. Edit
//      est_gold_weight_g / approve / reject a generated variant.
// POST /api/solitaire-designs?action=update-labgrown-price — staff-only. Edit
//      the lab-grown price grid.
// POST /api/solitaire-designs?action=save-selection        — public. Saves a
//      client's finished configuration (like "Save Estimate").

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID, checkCrmSecret } from "./_lib/config.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { generateSolitaireDesignViews } from "./_lib/solitaireImageGen.js";
import { getRates } from "./_lib/rates.js";

export const config = { maxDuration: 60 };

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
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

    const result = (designs || []).map((d) => ({
      id: d.id,
      category: d.category,
      designNumber: d.design_number,
      name: d.name,
      conceptPrompt: d.concept_prompt,
      hasSideDiamonds: d.has_side_diamonds,
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

  // ── POST action=create-design — staff-only. Adds a new design concept. ─
  if (req.method === "POST" && action === "create-design") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { category, designNumber, name, conceptPrompt, hasSideDiamonds } = body;
    if (!category || !designNumber || !name || !conceptPrompt) {
      return res.status(400).json({ ok: false, error: "category_designNumber_name_conceptPrompt_required" });
    }
    const { data, error } = await sb.from("solitaire_designs").insert({
      tenant_id: TENANT_ID, category, design_number: designNumber, name,
      concept_prompt: conceptPrompt, has_side_diamonds: !!hasSideDiamonds,
    }).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, design: data });
  }

  // ── POST action=generate-variant — staff-only. Calls the AI Design
  // Generator for one design x gold-colour x shape (± carat) combo. ────
  if (req.method === "POST" && action === "generate-variant") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    const body = parseBody(req);
    const { designId, goldColor, diamondShape, caratSize, generatedBy, promptOverride, referenceImageBase64 } = body;
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

  // ── POST action=update-variant — staff-only. Edit gold weight estimate
  // and/or approve/reject a generated variant. ─────────────────────────
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
    return res.status(200).json({ ok: true, variant: data });
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
