<#
  CRIM Flight Deck - run together with the simulator.

  Started by MSFS itself (EXE.xml entry, see autostart.ps1) or by a logon task (-WaitForSim):
    * starts the server hidden (no console window), logs to data\logs\server.log
    * stops it again when the simulator exits (unless -KeepRunning)
  If a server already answers on the port (for example started by hand with start.cmd) nothing is started twice.
#>
[CmdletBinding()]
param(
  # logon-task mode: wait (forever) for the simulator to appear, run the server while it runs, then wait for the next start
  [switch]$WaitForSim,
  # leave the server running after the simulator exits
  [switch]$KeepRunning,
  [string]$SimProcessName = 'FlightSimulator2024',
  # seconds to wait for the simulator process when started by EXE.xml (it normally exists already)
  [int]$SimWaitSeconds = 120,
  [int]$Port = 0,
  [string]$DataDir = '',
  [switch]$Mock
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dataRoot = if ($DataDir) { $DataDir } else { Join-Path $root 'data' }
$logDir = Join-Path $dataRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'autostart.log'

function Log($msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
}

# keep the log small: drop everything but the last 400 lines when it grows
try {
  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 200KB) {
    $tail = Get-Content $logFile -Tail 400
    Set-Content -Path $logFile -Value $tail -Encoding UTF8
  }
} catch { }

function Get-LauncherPort {
  if ($Port -gt 0) { return $Port }
  try {
    $p = (Get-Content (Join-Path $dataRoot 'server.json') -Raw | ConvertFrom-Json).port
    if ($p) { return [int]$p }
  } catch { }
  return 3000
}
$serverPort = Get-LauncherPort

function Test-ServerUp {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$serverPort/api/health" -TimeoutSec 2
    return ($r.name -eq 'crim-flight-deck')
  } catch { return $false }
}

function Test-SimRunning { return [bool](Get-Process -Name $SimProcessName -ErrorAction SilentlyContinue) }

. (Join-Path $PSScriptRoot 'lib.ps1')

function Start-Server {
  $node = Find-Node $root
  if (-not $node) { Log 'Node.js not found - install Node 20+ (https://nodejs.org/).'; return $null }
  $serverJs = Join-Path $root 'apps\server\dist\server.mjs'
  $webIndex = Join-Path $root 'apps\web\dist\index.html'
  if (-not (Test-Path $serverJs) -or -not (Test-Path $webIndex)) {
    Log 'Build output missing - run start.cmd once (it builds the app), then try again.'
    return $null
  }
  $argList = @('apps/server/dist/server.mjs')
  if ($Mock) { $argList += @('--adapter', 'mock') }
  if ($Port -gt 0) { $argList += @('--port', "$Port") }
  if ($DataDir) { $argList += @('--data-dir', "`"$DataDir`"") }
  $p = Start-Process -FilePath $node -ArgumentList $argList -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server.err.log') -PassThru
  Log "server started (pid $($p.Id), port $serverPort)"
  return $p
}

function Stop-Server($p) {
  if (-not $p -or $p.HasExited) { return }
  # /T also ends the SimConnect bridge the server spawned
  & taskkill.exe /PID $p.Id /T /F | Out-Null
  Log "server stopped (pid $($p.Id))"
}

function Run-Once([bool]$simAlreadyThere) {
  $proc = $null
  if (Test-ServerUp) {
    Log "a server already answers on port $serverPort - not starting another one"
  } else {
    $proc = Start-Server
    if ($proc) {
      for ($i = 0; $i -lt 40 -and -not (Test-ServerUp); $i++) { Start-Sleep -Milliseconds 500 }
      if (-not (Test-ServerUp)) { Log 'WARNING: the server did not answer within 20 s (see server.err.log)' }
    }
  }

  if (-not $simAlreadyThere) {
    for ($i = 0; $i -lt ($SimWaitSeconds / 2) -and -not (Test-SimRunning); $i++) { Start-Sleep -Seconds 2 }
    if (-not (Test-SimRunning)) {
      Log "simulator process '$SimProcessName' not seen within $SimWaitSeconds s - leaving the server running"
      return
    }
  }
  Log "simulator '$SimProcessName' is running"
  while (Test-SimRunning) { Start-Sleep -Seconds 5 }
  Log 'simulator exited'
  if (-not $KeepRunning) {
    Stop-Server $proc
    # the server we started may have been replaced by an update (it restarts itself): stop that one too, but only
    # because this launcher started a server in the first place - never one the user started by hand
    if ($proc -and (Test-ServerUp)) {
      if (Stop-CrimServer $root $serverPort) { Log "server (restarted by an update) stopped" }
    }
  }
}

Log ("run-with-sim started (mode: {0}, port {1})" -f $(if ($WaitForSim) { 'wait-for-sim' } else { 'started-by-sim' }), $serverPort)
try {
  if ($WaitForSim) {
    while ($true) {
      while (-not (Test-SimRunning)) { Start-Sleep -Seconds 5 }
      Run-Once $true
    }
  } else {
    Run-Once $false
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
