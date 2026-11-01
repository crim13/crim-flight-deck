# CRIM Flight Deck - helpers shared by install.ps1, update.ps1, uninstall.ps1, start.ps1 and run-with-sim.ps1.
# Dot-source it:  . (Join-Path $PSScriptRoot 'lib.ps1')      (ASCII only: Windows PowerShell 5.1 reads scripts as ANSI)

function Test-ReleaseLayout([string]$Root) { return (Test-Path (Join-Path $Root 'version.json')) }

function Get-ReleaseInfo([string]$Root) {
  $f = Join-Path $Root 'version.json'
  if (-not (Test-Path $f)) { return $null }
  return Get-Content $f -Raw | ConvertFrom-Json
}

# runtime\node.exe (shipped in releases) first, then whatever Node 20+ is on the PATH
function Find-Node([string]$Root) {
  $bundled = Join-Path $Root 'runtime\node.exe'
  if (Test-Path $bundled) { return $bundled }
  $n = Get-Command node -ErrorAction SilentlyContinue
  if ($n) { return $n.Source }
  foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Get-NodeMajor([string]$NodeExe) {
  try { return [int]((& $NodeExe -v).TrimStart('v').Split('.')[0]) } catch { return 0 }
}

# folder of the MSFS 2024 SDK (the one that contains "SimConnect SDK"), or $null
function Find-MsfsSdk([string]$Hint = '') {
  $cands = @($Hint, $env:MSFS2024_SDK, $env:MSFS_2024_SDK, $env:MSFS_SDK)
  foreach ($d in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    $cands += (Join-Path $d.Root 'MSFS 2024 SDK'); $cands += (Join-Path $d.Root 'MSFS SDK')
  }
  $cands += (Join-Path $env:ProgramFiles 'MSFS 2024 SDK')
  foreach ($c in ($cands | Where-Object { $_ })) {
    if (Test-Path (Join-Path $c 'SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll')) { return $c }
  }
  return $null
}

function Get-DataDir([string]$Root) {
  if ($env:CRIM_DATA_DIR) { return $env:CRIM_DATA_DIR }
  return (Join-Path $Root 'data')
}

function Get-ServerPort([string]$Root, [int]$Override = 0) {
  if ($Override -gt 0) { return $Override }
  try {
    $p = (Get-Content (Join-Path (Get-DataDir $Root) 'server.json') -Raw | ConvertFrom-Json).port
    if ($p) { return [int]$p }
  } catch { }
  return 3000
}

function Get-CrimHealth([int]$Port) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    if ($r.name -eq 'crim-flight-deck') { return $r }
  } catch { }
  return $null
}

# Stops the CRIM server listening on the port: only that process (no process tree, so a caller that is itself a
# child of the server, like the updater started from the admin page, survives), then the bridge started from $Root.
function Stop-CrimServer([string]$Root, [int]$Port) {
  if (-not (Get-CrimHealth $Port)) { return $false }
  $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($id in $pids) { if ($id -ne $PID) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }
  foreach ($b in (Get-Process -Name CrimSimConnectBridge -ErrorAction SilentlyContinue)) {
    try { if ($b.Path -and $b.Path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $b.Id -Force -ErrorAction SilentlyContinue } } catch { }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and (Get-CrimHealth $Port)) { Start-Sleep -Milliseconds 300 }
  return $true
}

# Starts the server hidden and fully detached (no inherited handles, so a caller whose output is piped or captured
# does not wait for the server; the server does not die with the caller). Output goes to <LogDir>\server*.log.
function Start-CrimServerDetached([string]$Root, [string]$NodeExe, [string[]]$ServerArgs, [string]$LogDir) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $cmd = 'cmd.exe /c ""{0}" {1} >"{2}" 2>"{3}""' -f $NodeExe, ($ServerArgs -join ' '), (Join-Path $LogDir 'server.log'), (Join-Path $LogDir 'server.err.log')
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $Root }
  if ($r.ReturnValue -ne 0) { throw "could not start the server (WMI error $($r.ReturnValue))" }
}

# Files downloaded from the internet carry a "from the internet" mark that makes Windows warn about every exe/script.
function Unblock-Tree([string]$Root) {
  try { Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue } catch { }
}

# Copies the two SimConnect DLLs from the user's own MSFS SDK next to the bridge (they are Microsoft's and are not
# shipped with CRIM Flight Deck). Returns a status string: ok | copied | no-sdk
function Install-SimConnectDlls([string]$Root, [string]$SdkHint = '') {
  $bin = Join-Path $Root 'apps\simconnect-bridge\bin'
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  $sdk = Find-MsfsSdk $SdkHint
  $pairs = @(
    @{ Src = 'SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll'; Name = 'Microsoft.FlightSimulator.SimConnect.dll' },
    @{ Src = 'SimConnect SDK\lib\SimConnect.dll'; Name = 'SimConnect.dll' }
  )
  $status = 'ok'
  foreach ($p in $pairs) {
    $dest = Join-Path $bin $p.Name
    if (-not $sdk) { if (-not (Test-Path $dest)) { $status = 'no-sdk' }; continue }
    $src = Join-Path $sdk $p.Src
    if (-not (Test-Path $src)) { if (-not (Test-Path $dest)) { $status = 'no-sdk' }; continue }
    if (-not (Test-Path $dest) -or (Get-FileHash $src).Hash -ne (Get-FileHash $dest).Hash) {
      Copy-Item -Path $src -Destination $dest -Force
      if ($status -eq 'ok') { $status = 'copied' }
    }
  }
  return $status
}

# 1 if a is newer than b, -1 if older, 0 if equal. "v" prefix and "-pre" suffix understood (pre-release < release).
function Compare-Versions([string]$A, [string]$B) {
  $pa = [regex]::Match($A.Trim(), '^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?')
  $pb = [regex]::Match($B.Trim(), '^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?')
  if (-not $pa.Success -or -not $pb.Success) { return 0 }
  for ($i = 1; $i -le 3; $i++) {
    $x = [int]$pa.Groups[$i].Value; $y = [int]$pb.Groups[$i].Value
    if ($x -ne $y) { if ($x -lt $y) { return -1 } else { return 1 } }
  }
  $sa = $pa.Groups[4].Value; $sb = $pb.Groups[4].Value
  if ($sa -eq $sb) { return 0 }
  if (-not $sa) { return 1 }
  if (-not $sb) { return -1 }
  if ([string]::CompareOrdinal($sa, $sb) -lt 0) { return -1 }
  return 1
}
