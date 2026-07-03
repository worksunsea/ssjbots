# Dev Agent Listener

Runs on Saurav's own PC (not deployed anywhere). Polls the shared Supabase
project for coding tasks queued via WhatsApp (see `ownerCommand.js`'s
`dev_task` intent in the main ssjbots repo) and feeds them into one
persistent, visible Claude Code session — not a new window per message.

Claude runs in its normal interactive mode here: every file edit, command,
or commit still needs manual approval in this window, exactly like using
Claude Code directly. Nothing pushes automatically.

## Setup

```
cd dev-agent
npm install
cp .env.example .env
# edit .env — fill in SUPABASE_SERVICE_KEY from the Supabase dashboard
npm start
```

Leave the window open. The first WhatsApp coding request opens a Claude
Code session right there; later requests (while that session is still
running) get typed into the same session instead of opening another one.
If the session is closed, the next task starts a fresh one.

## Requirements

- `claude` CLI available on PATH (same one used interactively).
- Repos checked out locally at the paths in `REPO_MAP` in `index.js`
  (defaults: `C:\projects\ssj-hr`, `C:\projects\ssjbots`, `C:\projects\fms-tracker`).

## Limitations

- Only works while this machine and this window are running — if the PC
  is off or the window is closed, WhatsApp dev-task replies will say it
  was queued, but nothing happens until the listener is running again.
- Repo-switching between messages is a soft hint, not enforced — if a new
  task is for a different repo than the currently open session, it gets
  prefixed with a note so Claude can `cd` there itself if needed, rather
  than the listener silently guessing wrong.
