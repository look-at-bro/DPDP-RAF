@echo off
setlocal
cd /d "%~dp0"
npm run dev:network
if errorlevel 1 pause