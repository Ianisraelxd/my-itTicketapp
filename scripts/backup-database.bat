@echo off
rem ===========================================================================
rem  Campus HelpDesk - MySQL backup
rem  Creates backups\backup_YYYY-MM-DD_HH-mm-ss.sql next to the project and
rem  deletes backups older than KEEP_DAYS. Safe to run by hand or from Task
rem  Scheduler. Exit code 0 = success, 1 = failure (details in backups\backup.log).
rem ===========================================================================
setlocal EnableExtensions

rem ---- Settings: edit these ------------------------------------------------
rem Database to back up. The app's own database is "helpdesk"; change this if
rem yours has a different name (for example it_ticketing_db).
set "DB_NAME=helpdesk"
set "DB_USER=root"
rem Leave empty if the MySQL user has no password (XAMPP default).
set "DB_PASS="
set "MYSQL_BIN=C:\xampp\mysql\bin"
rem Resolve to a clean absolute path
for %%i in ("%~dp0..\backups") do set "BACKUP_DIR=%%~fi"
set "KEEP_DAYS=14"
rem --------------------------------------------------------------------------

if not exist "%MYSQL_BIN%\mysqldump.exe" (
    echo mysqldump.exe not found in "%MYSQL_BIN%". Fix MYSQL_BIN at the top of this script.
    exit /b 1
)
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

rem Locale-independent timestamp, e.g. 2026-10-03_02-00-00
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%i"
set "BACKUP_FILE=%BACKUP_DIR%\backup_%STAMP%.sql"
set "LOG_FILE=%BACKUP_DIR%\backup.log"

rem Passed through the environment so it never shows up in the command line.
if defined DB_PASS set "MYSQL_PWD=%DB_PASS%"

"%MYSQL_BIN%\mysqldump.exe" --user=%DB_USER% --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file="%BACKUP_FILE%" %DB_NAME%
if errorlevel 1 (
    if exist "%BACKUP_FILE%" del "%BACKUP_FILE%"
    echo [%STAMP%] FAILED to back up %DB_NAME% >> "%LOG_FILE%"
    echo Backup of %DB_NAME% failed. See above for the mysqldump error.
    exit /b 1
)

echo [%STAMP%] OK  %BACKUP_FILE% >> "%LOG_FILE%"
echo Backup saved: %BACKUP_FILE%

rem Remove backups older than KEEP_DAYS (forfiles reports an error when nothing matches; ignore it).
forfiles /p "%BACKUP_DIR%" /m "backup_*.sql" /d -%KEEP_DAYS% /c "cmd /c del @path" >nul 2>&1

exit /b 0
