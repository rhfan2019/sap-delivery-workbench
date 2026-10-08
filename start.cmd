@echo off
setlocal
node "%~dp0scripts\dev\components.mjs" start
if errorlevel 1 (
  pause
  exit /b 1
)
