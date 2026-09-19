# Shared Windows build artifact helpers. Dot-sourcing this file does not build,
# launch, remove old snapshots, or change the caller's working directory.

function Assert-BuildArtifactBinaryName {
  param([Parameter(Mandatory = $true)][string]$BinaryName)

  if ($BinaryName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
    throw "Build artifact binary name must be a plain filename without an extension."
  }
}

function Save-VersionedBuiltExe {
  param(
    [Parameter(Mandatory = $true)][string]$SourceExe,
    [Parameter(Mandatory = $true)][string]$BinaryName,
    [Parameter(Mandatory = $true)][string]$SnapshotDir
  )

  Assert-BuildArtifactBinaryName $BinaryName
  $sourceItem = Get-Item -LiteralPath $SourceExe -Force -ErrorAction Stop
  if ($sourceItem.PSIsContainer -or
      ($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "Build artifact source must be a regular file, not a directory or link."
  }

  $snapshotFullPath = [System.IO.Path]::GetFullPath($SnapshotDir)
  [System.IO.Directory]::CreateDirectory($snapshotFullPath) | Out-Null
  $directoryItem = Get-Item -LiteralPath $snapshotFullPath -Force -ErrorAction Stop
  if ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Build snapshot directory must not be a link or junction."
  }

  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff', [Globalization.CultureInfo]::InvariantCulture)
  $nonce = [Guid]::NewGuid().ToString('N')
  $snapshotName = "$BinaryName-$stamp-$nonce.exe"
  $snapshotPath = [System.IO.Path]::Combine($snapshotFullPath, $snapshotName)
  $partialPath = "$snapshotPath.partial"
  $sourceStream = $null
  $destinationStream = $null
  $ownsPartial = $false
  try {
    # Copy bytes into a new file: hard links would let a later Cargo build mutate
    # the running snapshot. CreateNew and File.Move never overwrite older files.
    $sourceStream = [System.IO.File]::Open($sourceItem.FullName,
      [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $destinationStream = [System.IO.File]::Open($partialPath,
      [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $ownsPartial = $true
    $sourceStream.CopyTo($destinationStream)
    $destinationStream.Dispose()
    $destinationStream = $null
    $sourceStream.Dispose()
    $sourceStream = $null
    [System.IO.File]::SetLastWriteTimeUtc($partialPath, [DateTime]::UtcNow)
    # Same-directory rename publishes only the completed copy. This two-argument
    # overload is supported by Windows PowerShell 5.1 and refuses replacement.
    [System.IO.File]::Move($partialPath, $snapshotPath)
    $ownsPartial = $false
    return $snapshotPath
  } finally {
    if ($destinationStream) { $destinationStream.Dispose() }
    if ($sourceStream) { $sourceStream.Dispose() }
    if ($ownsPartial -and [System.IO.File]::Exists($partialPath)) {
      [System.IO.File]::Delete($partialPath)
    }
  }
}

function Find-SavedBuiltExe {
  param(
    [Parameter(Mandatory = $true)][string]$TargetDir,
    [Parameter(Mandatory = $true)][string]$BinaryName
  )

  Assert-BuildArtifactBinaryName $BinaryName
  $snapshotDir = [System.IO.Path]::Combine($TargetDir, 'simple-vibe-build-sources')
  $directoryItem = Get-Item -LiteralPath $snapshotDir -Force -ErrorAction SilentlyContinue
  if (-not $directoryItem -or -not $directoryItem.PSIsContainer -or
      ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    return $null
  }

  $escapedBinary = [regex]::Escape($BinaryName)
  $pattern = "^$escapedBinary-(?<stamp>\d{8}-\d{6}-\d{3})-[a-fA-F0-9]{32}\.exe$"
  $candidates = @(Get-ChildItem -LiteralPath $snapshotDir -File -Force -ErrorAction Stop | Where-Object {
    if ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $false }
    $match = [regex]::Match($_.Name, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { return $false }
    $parsedStamp = [DateTime]::MinValue
    return [DateTime]::TryParseExact($match.Groups['stamp'].Value, 'yyyyMMdd-HHmmss-fff',
      [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None,
      [ref]$parsedStamp)
  } | Sort-Object -Property @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true },
    @{ Expression = { $_.Name }; Descending = $true })
  if ($candidates.Count -gt 0) { return $candidates[0].FullName }

  $legacyPath = [System.IO.Path]::Combine($snapshotDir, "$BinaryName.exe")
  $legacyItem = Get-Item -LiteralPath $legacyPath -Force -ErrorAction SilentlyContinue
  if ($legacyItem -and -not $legacyItem.PSIsContainer -and
      -not ($legacyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    return $legacyItem.FullName
  }
  return $null
}

function Select-RuntimeBuiltExeItem {
  param(
    [AllowNull()][object]$SavedItem,
    [AllowNull()][object]$ReleaseItem,
    [Parameter(Mandatory = $true)][string]$BinaryName
  )

  Assert-BuildArtifactBinaryName $BinaryName
  if ($SavedItem -and ($SavedItem.PSIsContainer -or
      ($SavedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint))) {
    $SavedItem = $null
  }
  if ($ReleaseItem -and ($ReleaseItem.PSIsContainer -or
      ($ReleaseItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint))) {
    $ReleaseItem = $null
  }
  if (-not $SavedItem) {
    if ($ReleaseItem) { return $ReleaseItem.FullName }
    return $null
  }
  if (-not $ReleaseItem -or $ReleaseItem.LastWriteTimeUtc -le $SavedItem.LastWriteTimeUtc) {
    return $SavedItem.FullName
  }

  $expectedName = switch ($BinaryName.ToLowerInvariant()) {
    'simple-vibe-ide' { 'Simple Vibe IDE' }
    'simple-vibe-terminal' { 'Simple Vibe Terminal' }
    default { $null }
  }
  if ($expectedName) {
    try {
      # A direct newer Tauri build may supersede the last published snapshot.
      # A failed Terminal build can also leave Terminal bytes under the IDE's
      # Cargo basename, so a newer timestamp alone is not enough to select it.
      $info = $ReleaseItem.VersionInfo
      if ($info -and $info.ProductName -ceq $expectedName -and
          $info.FileDescription -ceq $expectedName) {
        return $ReleaseItem.FullName
      }
    } catch {
      # Unreadable/missing metadata cannot displace a saved runtime snapshot.
    }
  }
  return $SavedItem.FullName
}

function Find-RuntimeBuiltExe {
  param(
    [Parameter(Mandatory = $true)][string]$TargetDir,
    [Parameter(Mandatory = $true)][string]$BinaryName
  )

  Assert-BuildArtifactBinaryName $BinaryName
  $savedPath = Find-SavedBuiltExe -TargetDir $TargetDir -BinaryName $BinaryName
  $savedItem = if ($savedPath) {
    Get-Item -LiteralPath $savedPath -Force -ErrorAction SilentlyContinue
  } else { $null }
  $releaseDir = [System.IO.Path]::Combine($TargetDir, 'release')
  $releasePath = [System.IO.Path]::Combine($releaseDir, "$BinaryName.exe")
  $releaseItem = Get-Item -LiteralPath $releasePath -Force -ErrorAction SilentlyContinue
  return Select-RuntimeBuiltExeItem -SavedItem $savedItem -ReleaseItem $releaseItem -BinaryName $BinaryName
}
