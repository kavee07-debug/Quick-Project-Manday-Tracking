@echo off
REM Quick Project Manday Tracking - start dev servers (frontend + backend)
REM Opens 2 separate terminal windows: Backend :3007, Frontend :4207

start "QTM Backend (:3007)" cmd /k "cd /d "%~dp0backend\Qtm.Api" && dotnet watch run --no-launch-profile --urls http://localhost:3007"
start "QTM Frontend (:4207)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Started backend (:3007) and frontend (:4207) in separate windows.
