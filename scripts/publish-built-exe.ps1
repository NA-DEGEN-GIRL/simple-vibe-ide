param(
  [Parameter(Mandatory = $true)][string]$SourceExe,
  [Parameter(Mandatory = $true)][string]$BinaryName,
  [Parameter(Mandatory = $true)][string]$SnapshotDir
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-build-artifacts.ps1")

# Print only the published path; build-and-copy.cmd captures this result.
Save-VersionedBuiltExe -SourceExe $SourceExe -BinaryName $BinaryName -SnapshotDir $SnapshotDir
