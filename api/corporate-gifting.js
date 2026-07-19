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
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { getRates } from "./_lib/rates.js";
import { enrollLeadInDrip } from "./_lib/drip.js";

export const config = { maxDuration: 30 };

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
      .select("id, category, name, description, image_url, sort_order, price_mode, gifting_sheet_name, weight_grams, manual_price")
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

    const enquiryItems = items.map((i) => ({
      name: String(i.name || "").slice(0, 150),
      qty: Math.max(1, Math.round(Number(i.qty) || 1)),
      price: i.price != null ? Number(i.price) : null,
    }));
    const total = enquiryItems.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
    const description = enquiryItems.map((i) => `${i.qty} x ${i.name}${i.price != null ? ` (₹${i.price})` : ""}`).join(", ");

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

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
