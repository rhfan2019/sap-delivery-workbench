@echo off
setlocal
node "%~dp0scripts\dev\components.mjs" start
set status=%errorlevel%
rem Keep the window open so the outcome (every component ready, or the failure) stays readable.
pause
exit /b %status%
