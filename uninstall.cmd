@echo off
rem CRIM Flight Deck - removes the autostart entry, shortcuts and firewall rule (not this folder, not your settings).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1" %*
echo.
pause
