<#
  Allows inbound connections to the Flight Deck port from the LOCAL SUBNET only, on private networks.
  Run once from an elevated (Administrator) PowerShell:   scripts\allow-firewall.ps1 [-Port 3000]
#>
[CmdletBinding()]
param([int]$Port = 3000)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Please run this script as Administrator (right-click PowerShell > Run as administrator).' -ForegroundColor Red
  exit 1
}
Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'CRIM Flight Deck' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host "Firewall rule 'CRIM Flight Deck' added: TCP $Port, private networks, local subnet only." -ForegroundColor Green
Write-Host "If your Wi-Fi is classified as 'Public', set it to Private (Settings > Network > Wi-Fi > properties) or the rule will not apply."
