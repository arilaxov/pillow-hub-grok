@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 18+ from https://nodejs.org & pause & exit /b 1)
set "PILLOW_PORT=8765"
if exist .env for /f "usebackq tokens=1,2 delims==" %%A in (".env") do if "%%A"=="PORT" set "PILLOW_PORT=%%B"
if defined PORT set "PILLOW_PORT=%PORT%"
start "" "http://127.0.0.1:%PILLOW_PORT%/"
node server.js
pause
