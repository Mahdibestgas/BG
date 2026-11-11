# Removes the keep-alive task and stops it. The app itself is untouched.
$name = 'CashFlow13-KeepAlive'
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'cf13-keepalive' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Output "Removed: $name"
