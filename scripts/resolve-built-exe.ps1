param(
  [Parameter(Mandatory = $true)][string]$BinaryName,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [string]$FallbackTargetDir = "D:\build-cache\simple-vibe-ide-target",
  [string]$ExcludeReleaseDir,
  [switch]$PreferRelease
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-build-artifacts.ps1")

$candidates = @()
foreach ($targetDir in @($env:CARGO_TARGET_DIR, $FallbackTargetDir, (Join-Path $RepoRoot "src-tauri\target"))) {
  if (-not $targetDir) { continue }
  $releaseExe = [System.IO.Path]::Combine($targetDir, "release", "$BinaryName.exe")
  # A caller immediately following its own successful build needs that Cargo output.
  # Runtime callers prefer the saved IDE before the Terminal build renames Cargo's exe.
  if ($PreferRelease) { $candidates += $releaseExe }
  else { $candidates += Find-RuntimeBuiltExe -TargetDir $targetDir -BinaryName $BinaryName }
}

$seen = @{}
$excludedFull = if ($ExcludeReleaseDir) {
  try { [System.IO.Path]::GetFullPath((Join-Path $ExcludeReleaseDir "$BinaryName.exe")) } catch { $null }
} else {
  $null
}
foreach ($candidate in $candidates) {
  if (-not $candidate) { continue }
  $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction SilentlyContinue
  if (-not $resolved) { continue }
  $item = Get-Item -LiteralPath $resolved.Path -ErrorAction SilentlyContinue
  if (-not $item -or $item.PSIsContainer) { continue }
  # build-and-copy.cmd may use the same directory for Cargo's release output
  # and the temp copy target. In that case the freshly built exe is already in
  # place; do not skip it and fall through to an older smoke-test snapshot.
  if ($excludedFull -and ([System.IO.Path]::GetFullPath($item.FullName) -ieq $excludedFull)) {
    $item.FullName
    exit 0
  }
  $key = $item.FullName.ToLowerInvariant()
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  $item.FullName
  exit 0
}

exit 1
