@echo off
rem Runs the taskbar restore hard-kill test (no PowerShell policy changes needed). Arguments pass through.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-taskbar-restore.ps1" %*
exit /b %errorlevel%
