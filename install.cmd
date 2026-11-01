@echo off
rem CRIM Flight Deck - setup (safe to run again). Asks before every system change.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
echo.
pause
