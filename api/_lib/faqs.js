// Fetch the owner-editable Q&A table. Cached 60s so every webhook call
// doesn't hit Supabase for the FAQ list.

import { supa } from "./supabase.js";

// Tenant-scoped cache: { [tenantId]: { ts, data } }
const cache = {};
const TTL_MS = 60_000;

export async function getFaqs(tenantId) {
  if (!tenantId) return [];
  const now = Date.now();
  const slot = cache[tenantId];
  if (slot?.data && now - slot.ts < TTL_MS) return slot.data;
  const { data } = await supa()
    .from("bullion_faqs")
    .select("keywords,answer")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  cache[tenantId] = { ts: now, data: data || [] };
  return cache[tenantId].data;
}

export function faqsForPrompt(faqs) {
  if (!faqs?.length) return "(no FAQs configured — ask the team for canonical answers before answering)";
  return faqs
    .map((f, i) => `${i + 1}. Matches keywords: ${f.keywords}\n   Answer: ${f.answer}`)
    .join("\n\n");
}
