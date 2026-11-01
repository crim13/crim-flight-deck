<#
  CRIM Flight Deck - setup. Safe to run again at any time (it only changes what is missing).

    install.cmd                      interactive: asks before each system change
    scripts\install.ps1 -Yes         answer yes to everything (firewall rule asks for administrator rights)

  What it does
    1. unblocks the downloaded files (Windows otherwise warns about every exe and script)
    2. checks the bundled Node.js runtime
    3. copies the two SimConnect DLLs from YOUR installed MSFS 2024 SDK next to the bridge
       (they belong to Microsoft and are therefore not shipped with this app)
    4. optional: firewall rule so the tablet / phone can connect (local network only)
    5. optional: start automatically with MSFS (scripts\autostart.ps1)
    6. optional: Start Menu shortcuts
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$Update,
  [switch]$NoAutostart,
  [switch]$NoFirewall,
  [switch]$NoShortcuts,
  [string]$SdkPath = '',
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Row($ok, $name, $detail) {
  $mark = if ($ok -eq $true) { '[ OK ]' } elseif ($ok -eq $false) { '[FAIL]' } else { '[ -- ]' }
  $color = if ($ok -eq $true) { 'Green' } elseif ($ok -eq $false) { 'Red' } else { 'Yellow' }
  Write-Host ('{0} {1,-30} {2}' -f $mark, $name, $detail) -ForegroundColor $color
}
function Ask([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host "$q [Y/n]"
  return ($a -eq '' -or $a -match '^[yY]')
}

$info = Get-ReleaseInfo $root
Say "`nCRIM Flight Deck - setup$(if ($info) { '  (v' + $info.version + ')' })`n" Cyan

# 1. unblock -------------------------------------------------------------------------------------------------------
Unblock-Tree $root
Row $true 'Files unblocked' ''

# 2. Node ----------------------------------------------------------------------------------------------------------
$node = Find-Node $root
$major = if ($node) { Get-NodeMajor $node } else { 0 }
if ($major -ge 20) { Row $true 'Node.js runtime' ("v$major  ($(if ($node.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { 'bundled' } else { $node }))") }
else { Row $false 'Node.js runtime' 'missing - download the full release zip or install Node 20+ from https://nodejs.org/' }

# 3. SimConnect DLLs -----------------------------------------------------------------------------------------------
$bridge = Join-Path $root 'apps\simconnect-bridge\bin\CrimSimConnectBridge.exe'
if (-not (Test-Path $bridge)) {
  Row $false 'SimConnect bridge' 'CrimSimConnectBridge.exe not found (release zip incomplete? or run scripts\build-bridge.ps1 in a git checkout)'
} else {
  $st = Install-SimConnectDlls $root $SdkPath
  switch ($st) {
    'ok' { Row $true 'SimConnect DLLs' 'present' }
    'copied' { Row $true 'SimConnect DLLs' 'copied from your MSFS 2024 SDK' }
    default {
      Row $false 'SimConnect DLLs' 'MSFS 2024 SDK not found'
      Say '       Install it from inside MSFS 2024: Options > General > Developers > Developer Mode ON, then Help > SDK Installer.' Yellow
      Say '       Then run install.cmd again. Without it the app starts but cannot talk to the simulator.' Yellow
    }
  }
}

if ($Update) { return }   # updates only refresh the files above

# 4. firewall ------------------------------------------------------------------------------------------------------
$port = Get-ServerPort $root $Port
if (-not $NoFirewall) {
  $rule = $null
  try { $rule = Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue } catch { }
  if ($rule) { Row $true 'Firewall rule' 'present' }
  elseif (Ask "Allow tablet / phone access through the Windows firewall (TCP $port, local network only, needs administrator rights)?") {
    try {
      Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'allow-firewall.ps1')`" -Port $port"
      $rule = Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue
      Row ([bool]$rule) 'Firewall rule' $(if ($rule) { "added (TCP $port, private networks, local subnet)" } else { 'not added (administrator prompt declined?)' })
    } catch { Row $false 'Firewall rule' $_.Exception.Message }
  } else { Row $null 'Firewall rule' 'skipped (scripts\allow-firewall.ps1 later, if the tablet cannot connect)' }
}

# 5. autostart -----------------------------------------------------------------------------------------------------
if (-not $NoAutostart) {
  if (Ask 'Start CRIM Flight Deck automatically together with MSFS?') {
    try { & (Join-Path $PSScriptRoot 'autostart.ps1') -Install } catch { Row $false 'Autostart' $_.Exception.Message }
  } else { Row $null 'Autostart' 'skipped (scripts\autostart.ps1 -Install later)' }
}

# 6. shortcuts -----------------------------------------------------------------------------------------------------
if (-not $NoShortcuts) {
  if (Ask 'Create Start Menu shortcuts?') {
    try {
      $dir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CRIM Flight Deck'
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $sh = New-Object -ComObject WScript.Shell
      $mk = {
        param($name, $target, $arguments)
        $l = $sh.CreateShortcut((Join-Path $dir "$name.lnk"))
        $l.TargetPath = $target; $l.Arguments = $arguments; $l.WorkingDirectory = $root
        $l.Save()
      }
      & $mk 'CRIM Flight Deck' (Join-Path $root 'start.cmd') ''
      & $mk 'CRIM Flight Deck - check for updates' (Join-Path $root 'update.cmd') ''
      & $mk 'CRIM Flight Deck - admin page' "$env:SystemRoot\explorer.exe" "http://localhost:$port/admin"
      Row $true 'Start Menu shortcuts' 'created'
    } catch { Row $false 'Start Menu shortcuts' $_.Exception.Message }
  } else { Row $null 'Start Menu shortcuts' 'skipped' }
}

Say "`nDone. Start it with start.cmd (or just start MSFS if autostart is on), then open http://localhost:$port/admin on this PC" Cyan
Say 'and scan the QR code with the tablet / phone.' Cyan
