@echo off
setlocal DisableDelayedExpansion

set "LAUNCH_SCRIPT=%~dp0scripts\run-temp-release.ps1"

if not exist "%LAUNCH_SCRIPT%" (
  echo Launch helper not found: scripts\run-temp-release.ps1
  exit /b 1
)

set "SIMPLE_VIBE_IDE_ROOT=%~dp0"
if "%SIMPLE_VIBE_IDE_ROOT:~-1%"=="\" set "SIMPLE_VIBE_IDE_ROOT=%SIMPLE_VIBE_IDE_ROOT:~0,-1%"

rem Always launch a separate versioned copy, never a mutable Cargo build output.
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%LAUNCH_SCRIPT%" -SkipTerminal
set "LAUNCH_EXIT_CODE=%ERRORLEVEL%"
if not "%LAUNCH_EXIT_CODE%"=="0" (
  echo.
  echo Launch failed. Review the diagnostic above, then build the app if needed.
)
exit /b %LAUNCH_EXIT_CODE%
