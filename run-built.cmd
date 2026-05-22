@echo off
setlocal

set "APP_DIR=%TEMP%\simple-vibe-ide-target\release"
set "APP_EXE=%APP_DIR%\simple-vibe-ide.exe"
set "SOURCE_EXE=%~dp0src-tauri\target\release\simple-vibe-ide.exe"

if not exist "%SOURCE_EXE%" if exist "%APP_EXE%" set "SOURCE_EXE=%APP_EXE%"

if not exist "%SOURCE_EXE%" (
  echo Built app not found:
  echo   %SOURCE_EXE%
  echo.
  echo Build it first with:
  echo   npm run tauri -- build --no-bundle
  exit /b 1
)

if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if /I not "%SOURCE_EXE%"=="%APP_EXE%" (
  copy /Y "%SOURCE_EXE%" "%APP_EXE%" >nul
  if errorlevel 1 exit /b 1
)

set "SIMPLE_VIBE_IDE_ROOT=%~dp0"
if "%SIMPLE_VIBE_IDE_ROOT:~-1%"=="\" set "SIMPLE_VIBE_IDE_ROOT=%SIMPLE_VIBE_IDE_ROOT:~0,-1%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$exe = Join-Path $env:TEMP 'simple-vibe-ide-target\release\simple-vibe-ide.exe'; Start-Process -FilePath $exe -WorkingDirectory $env:TEMP"
