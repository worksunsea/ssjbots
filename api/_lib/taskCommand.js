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

// Extracts { intent: "create_task"|"none", assignee, title, due_date } from free text.
export async function parseTaskCommand(messageText) {
  const system = [
    `Today's date is ${todayIST()} (IST).`,
    "The user is a business owner texting his WhatsApp bot to assign a task to a staff member.",
    "Extract the command as JSON only, no prose: {\"intent\":\"create_task\",\"assignee\":\"<name>\",\"title\":\"<short task description>\",\"due_date\":\"YYYY-MM-DD\"}",
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

// Resolves a free-text name against the shared `staff` table.
// Returns { match } on a unique hit, or { candidates } listing close matches.
export async function resolveAssignee(sb, assigneeName) {
  const { data: staff } = await sb
    .from("staff")
    .select("id,name,active")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true);

  const exact = (staff || []).filter((s) => nameEq(s.name, assigneeName));
  if (exact.length === 1) return { match: exact[0] };

  const needle = String(assigneeName || "").trim().toLowerCase();
  const partial = (staff || []).filter((s) => s.name?.toLowerCase().includes(needle) || needle.includes(s.name?.toLowerCase() || "\0"));
  if (partial.length === 1) return { match: partial[0] };

  return { candidates: (exact.length ? exact : partial).map((s) => s.name) };
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

// Full pipeline: parse → resolve → create. Returns the WhatsApp reply text.
export async function handleOwnerTaskCommand(sb, messageText) {
  const parsed = await parseTaskCommand(messageText);
  if (parsed.intent !== "create_task" || !parsed.assignee || !parsed.title) {
    return "Didn't catch a task assignment there. Try: \"assign <name>: <task> by <date>\"";
  }

  const resolved = await resolveAssignee(sb, parsed.assignee);
  if (resolved.candidates) {
    if (!resolved.candidates.length) {
      return `Couldn't find a staff member named "${parsed.assignee}". Check the spelling?`;
    }
    return `Found more than one match for "${parsed.assignee}": ${resolved.candidates.join(", ")}. Which one?`;
  }

  try {
    await createTaskFromCommand(sb, {
      assignedToName: resolved.match.name,
      title: parsed.title,
      dueDate: parsed.due_date,
    });
  } catch (err) {
    return `Couldn't create the task — ${String(err.message || err)}`;
  }

  const dueText = parsed.due_date ? `, due ${parsed.due_date}` : "";
  return `✅ Task assigned to ${resolved.match.name}: ${parsed.title}${dueText}`;
}
