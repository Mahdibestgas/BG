# Registers the keep-alive as a per-user scheduled task (no administrator needed): starts at every logon, hidden,
# restarts itself if it ever stops, and starts right now.   Undo with uninstall-keepalive.ps1.
$name = 'CashFlow13-KeepAlive'
$script = Join-Path $PSScriptRoot 'cf13-keepalive.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Keeps the Cash Flow 13 web app, API and database running (local only).' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output "Registered and started: $name"
