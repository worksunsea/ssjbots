// POST /api/job-enquiry — public form submission from /careers.
// Upserts a lead by phone (source="job_enquiry"), stores resume/photo/
// instagram in extra_fields, and pings admin so HR can follow up.

import { supa } from "./_lib/supabase.js";
import { normalizePhone, TENANT_ID } from "./_lib/config.js";
import { sendPushNotification } from "./_lib/pushNotify.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const phone = normalizePhone(body.phone);
  const name = String(body.name || "").trim().slice(0, 100);
  if (!phone) return res.status(400).json({ ok: false, error: "invalid_phone" });
  if (!name) return res.status(400).json({ ok: false, error: "name_required" });
  if (!body.resume_url) return res.status(400).json({ ok: false, error: "resume_required" });

  const sb = supa();

  const { data: existing } = await sb.from("bullion_leads")
    .select("id, extra_fields").eq("phone", phone).eq("tenant_id", TENANT_ID).maybeSingle();

  const jobFields = {
    job_position_interested: body.position ? String(body.position).slice(0, 200) : "",
    job_instagram: body.instagram ? String(body.instagram).slice(0, 300) : "",
    job_resume_url: body.resume_url,
    job_photo_url: body.photo_url || "",
    job_applied_at: new Date().toISOString(),
  };

  let leadId;
  if (existing) {
    leadId = existing.id;
    await sb.from("bullion_leads").update({
      name,
      extra_fields: { ...(existing.extra_fields || {}), ...jobFields },
    }).eq("id", leadId);
  } else {
    const { data: inserted, error } = await sb.from("bullion_leads").insert({
      tenant_id: TENANT_ID,
      phone,
      name,
      source: "job_enquiry",
      status: "new",
      stage: "greeting",
      extra_fields: jobFields,
    }).select("id").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    leadId = inserted.id;
  }

  await sendPushNotification({
    userId: "admin",
    title: "🧑‍💼 New Job Application",
    body: `${name} applied${body.position ? ` for ${body.position}` : ""} — resume attached.`,
    url: "/",
  }).catch(() => {});

  return res.status(200).json({ ok: true, leadId });
}
