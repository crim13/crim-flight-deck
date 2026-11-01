<#
  CRIM Flight Deck - update to the latest GitHub release.

    update.cmd                       look for an update, ask, install it (restarts the server if it was running)
    scripts\update.ps1 -Check        only look
    scripts\update.ps1 -Apply        install without asking (used by the admin page "Update now" button)

  The release zip is downloaded over HTTPS and checked against the SHA256SUMS.txt of the same release; nothing is
  changed when the check fails. Your settings (data\) and the SimConnect DLLs copied from your SDK are never touched.
  The previous version is kept in data\updates\backup-<version> and restored automatically if the new one does not start.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Apply,
  [switch]$Restart,
  [switch]$Yes,
  [string]$Repo = '',
  # default: https://api.github.com (CRIM_UPDATE_API overrides it, like for the server's update check)
  [string]$ApiBase = '',
  # install folder (the default is the parent of this script; the temporary copy gets it passed)
  [string]$Root = '',
  [switch]$FromTemp
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path $Root).Path.TrimEnd('\')
. (Join-Path $PSScriptRoot 'lib.ps1')

$dataDir = Get-DataDir $Root
$logDir = Join-Path $dataDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'update.log'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Log($m) {
  try { Add-Content -Path $logFile -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m) -Encoding UTF8 } catch { }
  Write-Host $m
}
# every error ends up in update.log (the admin page starts this script hidden, nobody sees the console)
trap { Log "ERROR: $($_.Exception.Message)"; exit 1 }
if (-not $ApiBase) { $ApiBase = if ($env:CRIM_UPDATE_API) { $env:CRIM_UPDATE_API } else { 'https://api.github.com' } }

$cur = Get-ReleaseInfo $Root
if (-not $cur) { throw 'This is a development checkout (no version.json). Update it with git pull / npm run build.' }
if (-not $Repo) { $Repo = $cur.repo }
if (-not $Repo) { throw 'No GitHub repository known (version.json has no "repo").' }

# ---- 1. what is the latest release? ----------------------------------------------------------------------------
$rel = Invoke-RestMethod -Uri "$ApiBase/repos/$Repo/releases/latest" -TimeoutSec 20 `
  -Headers @{ 'User-Agent' = 'crim-flight-deck-updater'; Accept = 'application/vnd.github+json' }
$latest = ([string]$rel.tag_name).TrimStart('v')
if ($latest -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') { throw "unexpected release tag '$($rel.tag_name)'" }
$zipAsset = @($rel.assets | Where-Object { $_.name -match '^CRIM-FlightDeck-.*-win-x64\.zip$' })[0]
$sumAsset = @($rel.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' })[0]
$newer = (Compare-Versions $latest $cur.version) -gt 0

if (-not $newer) { Log "Up to date: v$($cur.version) (latest release v$latest)."; return }
if (-not $zipAsset -or -not $sumAsset) { throw "Release v$latest has no installer zip / SHA256SUMS.txt yet - try again later." }
if (-not $FromTemp) {
  Say "Update available: v$($cur.version) -> v$latest" Green
  if ($rel.html_url) { Say "Release notes: $($rel.html_url)" }
}
if ($Check -and -not $Apply) { Say 'Run update.cmd to install it.'; return }

if (-not $Apply -and -not $Yes) {
  $a = Read-Host "Install v$latest now? Your settings are kept. [Y/n]"
  if ($a -ne '' -and $a -notmatch '^[yY]') { return }
}

# ---- 2. continue from a temporary copy: this script and scripts\ get replaced below -------------------------------
if (-not $FromTemp) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('crim-update-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Copy-Item (Join-Path $PSScriptRoot 'update.ps1'), (Join-Path $PSScriptRoot 'lib.ps1') -Destination $tmp
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $tmp 'update.ps1'), '-Apply', '-Yes', '-FromTemp', '-Root', $Root, '-Repo', $Repo, '-ApiBase', $ApiBase)
  # restart the server afterwards if it is running now (the admin page button) or when asked to
  if ($Restart -or (Get-CrimHealth (Get-ServerPort $Root))) { $args2 += '-Restart' }
  & powershell.exe @args2
  $code = $LASTEXITCODE
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  exit $code
}

# ---- 3. download + verify -----------------------------------------------------------------------------------------
$origin = ([Uri]$ApiBase).GetLeftPart([UriPartial]::Authority)
foreach ($u in @($zipAsset.browser_download_url, $sumAsset.browser_download_url)) {
  if (-not ($u.StartsWith('https://github.com/') -or $u.StartsWith($origin + '/'))) { throw "refusing to download from $u" }
}
$work = Join-Path $dataDir "updates\v$latest"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work $zipAsset.name
Log "Downloading $($zipAsset.name) ..."
Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 600
Invoke-WebRequest -Uri $sumAsset.browser_download_url -OutFile (Join-Path $work 'SHA256SUMS.txt') -UseBasicParsing -TimeoutSec 60

$expected = $null
foreach ($line in (Get-Content (Join-Path $work 'SHA256SUMS.txt'))) {
  $m = [regex]::Match($line, '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$')
  if ($m.Success -and $m.Groups[2].Value -eq $zipAsset.name) { $expected = $m.Groups[1].Value }
}
if (-not $expected) { throw "SHA256SUMS.txt has no entry for $($zipAsset.name)" }
$actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash
if ($actual -ne $expected.ToUpper()) { Remove-Item $zip -Force; throw "checksum mismatch for $($zipAsset.name) (expected $expected, got $actual) - nothing was changed" }
Log 'Checksum OK.'

$stage = Join-Path $work 'stage'
Expand-Archive -Path $zip -DestinationPath $stage -Force
$new = $stage
if (-not (Test-Path (Join-Path $new 'version.json'))) {
  $new = @(Get-ChildItem $stage -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'version.json') })[0].FullName
}
if (-not $new) { throw 'the zip does not contain a CRIM Flight Deck release' }
$newInfo = Get-Content (Join-Path $new 'version.json') -Raw | ConvertFrom-Json
if ($newInfo.version -ne $latest) { throw "the zip contains v$($newInfo.version), expected v$latest" }
foreach ($must in @('apps\server\dist\server.mjs', 'apps\web\dist\index.html', 'scripts\update.ps1', 'scripts\lib.ps1')) {
  if (-not (Test-Path (Join-Path $new $must))) { throw "the zip is incomplete: $must is missing" }
}

# ---- 4. stop, back up, replace ------------------------------------------------------------------------------------
$port = Get-ServerPort $Root
$wasRunning = [bool](Get-CrimHealth $port)
if ($wasRunning) { Log "Stopping the server (port $port) ..."; Stop-CrimServer $Root $port | Out-Null }

$dirs = @('apps\server\dist', 'apps\web\dist', 'scripts', 'docs')
$replaceRuntime = (Test-Path (Join-Path $new 'runtime\node.exe')) -and ($newInfo.node -ne $cur.node -or -not (Test-Path (Join-Path $Root 'runtime\node.exe')))
if ($replaceRuntime) { $dirs += 'runtime' }
$bridgeDir = 'apps\simconnect-bridge\bin'
$rootFiles = @('version.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'THIRD-PARTY.txt', 'install.cmd', 'start.cmd', 'update.cmd', 'uninstall.cmd')

function Sync-Dir([string]$from, [string]$to, [switch]$Purge, [string[]]$ExcludeFiles = @()) {
  if (-not (Test-Path $from)) { return }
  $a = @($from, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:3', '/W:1')
  if ($Purge) { $a += '/PURGE' }
  if ($ExcludeFiles.Count) { $a += '/XF'; $a += $ExcludeFiles }
  & robocopy.exe @a | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $from -> $to" }
}
function Copy-Layout([string]$srcRoot, [string]$dstRoot, [string[]]$dirList) {
  foreach ($d in $dirList) { Sync-Dir (Join-Path $srcRoot $d) (Join-Path $dstRoot $d) -Purge }
  Sync-Dir (Join-Path $srcRoot $bridgeDir) (Join-Path $dstRoot $bridgeDir) -ExcludeFiles @('*.dll')   # never touch the SDK DLLs
  foreach ($f in $rootFiles) { if (Test-Path (Join-Path $srcRoot $f)) { Copy-Item (Join-Path $srcRoot $f) (Join-Path $dstRoot $f) -Force } }
}

$backup = Join-Path $dataDir "updates\backup-$($cur.version)"
Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Layout $Root $backup $dirs
Log "Previous version saved in $backup"

function Start-Server {
  $node = Find-Node $Root
  if (-not $node) { throw 'Node.js not found' }
  $a = @('apps/server/dist/server.mjs')
  if ($env:CRIM_DATA_DIR) { $a += @('--data-dir', "`"$env:CRIM_DATA_DIR`"") }
  Start-CrimServerDetached $Root $node $a $logDir
}
function Wait-ForVersion([string]$v, [int]$Seconds = 30) {
  # wall-clock deadline: a probe of a closed port can itself take a couple of seconds on Windows
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $h = Get-CrimHealth $port
    if ($h -and $h.version -eq $v) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

try {
  Log "Installing v$latest ..."
  Copy-Layout $new $Root $dirs
  & (Join-Path $Root 'scripts\install.ps1') -Update -Yes | Out-Null   # unblock + SimConnect DLL check
  if ($wasRunning -or $Restart) {
    Log 'Starting the server ...'
    Start-Server
    if (-not (Wait-ForVersion $latest)) { throw "the new version did not start (see $logDir\server.err.log)" }
  }
  Log "Updated v$($cur.version) -> v$latest."
} catch {
  Log "UPDATE FAILED: $($_.Exception.Message) - restoring v$($cur.version)"
  Stop-CrimServer $Root $port | Out-Null
  $restoreDirs = $dirs
  Copy-Layout $backup $Root $restoreDirs
  if ($wasRunning -or $Restart) { try { Start-Server; Wait-ForVersion $cur.version | Out-Null } catch { } }
  Log 'Previous version restored.'
  exit 1
}

# keep the two newest backups, drop the downloaded files
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $dataDir 'updates') -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
exit 0
