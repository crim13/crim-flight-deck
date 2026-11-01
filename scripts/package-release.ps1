<#
  CRIM Flight Deck - builds the release zip (maintainer tool, run from a git checkout on a PC with the MSFS SDK).

    scripts\package-release.ps1                          check, build and package the version in package.json
    scripts\package-release.ps1 -Version 1.1.0           bump the version everywhere first
    scripts\package-release.ps1 -Publish [-Draft]        also create the GitHub release (needs `gh auth login`)

  Output (release\):  CRIM-FlightDeck-v<version>-win-x64.zip  and  SHA256SUMS.txt
  The zip contains the built app, the bridge executable and a Node.js runtime, but NOT Microsoft's SimConnect DLLs:
  install.cmd copies those from the user's own MSFS SDK. The bridge is built here (the SDK is needed to compile it),
  which is why releases are made from this PC and not on GitHub's build servers.
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$NodeVersion = '24.16.0',
  # use this node.exe instead of downloading Node (for tests)
  [string]$NodeExe = '',
  [switch]$SkipChecks,
  [switch]$SkipBridge,
  [switch]$Publish,
  [switch]$Draft,
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Step($m) { Write-Host "[release] $m" -ForegroundColor Cyan }

# ---- version ----------------------------------------------------------------------------------------------------------
$pkgFiles = @('package.json', 'shared\package.json', 'apps\server\package.json', 'apps\web\package.json') | ForEach-Object { Join-Path $root $_ }
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($Version) {
  if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') { throw "bad version '$Version' (use 1.2.3 or 1.2.3-beta.1)" }
  foreach ($f in $pkgFiles) {
    $t = Get-Content $f -Raw
    $n = [regex]::Replace($t, '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
    [IO.File]::WriteAllText($f, $n, (New-Object Text.UTF8Encoding($false)))
  }
  $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  Step "version set to $Version"
}
$ver = $pkg.version
$repoUrl = if ($pkg.repository -is [string]) { $pkg.repository } else { $pkg.repository.url }
$slug = ([regex]::Match($repoUrl, 'github\.com[/:]([^/]+/[^/.]+)')).Groups[1].Value
if (-not $slug) { throw 'package.json has no GitHub "repository"' }

# ---- changelog notes (a release without notes is refused) ------------------------------------------------------------
$changelog = Get-Content (Join-Path $root 'CHANGELOG.md') -Raw
$m = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($ver))\][^\r\n]*\r?\n(.*?)(?=^## \[|\z)")
if (-not $m.Success -or -not $m.Groups[1].Value.Trim()) { throw "CHANGELOG.md has no section '## [$ver]' - write the release notes first" }
$notes = $m.Groups[1].Value.Trim()

# ---- checks + build ---------------------------------------------------------------------------------------------------
if ($SkipChecks) { Step 'building (checks skipped)'; npm run build; if ($LASTEXITCODE -ne 0) { throw 'build failed' } }
else { Step 'typecheck, tests, build, smoke test (npm run verify)'; npm run verify; if ($LASTEXITCODE -ne 0) { throw 'verify failed - not releasing' } }

if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# The bridge is built into its own folder (apps\simconnect-bridge\bin may be in use by a running server) and without
# Microsoft's DLLs. -SkipBridge packages the bridge found in bin instead (test packages only).
$bin = Join-Path $OutDir 'bridge-build'
if ($SkipBridge) { $bin = Join-Path $root 'apps\simconnect-bridge\bin' }
else {
  Step 'building the SimConnect bridge'
  Remove-Item -Recurse -Force $bin -ErrorAction SilentlyContinue
  & (Join-Path $PSScriptRoot 'build-bridge.ps1') -NoCopy -OutDir $bin
}
if (-not (Test-Path (Join-Path $bin 'CrimSimConnectBridge.exe'))) { throw 'bridge executable missing (run scripts\build-bridge.ps1 or pass -SkipBridge for a test package)' }

# ---- stage ----------------------------------------------------------------------------------------------------------------
$stageParent = Join-Path $OutDir 'stage'
$stage = Join-Path $stageParent 'CRIM-FlightDeck'
Remove-Item -Recurse -Force $stageParent -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

function Put($rel, $isDir = $false) {
  $src = Join-Path $root $rel
  $dst = Join-Path $stage $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  if ($isDir) { Copy-Item -Path $src -Destination $dst -Recurse -Force } else { Copy-Item -Path $src -Destination $dst -Force }
}
Step 'staging files'
Put 'apps\server\dist\server.mjs'
Put 'apps\web\dist' $true
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'apps\simconnect-bridge\bin') | Out-Null
foreach ($f in @('CrimSimConnectBridge.exe', 'CrimSimConnectBridge.exe.config')) {   # no DLLs, on purpose
  Copy-Item (Join-Path $bin $f) (Join-Path $stage "apps\simconnect-bridge\bin\$f") -Force
}
foreach ($s in (Get-ChildItem (Join-Path $root 'scripts') -File | Where-Object { $_.Name -notin @('build-bridge.ps1', 'smoke-test.mjs', 'package-release.ps1') })) { Put "scripts\$($s.Name)" }
Put 'docs' $true
foreach ($f in @('LICENSE', 'README.md', 'CHANGELOG.md', 'install.cmd', 'start.cmd', 'update.cmd', 'uninstall.cmd')) { Put $f }

# ---- Node.js runtime ----------------------------------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
if ($NodeExe) {
  Copy-Item $NodeExe (Join-Path $stage 'runtime\node.exe')
  $nodeVer = (& $NodeExe -v).TrimStart('v')
} else {
  $nodeVer = $NodeVersion
  $cache = Join-Path $OutDir 'cache'
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  $nz = "node-v$NodeVersion-win-x64.zip"
  $nzPath = Join-Path $cache $nz
  $base = "https://nodejs.org/dist/v$NodeVersion"
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $want = ([regex]::Match($sums, "(?m)^([0-9a-f]{64})\s+$([regex]::Escape($nz))\s*$")).Groups[1].Value
  if (-not $want) { throw "SHASUMS256.txt of Node $NodeVersion has no $nz" }
  if (-not (Test-Path $nzPath) -or (Get-FileHash $nzPath -Algorithm SHA256).Hash.ToLower() -ne $want) {
    Step "downloading $nz"
    Invoke-WebRequest -Uri "$base/$nz" -OutFile $nzPath -UseBasicParsing
  }
  if ((Get-FileHash $nzPath -Algorithm SHA256).Hash.ToLower() -ne $want) { throw "checksum mismatch for $nz" }
  $tmp = Join-Path $cache "node-$NodeVersion"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Expand-Archive -Path $nzPath -DestinationPath $tmp -Force
  $inner = Join-Path $tmp "node-v$NodeVersion-win-x64"
  Copy-Item (Join-Path $inner 'node.exe') (Join-Path $stage 'runtime\node.exe')
  Copy-Item (Join-Path $inner 'LICENSE') (Join-Path $stage 'runtime\LICENSE-node.txt')
}

# ---- version.json + third-party notices ---------------------------------------------------------------------------
$info = [ordered]@{ name = 'CRIM Flight Deck'; version = $ver; repo = $slug; node = $nodeVer; builtAt = (Get-Date).ToUniversalTime().ToString('s') + 'Z' }
[IO.File]::WriteAllText((Join-Path $stage 'version.json'), (($info | ConvertTo-Json) + "`n"), (New-Object Text.UTF8Encoding($false)))

$lines = @('CRIM Flight Deck is licensed under the GNU GPL v3 (see LICENSE). It bundles these third-party components:', '', "Node.js v$nodeVer  (runtime\; see runtime\LICENSE-node.txt)")
$deps = @()
foreach ($p in @('apps\web\package.json', 'apps\server\package.json')) { $deps += (Get-Content (Join-Path $root $p) -Raw | ConvertFrom-Json).dependencies.PSObject.Properties.Name }
foreach ($d in ($deps | Where-Object { $_ -notlike '@crim/*' } | Sort-Object -Unique)) {
  $pj = Join-Path $root "node_modules\$d\package.json"
  if (Test-Path $pj) { $j = Get-Content $pj -Raw | ConvertFrom-Json; $lines += "$($j.name) $($j.version)  ($($j.license))" }
}
$lines += @('', 'Not included: Microsoft''s SimConnect DLLs. install.cmd copies them from your own MSFS 2024 SDK.',
  'CRIM Flight Deck is an independent project, not affiliated with or endorsed by Microsoft or Asobo Studio.')
[IO.File]::WriteAllText((Join-Path $stage 'THIRD-PARTY.txt'), (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))

# ---- zip + checksums -----------------------------------------------------------------------------------------------------
$zipName = "CRIM-FlightDeck-v$ver-win-x64.zip"
$zip = Join-Path $OutDir $zipName
Remove-Item $zip -Force -ErrorAction SilentlyContinue
# entries are written by hand: Windows PowerShell's ZipFile.CreateFromDirectory stores "dir\file" names, which the zip
# specification does not allow (other unzip tools then create files with backslashes in their names)
$fsOut = [IO.File]::Open($zip, [IO.FileMode]::Create)
$za = New-Object IO.Compression.ZipArchive($fsOut, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in (Get-ChildItem -Path $stage -Recurse -File)) {
    $entry = 'CRIM-FlightDeck/' + $f.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $f.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $za.Dispose(); $fsOut.Dispose() }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$sumFile = Join-Path $OutDir 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sumFile, "$hash  $zipName`n", (New-Object Text.UTF8Encoding($false)))
Remove-Item -Recurse -Force $stageParent
Step ('{0}  {1:N1} MB  sha256 {2}' -f $zipName, ((Get-Item $zip).Length / 1MB), $hash)

# ---- publish ----------------------------------------------------------------------------------------------------------------
if ($Publish) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) not found' }
  $dirty = (git status --porcelain) -join ''
  if ($dirty) { throw 'the git working tree has uncommitted changes - commit and push first, the release is made from the pushed commit' }
  $notesFile = Join-Path $OutDir "notes-v$ver.md"
  [IO.File]::WriteAllText($notesFile, $notes + "`n", (New-Object Text.UTF8Encoding($false)))
  $a = @('release', 'create', "v$ver", $zip, $sumFile, '--repo', $slug, '--title', "CRIM Flight Deck v$ver", '--notes-file', $notesFile)
  if ($Draft) { $a += '--draft' }
  if ($ver -match '-') { $a += '--prerelease' }
  Step "creating GitHub release v$ver in $slug"
  & gh @a
  if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
} else {
  Step "not published (add -Publish). Files are in $OutDir"
}
