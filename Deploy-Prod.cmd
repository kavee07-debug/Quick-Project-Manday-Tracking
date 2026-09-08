@echo off
REM ============================================================
REM  Double-click this on the App server to deploy QtmApi-deploy.zip.
REM  It asks for Administrator, then runs deploy-to-prod.ps1 next to it.
REM  Keep both files in the same folder.
REM  (ASCII only on purpose - a .cmd console reads the OEM codepage,
REM   so Thai text here would come out as garbage. The .ps1 prints Thai.)
REM ============================================================
setlocal
cd /d "%~dp0"

REM -- already elevated? "net session" only succeeds as Administrator --
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

if not exist "%~dp0deploy-to-prod.ps1" (
    echo.
    echo [ERROR] deploy-to-prod.ps1 not found next to this file.
    echo         Keep Deploy-Prod.cmd and deploy-to-prod.ps1 in the same folder.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-to-prod.ps1" %*
set RC=%errorlevel%

echo.
if %RC% neq 0 (
    echo === FINISHED WITH ERRORS ^(exit %RC%^) ===
) else (
    echo === DONE ===
)
pause
exit /b %RC%
