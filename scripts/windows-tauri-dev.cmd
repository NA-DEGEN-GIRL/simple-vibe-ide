@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help

set "VSDEVCMD=%VSDEVCMD%"
if not defined VSDEVCMD set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

set "SCRIPT_DIR=%~dp0"
if not defined SVIDE_REPO_DIR for %%I in ("%SCRIPT_DIR%..") do set "SVIDE_REPO_DIR=%%~fI"
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%TEMP%\simple-vibe-ide-dev-target"

echo === Simple Vibe IDE dev mode (Tauri + Vite HMR) ===
echo Repo: !SVIDE_REPO_DIR!
echo Cargo target: !CARGO_TARGET_DIR!
echo.

if not exist "!VSDEVCMD!" (
  echo *** Visual Studio developer command file not found:
  echo     !VSDEVCMD!
  echo Set VSDEVCMD to the correct VsDevCmd.bat path and retry.
  exit /b 1
)

call "!VSDEVCMD!" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

set "PATH=%USERPROFILE%\.cargo\bin;C:\Program Files\nodejs;%PATH%"
set "CARGO_INCREMENTAL=1"
if not exist "!CARGO_TARGET_DIR!" mkdir "!CARGO_TARGET_DIR!"
if errorlevel 1 exit /b %errorlevel%

pushd "!SVIDE_REPO_DIR!"
if errorlevel 1 exit /b %errorlevel%

if /i "%~1"=="--check" (
  echo === Check only ===
  echo Current dir: !CD!
  where npm
  where cargo
  where rustc
  popd
  exit /b 0
)

if not exist "package.json" (
  echo *** package.json not found in !CD!
  popd
  exit /b 1
)

if /i not "!SVIDE_SKIP_NPM_INSTALL!"=="1" (
  echo === Ensuring Windows npm dependencies ===
  call npm.cmd install
  if errorlevel 1 (
    set "STATUS=!errorlevel!"
    popd
    exit /b !STATUS!
  )
)

echo.
echo === Starting Tauri dev app ===
echo Frontend edits should hot-reload through Vite. Stop with Ctrl+C.
call npm.cmd run tauri:dev
set "STATUS=%errorlevel%"
popd
exit /b %STATUS%

:help
echo Usage: scripts\windows-tauri-dev.cmd [--check]
echo.
echo Starts Simple Vibe IDE in Tauri dev mode on Windows.
echo Optional environment variables:
echo   SVIDE_REPO_DIR     Repo directory. Defaults to this script's repo.
echo   CARGO_TARGET_DIR   Cargo target cache. Defaults to %%TEMP%%\simple-vibe-ide-dev-target.
echo   VSDEVCMD           Path to Visual Studio VsDevCmd.bat.
exit /b 0
