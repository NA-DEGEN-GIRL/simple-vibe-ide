param(
  [string]$SourceExe,
  [string]$AppRoot,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

function Format-DisplayPath {
  param([string]$Path)

  if (-not $Path) { return $Path }

  $display = $Path
  if ($env:TEMP) {
    $display = $display -replace [regex]::Escape($env:TEMP), "%TEMP%"
  }
  if ($env:USERPROFILE) {
    $display = $display -replace [regex]::Escape($env:USERPROFILE), "%USERPROFILE%"
  }
  $display = $display -replace "(?i)\\\\wsl(?:\.localhost)?\\[^\\]+\\home\\[^\\]+", "\\wsl.localhost\[DISTRO]\home\[USER]"
  $display = $display -replace "/home/[^/]+", "/home/[USER]"
  return $display
}

function ConvertTo-VbsString {
  param([string]$Value)
  return [string]::Concat('"', ($Value -replace '"', '""'), '"')
}

function Resolve-SourceExe {
  param([string]$Requested)

  $candidates = @()
  if ($Requested) {
    $candidates += $Requested
  }
  if ($env:CARGO_TARGET_DIR) {
    $candidates += Join-Path $env:CARGO_TARGET_DIR "release\simple-vibe-ide.exe"
  }
  $candidates += "D:\build-cache\simple-vibe-ide-target\release\simple-vibe-ide.exe"
  $candidates += Join-Path $env:TEMP "simple-vibe-ide-target\release\simple-vibe-ide.exe"
  $candidates += Join-Path $PSScriptRoot "..\src-tauri\target\release\simple-vibe-ide.exe"

  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
  }

  throw "Could not find simple-vibe-ide.exe. Pass -SourceExe or build first."
}

if (-not $AppRoot) {
  $AppRoot = Join-Path $env:TEMP "simple-vibe-ide-target"
}

$source = Resolve-SourceExe $SourceExe
$releaseDir = Join-Path $AppRoot "release"
$preferredDest = Join-Path $releaseDir "simple-vibe-ide.exe"
$vbs = Join-Path $AppRoot "run-built-temp.vbs"
$cmd = Join-Path $AppRoot "run-built-temp.cmd"

New-Item -ItemType Directory -Force $releaseDir | Out-Null

$sourceFull = [System.IO.Path]::GetFullPath($source)
$destFull = [System.IO.Path]::GetFullPath($preferredDest)
if ($sourceFull -ine $destFull) {
  try {
    Copy-Item $sourceFull $destFull -Force
  } catch {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $destFull = Join-Path $releaseDir "simple-vibe-ide-$stamp.exe"
    Copy-Item $sourceFull $destFull -Force
    Write-Host "Stable exe was locked; copied to a timestamped exe instead." -ForegroundColor Yellow
  }
}

$vbsCurrentDirectory = ConvertTo-VbsString $env:TEMP
$vbsExe = ConvertTo-VbsString $destFull
$vbsLines = @(
  'Set shell = CreateObject("WScript.Shell")',
  ('shell.CurrentDirectory = {0}' -f $vbsCurrentDirectory),
  ('shell.Run Chr(34) & {0} & Chr(34), 1, False' -f $vbsExe)
)
Set-Content -Path $vbs -Encoding ASCII -Value $vbsLines

$cmdLines = @(
  '@echo off',
  'setlocal',
  'start "" /D "%TEMP%" "' + $destFull + '"'
)
Set-Content -Path $cmd -Encoding ASCII -Value $cmdLines

Write-Host "Simple Vibe IDE temp release is ready." -ForegroundColor Green
Write-Host "Source:   $(Format-DisplayPath $sourceFull)"
Write-Host "Exe:      $(Format-DisplayPath $destFull)"
Write-Host "VBS:      $(Format-DisplayPath $vbs)"
Write-Host "CMD:      $(Format-DisplayPath $cmd)"

if (-not $NoLaunch) {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`""
}
