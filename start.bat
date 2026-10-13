@echo off
rem Double-click to run Campus HelpDesk. Starts MySQL (XAMPP), builds the site and opens the browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node scripts\start.mjs
pause
