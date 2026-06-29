#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Configure IIS for Quick Project Manday Tracking on a Windows + IIS server.
  Creates app pools + sites for the Backend (.NET) and Frontend (React static),
  enables the ARR proxy, stops the Default Web Site that holds port 80, opens the
  firewall, and runs a basic health check.

  Idempotent: re-running removes and recreates the sites/app pools.

  NOTE: ASCII-only on purpose. Windows PowerShell 5.1 reads .ps1 files using the
  system ANSI codepage, so non-ASCII (e.g. Thai) comments/strings would be corrupted
  and break parsing. Keep this file ASCII-only.

.PREREQUISITES (do these first - see DEPLOY.md step 1)
  - Install IIS + URL Rewrite + ARR + .NET 10 Hosting Bundle
  - Extract artifacts: QtmApi.zip -> C:\inetpub\QtmApi, QtmWeb.zip -> C:\inetpub\QtmWeb
  - Edit C:\inetpub\QtmApi\appsettings.Production.json with real values (DB/JWT/admin)

.EXAMPLE
  # Open PowerShell as Administrator, then:
  .\setup-iis.ps1
  # or override paths/ports:
  .\setup-iis.ps1 -ApiPath D:\sites\QtmApi -WebPath D:\sites\QtmWeb -WebPort 8080
#>

param(
  [string]$ApiPath = 'C:\inetpub\QtmApi',
  [string]$WebPath = 'C:\inetpub\QtmWeb',
  [int]   $ApiPort = 3007,
  [int]   $WebPort = 80,
  [string]$ApiSite = 'QtmApi',
  [string]$WebSite = 'QtmWeb'
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Info($m) { Write-Host "[ ] $m"  -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"  -ForegroundColor Yellow }

# ---- 0) Validate physical paths ----
foreach ($p in @($ApiPath, $WebPath)) {
  if (-not (Test-Path $p)) { throw "Folder not found: '$p' - extract the artifact here first (see DEPLOY.md step 4)" }
}
if (-not (Test-Path (Join-Path $ApiPath 'Qtm.Api.dll'))) { throw "Qtm.Api.dll not found in '$ApiPath' - backend artifact incomplete" }
if (-not (Test-Path (Join-Path $WebPath 'index.html'))) { throw "index.html not found in '$WebPath' - frontend artifact incomplete" }
Ok "Artifacts found (backend + frontend)"

# ---- 1) Warn if appsettings.Production.json still has placeholders ----
$prodCfg = Join-Path $ApiPath 'appsettings.Production.json'
if (-not (Test-Path $prodCfg)) {
  Warn "appsettings.Production.json not found - create it with DB connection / JWT key / admin password"
} elseif ((Get-Content $prodCfg -Raw) -match 'CHANGE_ME|CHANGE_THIS') {
  Warn "appsettings.Production.json still contains CHANGE_ME - set real values before going live (login fails if DB is unreachable)"
} else {
  Ok "appsettings.Production.json has been customized"
}

# ---- 2) Enable ARR proxy (required for the /api reverse-proxy in the frontend web.config) ----
try {
  Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
  $proxy = (Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled').Value
  if ($proxy) { Ok 'ARR proxy enabled' } else { Warn 'Could not enable ARR proxy' }
} catch {
  Warn "Failed to enable ARR proxy - is URL Rewrite + ARR installed? ($($_.Exception.Message))"
}

# ---- 3) Stop the Default Web Site that holds port $WebPort ----
$defSite = Get-Website -Name 'Default Web Site' -ErrorAction SilentlyContinue
if ($defSite -and $defSite.State -ne 'Stopped') {
  Stop-Website -Name 'Default Web Site'
  Ok 'Stopped Default Web Site (frees port 80)'
}

# ---- helper: create app pool (No Managed Code) + site, idempotently ----
function New-QtmSite {
  param([string]$Name, [string]$Path, [int]$Port)

  if (Get-Website -Name $Name -ErrorAction SilentlyContinue) {
    Remove-Website -Name $Name; Info "Removed existing site '$Name'"
  }
  if (Test-Path "IIS:\AppPools\$Name") {
    Remove-WebAppPool -Name $Name; Info "Removed existing app pool '$Name'"
  }

  New-WebAppPool -Name $Name | Out-Null
  # .NET Core / .NET 5+ runs out-of-process via the ASP.NET Core Module => No Managed Code
  Set-ItemProperty "IIS:\AppPools\$Name" -Name managedRuntimeVersion -Value ''
  Set-ItemProperty "IIS:\AppPools\$Name" -Name startMode -Value 'AlwaysRunning'

  New-Website -Name $Name -PhysicalPath $Path -Port $Port -ApplicationPool $Name | Out-Null
  Ok "Created site '$Name' -> $Path  (port $Port, app pool No Managed Code)"
}

# ---- 4) Create Backend + Frontend sites ----
New-QtmSite -Name $ApiSite -Path $ApiPath -Port $ApiPort
New-QtmSite -Name $WebSite -Path $WebPath -Port $WebPort

# ---- 5) Open firewall for the frontend port (users connect here) ----
$ruleName = "QtmWeb HTTP $WebPort"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $WebPort -Action Allow | Out-Null
  Ok "Opened inbound firewall TCP $WebPort"
} else {
  Info "Firewall rule '$ruleName' already exists"
}

# ---- 6) Start sites + verify ----
Start-Website -Name $ApiSite -ErrorAction SilentlyContinue
Start-Website -Name $WebSite -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host ""
Info "Testing backend /health (ASP.NET Core may take a few seconds to start)..."
try {
  $r = Invoke-WebRequest "http://localhost:$ApiPort/health" -UseBasicParsing -TimeoutSec 20
  if ($r.StatusCode -eq 200) { Ok "backend /health responded: $($r.Content)" }
} catch {
  Warn "Could not reach /health - check $ApiPath\logs\ or verify .NET Hosting Bundle / connection string ($($_.Exception.Message))"
}

Write-Host ""
Ok "Done. Open:  http://<server-name-or-IP>/  (frontend port $WebPort)"
Write-Host "   - Backend (local): http://localhost:$ApiPort/health , /swagger"
Write-Host "   - If /api returns 404: confirm ARR proxy is enabled (step 2 above)"
