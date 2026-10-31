# Registers the daily 10:00 task. Run once: powershell -File scripts\mmtc-refresh\register-task.ps1
$script = Join-Path $PSScriptRoot "run-daily.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "SSJ MMTC price refresh" -Action $action -Trigger $trigger -Settings $settings -Description "Refresh MMTC-PAMP listed prices into ssjbots corporate gifting (price ceiling)" -Force | Out-Null
Get-ScheduledTask -TaskName "SSJ MMTC price refresh" | Select-Object TaskName, State
