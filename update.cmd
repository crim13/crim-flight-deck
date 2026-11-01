@echo off
rem CRIM Flight Deck - look for a newer release and install it (your settings are kept).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1" %*
echo.
pause
