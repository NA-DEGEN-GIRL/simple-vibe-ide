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
set "STATUS=!ERRORLEVEL!"
if not "!STATUS!"=="0" exit /b !STATUS!

set "PATH=%USERPROFILE%\.cargo\bin;C:\Program Files\nodejs;%PATH%"
set "CARGO_INCREMENTAL=1"
if not exist "!CARGO_TARGET_DIR!" (
  mkdir "!CARGO_TARGET_DIR!"
  set "STATUS=!ERRORLEVEL!"
  if not "!STATUS!"=="0" exit /b !STATUS!
)

pushd "!SVIDE_REPO_DIR!"
set "STATUS=!ERRORLEVEL!"
if not "!STATUS!"=="0" exit /b !STATUS!

if /i "%~1"=="--check" (
  echo === Check only ===
  echo Current dir: !CD!
  where npm
  if not "!ERRORLEVEL!"=="0" (popd & exit /b 1)
  where cargo
  if not "!ERRORLEVEL!"=="0" (popd & exit /b 1)
  where rustc
  if not "!ERRORLEVEL!"=="0" (popd & exit /b 1)
  popd
  exit /b 0
)

if not exist "package.json" (
  echo *** package.json not found in !CD!
  popd
  exit /b 1
)

if /i not "!SVIDE_SKIP_NPM_INSTALL!"=="1" if not exist "node_modules" (
  echo === Ensuring Windows npm dependencies ===
  call npm.cmd install
  set "STATUS=!ERRORLEVEL!"
  if not "!STATUS!"=="0" (
    popd
    exit /b !STATUS!
  )
)

if not exist "node_modules\@esbuild\win32-x64\package.json" goto :wrong_node_modules
if not exist "node_modules\@tauri-apps\cli-win32-x64-msvc\package.json" goto :wrong_node_modules
if not exist "node_modules\.bin\vite.cmd" goto :wrong_node_modules
if not exist "node_modules\.bin\tauri.cmd" goto :wrong_node_modules
if exist "node_modules\.bin\esbuild\NUL" goto :wrong_node_modules
if exist "node_modules\.bin\nanoid\NUL" goto :wrong_node_modules
if exist "node_modules\.bin\vite\NUL" goto :wrong_node_modules

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
echo   SVIDE_SKIP_NPM_INSTALL  Set to 1 to reuse an existing Windows dependency tree.
exit /b 0

:wrong_node_modules
echo *** node_modules is not a complete Windows dependency tree.
echo     Do not run Windows npm over dependencies created by WSL.
echo     Use scripts\windows-staged-runtime-smoke.ps1 for a WSL-hosted checkout,
echo     or install dependencies in a Windows-local checkout.
popd
exit /b 1
