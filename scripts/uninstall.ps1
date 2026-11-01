<#
  CRIM Flight Deck - removes what install.ps1 added outside this folder: the MSFS autostart entry, the logon task,
  the Start Menu shortcuts and the firewall rule. The app folder and your settings (data\) are NOT deleted:
  delete the folder yourself if you want it gone completely.
#>
[CmdletBinding()]
param([switch]$Yes)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
if (-not $Yes) {
  $a = Read-Host 'Remove the MSFS autostart entry, shortcuts and firewall rule? [Y/n]'
  if ($a -ne '' -and $a -notmatch '^[yY]') { return }
}

Stop-CrimServer $root (Get-ServerPort $root) | Out-Null
try { & (Join-Path $PSScriptRoot 'autostart.ps1') -Uninstall } catch { Say "autostart: $($_.Exception.Message)" Yellow }
try { & (Join-Path $PSScriptRoot 'autostart.ps1') -Uninstall -Method Task } catch { }

$dir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CRIM Flight Deck'
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir; Say 'Start Menu shortcuts removed' Green }

$rule = $null
try { $rule = Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue } catch { }
if ($rule) {
  try {
    Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "Remove-NetFirewallRule -DisplayName ''CRIM Flight Deck''"'
    Say 'Firewall rule removed' Green
  } catch { Say "firewall rule not removed: $($_.Exception.Message)" Yellow }
}
Say "`nDone. Settings are still in $(Get-DataDir $root); delete this folder to remove everything." Cyan
