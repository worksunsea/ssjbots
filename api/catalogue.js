// GET  /api/catalogue?action=view&token=<share_id>   — public, no auth. Resolves a
//      share's snapshotted product list, recomputes live prices, logs a view.
// POST /api/catalogue?action=select                  — public, no auth. Add/remove a
//      product from the client's persistent (lead/phone-keyed) selection basket.
// POST /api/catalogue?action=share                    — staff-only (x-crm-secret).
//      Resolves a product set (whole collection / filtered / hand-picked), mints a
//      share link, sends it via WhatsApp.
//
// Token = catalogue_shares.id (uuid), same "id itself is the link token" pattern as
// bullion_referrals / bullion_leads.form_token.

import { supa } from "./_lib/supabase.js";
import { sendWhatsAppWbiz } from "./_lib/wa.js";
import { checkCrmSecret, normalizePhone } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";

export const config = { maxDuration: 30 };

const TOKEN_RE = /^[0-9a-f-]{36}$/;
const SITE_URL = "https://ssjbot.gemtre.in";

// Client-side PURITIES order (App.jsx) — index maps to a live per-gram rate.
// idx 7 ("Custom ₹/g") has no live rate key — falls back to manual_price.
function purityIdxToRatePg(idx, rates) {
  const s = rates.spot;
  const map = { 0: s.gold22kt, 1: s.gold18kt, 2: s.gold14kt, 3: s.gold9kt, 4: s.gold24kt, 5: s.silverPerGram, 6: s.silverPerGram };
  return map[idx] ?? null;
}

function computeLivePrice(p, rates) {
  if (p.price_mode !== "live_gold") {
    return p.manual_price != null ? Number(p.manual_price) : null;
  }
  let base = null;
  if (p.rate_source === "mmtc_coin") {
    const isSilver = p.catalogue_materials?.code === "S";
    const list = isSilver ? rates.silverCoins : rates.goldCoins;
    const match = (list || []).find((c) => Math.abs(c.weight_g - Number(p.coin_weight_g)) < 0.001);
    if (match) base = isSilver ? (match.mmtc ?? match.sunSea ?? null) : (match.mmtc9999 ?? match.sunSea995 ?? null);
  } else {
    const ratePg = purityIdxToRatePg(p.purity_idx, rates);
    if (ratePg != null && p.net_gold_weight_grams != null) base = Number(p.net_gold_weight_grams) * ratePg;
  }
  if (base == null) return p.manual_price != null ? Number(p.manual_price) : null;
  let total = base + Number(p.making_amount || 0) + Number(p.dia_total || 0) + Number(p.misc_total || 0);
  if (p.apply_gst) total *= 1.03;
  total *= Number(p.qty || 1);
  return Math.round(total);
}

const PRODUCT_SELECT = `
  id, sku, old_sku, name, description, weight_grams, status, stock_status,
  price_mode, rate_source, purity_idx, net_gold_weight_grams, coin_weight_g,
  making_amount, dia_total, misc_total, apply_gst, qty, manual_price, price_visible,
  catalogue_materials(code, name),
  catalogue_item_types!catalogue_products_item_type_id_fkey(name, code),
  catalogue_styles(name, code),
  catalogue_product_images(url, is_cover, sort_order)
`;

function serializeProduct(p, rates) {
  const images = (p.catalogue_product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const cover = images.find((i) => i.is_cover) || images[0];
  return {
    id: p.id,
    sku: p.sku,
    name: p.name || p.sku,
    description: p.description,
    itemType: p.catalogue_item_types?.name,
    material: p.catalogue_materials?.name,
    style: p.catalogue_styles?.name,
    stockStatus: p.stock_status,
    weightGrams: p.weight_grams,
    coverImage: cover?.url || null,
    images: images.map((i) => i.url),
    price: p.price_visible ? computeLivePrice(p, rates) : null,
    priceVisible: p.price_visible,
  };
}

// Find (or create) the persistent selection basket for a lead/phone.
async function getOrCreateSelection(sb, tenantId, leadId, phone) {
  let q = sb.from("catalogue_selections").select("id").eq("tenant_id", tenantId);
  q = leadId ? q.eq("lead_id", leadId) : q.eq("phone", phone).is("lead_id", null);
  const { data: existing } = await q.maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await sb.from("catalogue_selections")
    .insert({ tenant_id: tenantId, lead_id: leadId || null, phone: leadId ? null : phone })
    .select("id").single();
  if (error) throw new Error(error.message);
  return created.id;
}

async function getSelectionProductIds(sb, selectionId) {
  const { data } = await sb.from("catalogue_selection_items").select("product_id").eq("selection_id", selectionId);
  return (data || []).map((r) => r.product_id);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-crm-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  const sb = supa();
  const action = req.query?.action;

  // ── GET action=view — public collection page data ────────────────────
  if (req.method === "GET" && action === "view") {
    const token = req.query?.token;
    if (!token || !TOKEN_RE.test(token)) return res.status(400).json({ ok: false, error: "invalid_token" });

    const { data: share, error: shareErr } = await sb.from("catalogue_shares")
      .select("id, tenant_id, share_type, item_type_id, lead_id, sent_to_phone, view_count, first_viewed_at")
      .eq("id", token).maybeSingle();
    if (shareErr || !share) return res.status(404).json({ ok: false, error: "not_found" });

    const { data: sp } = await sb.from("catalogue_share_products").select("product_id").eq("share_id", token);
    const productIds = (sp || []).map((r) => r.product_id);

    let products = [];
    if (productIds.length) {
      const { data: rows } = await sb.from("catalogue_products")
        .select(PRODUCT_SELECT)
        .in("id", productIds)
        .eq("status", "published");
      const rates = await getRates();
      products = (rows || []).map((p) => serializeProduct(p, rates));
    }

    const now = new Date().toISOString();
    await sb.from("catalogue_shares").update({
      view_count: (share.view_count || 0) + 1,
      first_viewed_at: share.first_viewed_at || now,
      last_viewed_at: now,
    }).eq("id", token);

    let selectionProductIds = [];
    if (share.lead_id || share.sent_to_phone) {
      const selectionId = await getOrCreateSelection(sb, share.tenant_id, share.lead_id, share.sent_to_phone);
      selectionProductIds = await getSelectionProductIds(sb, selectionId);
    }

    return res.status(200).json({ ok: true, shareType: share.share_type, products, selectionProductIds });
  }

  // ── POST action=select — public, add/remove from persistent basket ───
  if (req.method === "POST" && action === "select") {
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { token, productId, mode } = body;
    if (!token || !TOKEN_RE.test(token)) return res.status(400).json({ ok: false, error: "invalid_token" });
    if (!productId || !TOKEN_RE.test(productId)) return res.status(400).json({ ok: false, error: "invalid_product" });

    const { data: share } = await sb.from("catalogue_shares")
      .select("id, tenant_id, lead_id, sent_to_phone").eq("id", token).maybeSingle();
    if (!share) return res.status(404).json({ ok: false, error: "not_found" });
    if (!share.lead_id && !share.sent_to_phone) return res.status(400).json({ ok: false, error: "share_has_no_client" });

    const selectionId = await getOrCreateSelection(sb, share.tenant_id, share.lead_id, share.sent_to_phone);

    if (mode === "remove") {
      await sb.from("catalogue_selection_items").delete().eq("selection_id", selectionId).eq("product_id", productId);
    } else {
      await sb.from("catalogue_selection_items")
        .upsert({ selection_id: selectionId, product_id: productId, share_id: token }, { onConflict: "selection_id,product_id" });
    }
    await sb.from("catalogue_selections").update({ updated_at: new Date().toISOString() }).eq("id", selectionId);

    const selectionProductIds = await getSelectionProductIds(sb, selectionId);
    return res.status(200).json({ ok: true, selectionProductIds });
  }

  // ── POST action=share — staff-only ────────────────────────────────────
  if (req.method === "POST" && action === "share") {
    const authFail = checkCrmSecret(req, res);
    if (authFail) return authFail;

    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { shareType, itemTypeId, filters, productIds, leadId, phone, tenantId } = body;
    if (!["collection", "filtered", "custom"].includes(shareType)) {
      return res.status(400).json({ ok: false, error: "invalid_share_type" });
    }
    const sentPhone = normalizePhone(phone);
    if (!leadId && !sentPhone) return res.status(400).json({ ok: false, error: "lead_or_phone_required" });

    let resolvedIds = [];
    if (shareType === "custom") {
      resolvedIds = Array.isArray(productIds) ? productIds.filter((id) => TOKEN_RE.test(id)) : [];
    } else {
      if (!itemTypeId) return res.status(400).json({ ok: false, error: "item_type_required" });
      const { data: members } = await sb.from("catalogue_product_collections")
        .select("product_id").eq("item_type_id", itemTypeId);
      const candidateIds = (members || []).map((r) => r.product_id);
      if (!candidateIds.length) resolvedIds = [];
      else {
        const { data: candidates } = await sb.from("catalogue_products")
          .select(PRODUCT_SELECT).in("id", candidateIds).eq("status", "published");
        let filtered = candidates || [];
        if (shareType === "filtered" && filters) {
          const rates = await getRates();
          if (filters.createdAfter) {
            const { data: withDates } = await sb.from("catalogue_products")
              .select("id, created_at").in("id", filtered.map((p) => p.id)).gte("created_at", filters.createdAfter);
            const okIds = new Set((withDates || []).map((r) => r.id));
            filtered = filtered.filter((p) => okIds.has(p.id));
          }
          if (filters.priceMin != null || filters.priceMax != null) {
            filtered = filtered.filter((p) => {
              const price = computeLivePrice(p, rates);
              if (price == null) return false;
              if (filters.priceMin != null && price < filters.priceMin) return false;
              if (filters.priceMax != null && price > filters.priceMax) return false;
              return true;
            });
          }
        }
        resolvedIds = filtered.map((p) => p.id);
      }
    }

    if (!resolvedIds.length) return res.status(400).json({ ok: false, error: "no_matching_products" });

    const { data: shareRow, error: shareInsErr } = await sb.from("catalogue_shares")
      .insert({
        tenant_id: tenantId, share_type: shareType, item_type_id: itemTypeId || null,
        filters: filters || null, lead_id: leadId || null, sent_to_phone: sentPhone,
        created_by: body.createdBy || null,
      }).select("id").single();
    if (shareInsErr || !shareRow) return res.status(500).json({ ok: false, error: "share_create_failed" });

    await sb.from("catalogue_share_products").insert(resolvedIds.map((productId) => ({ share_id: shareRow.id, product_id: productId })));

    const link = `${SITE_URL}/c/${shareRow.id}`;
    const msg = [
      `💎 *Sun Sea Jewellers* has shared a collection with you!`,
      ``,
      `👉 ${link}`,
      ``,
      `${resolvedIds.length} design${resolvedIds.length > 1 ? "s" : ""} — tap through to browse, save your favourites, and see today's pricing.`,
    ].join("\n");
    const wa = sentPhone ? await sendWhatsAppWbiz({ phone: sentPhone, msg, whatsappClient: null }) : { status: 0 };
    await sb.from("catalogue_shares").update({
      sent_at: wa.status === 1 ? new Date().toISOString() : null,
      wa_status: wa.status === 1 ? "wa_sent" : "pending",
    }).eq("id", shareRow.id);

    return res.status(200).json({ ok: true, shareId: shareRow.id, link, productCount: resolvedIds.length, waSent: wa.status === 1 });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
