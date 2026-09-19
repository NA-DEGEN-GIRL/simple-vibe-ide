# Run with Windows PowerShell 5.1 or PowerShell 7. Only disposable fixture files
# are touched; no compiler, application, or child process is started.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-artifacts.ps1')

function Assert-ArtifactTest {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "Build artifact regression: $Message" }
}

function Assert-ArtifactBytes {
  param([string]$Path, [byte[]]$Expected, [string]$Message)
  $actual = [System.IO.File]::ReadAllBytes($Path)
  Assert-ArtifactTest ([Convert]::ToBase64String($actual) -eq [Convert]::ToBase64String($Expected)) $Message
}

function Write-ArtifactFixture {
  param([string]$Path, [byte[]]$Bytes)
  [System.IO.File]::WriteAllBytes($Path, $Bytes)
}

function New-RuntimeArtifactFixtureItem {
  param([string]$FullName, [DateTime]$LastWriteTimeUtc, [string]$ProductName, [string]$FileDescription)
  return [pscustomobject]@{
    FullName = $FullName
    LastWriteTimeUtc = $LastWriteTimeUtc
    PSIsContainer = $false
    Attributes = [System.IO.FileAttributes]::Normal
    VersionInfo = [pscustomobject]@{ ProductName = $ProductName; FileDescription = $FileDescription }
  }
}

$fixtureRoot = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),
  ('simple-vibe-artifacts-smoke-' + [Guid]::NewGuid().ToString('N')))
[System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$lockedStream = $null
try {
  # Keep source ASCII while exercising real Hangul and wildcard-like paths.
  $unicodeLeaf = 'project [test] ' + [char]0xD55C + [char]0xAE00
  $targetDir = [System.IO.Path]::Combine($fixtureRoot, $unicodeLeaf)
  $snapshotDir = [System.IO.Path]::Combine($targetDir, 'simple-vibe-build-sources')
  [System.IO.Directory]::CreateDirectory($snapshotDir) | Out-Null
  $source = [System.IO.Path]::Combine($targetDir, 'source [app].exe')
  $firstBytes = [byte[]](0, 1, 2, 3, 127, 128, 254, 255)
  $secondBytes = [byte[]](255, 42, 0, 128, 7)
  Write-ArtifactFixture $source $firstBytes

  $legacy = [System.IO.Path]::Combine($snapshotDir, 'simple-vibe-ide.exe')
  Write-ArtifactFixture $legacy $firstBytes
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-ide') -eq $legacy) 'legacy fallback'
  $lockedStream = [System.IO.File]::Open($legacy, [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $first = Save-VersionedBuiltExe $source 'simple-vibe-ide' $snapshotDir
  Assert-ArtifactTest ($first -match 'simple-vibe-ide-\d{8}-\d{6}-\d{3}-[a-f0-9]{32}\.exe$') 'versioned basename'
  Assert-ArtifactBytes $first $firstBytes 'first snapshot bytes'
  Assert-ArtifactBytes $legacy $firstBytes 'locked legacy snapshot unchanged'
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'versioned snapshot preferred over legacy'
  $lockedStream.Dispose()
  $lockedStream = $null
  [System.IO.File]::SetLastWriteTimeUtc($legacy, [DateTime]::UtcNow.AddDays(3))
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'newer legacy mtime does not hide a versioned snapshot'

  $lockedStream = [System.IO.File]::Open($first, [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  Write-ArtifactFixture $source $secondBytes
  $second = Save-VersionedBuiltExe $source 'simple-vibe-ide' $snapshotDir
  $third = Save-VersionedBuiltExe $source 'simple-vibe-ide' $snapshotDir
  Assert-ArtifactTest ($first -ne $second -and $second -ne $third) 'repeated publication is unique'
  Assert-ArtifactBytes $first $firstBytes 'old locked snapshot independent of changed source'
  Assert-ArtifactBytes $second $secondBytes 'second snapshot bytes'
  Assert-ArtifactBytes $third $secondBytes 'third snapshot bytes'
  Assert-ArtifactBytes $source $secondBytes 'source preserved'
  $lockedStream.Dispose()
  $lockedStream = $null

  # Resolution uses the completed files' actual modification times, not a
  # filename's claimed timestamp, and separates IDE and Terminal snapshots.
  [System.IO.File]::SetLastWriteTimeUtc($first, [DateTime]::UtcNow.AddDays(1))
  $terminal = Save-VersionedBuiltExe $source 'simple-vibe-terminal' $snapshotDir
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'actual file timestamp determines latest'
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-terminal') -eq $terminal) 'per-binary resolution'

  $ignoredPartial = [System.IO.Path]::Combine($snapshotDir,
    'simple-vibe-ide-20990101-000000-000-00000000000000000000000000000000.exe.partial')
  Write-ArtifactFixture $ignoredPartial $secondBytes
  $invalidStamp = [System.IO.Path]::Combine($snapshotDir,
    'simple-vibe-ide-20999999-000000-000-00000000000000000000000000000000.exe')
  Write-ArtifactFixture $invalidStamp $secondBytes
  $directoryCandidate = [System.IO.Path]::Combine($snapshotDir,
    'simple-vibe-ide-20990101-000000-000-11111111111111111111111111111111.exe')
  [System.IO.Directory]::CreateDirectory($directoryCandidate) | Out-Null
  Assert-ArtifactTest ((Find-SavedBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'partials, invalid timestamps and directories ignored'
  Assert-ArtifactBytes $ignoredPartial $secondBytes 'unrelated partial remains untouched'

  $invalidRejected = $false
  try { Save-VersionedBuiltExe $source '../outside' $snapshotDir | Out-Null }
  catch { $invalidRejected = $true }
  Assert-ArtifactTest $invalidRejected 'path traversal rejected'
  $invalidRejected = $false
  try { Find-SavedBuiltExe $targetDir '../outside' | Out-Null }
  catch { $invalidRejected = $true }
  Assert-ArtifactTest $invalidRejected 'resolver path traversal rejected'

  $directoryRejected = $false
  try { Save-VersionedBuiltExe $targetDir 'simple-vibe-ide' $snapshotDir | Out-Null }
  catch { $directoryRejected = $true }
  Assert-ArtifactTest $directoryRejected 'directory source rejected'
  Assert-ArtifactTest ($null -eq (Find-SavedBuiltExe ([System.IO.Path]::Combine($fixtureRoot, 'absent')) 'simple-vibe-ide')) 'absent snapshot directory'
  $lockedStream = [System.IO.File]::Open($source, [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
  $lockedSourceRejected = $false
  try { Save-VersionedBuiltExe $source 'simple-vibe-ide' $snapshotDir | Out-Null }
  catch { $lockedSourceRejected = $true }
  Assert-ArtifactTest $lockedSourceRejected 'unreadable source does not publish a snapshot'
  $lockedStream.Dispose()
  $lockedStream = $null

  # Symbolic links may require elevation or developer mode on Windows. Run this
  # portion wherever fixture creation is supported, and report rather than hide
  # the OS limitation. Reparse filtering itself is unconditional in the helper.
  $linkTargetDir = [System.IO.Path]::Combine($fixtureRoot, 'link-only')
  $linkSnapshotDir = [System.IO.Path]::Combine($linkTargetDir, 'simple-vibe-build-sources')
  [System.IO.Directory]::CreateDirectory($linkSnapshotDir) | Out-Null
  $linkLegacy = [System.IO.Path]::Combine($linkSnapshotDir, 'simple-vibe-ide.exe')
  Write-ArtifactFixture $linkLegacy $firstBytes
  $linkPath = [System.IO.Path]::Combine($linkSnapshotDir,
    'simple-vibe-ide-20990101-000000-000-22222222222222222222222222222222.exe')
  $linkCreated = $false
  try {
    New-Item -ItemType SymbolicLink -Path $linkPath -Target $source -ErrorAction Stop | Out-Null
    $linkCreated = $true
  } catch {
    Write-Host 'Build artifacts smoke: symbolic-link fixture unavailable on this host.'
  }
  if ($linkCreated) {
    Assert-ArtifactTest ((Find-SavedBuiltExe $linkTargetDir 'simple-vibe-ide') -eq $linkLegacy) 'symbolic-link snapshot ignored before legacy fallback'
    $linkRejected = $false
    try { Save-VersionedBuiltExe $linkPath 'simple-vibe-ide' $snapshotDir | Out-Null }
    catch { $linkRejected = $true }
    Assert-ArtifactTest $linkRejected 'symbolic-link source rejected'
  }

  $remainingPartials = @(Get-ChildItem -LiteralPath $snapshotDir -File -Force |
    Where-Object { $_.Name.EndsWith('.partial') })
  Assert-ArtifactTest ($remainingPartials.Count -eq 1 -and $remainingPartials[0].FullName -eq $ignoredPartial) 'no publication partials remain'

  # Real fixture files cover the resolver wiring and no-snapshot fallback.
  # Pure selection fixtures supply version metadata without inventing PE bytes.
  Assert-ArtifactTest ((Find-RuntimeBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'runtime uses saved snapshot without raw output'
  $releaseDir = [System.IO.Path]::Combine($targetDir, 'release')
  [System.IO.Directory]::CreateDirectory($releaseDir) | Out-Null
  $rawExe = [System.IO.Path]::Combine($releaseDir, 'simple-vibe-ide.exe')
  Write-ArtifactFixture $rawExe $secondBytes
  [System.IO.File]::SetLastWriteTimeUtc($rawExe, [DateTime]::UtcNow.AddDays(4))
  Assert-ArtifactTest ((Find-RuntimeBuiltExe $targetDir 'simple-vibe-ide') -eq $first) 'newer raw file without product metadata does not hide snapshot'
  $rawOnlyTarget = [System.IO.Path]::Combine($fixtureRoot, 'raw-only')
  $rawOnlyRelease = [System.IO.Path]::Combine($rawOnlyTarget, 'release')
  [System.IO.Directory]::CreateDirectory($rawOnlyRelease) | Out-Null
  $rawOnlyExe = [System.IO.Path]::Combine($rawOnlyRelease, 'simple-vibe-ide.exe')
  Write-ArtifactFixture $rawOnlyExe $firstBytes
  Assert-ArtifactTest ((Find-RuntimeBuiltExe $rawOnlyTarget 'simple-vibe-ide') -eq $rawOnlyExe) 'raw output fallback without snapshots'
  Assert-ArtifactTest ($null -eq (Find-RuntimeBuiltExe $rawOnlyTarget 'simple-vibe-terminal')) 'runtime absent binary is null'

  $savedFixture = New-RuntimeArtifactFixtureItem 'saved.exe' ([DateTime]::UtcNow) '' ''
  $newerTime = $savedFixture.LastWriteTimeUtc.AddMinutes(1)
  $rawFixture = New-RuntimeArtifactFixtureItem 'raw.exe' $newerTime 'Simple Vibe IDE' 'Simple Vibe IDE'
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-ide') -eq 'raw.exe') 'newer verified direct IDE build preferred'
  $rawFixture.VersionInfo.ProductName = 'Simple Vibe Terminal'
  $rawFixture.VersionInfo.FileDescription = 'Simple Vibe Terminal'
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-ide') -eq 'saved.exe') 'failed Terminal build cannot contaminate IDE selection'
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-terminal') -eq 'raw.exe') 'newer verified direct Terminal build preferred'
  $rawFixture.VersionInfo.FileDescription = 'Other description'
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-terminal') -eq 'saved.exe') 'both product name and description must match'
  $rawFixture.VersionInfo.ProductName = 'Simple Vibe IDE'
  $rawFixture.VersionInfo.FileDescription = 'Simple Vibe IDE'
  $rawFixture.LastWriteTimeUtc = $savedFixture.LastWriteTimeUtc
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-ide') -eq 'saved.exe') 'equal timestamps retain snapshot'
  $rawFixture.LastWriteTimeUtc = $savedFixture.LastWriteTimeUtc.AddMinutes(-1)
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-ide') -eq 'saved.exe') 'older direct build retains snapshot'
  $rawFixture.LastWriteTimeUtc = $newerTime
  $rawFixture.Attributes = [System.IO.FileAttributes]::ReparsePoint
  Assert-ArtifactTest ((Select-RuntimeBuiltExeItem $savedFixture $rawFixture 'simple-vibe-ide') -eq 'saved.exe') 'linked raw output never displaces snapshot'
  Assert-ArtifactTest ($null -eq (Select-RuntimeBuiltExeItem $null $rawFixture 'simple-vibe-ide')) 'linked raw output not used as fallback'
  $rawFixture.Attributes = [System.IO.FileAttributes]::Normal
  $rawFixture.PSIsContainer = $true
  Assert-ArtifactTest ($null -eq (Select-RuntimeBuiltExeItem $null $rawFixture 'simple-vibe-ide')) 'directory raw output not used as fallback'
  $invalidRejected = $false
  try { Find-RuntimeBuiltExe $targetDir '../outside' | Out-Null }
  catch { $invalidRejected = $true }
  Assert-ArtifactTest $invalidRejected 'runtime resolver path traversal rejected'

  Write-Host 'Build artifacts smoke passed: immutable copies, locked old files, latest/runtime resolution, metadata guards, Unicode paths and filename guards.'
} finally {
  if ($lockedStream) { $lockedStream.Dispose() }
  # Only this invocation's GUID-owned fixture tree is removed, never build data.
  if ([System.IO.Directory]::Exists($fixtureRoot)) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
