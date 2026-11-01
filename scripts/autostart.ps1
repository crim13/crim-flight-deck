<#
  CRIM Flight Deck - start automatically with Microsoft Flight Simulator 2024.

    scripts\autostart.ps1 -Status              show what is installed
    scripts\autostart.ps1 -Install             add an entry to MSFS's EXE.xml (MSFS starts the server together with the sim)
    scripts\autostart.ps1 -Uninstall           remove that entry again (nothing else in EXE.xml is touched)
    scripts\autostart.ps1 -Install -Method Task    alternative: a logon task that waits for the simulator (works for any install type)

  EXE.xml is MSFS's own list of programs to launch with the simulator (other add-ons use it too). The file is backed up
  before every change, the new file is validated before it replaces the old one, and existing entries are kept.
  -DryRun shows what would change without touching anything. Nothing here needs administrator rights, except that
  Windows sometimes insists on it for -Method Task.
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [ValidateSet('ExeXml', 'Task')][string]$Method = 'ExeXml',
  # explicit EXE.xml (default: the one(s) MSFS 2024 uses on this PC)
  [string]$ExeXmlPath = '',
  [string]$TaskName = 'CRIM Flight Deck',
  # leave the server running after the simulator exits
  [switch]$KeepRunning,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'run-with-sim.ps1'
$addonName = 'CRIM Flight Deck'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

if (-not ($Install -or $Uninstall -or $Status)) { $Status = $true }

function Get-ExeXmlCandidates {
  if ($ExeXmlPath) { return @($ExeXmlPath) }
  $c = @(
    (Join-Path $env:APPDATA 'Microsoft Flight Simulator 2024\EXE.xml'),                                  # Steam / standalone
    (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\EXE.xml')       # Microsoft Store / Game Pass
  )
  # only files that exist, or whose folder exists (MSFS created it, EXE.xml just was never needed)
  return @($c | Where-Object { (Test-Path $_) -or (Test-Path (Split-Path $_)) })
}

function Get-LauncherArgs {
  $a = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcher
  if ($KeepRunning) { $a += ' -KeepRunning' }
  return $a
}

function Load-Xml($path) {
  $doc = New-Object System.Xml.XmlDocument
  $doc.Load($path)
  return $doc
}

function Find-OurEntry($doc) {
  foreach ($n in $doc.DocumentElement.SelectNodes('Launch.Addon')) {
    if ($n.SelectSingleNode('Name') -and $n.SelectSingleNode('Name').InnerText -eq $addonName) { return $n }
  }
  return $null
}

function Add-Child($doc, $parent, $name, $text) {
  $e = $doc.CreateElement($name)
  $e.InnerText = $text
  [void]$parent.AppendChild($e)
}

function Save-Validated($doc, $path) {
  $tmp = "$path.crim-tmp"
  $doc.Save($tmp)
  try { [void](Load-Xml $tmp) } catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; throw "refusing to write an invalid EXE.xml: $($_.Exception.Message)" }
  Move-Item -Path $tmp -Destination $path -Force
}

function Backup-File($path) {
  $b = "$path.crim-backup"
  if (Test-Path $b) { $b = '{0}.crim-backup-{1:yyyyMMdd-HHmmss}' -f $path, (Get-Date) }
  Copy-Item -Path $path -Destination $b
  return $b
}

function Install-ExeXml($path) {
  $created = $false
  if (Test-Path $path) {
    $doc = Load-Xml $path
    if ($doc.DocumentElement.Name -ne 'SimBase.Document') { throw "$path is not a MSFS launch file (root element '$($doc.DocumentElement.Name)')" }
  } else {
    $created = $true
    $doc = New-Object System.Xml.XmlDocument
    $doc.LoadXml('<?xml version="1.0" encoding="windows-1252"?><SimBase.Document Type="Launch" version="1,0"><Descr>Launch</Descr><Filename>EXE.xml</Filename><Disabled>False</Disabled><Launch.ManualLoad>False</Launch.ManualLoad></SimBase.Document>')
  }
  $old = Find-OurEntry $doc
  if ($old) { [void]$doc.DocumentElement.RemoveChild($old) }
  $entry = $doc.CreateElement('Launch.Addon')
  Add-Child $doc $entry 'Disabled' 'False'
  Add-Child $doc $entry 'ManualLoad' 'False'
  Add-Child $doc $entry 'Name' $addonName
  Add-Child $doc $entry 'Path' $psExe
  Add-Child $doc $entry 'CommandLine' (Get-LauncherArgs)
  Add-Child $doc $entry 'NewConsole' 'False'
  [void]$doc.DocumentElement.AppendChild($entry)

  $others = @($doc.DocumentElement.SelectNodes('Launch.Addon') | Where-Object { $_ -ne $entry }).Count
  if ($DryRun) {
    Say "[dry run] would $(if ($old) { 'update' } else { 'add' }) the '$addonName' entry in $path (keeping $others other add-on entr$(if ($others -eq 1) { 'y' } else { 'ies' }))" Yellow
    return
  }
  if (-not $created) { Say "  backup: $(Backup-File $path)" }
  Save-Validated $doc $path
  Say "  OK: '$addonName' $(if ($old) { 'updated' } else { 'added' }) in $path (other add-ons kept: $others)" Green
}

function Uninstall-ExeXml($path) {
  if (-not (Test-Path $path)) { Say "  $path does not exist - nothing to remove" Gray; return }
  $doc = Load-Xml $path
  $old = Find-OurEntry $doc
  if (-not $old) { Say "  no '$addonName' entry in $path" Gray; return }
  [void]$doc.DocumentElement.RemoveChild($old)
  if ($DryRun) { Say "[dry run] would remove the '$addonName' entry from $path" Yellow; return }
  Say "  backup: $(Backup-File $path)"
  Save-Validated $doc $path
  Say "  OK: '$addonName' removed from $path" Green
}

function Show-Status {
  Say "CRIM Flight Deck - autostart status`n" Cyan
  $found = Get-ExeXmlCandidates
  if (-not $found) { Say 'EXE.xml: no MSFS 2024 folder found (is the simulator installed for this user?)' Yellow }
  foreach ($p in $found) {
    if (-not (Test-Path $p)) { Say "EXE.xml: $p (does not exist yet)"; continue }
    try {
      $doc = Load-Xml $p
      $e = Find-OurEntry $doc
      $n = @($doc.DocumentElement.SelectNodes('Launch.Addon')).Count
      Say ("EXE.xml: {0}`n         {1}; {2} add-on entr{3} in total" -f $p, $(if ($e) { 'CRIM Flight Deck: INSTALLED' } else { 'CRIM Flight Deck: not installed' }), $n, $(if ($n -eq 1) { 'y' } else { 'ies' })) $(if ($e) { 'Green' } else { 'Gray' })
    } catch { Say "EXE.xml: $p is NOT valid XML ($($_.Exception.Message)) - MSFS cannot start any add-on from it" Red }
  }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Say ("Logon task '{0}': {1}" -f $TaskName, $(if ($t) { "INSTALLED ($($t.State))" } else { 'not installed' })) $(if ($t) { 'Green' } else { 'Gray' })
  $sim = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue
  Say ("Simulator: {0}" -f $(if ($sim) { 'running (an EXE.xml change applies at its next start)' } else { 'not running' }))
  $log = Join-Path $root 'data\logs\autostart.log'
  if (Test-Path $log) { Say "`nLast launcher log lines ($log):"; Get-Content $log -Tail 6 | ForEach-Object { Say "  $_" } }
}

function Install-Task {
  $action = New-ScheduledTaskAction -Execute $psExe -Argument ((Get-LauncherArgs) + ' -WaitForSim')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if ($DryRun) { Say "[dry run] would register logon task '$TaskName': $psExe $($action.Arguments)" Yellow; return }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force `
    -Description 'Starts CRIM Flight Deck while Microsoft Flight Simulator 2024 is running.' | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Say "  OK: logon task '$TaskName' registered and started (it waits for the simulator)." Green
}

function Uninstall-Task {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Say "  no logon task '$TaskName'" Gray; return }
  if ($DryRun) { Say "[dry run] would remove logon task '$TaskName'" Yellow; return }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Say "  OK: logon task '$TaskName' removed" Green
}

if (-not (Test-Path $launcher)) { throw "launcher not found: $launcher" }

if ($Status) { Show-Status; if (-not ($Install -or $Uninstall)) { return } }

if ($Install) {
  if ($Method -eq 'Task') { Install-Task }
  else {
    $targets = Get-ExeXmlCandidates
    if (-not $targets) { throw 'No MSFS 2024 folder found. Pass the file explicitly: -ExeXmlPath "C:\...\EXE.xml"' }
    foreach ($t in $targets) { Install-ExeXml $t }
    if (-not $DryRun) { Say "`nRestart MSFS: the server now starts hidden with the simulator and stops when you quit it (log: data\logs)." Cyan }
  }
}
if ($Uninstall) {
  if ($Method -eq 'Task') { Uninstall-Task }
  else { foreach ($t in (Get-ExeXmlCandidates)) { Uninstall-ExeXml $t } }
}
