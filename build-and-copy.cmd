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

echo ==^> TypeScript check
call npm.cmd run check || goto :fail

echo.
echo ==^> Build Simple Vibe IDE
call npm.cmd run tauri -- build --no-bundle || goto :fail

echo.
echo ==^> Build Simple Vibe Terminal
call npm.cmd run tauri:terminal:build || goto :fail

if not exist "%APP_RELEASE%" mkdir "%APP_RELEASE%" || goto :fail

call :copy_built_exe "simple-vibe-ide" IDE_EXE || goto :fail
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

:copy_built_exe
set "BINARY=%~1"
set "OUTVAR=%~2"
set "SRC="
set "DEST=%APP_RELEASE%\%BINARY%.exe"

if defined CARGO_TARGET_DIR if exist "%CARGO_TARGET_DIR%\release\%BINARY%.exe" set "SRC=%CARGO_TARGET_DIR%\release\%BINARY%.exe"
if not defined SRC if exist "%~dp0src-tauri\target\release\%BINARY%.exe" set "SRC=%~dp0src-tauri\target\release\%BINARY%.exe"

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
)

set "%OUTVAR%=%DEST%"
echo Copied %BINARY%.exe
exit /b 0

:write_launcher
set "LAUNCHER=%APP_ROOT%\%~1"
set "TITLE=%~2"
set "EXE=%~3"
(
  echo @echo off
  echo setlocal
  echo start "%TITLE%" /D "%%TEMP%%" "%EXE%"
) > "%LAUNCHER%"
exit /b 0

:fail
set "CODE=%ERRORLEVEL%"
echo.
echo Build/copy failed with exit code %CODE%.
popd
exit /b %CODE%
