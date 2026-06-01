param(
  [string]$SourceExe,
  [string]$TerminalSourceExe,
  [string]$AppRoot,
  [switch]$SkipTerminal,
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
  param(
    [string]$Requested,
    [string]$BinaryName = "simple-vibe-ide",
    [switch]$Required
  )

  $candidates = @()
  if ($Requested) {
    $candidates += $Requested
  }
  if ($env:CARGO_TARGET_DIR) {
    $candidates += Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"
  }
  $candidates += "D:\build-cache\simple-vibe-ide-target\release\$BinaryName.exe"
  $candidates += Join-Path $env:TEMP "simple-vibe-ide-target\release\$BinaryName.exe"
  $candidates += Join-Path $PSScriptRoot "..\src-tauri\target\release\$BinaryName.exe"

  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
  }

  if ($Required) {
    throw "Could not find $BinaryName.exe. Pass -SourceExe or build first."
  }
  return $null
}

function Copy-ExeToRelease {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$BinaryName,
    [Parameter(Mandatory = $true)][string]$ReleaseDir
  )

  $preferredDest = Join-Path $ReleaseDir "$BinaryName.exe"
  $sourceFull = [System.IO.Path]::GetFullPath($Source)
  $destFull = [System.IO.Path]::GetFullPath($preferredDest)
  if ($sourceFull -ine $destFull) {
    try {
      Copy-Item $sourceFull $destFull -Force
    } catch {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $destFull = Join-Path $ReleaseDir "$BinaryName-$stamp.exe"
      Copy-Item $sourceFull $destFull -Force
      Write-Host "Stable $BinaryName.exe was locked; copied to a timestamped exe instead." -ForegroundColor Yellow
    }
  }
  return @{
    Source = $sourceFull
    Exe = $destFull
  }
}

function Write-LauncherFiles {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$BaseName,
    [Parameter(Mandatory = $true)][string]$Title
  )

  $vbs = Join-Path $AppRoot "$BaseName.vbs"
  $cmd = Join-Path $AppRoot "$BaseName.cmd"
  $vbsCurrentDirectory = ConvertTo-VbsString $env:TEMP
  $vbsExe = ConvertTo-VbsString $Exe
  $vbsLines = @(
    'Set shell = CreateObject("WScript.Shell")',
    ('shell.CurrentDirectory = {0}' -f $vbsCurrentDirectory),
    ('shell.Run Chr(34) & {0} & Chr(34), 1, False' -f $vbsExe)
  )
  Set-Content -Path $vbs -Encoding ASCII -Value $vbsLines

  $cmdLines = @(
    '@echo off',
    'setlocal',
    ('start "{0}" /D "%TEMP%" "{1}"' -f $Title, $Exe)
  )
  Set-Content -Path $cmd -Encoding ASCII -Value $cmdLines

  return @{
    Vbs = $vbs
    Cmd = $cmd
  }
}

if (-not $AppRoot) {
  $AppRoot = Join-Path $env:TEMP "simple-vibe-ide-target"
}

$source = Resolve-SourceExe -Requested $SourceExe -BinaryName "simple-vibe-ide" -Required
$releaseDir = Join-Path $AppRoot "release"

New-Item -ItemType Directory -Force $releaseDir | Out-Null

$ide = Copy-ExeToRelease -Source $source -BinaryName "simple-vibe-ide" -ReleaseDir $releaseDir
$ideLaunchers = Write-LauncherFiles -Exe $ide.Exe -AppRoot $AppRoot -BaseName "run-built-temp" -Title "Simple Vibe IDE"

$terminal = $null
$terminalLaunchers = $null
if (-not $SkipTerminal) {
  $terminalSource = Resolve-SourceExe -Requested $TerminalSourceExe -BinaryName "simple-vibe-terminal"
  if ($terminalSource) {
    $terminal = Copy-ExeToRelease -Source $terminalSource -BinaryName "simple-vibe-terminal" -ReleaseDir $releaseDir
    $terminalLaunchers = Write-LauncherFiles -Exe $terminal.Exe -AppRoot $AppRoot -BaseName "run-terminal-temp" -Title "Simple Vibe Terminal"
  }
}

Write-Host "Simple Vibe temp release is ready." -ForegroundColor Green
Write-Host "IDE Source:      $(Format-DisplayPath $ide.Source)"
Write-Host "IDE Exe:         $(Format-DisplayPath $ide.Exe)"
Write-Host "IDE VBS:         $(Format-DisplayPath $ideLaunchers.Vbs)"
Write-Host "IDE CMD:         $(Format-DisplayPath $ideLaunchers.Cmd)"
if ($terminal) {
  Write-Host "Terminal Source: $(Format-DisplayPath $terminal.Source)"
  Write-Host "Terminal Exe:    $(Format-DisplayPath $terminal.Exe)"
  Write-Host "Terminal VBS:    $(Format-DisplayPath $terminalLaunchers.Vbs)"
  Write-Host "Terminal CMD:    $(Format-DisplayPath $terminalLaunchers.Cmd)"
} elseif (-not $SkipTerminal) {
  Write-Host "Terminal Exe:    not found; run npm run tauri:terminal:build or build-and-copy.cmd to build it." -ForegroundColor Yellow
}

if (-not $NoLaunch) {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$($ideLaunchers.Vbs)`""
}
