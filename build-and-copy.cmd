@echo off
setlocal EnableExtensions EnableDelayedExpansion

pushd "%~dp0" || exit /b 1

if not defined CARGO_INCREMENTAL set "CARGO_INCREMENTAL=0"
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%TEMP%\simple-vibe-ide-target"

set "APP_ROOT=%TEMP%\simple-vibe-ide-target"
set "APP_RELEASE=%APP_ROOT%\release"

echo Simple Vibe IDE + Terminal build and copy
echo Repo: %CD%
echo Cargo target: %CARGO_TARGET_DIR%
echo Copy target: %APP_RELEASE%
echo.

if not exist "node_modules" (
  echo node_modules not found. Running npm install...
  call npm.cmd install || goto :fail
)

if not exist "node_modules\@esbuild\win32-x64\package.json" goto :wrong_node_modules
if not exist "node_modules\@tauri-apps\cli-win32-x64-msvc\package.json" goto :wrong_node_modules
if not exist "node_modules\.bin\vite.cmd" goto :wrong_node_modules
if not exist "node_modules\.bin\tauri.cmd" goto :wrong_node_modules
if exist "node_modules\.bin\esbuild\NUL" goto :wrong_node_modules
if exist "node_modules\.bin\nanoid\NUL" goto :wrong_node_modules
if exist "node_modules\.bin\vite\NUL" goto :wrong_node_modules

echo ==^> TypeScript check
call npm.cmd run check || goto :fail

echo.
echo ==^> Build Simple Vibe IDE
call npm.cmd run tauri -- build --no-bundle || goto :fail

if not exist "%APP_RELEASE%" mkdir "%APP_RELEASE%" || goto :fail
call :copy_built_exe "simple-vibe-ide" IDE_EXE || goto :fail

echo.
echo ==^> Build Simple Vibe Terminal
call npm.cmd run tauri:terminal:build || goto :fail

call :copy_built_exe "simple-vibe-terminal" TERMINAL_EXE || goto :fail
call :write_launcher "run-simple-vibe-ide.cmd" "Simple Vibe IDE" "%IDE_EXE%" || goto :fail
call :write_launcher "run-simple-vibe-terminal.cmd" "Simple Vibe Terminal" "%TERMINAL_EXE%" || goto :fail

echo.
echo Ready.
echo   IDE:      %IDE_EXE%
echo   Terminal: %TERMINAL_EXE%
echo   Launchers:
echo     %APP_ROOT%\run-simple-vibe-ide.cmd
echo     %APP_ROOT%\run-simple-vibe-terminal.cmd
popd
exit /b 0

:wrong_node_modules
echo node_modules is not a complete Windows dependency tree.
echo Do not run Windows npm over dependencies created by WSL.
echo Use scripts\windows-staged-runtime-smoke.ps1 for a WSL-hosted checkout,
echo or install dependencies in a Windows-local checkout.
echo.
echo Build/copy failed with exit code 1.
popd
exit /b 1

:copy_built_exe
set "BINARY=%~1"
set "OUTVAR=%~2"
set "SRC="
set "DEST=%APP_RELEASE%\%BINARY%.exe"

for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\resolve-built-exe.ps1" -BinaryName "%BINARY%" -RepoRoot "%~dp0" -ExcludeReleaseDir "%APP_RELEASE%"`) do set "SRC=%%I"

if not defined SRC (
  echo Built app not found: %BINARY%.exe
  exit /b 1
)

if /I "%SRC%"=="%DEST%" (
  set "%OUTVAR%=%DEST%"
  echo %BINARY%.exe already in copy target.
  exit /b 0
)

copy /Y "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  for /f %%I in ('powershell.exe -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
  set "DEST=%APP_RELEASE%\%BINARY%-!STAMP!.exe"
  echo Stable %BINARY%.exe was locked; copying timestamped exe instead.
  copy /Y "%SRC%" "!DEST!" >nul || exit /b 1
  call :touch_exe "!DEST!"
) else (
  call :touch_exe "%DEST%"
)

set "%OUTVAR%=%DEST%"
echo Copied %BINARY%.exe
exit /b 0

:touch_exe
set "SVI_TOUCH_EXE=%~1"
powershell.exe -NoProfile -Command "$p=$env:SVI_TOUCH_EXE; if ($p) { (Get-Item -LiteralPath $p).LastWriteTime = Get-Date }" >nul 2>nul
set "SVI_TOUCH_EXE="
exit /b 0

:write_launcher
set "LAUNCHER=%APP_ROOT%\%~1"
set "TITLE=%~2"
set "EXE=%~3"
(
  echo @echo off
  echo setlocal
  echo echo Launching %TITLE%
  echo echo Exe: "%EXE%"
  echo ^> "%APP_ROOT%\last-launched-%~n1.txt" echo "%EXE%"
  echo start "%TITLE%" /D "%%TEMP%%" "%EXE%"
  echo timeout /t 2 ^>nul
) > "%LAUNCHER%"
exit /b 0

:fail
set "CODE=%ERRORLEVEL%"
echo.
echo Build/copy failed with exit code %CODE%.
popd
exit /b %CODE%
