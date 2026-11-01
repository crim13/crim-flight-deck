@echo off
rem CRIM Flight Deck - single start command (production). Double-click or run from a terminal.
rem   start.cmd            real MSFS 2024 via the SimConnect bridge
rem   start.cmd -Mock      development mock simulator (clearly marked as MOCK everywhere)
rem   start.cmd -Port 3100 -NoBrowser -Rebuild
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
