@echo off
rem Double-click to refresh the dashboard (Windows).
cd /d "%~dp0"
py -3 src\refresh.py || python src\refresh.py
echo.
pause
