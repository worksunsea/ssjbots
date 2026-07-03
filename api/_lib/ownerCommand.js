// Top-level router for Saurav's WhatsApp messages (owner-only, gated in
// webhook.js). One Claude call classifies intent; everything downstream is
// deterministic — data queries and resource search never touch AI, only the
// initial "what is this message asking for" step does.

import { askClaude, parseBotJson } from "./claude.js";
import { TENANT_ID, CLAUDE_MODEL } from "./config.js";
import { getActiveStaff, executeCreateTask } from "./taskCommand.js";
import { buildReportText } from "./reportQueries.js";
import { logCommand, getLastCommand, markFeedback, getRecentCorrections } from "./ownerLog.js";

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

const REPORT_TOPICS = [
  "delegations", "my_tasks", "staff_tasks", "help_slips", "leaves", "leave_balance", "petty_cash",
  "walkins", "demands", "staff_demands", "attendance_today", "low_stock", "fms_jobs",
  "lead_lookup", "staff_contact", "expiring_docs", "recent_completions", "full",
];

async function classifyOwnerMessage(messageText, staffNames, corrections) {
  const correctionsBlock = corrections?.length
    ? [
        "",
        "Past mistakes to avoid — these exact-ish messages were previously misclassified and the owner flagged the reply as wrong. Don't repeat the same error on similar messages:",
        ...corrections.map((c) => `- "${c.message_text}" was classified as intent=${c.intent}${c.topic ? ` topic=${c.topic}` : ""}, which was WRONG. Why: ${c.correction_note}`),
      ]
    : [];
  const system = [
    `Today's date is ${todayIST()} (IST). The user is the business owner texting his own WhatsApp bot.`,
    "Classify the message into exactly one of these JSON shapes (JSON only, no prose):",
    "",
    `1. Assigning a task to a staff member: {"intent":"create_task","assignee":"<exact roster name or null>","title":"<short task description>","due_date":"YYYY-MM-DD or omit"}`,
    `   Staff roster (ONLY valid "assignee"/"staff_name" values below): ${staffNames.join(", ")}`,
    "   Match misspelled/phonetic names to the closest roster name (e.g. \"Vineet\" -> \"Vinit\"). Set assignee to null if no plausible match.",
    "   Hindi/Hinglish task commands are common and verb-final, e.g. \"Ramesh ko bolo ki invoice fix kare Friday tak\" -> assignee Ramesh, title \"fix invoice\", due_date resolved. Strip postpositions (ko/se/ne) from the name.",
    "",
    `2. Asking for a status report / numbers / status on something: {"intent":"get_report","topic":"<one of: ${REPORT_TOPICS.join("|")}>","staff_name":"<exact roster name, ONLY for staff_tasks/staff_demands>","query":"<free text, ONLY for lead_lookup>"}`,
    "   - \"delegations\" = tasks he assigned to others (overdue). \"my_tasks\" = his own tasks.",
    "   - \"staff_tasks\" = a NAMED staff member's pending tasks, e.g. \"Naveen's pending tasks\", \"what does Priya have to do\" -> extract staff_name from the roster.",
    "   - \"help_slips\" = help slips assigned to him. \"leaves\" = pending/upcoming leave approvals. \"petty_cash\" = pending petty cash approvals.",
    "   - \"walkins\" = store walk-ins/conversions. \"demands\" = all open CRM demands/pipeline.",
    "   - \"staff_demands\" = a NAMED staff member's open CRM demands, e.g. \"what demands does Mahesh have open\" -> extract staff_name.",
    "   - \"attendance_today\" = who is absent/not present today, e.g. \"who's absent today\", \"who hasn't come in\".",
    "   - \"low_stock\" = inventory items below minimum stock level, e.g. \"what needs reordering\", \"low stock items\".",
    "   - \"fms_jobs\" = field/job tracker status, e.g. \"how many jobs today\", \"any pending job edit approvals\".",
    "   - \"lead_lookup\" = looking up a specific CUSTOMER by name or phone (not a staff member), e.g. \"who is Rohit Sharma\", \"find customer 98111...\" -> put the name/phone in \"query\".",
    "   - \"staff_contact\" = a NAMED staff member's phone number/role, e.g. \"what's Priya's number\" -> extract staff_name.",
    "   - \"expiring_docs\" = business documents (license, GST, etc.) expiring soon, e.g. \"any documents expiring\", \"license renewals due\".",
    "   - \"recent_completions\" = tasks completed today by anyone, e.g. \"what got done today\", \"who finished their tasks\".",
    "   - \"leave_balance\" = a NAMED staff member's leave days taken this quarter, e.g. \"how many leaves has Akshat taken\" -> extract staff_name.",
    "   - \"full\" = general \"give me the report\"/\"how are things\" with no specific topic.",
    "",
    `3. Asking to look something up / retrieve company information or a document (bank details, passwords, licenses, templates — NOT a customer): {"intent":"search_resources","query":"<short search keywords, e.g. 'ICICI bank details'>"}`,
    "",
    `4. Commenting on the PREVIOUS reply the bot just sent (e.g. "wrong answer", "galat jawab tha", "that's not right", "no that's wrong", or conversely "yes correct", "sahi hai", "thanks that's right"): {"intent":"feedback","rating":"wrong"|"correct"}`,
    "",
    `5. Anything else (chit-chat, unclear, not matching the above): {"intent":"none"}`,
    "",
    "The message may be in English, Hindi, or Hinglish (Devanagari or Latin script, or mixed) for any of the above.",
    ...correctionsBlock,
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
      // The upload form accepts images AND PDFs into this same column
      // (accept="image/*,.pdf") — sending a PDF as mediaType "image" fails
      // to render in WhatsApp, so detect it from the URL/extension.
      const isPdf = /\.pdf(\?|$)/i.test(doc.front_image_url);
      return {
        text: null,
        mediaUrl: doc.front_image_url,
        mediaType: isPdf ? "document" : "image",
        filename: isPdf ? `${doc.title}.pdf` : undefined,
        caption: `📋 ${doc.title}${doc.notes ? "\n" + doc.notes : ""}`,
      };
    }
    return { text: `📋 *${doc.title}*\n${doc.text_content || doc.notes || "(no details on file)"}` };
  }

  return { text: `Couldn't find anything matching "${query}" in Resources or Business Docs.` };
}

// One-off Claude call, only fires when Saurav flags a reply as wrong —
// explains what likely went wrong so the same mistake shows up as a
// few-shot correction in future classifyOwnerMessage calls.
async function diagnoseWrongAnswer(lastCommand) {
  const system = [
    "You are reviewing a misclassified WhatsApp command from a business-owner bot.",
    `Original message: "${lastCommand.message_text}"`,
    `The system classified it as intent=${lastCommand.intent}${lastCommand.topic ? ` topic=${lastCommand.topic}` : ""} and replied: "${(lastCommand.reply_text || "").slice(0, 300)}"`,
    "The owner says this was WRONG.",
    "In 1-2 short sentences: explain why the classification likely went wrong, and what intent/topic it should have been instead. No preamble, plain text only.",
  ].join("\n");
  try {
    const { text } = await askClaude({ system, messages: [{ role: "user", content: "Diagnose it." }], maxTokens: 150, model: CLAUDE_MODEL });
    return text.trim() || "Couldn't pin down why — logged for review.";
  } catch {
    return "Couldn't self-diagnose — logged for review.";
  }
}

// Full pipeline for any WhatsApp message from Saurav's number. Returns
// { replyText } and/or { mediaUrl, caption } for webhook.js to send.
export async function handleOwnerMessage(sb, messageText) {
  const [staff, corrections] = await Promise.all([getActiveStaff(sb), getRecentCorrections(sb)]);
  const parsed = await classifyOwnerMessage(messageText, staff.map((s) => s.name), corrections);

  // Feedback on the previous reply — doesn't get logged as its own command,
  // it annotates the one it's rating.
  if (parsed.intent === "feedback") {
    const last = await getLastCommand(sb);
    if (!last) return { replyText: "Nothing recent to rate." };
    if (parsed.rating === "wrong") {
      const diagnosis = await diagnoseWrongAnswer(last);
      await markFeedback(sb, last.id, "wrong", diagnosis);
      return { replyText: `Noted — marked wrong. ${diagnosis}` };
    }
    await markFeedback(sb, last.id, "correct", null);
    return { replyText: "👍 Noted." };
  }

  let result;
  if (parsed.intent === "create_task") {
    result = { replyText: await executeCreateTask(sb, staff, parsed) };
  } else if (parsed.intent === "get_report") {
    const topic = REPORT_TOPICS.includes(parsed.topic) ? parsed.topic : "full";
    const resolvedStaffName = parsed.staff_name
      ? staff.find((s) => nameEq(s.name, parsed.staff_name))?.name || null
      : null;
    result = { replyText: await buildReportText(sb, topic, { staffName: resolvedStaffName, query: parsed.query }) };
  } else if (parsed.intent === "search_resources") {
    const r = await searchResources(sb, parsed.query || messageText);
    result = { replyText: r.text, mediaUrl: r.mediaUrl, mediaType: r.mediaType, filename: r.filename, caption: r.caption };
  } else {
    result = { replyText: "Didn't catch that. You can: assign a task, ask for a report (e.g. \"give me reporting\"), or ask me to look something up (e.g. \"bank details for ICICI\")." };
  }

  await logCommand(sb, {
    messageText,
    intent: parsed.intent,
    topic: parsed.topic,
    staffName: parsed.staff_name || parsed.assignee,
    searchQuery: parsed.query,
    replyText: result.replyText || result.caption,
  }).catch((err) => console.error("ownerCommand: logCommand failed", err));

  return result;
}
