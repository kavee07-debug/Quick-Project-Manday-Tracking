@echo off
REM Quick Project Manday Tracking - start dev servers (frontend + backend)
REM Opens 2 separate terminal windows: Backend :3007, Frontend :4207

REM Run as Development: keeps Swagger on, layers appsettings.Development.json, and stops the
REM local run from being treated as Production (which now refuses default secrets).
start "QTM Backend (:3007)" cmd /k "cd /d "%~dp0backend\Qtm.Api" && set ASPNETCORE_ENVIRONMENT=Development&& dotnet watch run --no-launch-profile --urls http://localhost:3007"
start "QTM Frontend (:4207)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Started backend (:3007) and frontend (:4207) in separate windows.
