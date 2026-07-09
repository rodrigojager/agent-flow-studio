@echo off
cd /d "%~dp0"
npm run dev:desktop
if errorlevel 1 (
  echo.
  echo Falha ao iniciar o Agentes IA.
  pause
)
