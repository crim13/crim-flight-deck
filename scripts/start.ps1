<#
  CRIM Flight Deck - production start.
  Installs dependencies / builds when needed, builds the SimConnect bridge when possible,
  then runs the server in this console. Ctrl+C (or closing the window) shuts everything down gracefully.
#>
[CmdletBinding()]
param(
  [switch]$Mock,
  [int]$Port = 0,
  [switch]$NoBrowser,
  [switch]$Rebuild,
  [string]$HostAddress = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "[crim] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[crim] $msg" -ForegroundColor Yellow }

. (Join-Path $PSScriptRoot 'lib.ps1')
# a release install (version.json, bundled runtime, no sources) is run as it is; a git checkout is built first
$release = Test-ReleaseLayout $root

# --- Node ---------------------------------------------------------------------------------
$nodeExe = Find-Node $root
if (-not $nodeExe) { Write-Host 'Node.js 20+ is required. Install it from https://nodejs.org/ and run start.cmd again.' -ForegroundColor Red; exit 1 }
$major = Get-NodeMajor $nodeExe
if ($major -lt 20) { Write-Host "Node.js 20+ is required (found v$major)." -ForegroundColor Red; exit 1 }

# --- dependencies -------------------------------------------------------------------------
if (-not $release -and (-not (Test-Path (Join-Path $root 'node_modules\ws')) -or $Rebuild)) {
  Step 'Installing dependencies (npm install) ...'
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host 'npm install failed.' -ForegroundColor Red; exit 1 }
}

# --- build (only when missing or stale) ---------------------------------------------------
function Newest($paths) {
  $latest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (Test-Path $p) {
      Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { if ($_.LastWriteTime -gt $latest) { $latest = $_.LastWriteTime } }
    }
  }
  $latest
}
$serverOut = Join-Path $root 'apps\server\dist\server.mjs'
$webOut = Join-Path $root 'apps\web\dist\index.html'
$srcTime = Newest @((Join-Path $root 'apps\web\src'), (Join-Path $root 'apps\server\src'), (Join-Path $root 'shared\src'), (Join-Path $root 'shared\profiles'))
$stale = -not $release -and ($Rebuild -or -not (Test-Path $serverOut) -or -not (Test-Path $webOut) -or ((Get-Item $serverOut).LastWriteTime -lt $srcTime) -or ((Get-Item $webOut).LastWriteTime -lt $srcTime))
if ($stale) {
  Step 'Building web UI and server ...'
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed.' -ForegroundColor Red; exit 1 }
}

# --- SimConnect bridge (real simulator only) -----------------------------------------------
$bridge = Join-Path $root 'apps\simconnect-bridge\bin\CrimSimConnectBridge.exe'
if ($release -and -not $Mock) {
  # a release ships the bridge without Microsoft's DLLs: they are copied from the user's own MSFS SDK
  $dllState = Install-SimConnectDlls $root
  if ($dllState -eq 'no-sdk') {
    Warn 'The SimConnect DLLs are missing: install the MSFS 2024 SDK (MSFS: Developer Mode > Help > SDK Installer) and run install.cmd.'
    Warn 'The web UI will still start, but it cannot talk to the simulator until then.'
  }
}
if (-not $release -and -not $Mock -and -not (Test-Path $bridge)) {
  Step 'SimConnect bridge not built yet - trying to build it ...'
  try {
    & (Join-Path $PSScriptRoot 'build-bridge.ps1')
  } catch {
    Warn $_.Exception.Message
  }
  if (-not (Test-Path $bridge)) {
    Warn 'The bridge could not be built, so the server cannot talk to MSFS yet (see README: "SDK setup").'
    Warn 'The web UI will still start and show "SIMCONNECT BRIDGE NOT RUNNING". Use  start.cmd -Mock  to try the UI without the simulator.'
  }
}

# --- firewall hint ---------------------------------------------------------------------------
try {
  if (-not (Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue)) {
    Warn 'If your tablet / phone cannot connect, allow the port once (run as Administrator):  scripts\allow-firewall.ps1'
  }
} catch { }

# --- run -----------------------------------------------------------------------------------------
$argsList = @('apps/server/dist/server.mjs')
if ($Mock) { $argsList += @('--adapter', 'mock') }
if ($Port -gt 0) { $argsList += @('--port', $Port) }
if ($HostAddress) { $argsList += @('--host', $HostAddress) }

$adminPort = if ($Port -gt 0) { $Port } else {
  try { (Get-Content (Join-Path $root 'data\server.json') -Raw | ConvertFrom-Json).port } catch { 3000 }
}
if (-not $adminPort) { $adminPort = 3000 }

if (-not $NoBrowser) {
  # open the PC admin page (QR code + pairing links) once the server had a moment to start
  Start-Job -ScriptBlock { param($p) Start-Sleep -Seconds 2; Start-Process "http://localhost:$p/admin" } -ArgumentList $adminPort | Out-Null
}

Step ('Starting server' + $(if ($Mock) { ' (MOCK adapter)' } else { '' }) + ' - press Ctrl+C to stop')
& $nodeExe @argsList
exit $LASTEXITCODE
