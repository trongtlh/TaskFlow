@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
python -m pip install pyinstaller
if errorlevel 1 exit /b 1
call npm run dist:win
if errorlevel 1 (
  pause
  exit /b 1
)
echo Installer is in the release folder.
pause
