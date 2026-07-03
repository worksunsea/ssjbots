// Local listener: polls dev_agent_tasks for new WhatsApp-queued coding
// requests and feeds them into ONE persistent, visible Claude Code session
// running on this machine — not a new window per task. Run this in its own
// terminal window and leave it open; that window doubles as both the
// listener's log output and (once a task arrives) the Claude Code session
// itself.
//
// Claude runs in default interactive mode (no --dangerously-skip-permissions)
// so every tool call still needs manual approval, same as any Claude Code chat.

import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TENANT_ID = process.env.TENANT_ID || "a1b2c3d4-0000-0000-0000-000000000001";
const POLL_MS = Number(process.env.POLL_MS || 5000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — copy .env.example to .env and fill it in.");
  process.exit(1);
}

const REPO_MAP = {
  "ssj-hr": "C:\\projects\\ssj-hr",
  ssjbots: "C:\\projects\\ssjbots",
  "fms-tracker": "C:\\projects\\fms-tracker",
};
const DEFAULT_REPO = "ssj-hr";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let activeChild = null;
let activeRepoKey = null;

function resolveRepo(hint) {
  if (hint && REPO_MAP[hint]) return { key: hint, path: REPO_MAP[hint] };
  return { key: DEFAULT_REPO, path: REPO_MAP[DEFAULT_REPO] };
}

// No user-controlled text ever goes into argv/shell here — `claude` is
// spawned with a fixed, empty argument list, and the task text (which
// originates from a WhatsApp message) is only ever written to its stdin
// pipe, never interpolated into a command string. That avoids any shell-
// injection surface even though this path is already gated to Saurav's
// own WhatsApp number upstream — defense in depth for something that runs
// unattended on this machine.
function spawnClaude(repo) {
  console.log(`\n🖥️  Starting Claude Code in ${repo.path} ...`);
  const child = spawn("claude", [], {
    cwd: repo.path,
    stdio: ["pipe", "inherit", "inherit"],
    shell: true, // only resolves the fixed `claude` executable via PATH, no user data here
  });
  child.on("exit", (code) => {
    console.log(`\n🖥️  Claude Code session ended (exit ${code}). Waiting for the next task...`);
    if (activeChild === child) {
      activeChild = null;
      activeRepoKey = null;
    }
  });
  child.on("error", (err) => {
    console.error("Failed to spawn claude:", err.message);
    activeChild = null;
    activeRepoKey = null;
  });
  return child;
}

function feedTask(task, repo) {
  const isSameRepo = activeRepoKey === repo.key;
  const text = isSameRepo
    ? task
    : `[Note: this next task concerns the "${repo.key}" repo at ${repo.path} — cd there first if needed.]\n${task}`;

  const isNewSession = !activeChild || activeChild.killed;
  if (isNewSession) {
    activeChild = spawnClaude(repo);
    activeRepoKey = repo.key;
  } else {
    console.log(`\n📨 Feeding new task into the running session: ${task.slice(0, 80)}`);
  }
  // Written the same way whether the process just started or was already
  // running — stdin only, never a shell argument.
  activeChild.stdin.write(text + "\n");
}

async function pollOnce() {
  const { data: tasks, error } = await sb
    .from("dev_agent_tasks")
    .select("id,task_text,repo_hint,created_at")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error("Poll failed:", error.message);
    return;
  }
  for (const t of tasks || []) {
    const repo = resolveRepo(t.repo_hint);
    console.log(`\n✅ New dev task (${t.id}) — repo guess: ${t.repo_hint || "unsure -> " + DEFAULT_REPO}`);
    try {
      feedTask(t.task_text, repo);
      await sb.from("dev_agent_tasks").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", t.id);
    } catch (err) {
      console.error("Failed to deliver task", t.id, err.message);
      await sb.from("dev_agent_tasks").update({ status: "error" }).eq("id", t.id).catch(() => {});
    }
  }
}

console.log("🤖 Dev-agent listener running. Leave this window open.");
console.log(`Polling every ${POLL_MS / 1000}s for new WhatsApp-queued coding tasks...\n`);
setInterval(pollOnce, POLL_MS);
pollOnce();
