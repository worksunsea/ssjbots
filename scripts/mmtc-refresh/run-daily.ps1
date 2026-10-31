# Daily 10:00 MMTC price refresh. Registered by register-task.ps1.
# Needs: this PC on + logged in, Chrome open with the Claude-in-Chrome extension signed in.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$log = Join-Path $env:USERPROFILE "mmtc-refresh.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$prompt = Get-Content (Join-Path $PSScriptRoot "task-prompt.md") -Raw
try {
  $out = & claude -p $prompt --chrome --allowedTools "mcp__claude-in-chrome__*" "Bash(node scripts/mmtc-refresh/prepare.mjs)" "Read" "ToolSearch" 2>&1 | Out-String
} catch { $out = "MMTC_REFRESH_PROBLEM launcher error: $_" }
Add-Content -Path $log -Value "[$stamp] $($out.Trim())"
