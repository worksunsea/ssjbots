// Top-level router for Saurav's WhatsApp messages (owner-only, gated in
// webhook.js). One Claude call classifies intent; everything downstream is
// deterministic — data queries and resource search never touch AI, only the
// initial "what is this message asking for" step does.

import { askAI, parseBotJson } from "./ai.js";
import { TENANT_ID, OPENAI_MODEL, normalizePhone } from "./config.js";
import { getActiveStaff, executeCreateTask } from "./taskCommand.js";
import { buildReportText, findLeadsForForm } from "./reportQueries.js";
import { logCommand, getLastCommand, markFeedback, getRecentCorrections } from "./ownerLog.js";
import { queueDevTask } from "./devAgent.js";

const FORM_BASE_URL = "https://ssjbot.gemtre.in";

// Resolves (or creates) a form_token for a lead and returns the edit link.
// form_token defaults to gen_random_uuid() on the column, so existing rows
// already have one — this only backfills the rare row that somehow doesn't.
async function ensureFormLink(sb, lead) {
  let token = lead.form_token;
  if (!token) {
    const { data } = await sb.from("bullion_leads").update({ form_token: crypto.randomUUID() }).eq("id", lead.id).select("form_token").single();
    token = data?.form_token;
  }
  return `${FORM_BASE_URL}/update?t=${token}`;
}

// "edit contact Pooja" / "update Rohit Sharma's details" — finds the
// matching lead(s) and sends back the same personalised form link used
// elsewhere (drip campaigns, referrals) so Saurav can fill in bday,
// anniversary, address etc. himself, no new form needed.
async function editContact(sb, query) {
  if (!query) return { text: "Which contact? Give me a name or phone number." };
  const rows = await findLeadsForForm(sb, query);
  if (!rows.length) return { text: `Couldn't find a contact matching "${query}".` };
  if (rows.length > 1) {
    const list = rows.map((r) => `- ${r.name || "Unknown"} · ${r.phone || "no phone"}`).join("\n");
    return { text: `Found ${rows.length} matches for "${query}" — reply with the phone number to pick one:\n${list}` };
  }
  const lead = rows[0];
  const link = await ensureFormLink(sb, lead);
  return { text: `✏️ Edit link for *${lead.name || lead.phone}*:\n${link}` };
}

// "add new contact Pooja 9811123456" — pre-creates a minimal lead (phone is
// mandatory, it's the table's dedup key) then sends the same edit-form link
// so Saurav can fill in the rest (address, bday, anniversary...) himself.
async function addContact(sb, name, phone) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return { text: "What's their phone number? e.g. \"add contact Pooja 9811123456\"." };
  }
  const { data: existing } = await sb.from("bullion_leads").select("id,name,phone,form_token").eq("tenant_id", TENANT_ID).eq("phone", cleanPhone).maybeSingle();
  let lead = existing;
  if (!lead) {
    const ins = { tenant_id: TENANT_ID, phone: cleanPhone, status: "new", source: "owner_wa_command" };
    if (name) ins.name = String(name).slice(0, 100);
    const { data: newLead, error } = await sb.from("bullion_leads").insert(ins).select("id,name,phone,form_token").single();
    if (error) return { text: `Couldn't create that contact — ${error.message}` };
    lead = newLead;
  }
  const link = await ensureFormLink(sb, lead);
  const verb = existing ? "already exists — here's their edit link" : "added";
  return { text: `✅ Contact ${lead.name || lead.phone} ${verb}:\n${link}` };
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

const REPORT_TOPICS = [
  "delegations", "my_tasks", "staff_tasks", "help_slips", "leaves", "leave_balance", "petty_cash",
  "walkins", "demands", "staff_demands", "attendance_today", "low_stock", "fms_jobs",
  "lead_lookup", "staff_contact", "expiring_docs", "recent_completions", "full",
];

async function classifyOwnerMessage(messageText, staffNames, corrections, lastCommand) {
  const correctionsBlock = corrections?.length
    ? [
        "",
        "Past mistakes to avoid — these exact-ish messages were previously misclassified and the owner flagged the reply as wrong. Don't repeat the same error on similar messages:",
        ...corrections.map((c) => `- "${c.message_text}" was classified as intent=${c.intent}${c.topic ? ` topic=${c.topic}` : ""}, which was WRONG. Why: ${c.correction_note}`),
      ]
    : [];
  const lastCommandBlock = lastCommand?.intent === "get_report" && lastCommand?.topic
    ? [
        "",
        `Context: his PREVIOUS message was "${lastCommand.message_text}", classified as intent=get_report topic=${lastCommand.topic}. If THIS message is a short vague follow-up with no topic of its own (e.g. "total how many", "and yesterday?", "what about overall", "aur kitne"), assume he means the SAME topic (${lastCommand.topic}) — do NOT fall back to "full" just because this message alone doesn't name a topic.`,
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
    "   IMPORTANT: the top-level \"intent\" is ALWAYS the literal string \"get_report\" for this case — NEVER put the topic name (e.g. \"lead_lookup\", \"staff_contact\") directly in the \"intent\" field. The topic name goes ONLY in \"topic\".",
    "   - \"delegations\" = tasks he assigned to others (overdue). \"my_tasks\" = his own tasks.",
    "   - \"staff_tasks\" = a NAMED staff member's pending tasks, e.g. \"Naveen's pending tasks\", \"what does Priya have to do\" -> extract staff_name from the roster.",
    "   - \"help_slips\" = help slips assigned to him. \"leaves\" = pending/upcoming leave approvals. \"petty_cash\" = pending petty cash approvals.",
    "   - \"walkins\" = store walk-ins/conversions. \"demands\" = all open CRM demands/pipeline.",
    "   - \"staff_demands\" = a NAMED staff member's open CRM demands, e.g. \"what demands does Mahesh have open\" -> extract staff_name.",
    "   - \"attendance_today\" = who is absent/not present today, e.g. \"who's absent today\", \"who hasn't come in\".",
    "   - \"low_stock\" = inventory items below minimum stock level, e.g. \"what needs reordering\", \"low stock items\".",
    "   - \"fms_jobs\" = field/job tracker status, e.g. \"how many jobs today\", \"any pending job edit approvals\".",
    "   - \"lead_lookup\" = looking up a specific CUSTOMER by name or phone (not a staff member), e.g. \"who is Rohit Sharma\", \"find customer 98111...\", \"give me number for Pooja\", \"pooja ka number do\" -> put ONLY the name/phone in \"query\" (e.g. \"Pooja\", not the whole sentence). If multiple customers share that name, ALL of them will be returned — that's expected, not an error.",
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
    `6. Wanting to EDIT an existing customer/contact's details (add birthday, anniversary, address, email, etc. — NOT just looking them up): {"intent":"edit_contact","query":"<name or phone to find them by>"}`,
    "   e.g. \"edit Pooja's contact\", \"update Rohit Sharma's details\", \"add birthday for customer Anjali\", \"I want to edit a contact\" (query may be empty if no name given — will ask).",
    "",
    `7. Wanting to ADD a brand-new customer/contact to the database (NOT editing one that already exists): {"intent":"add_contact","name":"<name if given, else omit>","phone":"<10-digit phone if given, else omit>"}`,
    "   e.g. \"add new contact Pooja 9811123456\", \"naya contact add karo\", \"add a client Rohit, number 98111...\".",
    "",
    `8. Anything else (chit-chat, unclear, not matching the above): {"intent":"none"}`,
    "",
    "The message may be in English, Hindi, or Hinglish (Devanagari or Latin script, or mixed) for any of the above.",
    ...lastCommandBlock,
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

// Returns { text } for a single text reply, or { items: [{text}|{mediaUrl,
// mediaType, filename, caption}, ...] } when one or more documents match —
// callers must send every item, not just the first.
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
    // Multiple docs can legitimately match one query (e.g. 3 bank accounts
    // for "Sun Sea Jewellers") — send every match, not just the first.
    const items = docMatches.map((doc) => {
      if (doc.front_image_url) {
        const isPdf = /\.pdf(\?|$)/i.test(doc.front_image_url);
        return {
          mediaUrl: doc.front_image_url,
          mediaType: isPdf ? "document" : "image",
          filename: isPdf ? `${doc.title}.pdf` : undefined,
          caption: `📋 ${doc.title}${doc.notes ? "\n" + doc.notes : ""}`,
        };
      }
      return { text: `📋 *${doc.title}*\n${doc.text_content || doc.notes || "(no details on file)"}` };
    });
    return { items };
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
// { replyText }, { mediaUrl, caption }, or { items: [...] } for webhook.js to send.
export async function handleOwnerMessage(sb, messageText) {
  const [staff, corrections, lastCommand] = await Promise.all([getActiveStaff(sb), getRecentCorrections(sb), getLastCommand(sb)]);
  const parsed = await classifyOwnerMessage(messageText, staff.map((s) => s.name), corrections, lastCommand);

  // The classifier occasionally emits a REPORT_TOPICS value as the
  // top-level intent itself instead of nesting it under get_report — e.g.
  // {"intent":"lead_lookup"} instead of {"intent":"get_report","topic":"lead_lookup"}.
  // Confirmed for real via owner_command_log ("Give sanjeev garg number" ->
  // intent="lead_lookup", never handled, fell through to "Didn't catch
  // that"). Normalize defensively rather than trusting prompt wording alone.
  if (parsed.intent !== "get_report" && REPORT_TOPICS.includes(parsed.intent)) {
    parsed.topic = parsed.intent;
    parsed.intent = "get_report";
  }

  // Feedback on the previous reply — doesn't get logged as its own command,
  // it annotates the one it's rating.
  if (parsed.intent === "feedback") {
    const last = lastCommand;
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
    result = r.items ? { items: r.items } : { replyText: r.text };
  } else if (parsed.intent === "edit_contact") {
    result = { replyText: (await editContact(sb, parsed.query)).text };
  } else if (parsed.intent === "add_contact") {
    result = { replyText: (await addContact(sb, parsed.name, parsed.phone)).text };
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
    replyText: result.replyText || result.items?.map((i) => i.caption || i.text).join(" | "),
  }).catch((err) => console.error("ownerCommand: logCommand failed", err));

  return result;
}
