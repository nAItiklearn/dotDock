@echo off
rem Double-click to return the desktop to stock Windows (no PowerShell policy changes needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-windows.ps1" %*
exit /b %errorlevel%
