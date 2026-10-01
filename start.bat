@echo off
REM One-click launcher for Windows: installs what's missing, then starts the
REM dashboard at http://localhost:3000 and opens it in your browser.
REM Keep this window open while you use the dashboard; closing it stops the engine.
setlocal
cd /d "%~dp0"
title Voniweb Cold Email Engine

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run start.bat again.
  start "" https://nodejs.org
  goto :fail
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 20 (
  echo Your Node.js is too old. Install the LTS version from https://nodejs.org then run start.bat again.
  goto :fail
)

if not exist node_modules\ (
  echo [1/3] Installing dependencies - first run only, takes a few minutes...
  call npm install
  if errorlevel 1 goto :fail
)

if not exist node_modules\.chromium-installed (
  echo [2/3] Installing the Chromium browser used by the website auditor...
  call npx playwright install chromium
  if errorlevel 1 goto :fail
  echo done> node_modules\.chromium-installed
)

if not exist .env (
  copy .env.example .env >nul
  echo [3/3] Created .env - Notepad is opening it now.
  echo       Fill in ANTHROPIC_API_KEY and at least one SMTP_1_ account, save, and close Notepad.
  notepad .env
)

echo.
echo Starting the dashboard. It will open at http://localhost:3000
echo Keep this window open. Press Ctrl+C here to stop the engine.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 8; Start-Process 'http://localhost:3000'"
call npm start
echo.
echo The engine stopped. Scroll up for the reason.
pause
exit /b 0

:fail
echo.
echo Setup did not finish. Scroll up for the error.
pause
exit /b 1
