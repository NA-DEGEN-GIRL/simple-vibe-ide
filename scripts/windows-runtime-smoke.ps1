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
  & $Script
}

function Find-BuiltExe {
  param([string]$BinaryName = "simple-vibe-ide")

  $candidates = @()
  if ($env:CARGO_TARGET_DIR) {
    $candidates += Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"
  }
  $candidates += Join-Path $PSScriptRoot "..\src-tauri\target\release\$BinaryName.exe"

  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
  }

  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $escapedBinary = [regex]::Escape($BinaryName)
  $found = Get-ChildItem -Path $repoRoot -Filter "$BinaryName.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\release\\$escapedBinary\.exe$" } |
    Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoProviderPath = $repoRoot.ProviderPath

if ($repoProviderPath.StartsWith("\\")) {
  $passArgs = @()
  if ($NoLaunch) { $passArgs += "-NoLaunch" }
  if ($SkipNpmInstall) { $passArgs += "-SkipNpmInstall" }
  $argLine = $passArgs -join " "
  $psExe = (Get-Process -Id $PID).Path
  $cmd = "pushd ""$repoProviderPath"" && ""$psExe"" -NoProfile -ExecutionPolicy Bypass -File ""scripts\windows-runtime-smoke.ps1"" $argLine"
  cmd.exe /d /s /c $cmd
  exit $LASTEXITCODE
}

Set-Location $repoRoot

if (-not $env:CARGO_INCREMENTAL) { $env:CARGO_INCREMENTAL = "0" }
if (-not $env:CARGO_TARGET_DIR) {
  $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "simple-vibe-ide-target"
}

Write-Host "Simple Vibe IDE Windows runtime smoke"
Write-Host "Repo: $(Format-DisplayPath $repoRoot)"
Write-Host "Cargo target: $(Format-DisplayPath $env:CARGO_TARGET_DIR)"

Invoke-Step "Tool versions" {
  node --version
  npm.cmd --version
  rustc --version
  cargo --version
  $link = Get-Command link.exe -ErrorAction SilentlyContinue
  if ($link) {
    Write-Host "link.exe: $(Format-DisplayPath $link.Source)"
  } else {
    Write-Host "link.exe: not found on PATH; Tauri/Rust linking may fail until Visual Studio Build Tools are loaded." -ForegroundColor Yellow
  }
}

if (-not $SkipNpmInstall -and -not (Test-Path "node_modules")) {
  Invoke-Step "npm install" { npm.cmd install }
}

Invoke-Step "TypeScript check" { npm.cmd run check }
Invoke-Step "Frontend build" { npm.cmd run build }
Invoke-Step "Terminal frontend build" { npm.cmd run build:terminal }
Invoke-Step "Rust check" { cargo check --manifest-path src-tauri/Cargo.toml }
Invoke-Step "Tauri IDE release no-bundle build" { npm.cmd run tauri -- build --no-bundle }
Invoke-Step "Tauri Terminal release no-bundle build" { npm.cmd run tauri:terminal:build }

$ideExe = Find-BuiltExe "simple-vibe-ide"
$terminalExe = Find-BuiltExe "simple-vibe-terminal"
if (-not $ideExe) {
  throw "Could not find built simple-vibe-ide.exe after Tauri build."
}
if (-not $terminalExe) {
  throw "Could not find built simple-vibe-terminal.exe after Tauri terminal build."
}

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
