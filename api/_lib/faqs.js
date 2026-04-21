// Fetch the owner-editable Q&A table. Cached 60s so every webhook call
// doesn't hit Supabase for the FAQ list.

import { supa } from "./supabase.js";
import { TENANT_ID } from "./config.js";

let cache = { ts: 0, data: null };
const TTL_MS = 60_000;

export async function getFaqs() {
  const now = Date.now();
  if (cache.data && now - cache.ts < TTL_MS) return cache.data;
  const { data } = await supa()
    .from("bullion_faqs")
    .select("keywords,answer")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  cache = { ts: now, data: data || [] };
  return cache.data;
}

export function faqsForPrompt(faqs) {
  if (!faqs?.length) return "(no FAQs configured — ask the team for canonical answers before answering)";
  return faqs
    .map((f, i) => `${i + 1}. Matches keywords: ${f.keywords}\n   Answer: ${f.answer}`)
    .join("\n\n");
}
