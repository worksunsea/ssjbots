// Top-level router for Saurav's WhatsApp messages (owner-only, gated in
// webhook.js). One Claude call classifies intent; everything downstream is
// deterministic — data queries and resource search never touch AI, only the
// initial "what is this message asking for" step does.

import { askAI, parseBotJson } from "./ai.js";
import { TENANT_ID, OPENAI_MODEL } from "./config.js";
import { getActiveStaff, executeCreateTask } from "./taskCommand.js";
import { buildReportText } from "./reportQueries.js";
import { logCommand, getLastCommand, markFeedback, getRecentCorrections } from "./ownerLog.js";
import { queueDevTask } from "./devAgent.js";

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
    `3. Asking to look something up / retrieve company information or a document (bank details, passwords, licenses, templates — NOT a customer): {"intent":"search_resources","query":"<the key search terms only — person/company name, bank name, document type — space separated, drop filler words like 'I need', 'please', 'card', 'details'. e.g. 'Sanjeev Garg Aadhaar' not 'I need the aadhar card of Sanjeev Garg'>"}`,
    "",
    `4. Commenting on the PREVIOUS reply the bot just sent (e.g. "wrong answer", "galat jawab tha", "that's not right", "no that's wrong", or conversely "yes correct", "sahi hai", "thanks that's right"): {"intent":"feedback","rating":"wrong"|"correct"}`,
    "",
    `5. Asking for an actual CODE/APP CHANGE — a bug fix, a new feature, a UI tweak, "add a button that...", "fix the bug where...", "change the code so that...". This is different from #2 (which only reads data) — #5 is when he wants the SOFTWARE itself modified: {"intent":"dev_task","task":"<the coding request, cleaned up but keep his intent/details>","repo_hint":"<one of: ssj-hr|ssjbots|fms-tracker|unsure>"}`,
    "   ssj-hr = the HR app (tasks/leaves/help slips/petty cash/staff). ssjbots = the WhatsApp bot/CRM (this bot, leads, demands, walk-ins). fms-tracker = the field/job tracker (jobs, FMS). Guess from context; use \"unsure\" if genuinely unclear.",
    "",
    `6. Anything else (chit-chat, unclear, not matching the above): {"intent":"none"}`,
    "",
    "The message may be in English, Hindi, or Hinglish (Devanagari or Latin script, or mixed) for any of the above.",
    ...correctionsBlock,
  ].join("\n");
  try {
    const { text } = await askAI({
      system,
      messages: [{ role: "user", content: messageText }],
      maxTokens: 250,
      model: OPENAI_MODEL,
    });
    return parseBotJson(text) || { intent: "none" };
  } catch {
    return { intent: "none" };
  }
}

// Searches resources (plain text, e.g. bank details, passwords, templates)
// and business_docs (uploaded document images with optional OCR'd text) by
// keyword. No AI — plain ILIKE search.
//
// Was a single ILIKE match on the WHOLE query phrase, requiring it to
// appear as one literal contiguous substring — e.g. "adhar card Saurav
// Garg" never matched a title like "SANJEEV GARG AADHAR CARD" (different
// word order, and the person's name is often reversed relative to how
// someone would type it). Now splits into significant words and requires
// each one to appear SOMEWHERE across the searched columns (any order, any
// column) — chaining multiple .or() calls in supabase-js ANDs them
// together, which is what makes per-word matching possible without a
// separate full-text-search column. Falls back to ANY single word matching
// (still capped low) if the strict pass finds nothing, so a misremembered
// detail still surfaces a plausible candidate instead of "nothing found".
//
// keywords (business_docs/resources column) lets an admin add extra
// findable terms — bank name, alternate spellings, a name in a different
// order — without renaming the actual document title.
const SEARCH_STOPWORDS = new Set([
  "of", "the", "for", "a", "an", "and", "to", "is", "in", "on", "my", "i", "me", "need",
  "give", "please", "pls", "send", "share", "find", "get", "chk", "check", "details", "detail",
  "card", "document", "doc", "copy", "ka", "ki", "ke", "hai", "chahiye", "chaiye", "bhejo", "bhej", "do", "dena",
]);

function significantWords(query) {
  return String(query || "")
    .replace(/[,()]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w.toLowerCase()));
}

function requireAllWords(baseQuery, columns, words) {
  let q = baseQuery;
  for (const w of words) {
    const p = `%${w}%`;
    q = q.or(columns.map((c) => `${c}.ilike.${p}`).join(","));
  }
  return q;
}

function anyWordFilter(columns, words) {
  const conds = [];
  for (const w of words) {
    const p = `%${w}%`;
    for (const c of columns) conds.push(`${c}.ilike.${p}`);
  }
  return conds.join(",");
}

// Returns { text } for a text reply, or { text, mediaUrl, caption } if a
// matching document image should be sent.
async function searchResources(sb, query) {
  const words = significantWords(query);
  if (!words.length) return { text: `Couldn't find anything matching "${query}" in Resources or Business Docs.` };

  const resCols = ["title", "content", "section"];
  const docCols = ["title", "doc_type", "notes", "text_content", "keywords"];

  let { data: resourceMatches } = await requireAllWords(
    sb.from("resources").select("title,content,section").eq("tenant_id", TENANT_ID), resCols, words
  ).limit(3);
  if (!resourceMatches?.length && words.length > 1) {
    const fallback = await sb.from("resources").select("title,content,section").eq("tenant_id", TENANT_ID)
      .or(anyWordFilter(resCols, words)).limit(3);
    resourceMatches = fallback.data;
  }

  if (resourceMatches?.length) {
    const text = resourceMatches
      .map((r) => `📄 *${r.title}* (${r.section})\n${r.content}`)
      .join("\n\n");
    return { text };
  }

  let { data: docMatches } = await requireAllWords(
    sb.from("business_docs").select("title,doc_type,notes,text_content,keywords,front_image_url").eq("tenant_id", TENANT_ID), docCols, words
  ).limit(3);
  if (!docMatches?.length && words.length > 1) {
    const fallback = await sb.from("business_docs").select("title,doc_type,notes,text_content,keywords,front_image_url").eq("tenant_id", TENANT_ID)
      .or(anyWordFilter(docCols, words)).limit(3);
    docMatches = fallback.data;
  }

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
    const { text } = await askAI({ system, messages: [{ role: "user", content: "Diagnose it." }], maxTokens: 150, model: OPENAI_MODEL });
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
  } else if (parsed.intent === "dev_task") {
    try {
      await queueDevTask(sb, { taskText: parsed.task || messageText, repoHint: parsed.repo_hint });
      result = { replyText: "🖥️ Sent to your dev agent — check your PC. It'll wait for your approval on each step, same as a normal Claude Code chat. (Only works if your PC and the dev-agent listener are on.)" };
    } catch (err) {
      result = { replyText: `Couldn't queue that — ${String(err.message || err)}` };
    }
  } else {
    result = { replyText: "Didn't catch that. You can: assign a task, ask for a report (e.g. \"give me reporting\"), or ask me to look something up (e.g. \"bank details for ICICI\")." };
  }

  await logCommand(sb, {
    messageText,
    intent: parsed.intent,
    topic: parsed.topic || parsed.repo_hint,
    staffName: parsed.staff_name || parsed.assignee,
    searchQuery: parsed.query || parsed.task,
    replyText: result.replyText || result.caption,
  }).catch((err) => console.error("ownerCommand: logCommand failed", err));

  return result;
}
