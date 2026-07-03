// Logs every classified WhatsApp command from Saurav — backs the "AI
// Learning Log" on /reporting and the wrong-answer self-correction loop.
// No AI in this file; the diagnosis call lives in ownerCommand.js.

import { TENANT_ID } from "./config.js";

export async function logCommand(sb, { messageText, intent, topic, staffName, searchQuery, replyText }) {
  const { data } = await sb
    .from("owner_command_log")
    .insert({
      tenant_id: TENANT_ID,
      message_text: messageText,
      intent,
      topic: topic || null,
      staff_name: staffName || null,
      search_query: searchQuery || null,
      reply_text: (replyText || "").slice(0, 800),
    })
    .select("id")
    .single();
  return data?.id || null;
}

export async function getLastCommand(sb) {
  const { data } = await sb
    .from("owner_command_log")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .is("feedback", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function markFeedback(sb, id, feedback, correctionNote) {
  await sb
    .from("owner_command_log")
    .update({ feedback, correction_note: correctionNote || null })
    .eq("id", id);
}

// Past corrected mistakes, fed into the classifier prompt as few-shot
// examples so the same misclassification doesn't repeat.
export async function getRecentCorrections(sb, limit = 5) {
  const { data } = await sb
    .from("owner_command_log")
    .select("message_text,intent,topic,correction_note")
    .eq("tenant_id", TENANT_ID)
    .eq("feedback", "wrong")
    .not("correction_note", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}
