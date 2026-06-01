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

function Format-FileTimestamp {
  param([string]$Path)

  if (-not $Path) { return "" }
  $item = Get-Item $Path -ErrorAction SilentlyContinue
  if (-not $item) { return "missing" }
  return $item.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
}

function Resolve-SourceExe {
  param(
    [string]$Requested,
    [string]$BinaryName = "simple-vibe-ide",
    [switch]$Required
  )

  if ($Requested) {
    $resolvedRequested = Resolve-Path $Requested -ErrorAction SilentlyContinue
    if ($resolvedRequested) { return $resolvedRequested.Path }
    if ($Required) {
      throw "Could not find requested $BinaryName.exe: $Requested"
    }
  }

  $candidates = @()
  if ($env:CARGO_TARGET_DIR) {
    $candidates += Join-Path $env:CARGO_TARGET_DIR "simple-vibe-build-sources\$BinaryName.exe"
    $candidates += Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"
  }
  $candidates += "D:\build-cache\simple-vibe-ide-target\simple-vibe-build-sources\$BinaryName.exe"
  $candidates += "D:\build-cache\simple-vibe-ide-target\release\$BinaryName.exe"
  $candidates += Join-Path $PSScriptRoot "..\src-tauri\target\release\$BinaryName.exe"
  $tempReleaseExe = if ($AppRoot) { Join-Path (Join-Path $AppRoot "release") "$BinaryName.exe" } else { $null }
  $tempReleaseFull = if ($tempReleaseExe) {
    try { [System.IO.Path]::GetFullPath($tempReleaseExe) } catch { $null }
  } else {
    $null
  }

  $selfReleaseItem = $null
  $seen = @{}
  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if (-not $resolved) { continue }
    $item = Get-Item $resolved.Path -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    if ($tempReleaseFull -and ([System.IO.Path]::GetFullPath($item.FullName) -ieq $tempReleaseFull)) {
      $selfReleaseItem = $item
      continue
    }
    $key = $item.FullName.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    return $item.FullName
  }
  if ($selfReleaseItem) { return $selfReleaseItem.FullName }

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
    (Get-Item $destFull).LastWriteTime = Get-Date
  } else {
    Write-Host "$BinaryName.exe source is already the temp release exe; no separate copy source was found." -ForegroundColor Yellow
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
    ('echo Launching {0}' -f $Title),
    ('echo Exe: {0}' -f $Exe),
    ('> "{0}" echo {1}' -f (Join-Path $AppRoot "last-launched-$BaseName.txt"), $Exe),
    ('start "{0}" /D "%TEMP%" "{1}"' -f $Title, $Exe),
    'timeout /t 2 >nul'
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
Write-Host "IDE Source Time: $(Format-FileTimestamp $ide.Source)"
Write-Host "IDE Exe:         $(Format-DisplayPath $ide.Exe)"
Write-Host "IDE Exe Time:    $(Format-FileTimestamp $ide.Exe)"
Write-Host "IDE VBS:         $(Format-DisplayPath $ideLaunchers.Vbs)"
Write-Host "IDE CMD:         $(Format-DisplayPath $ideLaunchers.Cmd)"
if ($terminal) {
  Write-Host "Terminal Source: $(Format-DisplayPath $terminal.Source)"
  Write-Host "Terminal SrcTime:$(Format-FileTimestamp $terminal.Source)"
  Write-Host "Terminal Exe:    $(Format-DisplayPath $terminal.Exe)"
  Write-Host "Terminal ExeTime:$(Format-FileTimestamp $terminal.Exe)"
  Write-Host "Terminal VBS:    $(Format-DisplayPath $terminalLaunchers.Vbs)"
  Write-Host "Terminal CMD:    $(Format-DisplayPath $terminalLaunchers.Cmd)"
} elseif (-not $SkipTerminal) {
  Write-Host "Terminal Exe:    not found; run npm run tauri:terminal:build or build-and-copy.cmd to build it." -ForegroundColor Yellow
}

if (-not $NoLaunch) {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$($ideLaunchers.Vbs)`""
}
