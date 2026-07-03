// Top-level router for Saurav's WhatsApp messages (owner-only, gated in
// webhook.js). One Claude call classifies intent; everything downstream is
// deterministic — data queries and resource search never touch AI, only the
// initial "what is this message asking for" step does.

import { askClaude, parseBotJson } from "./claude.js";
import { TENANT_ID, CLAUDE_MODEL } from "./config.js";
import { getActiveStaff, executeCreateTask } from "./taskCommand.js";
import { buildReportText } from "./reportQueries.js";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

const REPORT_TOPICS = ["delegations", "my_tasks", "help_slips", "leaves", "petty_cash", "walkins", "demands", "full"];

async function classifyOwnerMessage(messageText, staffNames) {
  const system = [
    `Today's date is ${todayIST()} (IST). The user is the business owner texting his own WhatsApp bot.`,
    "Classify the message into exactly one of these JSON shapes (JSON only, no prose):",
    "",
    `1. Assigning a task to a staff member: {"intent":"create_task","assignee":"<exact roster name or null>","title":"<short task description>","due_date":"YYYY-MM-DD or omit"}`,
    `   Staff roster (ONLY valid "assignee" values): ${staffNames.join(", ")}`,
    "   Match misspelled/phonetic names to the closest roster name (e.g. \"Vineet\" -> \"Vinit\"). Set assignee to null if no plausible match.",
    "   Hindi/Hinglish task commands are common and verb-final, e.g. \"Ramesh ko bolo ki invoice fix kare Friday tak\" -> assignee Ramesh, title \"fix invoice\", due_date resolved. Strip postpositions (ko/se/ne) from the name.",
    "",
    `2. Asking for a status report / how things are going / numbers on something: {"intent":"get_report","topic":"<one of: ${REPORT_TOPICS.join("|")}>"}`,
    "   \"delegations\" = tasks he assigned to others. \"my_tasks\" = his own tasks. \"help_slips\" = help slips assigned to him. \"leaves\" = pending leave approvals. \"petty_cash\" = pending petty cash approvals. \"walkins\" = store walk-ins/conversions. \"demands\" = open CRM demands/pipeline. \"full\" = general \"give me the report\"/\"how are things\" with no specific topic.",
    "",
    `3. Asking to look something up / retrieve information (bank details, passwords, licenses, templates, any stored company info or document): {"intent":"search_resources","query":"<short search keywords, e.g. 'ICICI bank details'>"}`,
    "",
    `4. Anything else (chit-chat, unclear, not matching the above): {"intent":"none"}`,
    "",
    "The message may be in English, Hindi, or Hinglish (Devanagari or Latin script, or mixed) for any of the above.",
  ].join("\n");
  try {
    const { text } = await askClaude({
      system,
      messages: [{ role: "user", content: messageText }],
      maxTokens: 250,
      model: CLAUDE_MODEL,
    });
    return parseBotJson(text) || { intent: "none" };
  } catch {
    return { intent: "none" };
  }
}

// Searches resources (plain text, e.g. bank details, passwords, templates)
// and business_docs (uploaded document images with optional OCR'd text) by
// keyword. No AI — plain ILIKE search. Returns { text } for a text reply, or
// { text, mediaUrl, caption } if a matching document image should be sent.
async function searchResources(sb, query) {
  // Strip characters that would break PostgREST's comma-separated .or() filter syntax.
  const cleaned = String(query || "").replace(/[,()]/g, " ").trim();
  const q = `%${cleaned}%`;

  const { data: resourceMatches } = await sb
    .from("resources")
    .select("title,content,section")
    .eq("tenant_id", TENANT_ID)
    .or(`title.ilike.${q},content.ilike.${q},section.ilike.${q}`)
    .limit(3);

  if (resourceMatches?.length) {
    const text = resourceMatches
      .map((r) => `📄 *${r.title}* (${r.section})\n${r.content}`)
      .join("\n\n");
    return { text };
  }

  const { data: docMatches } = await sb
    .from("business_docs")
    .select("title,doc_type,notes,text_content,front_image_url")
    .eq("tenant_id", TENANT_ID)
    .or(`title.ilike.${q},doc_type.ilike.${q},notes.ilike.${q},text_content.ilike.${q}`)
    .limit(1);

  if (docMatches?.length) {
    const doc = docMatches[0];
    if (doc.front_image_url) {
      return {
        text: null,
        mediaUrl: doc.front_image_url,
        caption: `📋 ${doc.title}${doc.notes ? "\n" + doc.notes : ""}`,
      };
    }
    return { text: `📋 *${doc.title}*\n${doc.text_content || doc.notes || "(no details on file)"}` };
  }

  return { text: `Couldn't find anything matching "${query}" in Resources or Business Docs.` };
}

// Full pipeline for any WhatsApp message from Saurav's number. Returns
// { replyText } and/or { mediaUrl, caption } for webhook.js to send.
export async function handleOwnerMessage(sb, messageText) {
  const staff = await getActiveStaff(sb);
  const parsed = await classifyOwnerMessage(messageText, staff.map((s) => s.name));

  if (parsed.intent === "create_task") {
    const replyText = await executeCreateTask(sb, staff, parsed);
    return { replyText };
  }

  if (parsed.intent === "get_report") {
    const topic = REPORT_TOPICS.includes(parsed.topic) ? parsed.topic : "full";
    const replyText = await buildReportText(sb, topic);
    return { replyText };
  }

  if (parsed.intent === "search_resources") {
    const result = await searchResources(sb, parsed.query || messageText);
    return { replyText: result.text, mediaUrl: result.mediaUrl, caption: result.caption };
  }

  return { replyText: "Didn't catch that. You can: assign a task, ask for a report (e.g. \"give me reporting\"), or ask me to look something up (e.g. \"bank details for ICICI\")." };
}
