@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS first, then reopen this file.
  pause
  exit /b 1
)
python --version >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.11 or later and enable Add Python to PATH.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
