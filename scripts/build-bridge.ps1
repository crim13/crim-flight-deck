<#
  Builds the SimConnect bridge (.NET Framework 4.8, x64) against the official MSFS 2024 SDK.

  Requirements
    1. .NET SDK 8+     (winget install Microsoft.DotNet.SDK.8)
    2. MSFS 2024 SDK   (MSFS: Options > General > Developers > enable Developer Mode, then Help > SDK Installer;
                        installs to e.g. C:\MSFS 2024 SDK and normally sets the MSFS2024_SDK environment variable)

  The SDK is looked up in: -SdkPath, $env:MSFS2024_SDK, $env:MSFS_2024_SDK, $env:MSFS_SDK and a few default folders.
  -ManagedDll / -NativeDll override the individual files (e.g. for a custom SDK layout).
#>
[CmdletBinding()]
param(
  [string]$SdkPath = '',
  [string]$ManagedDll = '',
  [string]$NativeDll = '',
  [switch]$NoCopy,
  # build somewhere else than apps\simconnect-bridge\bin (the release script does: bin may be in use by a running server)
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root 'apps\simconnect-bridge\CrimSimConnectBridge.csproj'
$out = if ($OutDir) { $OutDir } else { Join-Path $root 'apps\simconnect-bridge\bin' }

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) { throw 'dotnet was not found. Install the .NET SDK:  winget install Microsoft.DotNet.SDK.8' }
$sdks = & dotnet --list-sdks
if (-not $sdks) { throw 'Only .NET runtimes are installed, no .NET SDK. Install it:  winget install Microsoft.DotNet.SDK.8' }

function Find-Sdk {
  $cands = @($SdkPath, $env:MSFS2024_SDK, $env:MSFS_2024_SDK, $env:MSFS_SDK,
    'C:\MSFS 2024 SDK', 'D:\MSFS 2024 SDK', (Join-Path $env:ProgramFiles 'MSFS 2024 SDK'), 'C:\MSFS SDK', 'D:\MSFS SDK') | Where-Object { $_ }
  foreach ($c in $cands) {
    if (Test-Path (Join-Path $c 'SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll')) { return $c }
  }
  return $null
}

if (-not $ManagedDll) {
  $sdk = Find-Sdk
  if (-not $sdk) {
    throw @'
MSFS 2024 SDK not found. Install it from inside MSFS 2024 (Developer Mode > Help > SDK Installer), or pass
-SdkPath "C:\MSFS 2024 SDK". Expected file:
  <SDK>\SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll
'@
  }
  $ManagedDll = Join-Path $sdk 'SimConnect SDK\lib\managed\Microsoft.FlightSimulator.SimConnect.dll'
  if (-not $NativeDll) { $NativeDll = Join-Path $sdk 'SimConnect SDK\lib\SimConnect.dll' }
}
if (-not (Test-Path $ManagedDll)) { throw "Managed wrapper not found: $ManagedDll" }
if (-not $NoCopy -and (-not $NativeDll -or -not (Test-Path $NativeDll))) { throw "Native SimConnect.dll not found: $NativeDll" }

Write-Host "[crim] managed wrapper : $ManagedDll"
if (-not $NoCopy) { Write-Host "[crim] native SimConnect: $NativeDll" }

$copy = if ($NoCopy) { 'false' } else { 'true' }
& dotnet build $proj -c Release -o $out "-p:SimConnectManagedDll=$ManagedDll" "-p:SimConnectNativeDll=$NativeDll" "-p:CopySimConnect=$copy" --nologo -v minimal
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' }
if (-not (Test-Path (Join-Path $out 'CrimSimConnectBridge.exe'))) { throw 'build finished but CrimSimConnectBridge.exe is missing' }
Write-Host "[crim] bridge built: $out\CrimSimConnectBridge.exe" -ForegroundColor Green
