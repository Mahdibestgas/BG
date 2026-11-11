# Keeps Cash Flow 13 running by itself, independent of Claude or any terminal window.
# Every 30 seconds it checks the database (5442), the API (8990) and the web app (5180) and starts whatever is down.
# Logs: saas\run\logs\.  It never touches ports 8931 / 8941 (the cash-collection mock servers).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot                 # ...\saas
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

function Port-Open([int]$port) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(800); if ($ok) { $c.EndConnect($iar) }; $c.Close(); return $ok } catch { return $false }
}
function Find-Npm {
  $n = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $n) { foreach ($p in @("$env:ProgramFiles\nodejs\npm.cmd", "${env:ProgramFiles(x86)}\nodejs\npm.cmd", "$env:APPDATA\npm\npm.cmd")) { if (Test-Path $p) { $n = $p; break } } }
  return $n
}
function Log($m) { Add-Content -Path (Join-Path $logs 'keepalive.log') -Value ("{0}  {1}" -f (Get-Date -Format 's'), $m) }

Log 'keepalive started'
while ($true) {
  try {
    # after a restart Docker Desktop may not be running: start it (the database lives in it), then wait for its engine
    if ((Get-Command docker -ErrorAction SilentlyContinue) -and -not (Port-Open 5442)) {
      & docker info 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0 -and -not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        $dd = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dd) { Start-Process -FilePath $dd; Log 'docker desktop: started'; Start-Sleep -Seconds 45 }
      }
    }
    if (-not (Port-Open 5442)) {                         # database container
      if (Get-Command docker -ErrorAction SilentlyContinue) { & docker start cf13_db 2>&1 | Out-Null; Log 'database: docker start cf13_db'; Start-Sleep -Seconds 8 }
    }
    $npm = Find-Npm
    if (-not $npm) { Log 'npm not found'; Start-Sleep -Seconds 60; continue }
    if ((Port-Open 5442) -and -not (Port-Open 8990)) {   # API
      Start-Process -FilePath $npm -ArgumentList @('--prefix', ('"' + (Join-Path $root 'apps\api') + '"'), 'run', 'start') -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'api.out.log') -RedirectStandardError (Join-Path $logs 'api.err.log')
      Log 'api: started'; Start-Sleep -Seconds 12
    }
    if (-not (Port-Open 5180)) {                         # web app
      Start-Process -FilePath $npm -ArgumentList @('--prefix', ('"' + (Join-Path $root 'apps\web') + '"'), 'run', 'dev') -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'web.out.log') -RedirectStandardError (Join-Path $logs 'web.err.log')
      Log 'web: started'; Start-Sleep -Seconds 8
    }
  } catch { Log ("error: " + $_.Exception.Message) }
  Start-Sleep -Seconds 30
}
