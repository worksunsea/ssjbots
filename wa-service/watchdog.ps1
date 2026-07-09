# WA session watchdog - runs locally on the NUC via Task Scheduler every 5 min.
#
# Why this exists: the Reception WA session got stuck in a broken reconnect
# loop (closed code=500, repeating every ~50min) for ~56h straight
# (2026-07-05 to 2026-07-07), silently failing every outbound WhatsApp
# message for every recipient until someone noticed and manually re-paired.
# Nothing detected it automatically. This script closes that gap: it polls
# wa-service's own /clients status, and if any session has been disconnected
# for 2 consecutive checks (~10 min), it restarts the container (cheap,
# fixes most stuck-reconnect cases) and pushes a notification via ssj-hr's
# existing PWA push endpoint - which works even when WhatsApp itself is the
# thing that's broken, unlike alerting over WA.
#
# Alerts go to user_id "admin", which ssj-hr's /api/push resolves to every
# superadmin + admin staff member (not just Saurav) - see api/push.js.
#
# Disconnected sessions report me=null (no phone number), which made past
# alerts say only "production disconnected" with no way to know which real
# WA number that is without digging through logs. State now remembers the
# last-seen phone number per client_id while it WAS connected, and includes
# it in the alert even after the session drops.

$ErrorActionPreference = "Stop"
$stateFile = "C:\docker-data\wa-watchdog-state.json"
$healthUrl = "http://localhost:3021/clients"
$pushUrl = "https://hr.gemtre.in/api/push"
$waAlertUrl = "https://ssjbot.gemtre.in/api/connection-alert"
$crmSecret = $env:CRM_SECRET   # same shared secret the CRM frontend uses (x-crm-secret)
$containerName = "ssj-wa-service"
$restartCooldownMin = 60   # don't restart more than once per hour even if still broken

function Load-State {
    if (Test-Path $stateFile) {
        try { return Get-Content $stateFile -Raw | ConvertFrom-Json } catch {}
    }
    return @{ fails = @{}; lastRestart = $null; knownMe = @{} }
}

function Save-State($state) {
    $state | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding utf8
}

function Send-Alert($title, $body) {
    try {
        # Deep-links straight to ssjbots' Connections screen (list + re-pair
        # QR for every session) instead of ssj-hr's reporting page - tapping
        # the notification should go directly to where you fix it, not to a
        # dashboard you then have to navigate away from.
        # notif_type makes this also show up as a clickable card in the HR
        # app's Notifications feed (not just an OS push toast that's easy to
        # dismiss/miss), same place leave/help-slip alerts already show.
        $payload = @{ user_id = "admin"; title = $title; body = $body; url = "https://ssjbot.gemtre.in/?screen=connections"; notif_type = "wa_session_down" } | ConvertTo-Json
        Invoke-RestMethod -Uri $pushUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 15 | Out-Null
    } catch {
        Write-Output ("wa-watchdog: push alert failed - {0}" -f $_)
    }
    # Also send a WhatsApp message via api/connection-alert.js — deliberately
    # over WbizTool (not Baileys), since Baileys is the very channel that may
    # be down right now. Push already covers all superadmin+admin; this adds
    # a channel that doesn't depend on the phone having the PWA installed.
    if ($crmSecret) {
        try {
            $waPayload = @{ title = $title; message = $body } | ConvertTo-Json
            Invoke-RestMethod -Uri $waAlertUrl -Method Post -Body $waPayload -ContentType "application/json" -Headers @{ "x-crm-secret" = $crmSecret } -TimeoutSec 15 | Out-Null
        } catch {
            Write-Output ("wa-watchdog: WA alert failed - {0}" -f $_)
        }
    }
}

# "919311777591:48@s.whatsapp.net" -> "919311777591"
function Clean-Phone($me) {
    if (-not $me) { return $null }
    return ($me -split ':')[0]
}

$state = Load-State
if (-not $state.fails) { $state | Add-Member -NotePropertyName fails -NotePropertyValue @{} -Force }
if (-not $state.knownMe) { $state | Add-Member -NotePropertyName knownMe -NotePropertyValue @{} -Force }

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 15
} catch {
    Write-Output ("wa-watchdog: could not reach wa-service at all - {0}" -f $_)
    Send-Alert "WA service unreachable" ("wa-service did not respond on {0} - check Docker Desktop / the NUC is on." -f $healthUrl)
    exit 0
}

$downClients = @()
foreach ($c in $health.clients) {
    $id = $c.client_id
    $prevFails = if ($state.fails.$id) { $state.fails.$id } else { 0 }
    if ($c.connected) {
        $state.fails.$id = 0
        $phone = Clean-Phone $c.me
        if ($phone) { $state.knownMe.$id = $phone }
    } else {
        $state.fails.$id = $prevFails + 1
        if ($state.fails.$id -ge 2) { $downClients += $id }
    }
}

if ($downClients.Count -gt 0) {
    $now = Get-Date
    $canRestart = $true
    if ($state.lastRestart) {
        $last = [datetime]$state.lastRestart
        if (($now - $last).TotalMinutes -lt $restartCooldownMin) { $canRestart = $false }
    }
    # e.g. "production (919311777591), Reception (918860866000)"
    $names = ($downClients | ForEach-Object {
        $phone = $state.knownMe.$_
        if ($phone) { "$_ ($phone)" } else { $_ }
    }) -join ", "
    if ($canRestart) {
        Write-Output ("wa-watchdog: {0} disconnected 2+ checks in a row - restarting {1}" -f $names, $containerName)
        docker restart $containerName | Out-Null
        $state.lastRestart = $now.ToString("o")
        Send-Alert "WhatsApp session dropped" ("{0} disconnected - auto-restarted the wa-service container. If messages still show waiting after a few minutes, it needs a manual re-pair (scan QR again)." -f $names)
    } else {
        Write-Output ("wa-watchdog: {0} still down but restarted within the last {1} min - skipping restart, still alerting" -f $names, $restartCooldownMin)
        Send-Alert "WhatsApp session still down" ("{0} still disconnected after a recent auto-restart - likely needs a manual re-pair (scan QR again)." -f $names)
    }
}

Save-State $state
