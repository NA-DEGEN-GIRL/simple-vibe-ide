param(
  [switch]$NoLaunch,
  [switch]$SkipNpmInstall
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
  $display = $display -replace "(?i)^[A-Z]:\\home\\[^\\]+", "[WSL_DRIVE]\home\[USER]"
  $display = $display -replace "/home/[^/]+", "/home/[USER]"
  return $display
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $Script
  $exitCode = $global:LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode."
  }
}

function Assert-WindowsNodeModules {
  $requiredPaths = @(
    "node_modules\.bin\esbuild",
    "node_modules\.bin\nanoid",
    "node_modules\.bin\vite",
    "node_modules\.bin\tsc.cmd",
    "node_modules\.bin\vite.cmd",
    "node_modules\.bin\tauri.cmd",
    "node_modules\@esbuild\win32-x64\package.json",
    "node_modules\@rollup\rollup-win32-x64-msvc\package.json",
    "node_modules\@tauri-apps\cli-win32-x64-msvc\package.json"
  )
  $missingPaths = @($requiredPaths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
  if ($missingPaths.Count -gt 0) {
    throw @"
node_modules is not a complete Windows dependency tree. Do not run Windows npm
over dependencies created by WSL. For a WSL-hosted checkout, run
scripts\windows-staged-runtime-smoke.ps1 so Windows uses its own NTFS stage.
Missing Windows files: $($missingPaths -join ", ")
"@
  }

  foreach ($path in @("node_modules\.bin\esbuild", "node_modules\.bin\nanoid", "node_modules\.bin\vite")) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw "node_modules contains a non-Windows npm bin link. Use the Windows-local staged smoke."
    }
  }
}

function Test-NonLocalWindowsPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($Path.StartsWith("\\")) { return $true }
  $qualifier = Split-Path -Qualifier $Path
  if (-not $qualifier) { return $false }
  $drive = Get-PSDrive -Name $qualifier.Substring(0, 1) -ErrorAction SilentlyContinue
  return [bool]($drive -and $drive.DisplayRoot)
}

function Find-BuiltExe {
  param([string]$BinaryName = "simple-vibe-ide")

  if ($env:CARGO_TARGET_DIR) {
    $candidate = Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
    return $null
  }

  $candidates = @()
  $candidates += "D:\build-cache\simple-vibe-ide-target\release\$BinaryName.exe"
  $candidates += Join-Path $PSScriptRoot "..\src-tauri\target\release\$BinaryName.exe"

  $seen = @{}
  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if (-not $resolved) { continue }
    $item = Get-Item $resolved.Path -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    $key = $item.FullName.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    return $item.FullName
  }

  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $escapedBinary = [regex]::Escape($BinaryName)
  $found = Get-ChildItem -Path $repoRoot -Filter "$BinaryName.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\release\\$escapedBinary\.exe$" } |
    Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Remove-StaleBuiltExe {
  param([string]$BinaryName = "simple-vibe-ide")

  if (-not $env:CARGO_TARGET_DIR) { return }
  $paths = @(
    (Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"),
    (Join-Path $env:CARGO_TARGET_DIR "simple-vibe-build-sources\$BinaryName.exe")
  )
  foreach ($path in $paths) {
    if (-not (Test-Path $path)) { continue }
    try {
      Remove-Item -LiteralPath $path -Force
    } catch {
      throw "Could not remove stale $BinaryName build artifact before rebuild: $(Format-DisplayPath $path). Close running apps that use it. $(Format-DisplayPath $_.Exception.Message)"
    }
  }
}

function Save-BuiltExeSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SourceExe,
    [Parameter(Mandatory = $true)][string]$BinaryName
  )

  if (-not $env:CARGO_TARGET_DIR) { return $SourceExe }
  $snapshotDir = Join-Path $env:CARGO_TARGET_DIR "simple-vibe-build-sources"
  New-Item -ItemType Directory -Force $snapshotDir | Out-Null
  $snapshotExe = Join-Path $snapshotDir "$BinaryName.exe"
  Copy-Item -LiteralPath $SourceExe -Destination $snapshotExe -Force
  (Get-Item -LiteralPath $snapshotExe).LastWriteTime = Get-Date
  return $snapshotExe
}

function Assert-ExeProductName {
  param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$ExpectedName
  )

  $item = Get-Item -LiteralPath $ExePath
  $info = $item.VersionInfo
  $productName = $info.ProductName
  $fileDescription = $info.FileDescription
  if ($productName -ne $ExpectedName -or $fileDescription -ne $ExpectedName) {
    throw "Unexpected Windows metadata for $(Format-DisplayPath $ExePath): ProductName='$productName', FileDescription='$fileDescription', expected '$ExpectedName'."
  }
  Write-Host "Windows metadata OK: $ExpectedName" -ForegroundColor Green
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoProviderPath = $repoRoot.ProviderPath

if ($repoProviderPath.StartsWith("\\")) {
  throw "Direct Windows smoke requires a Windows-local checkout. For WSL/UNC source, run scripts\windows-staged-runtime-smoke.ps1."
}

Set-Location $repoRoot

if (Test-NonLocalWindowsPath $repoProviderPath) {
  throw "Direct Windows smoke requires a Windows-local checkout. For WSL/UNC source, run scripts\windows-staged-runtime-smoke.ps1."
}

if (-not $env:CARGO_INCREMENTAL) { $env:CARGO_INCREMENTAL = "0" }
if (-not $env:CARGO_TARGET_DIR) {
  $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "simple-vibe-ide-target"
}
$env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
if (Test-NonLocalWindowsPath $env:CARGO_TARGET_DIR) {
  throw "CARGO_TARGET_DIR must be on a Windows-local filesystem: $(Format-DisplayPath $env:CARGO_TARGET_DIR)"
}

Write-Host "Simple Vibe IDE Windows runtime smoke"
Write-Host "Repo: $(Format-DisplayPath $repoRoot)"
Write-Host "Cargo target: $(Format-DisplayPath $env:CARGO_TARGET_DIR)"

Invoke-Step "Tool versions" {
  node --version
  if ($LASTEXITCODE -ne 0) { throw "node --version failed with exit code $LASTEXITCODE." }
  npm.cmd --version
  if ($LASTEXITCODE -ne 0) { throw "npm --version failed with exit code $LASTEXITCODE." }
  rustc --version
  if ($LASTEXITCODE -ne 0) { throw "rustc --version failed with exit code $LASTEXITCODE." }
  cargo --version
  if ($LASTEXITCODE -ne 0) { throw "cargo --version failed with exit code $LASTEXITCODE." }
  $link = Get-Command link.exe -ErrorAction SilentlyContinue
  if ($link) {
    Write-Host "link.exe: $(Format-DisplayPath $link.Source)"
  } else {
    Write-Host "link.exe: not found on PATH; Tauri/Rust linking may fail until Visual Studio Build Tools are loaded." -ForegroundColor Yellow
  }
}

if (-not $SkipNpmInstall) {
  Invoke-Step "Clean Windows npm install" { npm.cmd ci --no-audit --no-fund }
} elseif ($SkipNpmInstall) {
  Write-Host "npm install skipped; validating the existing Windows dependency tree."
}

Invoke-Step "Windows npm dependency preflight" { Assert-WindowsNodeModules }
Invoke-Step "npm audit" { npm.cmd audit --audit-level=low }

Invoke-Step "TypeScript check" { npm.cmd run check }
Invoke-Step "Frontend build" { npm.cmd run build }
Invoke-Step "Terminal frontend build" { npm.cmd run build:terminal }
Invoke-Step "Rust check" { cargo check --manifest-path src-tauri/Cargo.toml }
Remove-StaleBuiltExe "simple-vibe-ide"
Invoke-Step "Tauri IDE release no-bundle build" { npm.cmd run tauri -- build --no-bundle }
$ideExe = Find-BuiltExe "simple-vibe-ide"
if (-not $ideExe) {
  throw "Could not find built simple-vibe-ide.exe after Tauri build."
}
$ideExe = Save-BuiltExeSnapshot -SourceExe $ideExe -BinaryName "simple-vibe-ide"
Assert-ExeProductName -ExePath $ideExe -ExpectedName "Simple Vibe IDE"

Remove-StaleBuiltExe "simple-vibe-terminal"
Invoke-Step "Tauri Terminal release no-bundle build" { npm.cmd run tauri:terminal:build }
$terminalExe = Find-BuiltExe "simple-vibe-terminal"
if (-not $terminalExe) {
  throw "Could not find built simple-vibe-terminal.exe after Tauri terminal build."
}
$terminalExe = Save-BuiltExeSnapshot -SourceExe $terminalExe -BinaryName "simple-vibe-terminal"
Assert-ExeProductName -ExePath $terminalExe -ExpectedName "Simple Vibe Terminal"

Write-Host ""
Write-Host "Built IDE exe: $(Format-DisplayPath $ideExe)" -ForegroundColor Green
Write-Host "Built Terminal exe: $(Format-DisplayPath $terminalExe)" -ForegroundColor Green

if (-not $NoLaunch) {
  Invoke-Step "Launch built app" {
    Start-Process -FilePath $ideExe -WorkingDirectory $repoRoot
  }
}

Write-Host ""
Write-Host "Manual smoke checklist is in docs/WINDOWS_RUNTIME_SMOKE.md"
