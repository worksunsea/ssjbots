// GET  /api/corporate-gifting?action=products — public, no auth. Returns active
//      corporate-gifting coin products grouped by category tab, with live price.
// POST /api/corporate-gifting?action=lead     — public, no auth. Captures a lead
//      (name, phone, email, quantity, neededBy, city), upserts bullion_leads,
//      and enrolls into the 'corporate_gifting' funnel (no-op until Saurav
//      configures its WA session + drip steps in the Funnels tab).
// POST /api/corporate-gifting?action=enquire   — public, no auth. Logs a cart
//      enquiry as a bullion_demands row (visible on the Demands sheet) so
//      staff see it even though the actual message goes out via wa.me, not
//      the bot — bot_active stays false, no AI opening message is sent.

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID, checkCrmSecret } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { enrollLeadInDrip } from "./_lib/drip.js";
import { generateBrandedDesigns } from "./_lib/imageGen.js";

export const config = { maxDuration: 60 };

const LOGO_MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], ext: "jpg", mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: "png", mime: "image/png" },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: "webp", mime: "image/webp" },
];
function sniffImage(buf) {
  return LOGO_MAGIC.find((m) => m.bytes.every((b, i) => buf[i] === b)) || null;
}

function computePrice(p, rates) {
  if (p.price_mode === "manual") return p.manual_price != null ? Number(p.manual_price) : null;
  if (p.price_mode === "gifting_sheet") {
    const match = (rates.giftingCoins || []).find((g) => g.name === p.gifting_sheet_name);
    return match?.price ?? (p.manual_price != null ? Number(p.manual_price) : null);
  }
  if (p.price_mode === "live_gold") {
    const rate = rates.spot.gold24kt;
    if (rate != null && p.weight_grams != null) return Math.round(Number(p.weight_grams) * rate);
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  if (p.price_mode === "live_silver") {
    const rate = rates.spot.silverPerGram;
    if (rate != null && p.weight_grams != null) return Math.round(Number(p.weight_grams) * rate);
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  // live_gold_markup / live_silver_markup: weight x today's rate (from our
  // rates tab, live) + making_charge (from a real rate card, GST applied
  // to the making charge only) — falls back to markup_amount for rows that
  // don't have making_charge set yet.
  if (p.price_mode === "live_gold_markup" || p.price_mode === "live_silver_markup") {
    const rate = p.price_mode === "live_gold_markup" ? rates.spot.gold24kt : rates.spot.silverPerGram;
    if (rate != null && p.weight_grams != null) {
      const bullionValue = Number(p.weight_grams) * rate;
      if (p.making_charge != null) {
        return Math.round(bullionValue + Number(p.making_charge) * (1 + Number(p.tax_percent || 0) / 100));
      }
      if (p.markup_amount != null) return Math.round(bullionValue + Number(p.markup_amount));
    }
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  // ── GET action=products — public catalogue data ──────────────────────
  if (req.method === "GET" && action === "products") {
    const { data: rows, error } = await sb.from("corporate_gifting_products")
      .select("id, category, name, description, image_url, sort_order, price_mode, gifting_sheet_name, weight_grams, manual_price, markup_amount, making_charge, tax_percent")
      .eq("tenant_id", TENANT_ID).eq("active", true)
      .order("category", { ascending: true }).order("sort_order", { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });

    const rates = await getRates();
    const products = (rows || []).map((p) => ({
      id: p.id,
      category: p.category,
      name: p.name,
      description: p.description,
      imageUrl: p.image_url,
      weightGrams: p.weight_grams,
      price: computePrice(p, rates),
    }));
    return res.status(200).json({ ok: true, products });
  }

  // ── POST action=lead — public lead capture + funnel enrollment ───────
  if (req.method === "POST" && action === "lead") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const phone = normalizePhone(body.phone);
    if (!phone || phone.length !== 10) return res.status(400).json({ ok: false, error: "invalid_phone" });
    const name = body.name ? String(body.name).trim().slice(0, 100) : null;
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const email = body.email ? String(body.email).trim().slice(0, 200) : null;
    const city = body.city ? String(body.city).trim().slice(0, 100) : null;
    const quantity = body.quantity ? String(body.quantity).trim().slice(0, 100) : null;
    const neededBy = body.neededBy ? String(body.neededBy).trim().slice(0, 20) : null;

    const { data: existing } = await sb.from("bullion_leads")
      .select("id, extra_fields").eq("tenant_id", TENANT_ID).eq("phone", phone).maybeSingle();

    const extraFields = { ...(existing?.extra_fields || {}), corp_gift_quantity: quantity, corp_gift_needed_by: neededBy };
    let leadId = existing?.id;

    if (existing) {
      await sb.from("bullion_leads").update({
        name, email: email || undefined, city: city || undefined,
        source: "corporate_gifting", funnel_id: "corporate_gifting",
        extra_fields: extraFields, updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      const { data: newLead, error: insErr } = await sb.from("bullion_leads").insert({
        tenant_id: TENANT_ID, phone, name, email, city,
        status: "new", source: "corporate_gifting", funnel_id: "corporate_gifting",
        extra_fields: extraFields,
      }).select("id").single();
      if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
      leadId = newLead.id;
    }

    const { data: funnel } = await sb.from("funnels").select("*").eq("id", "corporate_gifting").maybeSingle();
    if (funnel?.active) {
      await enrollLeadInDrip({ lead: { id: leadId, name, phone, city, funnel_id: "corporate_gifting" }, funnel });
    }

    return res.status(200).json({ ok: true, leadId });
  }

  // ── POST action=enquire — public, log cart enquiry to Demands ────────
  if (req.method === "POST" && action === "enquire") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const leadId = body.leadId;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!leadId || !items.length) return res.status(400).json({ ok: false, error: "lead_and_items_required" });

    const { data: lead } = await sb.from("bullion_leads").select("id, tenant_id").eq("id", leadId).maybeSingle();
    if (!lead) return res.status(404).json({ ok: false, error: "lead_not_found" });

    const note = body.note ? String(body.note).trim().slice(0, 500) : null;
    const enquiryItems = items.map((i) => ({
      name: String(i.name || "").slice(0, 150),
      qty: Math.max(1, Math.round(Number(i.qty) || 1)),
      price: i.price != null ? Number(i.price) : null,
    }));
    const total = enquiryItems.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
    const description = [
      enquiryItems.map((i) => `${i.qty} x ${i.name}${i.price != null ? ` (₹${i.price})` : ""}`).join(", "),
      note ? `Note: ${note}` : null,
    ].filter(Boolean).join(" — ");

    const { data: demand, error } = await sb.from("bullion_demands").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      funnel_id: "corporate_gifting",
      description,
      product_category: "gold_coin",
      enquiry_items: enquiryItems,
      budget: total || null,
      crm_source: "corporate_gifting_web",
      bot_active: false,
    }).select("id").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, demandId: demand.id });
  }

  // ── POST action=design-upload-logo — public. Accepts a base64 image,
  // stores it in the media bucket, returns its public URL. ────────────
  if (req.method === "POST" && action === "design-upload-logo") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const leadId = body.leadId;
    if (!leadId) return res.status(400).json({ ok: false, error: "lead_id_required" });
    if (!body.dataBase64) return res.status(400).json({ ok: false, error: "data_required" });

    let buf;
    try { buf = Buffer.from(String(body.dataBase64), "base64"); } catch { return res.status(400).json({ ok: false, error: "invalid_base64" }); }
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: "file_too_large" });
    const kind = sniffImage(buf);
    if (!kind) return res.status(400).json({ ok: false, error: "unsupported_image_type" });

    const path = `uploads/corporate-gifting/logos/${leadId}/${Date.now()}.${kind.ext}`;
    const { error: upErr } = await sb.storage.from("media").upload(path, buf, { contentType: kind.mime, upsert: true });
    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
    const { data: pub } = sb.storage.from("media").getPublicUrl(path);

    return res.status(200).json({ ok: true, logoUrl: pub.publicUrl });
  }

  // ── POST action=design-generate — public, rate-limited. Generates 4
  // branded packaging mockups from a logo + optional color/text. ──────
  if (req.method === "POST" && action === "design-generate") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const leadId = body.leadId;
    const logoUrl = body.logoUrl;
    if (!leadId || !logoUrl) return res.status(400).json({ ok: false, error: "lead_id_and_logo_required" });
    const color = body.color ? String(body.color).slice(0, 30) : null;
    const customText = body.customText ? String(body.customText).trim().slice(0, 100) : null;

    const { data: lead } = await sb.from("bullion_leads").select("id, tenant_id").eq("id", leadId).maybeSingle();
    if (!lead) return res.status(404).json({ ok: false, error: "lead_not_found" });

    let { data: design } = await sb.from("corporate_gifting_designs").select("*").eq("lead_id", leadId).maybeSingle();
    if (!design) {
      const { data: created, error: insErr } = await sb.from("corporate_gifting_designs")
        .insert({ tenant_id: lead.tenant_id, lead_id: leadId, logo_url: logoUrl, color, custom_text: customText })
        .select("*").single();
      if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
      design = created;
    }
    if (design.batch_count >= design.max_batches) {
      return res.status(200).json({ ok: false, error: "generation_limit_reached", message: "You've used your free design batch. Confirm your order and our team can generate more options for you." });
    }

    let generated;
    try {
      generated = await generateBrandedDesigns({ logoUrl, color, customText });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "generation_failed", detail: String(e.message || e) });
    }

    const images = [];
    for (let i = 0; i < generated.length; i++) {
      const g = generated[i];
      const path = `uploads/corporate-gifting/designs/${leadId}/${Date.now()}_${i}.png`;
      const { error: upErr } = await sb.storage.from("media").upload(path, Buffer.from(g.base64, "base64"), { contentType: "image/png", upsert: true });
      if (upErr) continue;
      const { data: pub } = sb.storage.from("media").getPublicUrl(path);
      images.push({ label: g.label, url: pub.publicUrl });
    }
    if (!images.length) return res.status(500).json({ ok: false, error: "no_images_saved" });

    await sb.from("corporate_gifting_designs").update({
      logo_url: logoUrl, color, custom_text: customText, images,
      batch_count: design.batch_count + 1, status: "generated", updated_at: new Date().toISOString(),
    }).eq("id", design.id);

    return res.status(200).json({ ok: true, designId: design.id, images });
  }

  // ── POST action=design-select — public. Locks in the chosen design. ─
  if (req.method === "POST" && action === "design-select") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { designId, selectedIndex } = body;
    if (!designId || selectedIndex == null) return res.status(400).json({ ok: false, error: "design_id_and_index_required" });
    const { error } = await sb.from("corporate_gifting_designs")
      .update({ selected_index: selectedIndex, status: "finalized", updated_at: new Date().toISOString() })
      .eq("id", designId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── POST action=design-approve-more — staff-only (x-crm-secret). Lets
  // a customer generate more design batches after their order is confirmed. ─
  if (req.method === "POST" && action === "design-approve-more") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { designId, extraBatches } = body;
    if (!designId) return res.status(400).json({ ok: false, error: "design_id_required" });
    const { data: design } = await sb.from("corporate_gifting_designs").select("max_batches").eq("id", designId).maybeSingle();
    if (!design) return res.status(404).json({ ok: false, error: "design_not_found" });
    const { error } = await sb.from("corporate_gifting_designs")
      .update({ max_batches: design.max_batches + (Number(extraBatches) || 3), updated_at: new Date().toISOString() })
      .eq("id", designId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
