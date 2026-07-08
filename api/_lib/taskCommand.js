// WhatsApp free-text → ssj-hr task row.
// Only reachable for the owner's own number (checked in webhook.js) — this
// intentionally bypasses ssj-hr's SA-approval gate on new tasks, same as if
// Saurav created the task from the app himself.
//
// Classification (is this a task command, what's the assignee/title/date)
// happens once in ownerCommand.js's single Claude call — this file only does
// the deterministic resolve → insert → notify steps.

import { sendWhatsApp } from "./wa.js";
import { sendPushNotification } from "./pushNotify.js";
import { TENANT_ID, WA_SESSION_CLIENT_ID } from "./config.js";

const nameEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

// Karigars (type=artisan) are not staff and never get app logins or task
// assignments — see feedback_karigars_not_staff. Filtered client-side
// (not .neq("type", "artisan") in the query) because SQL's <> against a
// NULL type column would silently exclude legitimate staff rows that
// predate this field.
export async function getActiveStaff(sb) {
  const { data } = await sb
    .from("staff")
    .select("id,name,phone,type")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true);
  return (data || []).filter((s) => s.name && s.type !== "artisan");
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

// Given an already-classified { assignee, title, due_date } (from
// ownerCommand.js), resolves the assignee against the roster, creates the
// task, and notifies them on WhatsApp. Returns the reply text for Saurav.
export async function executeCreateTask(sb, staff, { assignee, title, due_date }) {
  if (!title) {
    return "Didn't catch a task assignment there. Try: \"assign <name>: <task> by <date>\"";
  }
  if (!assignee) {
    return `Couldn't match that name against the staff list. Check the spelling?`;
  }

  // assignee should already be an exact roster name (ownerCommand.js's
  // classifier is instructed to output one) — confirm rather than trust blindly.
  const matchedStaff = staff.find((s) => nameEq(s.name, assignee));
  if (!matchedStaff) {
    return `Couldn't match "${assignee}" against the staff list. Check the spelling?`;
  }

  try {
    await createTaskFromCommand(sb, { assignedToName: matchedStaff.name, title, dueDate: due_date });
  } catch (err) {
    return `Couldn't create the task — ${String(err.message || err)}`;
  }

  const dueText = due_date ? `, due ${due_date}` : "";
  let notifyNote = "";
  if (matchedStaff.phone) {
    const wa = await sendWhatsApp({
      phone: matchedStaff.phone,
      msg: buildAssigneeNotifyText({ title, dueDate: due_date }),
      client: WA_SESSION_CLIENT_ID,
    });
    if (wa.status !== 1) notifyNote = ` (couldn't notify ${matchedStaff.name} on WhatsApp: ${wa.message})`;
  } else {
    notifyNote = ` (${matchedStaff.name} has no phone on file — not notified)`;
  }
  // App push — this task-creation path only ever sent the WhatsApp text
  // above, never a push, so it never showed up as a lock-screen/app
  // notification like in-app-created tasks do.
  await sendPushNotification({
    userId: String(matchedStaff.id),
    title: "📋 New Task Assigned",
    body: `${title}${dueText}`,
    url: "/",
  });

  return `✅ Task assigned to ${matchedStaff.name}: ${title}${dueText}${notifyNote}`;
}
