// Queues a coding task for the local dev-agent listener (runs on Saurav's
// PC) to pick up and feed into a persistent, visible Claude Code session.
// No auto-push — the listener runs claude in default interactive mode, so
// every tool call still requires his approval, same as any Claude Code chat.

import { TENANT_ID } from "./config.js";

export async function queueDevTask(sb, { taskText, repoHint }) {
  const { error } = await sb.from("dev_agent_tasks").insert({
    tenant_id: TENANT_ID,
    task_text: taskText,
    repo_hint: repoHint || null,
    requested_by: "Saurav",
    status: "pending",
  });
  if (error) throw new Error(error.message);
}
