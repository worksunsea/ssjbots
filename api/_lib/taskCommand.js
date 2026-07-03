// WhatsApp free-text → ssj-hr task row.
// Only reachable for the owner's own number (checked in webhook.js) — this
// intentionally bypasses ssj-hr's SA-approval gate on new tasks, same as if
// Saurav created the task from the app himself.

import { askClaude, parseBotJson } from "./claude.js";
import { TENANT_ID, CLAUDE_MODEL } from "./config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

async function getActiveStaffNames(sb) {
  const { data } = await sb
    .from("staff")
    .select("name")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true);
  return (data || []).map((s) => s.name).filter(Boolean);
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
    "The message may be in English, Hindi, or Hinglish.",
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

// Full pipeline: parse (incl. name resolution) → create. Returns the WhatsApp reply text.
export async function handleOwnerTaskCommand(sb, messageText) {
  const staffNames = await getActiveStaffNames(sb);
  const parsed = await parseTaskCommand(messageText, staffNames);

  if (parsed.intent !== "create_task" || !parsed.title) {
    return "Didn't catch a task assignment there. Try: \"assign <name>: <task> by <date>\"";
  }
  if (!parsed.assignee) {
    return `Couldn't match that name against the staff list. Check the spelling?`;
  }

  // parsed.assignee should already be an exact roster name — confirm, since
  // the model is instructed to but isn't guaranteed to comply perfectly.
  const matchedName = staffNames.find((n) => nameEq(n, parsed.assignee));
  if (!matchedName) {
    return `Couldn't match "${parsed.assignee}" against the staff list. Check the spelling?`;
  }

  try {
    await createTaskFromCommand(sb, {
      assignedToName: matchedName,
      title: parsed.title,
      dueDate: parsed.due_date,
    });
  } catch (err) {
    return `Couldn't create the task — ${String(err.message || err)}`;
  }

  const dueText = parsed.due_date ? `, due ${parsed.due_date}` : "";
  return `✅ Task assigned to ${matchedName}: ${parsed.title}${dueText}`;
}
