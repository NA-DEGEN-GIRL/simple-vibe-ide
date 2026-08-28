param(
  [string]$StageRoot,
  [string]$CargoTargetDir,
  [switch]$IncludeUntracked,
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
  $display = $display -replace "(?i)^[A-Z]:\\home\\[^\\]+", "[WSL_DRIVE]\home\[USER]"
  $display = $display -replace "/home/[^/]+", "/home/[USER]"
  return $display
}

function Invoke-NativeStep {
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

function Test-NonLocalWindowsPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($Path.StartsWith("\\")) { return $true }
  $qualifier = Split-Path -Qualifier $Path
  if (-not $qualifier) { return $false }
  $driveName = $qualifier.Substring(0, 1)
  $drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
  return [bool]($drive -and $drive.DisplayRoot)
}

function Test-PrivateLookingUntrackedPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $normalized = $RelativePath.Replace("\", "/").ToLowerInvariant()
  $leaf = [System.IO.Path]::GetFileName($normalized)
  $environmentPrefix = "." + "env"
  $blockedLeafNames = @(
    ("." + "npm" + "rc"),
    ("." + "net" + "rc"),
    ("." + "git-" + "credentials"),
    ("id_" + "dsa"),
    ("id_" + "ecdsa"),
    ("id_" + "ed25519"),
    ("id_" + "rsa")
  )
  if ($leaf -eq $environmentPrefix -or
      ($leaf.StartsWith("$environmentPrefix.") -and -not $leaf.EndsWith(".example"))) {
    return $true
  }
  if ($blockedLeafNames -contains $leaf) { return $true }
  if ($normalized -match "(^|/)(\.ssh|\.aws|\.azure|\.gnupg)/") { return $true }
  return [bool]($leaf -match "\.(pem|key|p12|pfx)$")
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$gitSafeSourceRoot = $sourceRoot.Replace("\", "/")
if (-not $StageRoot) {
  $StageRoot = Join-Path $env:TEMP "simple-vibe-ide-win-src"
}
if (-not $CargoTargetDir) {
  $CargoTargetDir = Join-Path $env:TEMP "simple-vibe-ide-target"
}

$stageFullPath = [System.IO.Path]::GetFullPath($StageRoot)
$cargoFullPath = [System.IO.Path]::GetFullPath($CargoTargetDir)
$sourceFullPath = [System.IO.Path]::GetFullPath($sourceRoot)
$stageWithSeparator = $stageFullPath.TrimEnd("\") + "\"
$sourceWithSeparator = $sourceFullPath.TrimEnd("\") + "\"
$stageDriveRoot = [System.IO.Path]::GetPathRoot($stageFullPath).TrimEnd("\")

if ($stageFullPath.TrimEnd("\") -eq $stageDriveRoot) {
  throw "The Windows stage must not be a drive root."
}
if ($stageWithSeparator.StartsWith($sourceWithSeparator, [System.StringComparison]::OrdinalIgnoreCase) -or
    $sourceWithSeparator.StartsWith($stageWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The Windows stage and source checkout must not contain each other."
}
if (Test-NonLocalWindowsPath $stageFullPath) {
  throw "The Windows stage must be on a Windows-local filesystem, not WSL/UNC: $(Format-DisplayPath $stageFullPath)"
}
if (Test-NonLocalWindowsPath $cargoFullPath) {
  throw "CARGO_TARGET_DIR must be on a Windows-local filesystem, not WSL/UNC: $(Format-DisplayPath $cargoFullPath)"
}

$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) { $git = Get-Command git -ErrorAction SilentlyContinue }
if (-not $git) {
  throw "Git for Windows is required to create the tracked source manifest."
}

$markerName = ".simple-vibe-windows-stage"
$markerValue = "Simple Vibe IDE disposable Windows build stage."
$markerPath = Join-Path $stageFullPath $markerName
if (Test-Path $stageFullPath) {
  $stageItem = Get-Item -LiteralPath $stageFullPath -Force
  if ($stageItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Refusing to replace a stage directory that is a link or junction."
  }
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "Refusing to replace an unrecognized stage directory: $(Format-DisplayPath $stageFullPath)"
  }
  $existingMarker = (Get-Content -LiteralPath $markerPath -Raw).Trim()
  if ($existingMarker -ne $markerValue) {
    throw "Refusing to replace a stage directory with an invalid ownership marker."
  }
  try {
    Remove-Item -LiteralPath $stageFullPath -Recurse -Force
  } catch {
    throw "Could not refresh the Windows stage. Close any process using it and retry: $(Format-DisplayPath $_.Exception.Message)"
  }
}

New-Item -ItemType Directory -Path $stageFullPath -Force | Out-Null
Set-Content -LiteralPath $markerPath -Value $markerValue -Encoding Ascii

$global:LASTEXITCODE = 0
$trackedFiles = @(& $git.Source -c "safe.directory=$gitSafeSourceRoot" -C $sourceRoot ls-files --cached)
if ($global:LASTEXITCODE -ne 0) {
  throw "Could not enumerate tracked source files with Git."
}

$untrackedFiles = @()
if ($IncludeUntracked) {
  $global:LASTEXITCODE = 0
  $untrackedFiles = @(& $git.Source -c "safe.directory=$gitSafeSourceRoot" -C $sourceRoot ls-files --others --exclude-standard)
  if ($global:LASTEXITCODE -ne 0) {
    throw "Could not enumerate untracked source files with Git."
  }
  $privateUntrackedFiles = @($untrackedFiles | Where-Object { Test-PrivateLookingUntrackedPath $_ })
  if ($privateUntrackedFiles.Count -gt 0) {
    throw "Refusing to stage private-looking untracked files. Add private local files to .gitignore and retry."
  }
}
$sourceFiles = @($trackedFiles + $untrackedFiles | Sort-Object -Unique)
if ($sourceFiles.Count -eq 0) {
  throw "Git returned an empty source manifest."
}

Write-Host "Simple Vibe IDE Windows-local staged smoke"
Write-Host "Source: $(Format-DisplayPath $sourceRoot)"
Write-Host "Stage: $(Format-DisplayPath $stageFullPath)"
Write-Host "Cargo target: $(Format-DisplayPath $cargoFullPath)"
Write-Host "Source manifest entries: $($sourceFiles.Count)"

foreach ($relativePath in $sourceFiles) {
  if (-not $relativePath) { continue }
  if ([System.IO.Path]::IsPathRooted($relativePath) -or $relativePath -match "(^|[\\/])\.\.([\\/]|$)") {
    throw "Git returned an unsafe source path."
  }

  $windowsRelativePath = $relativePath.Replace("/", "\")
  $sourcePath = Join-Path $sourceRoot $windowsRelativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    continue
  }
  $destinationPath = Join-Path $stageFullPath $windowsRelativePath
  $destinationDirectory = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationDirectory)) {
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  }
  try {
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  } catch {
    throw "Could not stage source file '$relativePath': $(Format-DisplayPath $_.Exception.Message)"
  }
}

$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = $cargoFullPath
New-Item -ItemType Directory -Path $cargoFullPath -Force | Out-Null

Push-Location $stageFullPath
try {
  Invoke-NativeStep "Clean Windows npm install" {
    npm.cmd ci --no-audit --no-fund
  }

  $smokeParams = @{
    SkipNpmInstall = $true
    NoLaunch = $NoLaunch.IsPresent
  }
  & (Join-Path $stageFullPath "scripts\windows-runtime-smoke.ps1") @smokeParams
} finally {
  Pop-Location
}
