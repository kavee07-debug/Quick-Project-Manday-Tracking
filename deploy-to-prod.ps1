<#
.SYNOPSIS
    Deploys QtmApi-deploy.zip onto the on-prem IIS server.

.DESCRIPTION
    Stops the app pool, extracts the zip to a staging folder, copies it over
    production keeping the server's own config, starts the pool again and checks
    /health. The live appsettings.Production.json and web.config are never
    overwritten — that is where the DB connection, JWT key and admin password live.

    Double-click Deploy-Prod.cmd instead of running this directly; it asks for
    Administrator and then calls this script.

.PARAMETER Zip
    The uploaded artifact.

.PARAMETER SkipBackup
    Skip the timestamped copy of production taken before overwriting it.

.NOTES
    Any db\migrate-YYYY-MM-DD-HHmm.sql for this release must be run separately
    (sqlcmd) — this script only replaces the application files.
#>
[CmdletBinding()]
param(
    [string]$Zip      = 'C:\QuickProjectMandayTracking\QtmApi-deploy.zip',
    [string]$Stage    = 'C:\temp\QtmApi-stage',
    [string]$Prod     = 'C:\inetpub\QtmApi',
    [string]$AppPool  = 'QtmApi',
    [string]$HealthUrl = 'http://localhost/health',
    [string]$BackupRoot = 'C:\temp\QtmApi-backup',
    [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'
# robocopy signals success with exit codes 1-7, which PowerShell 7.4+ would otherwise turn into a
# terminating error under ErrorActionPreference = Stop. Harmless no-op on Windows PowerShell 5.1.
$PSNativeCommandUseErrorActionPreference = $false

function Write-Step { param($n, $text) Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Write-Ok   { param($text) Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn { param($text) Write-Host "    !   $text" -ForegroundColor Yellow }

Write-Host '=======================================================' -ForegroundColor White
Write-Host ' Deploy Quick Project Manday Tracking -> Production' -ForegroundColor White
Write-Host '=======================================================' -ForegroundColor White
Write-Host "  zip       : $Zip"
Write-Host "  staging   : $Stage"
Write-Host "  production: $Prod"
Write-Host "  app pool  : $AppPool"

try {
    Import-Module WebAdministration -ErrorAction Stop
} catch {
    throw "โหลดโมดูล WebAdministration ไม่ได้ — ต้องรันด้วยสิทธิ Administrator บนเครื่องที่ติดตั้ง IIS " +
          "(ดับเบิลคลิก Deploy-Prod.cmd จะขอสิทธิให้เอง). รายละเอียด: $($_.Exception.Message)"
}

# ---- pre-flight: fail before touching anything that is serving traffic ----
Write-Step 0 'ตรวจความพร้อมก่อนเริ่ม'
if (-not (Test-Path $Zip)) { throw "ไม่พบไฟล์ zip: $Zip  (อัปโหลด QtmApi-deploy.zip มาวางก่อน)" }
if (-not (Test-Path $Prod)) { throw "ไม่พบโฟลเดอร์ production: $Prod" }
if (-not (Test-Path "IIS:\AppPools\$AppPool")) { throw "ไม่พบ IIS App Pool ชื่อ '$AppPool'" }
$zipInfo = Get-Item $Zip
Write-Ok ("zip {0:N2} MB  แก้ไขล่าสุด {1}" -f ($zipInfo.Length / 1MB), $zipInfo.LastWriteTime)

# ---- 1) stop the pool so Qtm.Api.dll is not locked ----
Write-Step 1 "หยุด App Pool '$AppPool'"
if ((Get-WebAppPoolState -Name $AppPool).Value -eq 'Stopped') {
    Write-Warn 'หยุดอยู่แล้ว'
} else {
    Stop-WebAppPool -Name $AppPool
    for ($i = 0; $i -lt 20 -and (Get-WebAppPoolState -Name $AppPool).Value -ne 'Stopped'; $i++) { Start-Sleep -Milliseconds 500 }
    Write-Ok ((Get-WebAppPoolState -Name $AppPool).Value)
}

# From here on the site is down, so always try to start it again — even on failure.
try {
    # ---- 2) back up the current production files ----
    if ($SkipBackup) {
        Write-Step 2 'ข้ามการสำรอง (-SkipBackup)'
    } else {
        $backup = Join-Path $BackupRoot (Get-Date -Format 'yyyy-MM-dd-HHmm')
        Write-Step 2 "สำรอง production ไปที่ $backup"
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        robocopy $Prod $backup /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "สำรองไฟล์ไม่สำเร็จ (robocopy exit $LASTEXITCODE)" }
        Write-Ok 'สำรองเรียบร้อย (ถ้า deploy แล้วมีปัญหา ใช้โฟลเดอร์นี้ย้อนกลับได้)'
    }

    # ---- 3) extract the zip into a clean staging folder ----
    Write-Step 3 "แตก zip ลง $Stage"
    if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Stage | Out-Null
    Expand-Archive -Path $Zip -DestinationPath $Stage -Force
    if (-not (Test-Path (Join-Path $Stage 'Qtm.Api.dll'))) {
        throw "ไฟล์ zip ไม่ถูกต้อง — ไม่พบ Qtm.Api.dll ใน $Stage"
    }
    Write-Ok ("{0} ไฟล์" -f (Get-ChildItem $Stage -Recurse -File).Count)

    # ---- 4) copy over production, keeping the server's own config ----
    Write-Step 4 'ก๊อปทับ production (ยกเว้น appsettings.Production.json / web.config)'
    robocopy $Stage $Prod /E /XF appsettings.Production.json web.config /NFL /NDL /NJH /NJS /NP | Out-Null
    # robocopy: 0-7 = success (1 = files copied), 8+ = real failure
    if ($LASTEXITCODE -ge 8) { throw "ก๊อปไฟล์ไม่สำเร็จ (robocopy exit $LASTEXITCODE)" }
    Write-Ok "robocopy exit $LASTEXITCODE (0-7 = ปกติ)"
}
finally {
    # ---- 5) bring the site back up whatever happened above ----
    Write-Step 5 "สตาร์ท App Pool '$AppPool'"
    Start-WebAppPool -Name $AppPool -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20 -and (Get-WebAppPoolState -Name $AppPool).Value -ne 'Started'; $i++) { Start-Sleep -Milliseconds 500 }
    Write-Ok ((Get-WebAppPoolState -Name $AppPool).Value)
}

# ---- 6) health check (the app needs a moment to warm up) ----
Write-Step 6 "ตรวจ $HealthUrl"
$healthy = $false
for ($i = 1; $i -le 12; $i++) {
    try {
        $res = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
        Write-Ok ($res | ConvertTo-Json -Compress)
        $healthy = $true
        break
    } catch {
        Start-Sleep -Seconds 3
    }
}

Write-Host ''
if ($healthy) {
    Write-Host '=======================================================' -ForegroundColor Green
    Write-Host ' DEPLOY สำเร็จ' -ForegroundColor Green
    Write-Host '=======================================================' -ForegroundColor Green
    Write-Host ' อย่าลืม: ถ้ารอบนี้มี db\migrate-*.sql ต้องรันด้วย sqlcmd แยกต่างหาก' -ForegroundColor Yellow
    Write-Host ' ผู้ใช้ต้อง login ใหม่ (JWT เดิมใช้ไม่ได้หลัง restart)' -ForegroundColor Yellow
} else {
    Write-Host '=======================================================' -ForegroundColor Red
    Write-Host ' DEPLOY เสร็จ แต่ /health ยังไม่ตอบ' -ForegroundColor Red
    Write-Host '=======================================================' -ForegroundColor Red
    Write-Host ' เช็ก: App Pool = No Managed Code · .NET Hosting Bundle ติดตั้งแล้ว ·' -ForegroundColor Yellow
    Write-Host ' appsettings.Production.json ต่อ DB ได้ · ไม่มี site อื่นแย่งพอร์ต 80' -ForegroundColor Yellow
    Write-Host ' (รายละเอียดใน DEPLOY.md หัวข้อ Troubleshooting)' -ForegroundColor Yellow
    exit 1
}
