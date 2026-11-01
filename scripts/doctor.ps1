<# Prints what is installed / missing for running CRIM Flight Deck against the real simulator. #>
$root = Split-Path -Parent $PSScriptRoot
function Row($name, $ok, $detail) {
  if ($ok -eq $true -and $detail -match '^(run:|install|optional|not installed|missing)') { $detail = '' }
  $mark = if ($ok -eq $true) { '[ OK ]' } elseif ($ok -eq $false) { '[FAIL]' } else { '[ -- ]' }
  $color = if ($ok -eq $true) { 'Green' } elseif ($ok -eq $false) { 'Red' } else { 'Yellow' }
  Write-Host ("{0} {1,-26} {2}" -f $mark, $name, $detail) -ForegroundColor $color
}

. (Join-Path $PSScriptRoot 'lib.ps1')
$release = Test-ReleaseLayout $root
$info = Get-ReleaseInfo $root
Write-Host "`nCRIM Flight Deck - environment check$(if ($info) { '  (release v' + $info.version + ')' } else { '  (development checkout)' })`n"
$nodeExe = Find-Node $root
$major = if ($nodeExe) { Get-NodeMajor $nodeExe } else { 0 }
Row 'Node.js 20+' ($major -ge 20) $(if ($nodeExe) { "v$major  ($nodeExe)" } else { 'not installed (https://nodejs.org/)' })
if (-not $release) {
  Row 'npm dependencies' (Test-Path (Join-Path $root 'node_modules\ws')) 'run: npm install'
  Row 'web UI built' (Test-Path (Join-Path $root 'apps\web\dist\index.html')) 'run: npm run build'
  Row 'server built' (Test-Path (Join-Path $root 'apps\server\dist\server.mjs')) 'run: npm run build'
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  $sdkList = if ($dotnet) { & dotnet --list-sdks } else { $null }
  Row '.NET SDK (build bridge)' ([bool]$sdkList) $(if ($sdkList) { ($sdkList | Select-Object -First 1) } else { 'winget install Microsoft.DotNet.SDK.8' })
}

$sdk = Find-MsfsSdk
Row 'MSFS 2024 SDK' ([bool]$sdk) $(if ($sdk) { $sdk } else { 'install via MSFS Developer Mode > Help > SDK Installer' })
$bin = Join-Path $root 'apps\simconnect-bridge\bin'
Row 'SimConnect bridge' (Test-Path (Join-Path $bin 'CrimSimConnectBridge.exe')) $(if ($release) { 'missing: the release zip is incomplete' } else { 'run: scripts\build-bridge.ps1' })
Row 'SimConnect DLLs' ((Test-Path (Join-Path $bin 'SimConnect.dll')) -and (Test-Path (Join-Path $bin 'Microsoft.FlightSimulator.SimConnect.dll'))) 'run: install.cmd (copies them from the MSFS SDK)'

$msfs = Get-Process -Name 'FlightSimulator2024' -ErrorAction SilentlyContinue
Row 'MSFS 2024 running' $(if ($msfs) { $true } else { $null }) $(if ($msfs) { "pid $($msfs.Id)" } else { 'not running (start it to connect)' })

$fw = $null
try { $fw = Get-NetFirewallRule -DisplayName 'CRIM Flight Deck' -ErrorAction SilentlyContinue } catch { }
Row 'firewall rule' $(if ($fw) { $true } else { $null }) $(if ($fw) { 'present' } else { 'optional: scripts\allow-firewall.ps1 (admin) if devices cannot connect' })

Write-Host "`nLAN addresses:"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' } |
  ForEach-Object { Write-Host ("  {0,-30} {1}" -f $_.InterfaceAlias, $_.IPAddress) }
Write-Host ''

