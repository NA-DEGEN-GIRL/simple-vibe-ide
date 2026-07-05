param(
  [Parameter(Mandatory = $true)][string]$BinaryName,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [string]$FallbackTargetDir = "D:\build-cache\simple-vibe-ide-target",
  [string]$ExcludeReleaseDir
)

$ErrorActionPreference = "Stop"

$candidates = @()
if ($env:CARGO_TARGET_DIR) {
  $candidates += Join-Path $env:CARGO_TARGET_DIR "release\$BinaryName.exe"
  $candidates += Join-Path $env:CARGO_TARGET_DIR "simple-vibe-build-sources\$BinaryName.exe"
}
if ($FallbackTargetDir) {
  $candidates += Join-Path $FallbackTargetDir "release\$BinaryName.exe"
  $candidates += Join-Path $FallbackTargetDir "simple-vibe-build-sources\$BinaryName.exe"
}
$candidates += Join-Path $RepoRoot "src-tauri\target\release\$BinaryName.exe"

$seen = @{}
$excludedFull = if ($ExcludeReleaseDir) {
  try { [System.IO.Path]::GetFullPath((Join-Path $ExcludeReleaseDir "$BinaryName.exe")) } catch { $null }
} else {
  $null
}
foreach ($candidate in $candidates) {
  $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
  if (-not $resolved) { continue }
  $item = Get-Item $resolved.Path -ErrorAction SilentlyContinue
  if (-not $item) { continue }
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
