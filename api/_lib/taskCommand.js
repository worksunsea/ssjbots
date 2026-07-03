// WhatsApp free-text → ssj-hr task row.
// Only reachable for the owner's own number (checked in webhook.js) — this
// intentionally bypasses ssj-hr's SA-approval gate on new tasks, same as if
// Saurav created the task from the app himself.

import { askClaude, parseBotJson } from "./claude.js";
import { sendWhatsApp } from "./wa.js";
import { TENANT_ID, CLAUDE_MODEL, WA_SESSION_CLIENT_ID } from "./config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

async function getActiveStaff(sb) {
  const { data } = await sb
    .from("staff")
    .select("name,phone")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true);
  return (data || []).filter((s) => s.name);
}

// Extracts { intent: "create_task"|"none", assignee, title, due_date } from
// free text. `staffNames` is the live roster — Claude resolves misspelled/
// phonetic name variants (e.g. "Vineet" -> "Vinit") against it directly,
// since a plain string-match pass can't catch that but the model can.
export async function parseTaskCommand(messageText, staffNames) {
  const system = [
    `Today's date is ${todayIST()} (IST).`,
    "The user is a business owner texting his WhatsApp bot to assign a task to a staff member.",
    `Staff roster (the ONLY valid values for "assignee"): ${staffNames.join(", ")}`,
    "The name in the message may be misspelled or a phonetic variant (e.g. \"Vineet\" for \"Vinit\", \"Rames\" for \"Ramesh\"). Match it to the closest name in the roster and return that EXACT roster spelling in \"assignee\".",
    "If no roster name is a plausible match, set \"assignee\" to null — do not invent a name.",
    "Extract the command as JSON only, no prose: {\"intent\":\"create_task\",\"assignee\":\"<exact roster name or null>\",\"title\":\"<short task description>\",\"due_date\":\"YYYY-MM-DD\"}",
    "Resolve relative dates (e.g. 'by Friday', 'tomorrow', 'next week') against today's date.",
    "If due date isn't mentioned, omit due_date (do not guess).",
    "",
    "The message is very often Hindi or Hinglish (Devanagari script or Latin transliteration, or mixed), not just English. Treat these exactly the same as an English task command:",
    "- Hindi task-assignment sentences are usually verb-final and don't use English words like \"assign\". Example: \"Ramesh ko bolo ki invoice fix kare Friday tak\" or \"रमेश को बोलो invoice fix करे शुक्रवार तक\" -> assignee \"Ramesh\", title \"fix invoice\", due_date resolved from \"Friday\"/\"शुक्रवार\".",
    "- The assignee's name is frequently followed by a postposition (ko/se/ne/को/से/ने) — strip it before matching against the roster, e.g. \"Ramesh ko\" -> \"Ramesh\", \"रमेश को\" -> \"रमेश\" -> match to roster name \"Ramesh\".",
    "- Common Hindi/Hinglish date words relative to today: aaj/आज = today, kal/कल = tomorrow (when talking about the future), parso/परसों = day after tomorrow, agla hafta/agle hafte/अगले हफ्ते = next week, is hafte/इस हफ्ते = this week, mahine ke end tak/महीने के अंत तक = end of this month.",
    "- Do not require the word \"assign\" or any specific verb — any sentence instructing a named staff member to do something is a task-assignment command, in any of English, Hindi, or Hinglish.",
    "If the message does NOT look like a task-assignment instruction, reply exactly: {\"intent\":\"none\"}",
  ].join("\n");
  try {
    const { text } = await askClaude({
      system,
      messages: [{ role: "user", content: messageText }],
      maxTokens: 200,
      model: CLAUDE_MODEL,
    });
    return parseBotJson(text) || { intent: "none" };
  } catch {
    return { intent: "none" };
  }
}

// Inserts a task row matching ssj-hr's createTask shape (App.jsx createTask).
export async function createTaskFromCommand(sb, { assignedToName, title, dueDate }) {
  const row = {
    tenant_id: TENANT_ID,
    title,
    description: "",
    assigned_to: assignedToName,
    assigned_by: "Saurav",
    priority: "Medium",
    task_type: "one-time",
    due_date: dueDate || todayIST(),
    due_time: "18:00",
    status: "Pending",
    remarks: "",
    private: false,
    family_only: false,
    completions: [],
    checklist: [],
    created_at: new Date().toISOString(),
  };
  const { error } = await sb.from("tasks").insert(row);
  if (error) throw new Error(error.message);
  return row;
}

// Plain template, no AI — sent only for tasks created via this WhatsApp
// command path (not app-created tasks, to avoid any risk of notifying staff
// during bulk operations like CSV import or backup restore).
function buildAssigneeNotifyText({ title, dueDate }) {
  const dueText = dueDate ? ` — due ${dueDate}` : "";
  return `📋 New task from Saurav: "${title}"${dueText}`;
}

// Full pipeline: parse (incl. name resolution) → create → notify assignee. Returns the WhatsApp reply text for Saurav.
export async function handleOwnerTaskCommand(sb, messageText) {
  const staff = await getActiveStaff(sb);
  const staffNames = staff.map((s) => s.name);
  const parsed = await parseTaskCommand(messageText, staffNames);

  if (parsed.intent !== "create_task" || !parsed.title) {
    return "Didn't catch a task assignment there. Try: \"assign <name>: <task> by <date>\"";
  }
  if (!parsed.assignee) {
    return `Couldn't match that name against the staff list. Check the spelling?`;
  }

  // parsed.assignee should already be an exact roster name — confirm, since
  // the model is instructed to but isn't guaranteed to comply perfectly.
  const matchedStaff = staff.find((s) => nameEq(s.name, parsed.assignee));
  if (!matchedStaff) {
    return `Couldn't match "${parsed.assignee}" against the staff list. Check the spelling?`;
  }

  try {
    await createTaskFromCommand(sb, {
      assignedToName: matchedStaff.name,
      title: parsed.title,
      dueDate: parsed.due_date,
    });
  } catch (err) {
    return `Couldn't create the task — ${String(err.message || err)}`;
  }

  const dueText = parsed.due_date ? `, due ${parsed.due_date}` : "";
  let notifyNote = "";
  if (matchedStaff.phone) {
    const wa = await sendWhatsApp({
      phone: matchedStaff.phone,
      msg: buildAssigneeNotifyText({ title: parsed.title, dueDate: parsed.due_date }),
      client: WA_SESSION_CLIENT_ID,
    });
    if (wa.status !== 1) notifyNote = ` (couldn't notify ${matchedStaff.name} on WhatsApp: ${wa.message})`;
  } else {
    notifyNote = ` (${matchedStaff.name} has no phone on file — not notified)`;
  }

  return `✅ Task assigned to ${matchedStaff.name}: ${parsed.title}${dueText}${notifyNote}`;
}
