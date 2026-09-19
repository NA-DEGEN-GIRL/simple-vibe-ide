# Run with Windows PowerShell 5.1 or PowerShell 7. Functions are extracted from
# the real scripts without running their npm/build/launch entry points. Resolver
# subprocesses only inspect GUID-owned fixtures; no application is launched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-artifacts.ps1')

function Assert-RoutingTest {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "Build routing regression: $Message" }
  $script:routingAssertions += 1
}

function Read-RoutingScriptAst {
  param([string]$Name)
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot $Name), [ref]$tokens, [ref]$parseErrors)
  Assert-RoutingTest ($parseErrors.Count -eq 0) "$Name parses without errors"
  return $ast
}

function Get-RoutingFunctions {
  param($Ast, [string[]]$Names)
  $definitions = @($Ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
  }, $true) | Where-Object { $Names -contains $_.Name })
  Assert-RoutingTest ($definitions.Count -eq $Names.Count) 'all requested real functions were found'
  return $definitions
}

function Assert-RoutingBytes {
  param([string]$Path, [byte[]]$Expected, [string]$Message)
  $actual = [System.IO.File]::ReadAllBytes($Path)
  Assert-RoutingTest ([Convert]::ToBase64String($actual) -eq [Convert]::ToBase64String($Expected)) $Message
}

$script:routingAssertions = 0
$runtimeAst = Read-RoutingScriptAst 'windows-runtime-smoke.ps1'
$tempAst = Read-RoutingScriptAst 'run-temp-release.ps1'
foreach ($name in @('windows-build-artifacts.ps1', 'windows-build-artifacts-smoke.ps1',
  'resolve-built-exe.ps1', 'publish-built-exe.ps1', 'windows-staged-runtime-smoke.ps1',
  'windows-build-routing-smoke.ps1')) {
  Read-RoutingScriptAst $name | Out-Null
}
$definitions = @(Get-RoutingFunctions $runtimeAst @('Format-DisplayPath', 'Find-BuiltExe',
  'Remove-StaleBuiltExe', 'Save-BuiltExeSnapshot'))
$definitions += @(Get-RoutingFunctions $tempAst @('Resolve-SourceExe', 'Copy-ExeToRelease'))
foreach ($definition in $definitions) {
  # Use the original AST body, not a rewritten source string. Its file context
  # preserves the real PSScriptRoot required by legacy resolver fallback paths.
  Set-Item -Path ('Function:' + $definition.Name) -Value $definition.Body.GetScriptBlock()
}

# run-built delegates here: a historical staged D: cache must not displace a
# fresh build in the launcher's own repository when no explicit target is set.
$targetLoops = @($tempAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.ForEachStatementAst] -and
  $node.Variable.VariablePath.UserPath -eq 'targetDir'
}, $true))
$targetOrder = if ($targetLoops.Count -eq 1) { $targetLoops[0].Condition.Extent.Text } else { '' }
$explicitPosition = $targetOrder.IndexOf('$env:CARGO_TARGET_DIR')
$repoPosition = $targetOrder.IndexOf('(Join-Path $PSScriptRoot "..\src-tauri\target")')
$fallbackPosition = $targetOrder.IndexOf('"D:\build-cache\simple-vibe-ide-target"')
$appPosition = $targetOrder.IndexOf('$AppRoot')
Assert-RoutingTest ($explicitPosition -ge 0 -and $explicitPosition -lt $repoPosition -and
  $repoPosition -lt $fallbackPosition -and $fallbackPosition -lt $appPosition) 'launcher source priority is explicit target, own repository, historical cache, then app fallback'

# These statements must remain in the top-level build entry point. Checking the
# parsed commands/assignments avoids accepting a matching comment as coverage.
$runtimeCommands = @($runtimeAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst]
}, $true))
foreach ($entry in @(
  @{ Variable = '$ideExe'; Product = 'Simple Vibe IDE'; Binary = 'simple-vibe-ide' },
  @{ Variable = '$terminalExe'; Product = 'Simple Vibe Terminal'; Binary = 'simple-vibe-terminal' }
)) {
  $validate = @($runtimeCommands | Where-Object {
    $_.GetCommandName() -eq 'Assert-ExeProductName' -and
    $_.Extent.Text.Contains('-ExePath ' + $entry.Variable) -and
    $_.Extent.Text.Contains('-ExpectedName "' + $entry.Product + '"')
  })
  $save = @($runtimeAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst]
  }, $true) | Where-Object {
    $_.Left.Extent.Text -eq $entry.Variable -and
    $_.Right.Extent.Text.Contains('Save-BuiltExeSnapshot -SourceExe ' + $entry.Variable) -and
    $_.Right.Extent.Text.Contains('-BinaryName "' + $entry.Binary + '"')
  })
  Assert-RoutingTest ($validate.Count -eq 1 -and $save.Count -eq 1) ($entry.Binary + ' metadata and snapshot assignment exist')
  Assert-RoutingTest ($validate[0].Extent.StartOffset -lt $save[0].Extent.StartOffset) ($entry.Binary + ' metadata is checked before publication')
}
$launch = @($runtimeCommands | Where-Object { $_.GetCommandName() -eq 'Start-Process' })
Assert-RoutingTest ($launch.Count -eq 1) 'runtime smoke has one app launch'
Assert-RoutingTest ($launch[0].Extent.Text.Contains('-FilePath $ideExe') -and
  $launch[0].Extent.Text.Contains('-WorkingDirectory (Split-Path -Parent $ideExe)')) 'runtime launches the saved IDE with snapshot cwd, not disposable source cwd'

$fixtureRoot = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),
  ('simple-vibe-routing-smoke-' + [Guid]::NewGuid().ToString('N')))
$savedTarget = $env:CARGO_TARGET_DIR
$savedExitCode = $global:LASTEXITCODE
$createdDrive = $false
$locks = @()
[System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
try {
  # Resolve-SourceExe still supports the conventional D: fallback. A temporary
  # PSDrive lets this read-only fallback execute on non-Windows test hosts too.
  if (-not (Get-PSDrive -Name D -ErrorAction SilentlyContinue)) {
    New-PSDrive -Name D -PSProvider FileSystem -Root $fixtureRoot | Out-Null
    $createdDrive = $true
  }
  $target = [System.IO.Path]::Combine($fixtureRoot, 'cargo target [test]')
  $release = [System.IO.Path]::Combine($target, 'release')
  $snapshots = [System.IO.Path]::Combine($target, 'simple-vibe-build-sources')
  [System.IO.Directory]::CreateDirectory($release) | Out-Null
  [System.IO.Directory]::CreateDirectory($snapshots) | Out-Null
  $env:CARGO_TARGET_DIR = $target
  $AppRoot = [System.IO.Path]::Combine($fixtureRoot, 'app root [test]')
  $repo = [System.IO.Path]::Combine($fixtureRoot, 'repo [test]')
  [System.IO.Directory]::CreateDirectory($repo) | Out-Null
  $raw = [System.IO.Path]::Combine($release, 'simple-vibe-ide.exe')
  $terminalRaw = [System.IO.Path]::Combine($release, 'simple-vibe-terminal.exe')
  $legacy = [System.IO.Path]::Combine($snapshots, 'simple-vibe-ide.exe')
  $firstBytes = [byte[]](0, 128, 255, 1, 42)
  $secondBytes = [byte[]](127, 2, 3, 255, 0, 19)
  [System.IO.File]::WriteAllBytes($raw, $firstBytes)
  [System.IO.File]::WriteAllBytes($terminalRaw, $secondBytes)
  [System.IO.File]::WriteAllBytes($legacy, $firstBytes)
  $oldVersion = Save-VersionedBuiltExe $raw 'simple-vibe-ide' $snapshots
  foreach ($path in @($legacy, $oldVersion)) {
    $locks += [System.IO.File]::Open($path, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  }
  Remove-StaleBuiltExe 'simple-vibe-ide'
  Assert-RoutingTest (-not [System.IO.File]::Exists($raw)) 'cleanup removes only the selected mutable Cargo exe'
  Assert-RoutingBytes $terminalRaw $secondBytes 'cleanup leaves the other Cargo binary alone'
  Assert-RoutingBytes $legacy $firstBytes 'cleanup preserves the locked stable snapshot'
  Assert-RoutingBytes $oldVersion $firstBytes 'cleanup preserves the locked versioned snapshot'
  foreach ($handle in $locks) { $handle.Dispose() }
  $locks = @()

  [System.IO.File]::WriteAllBytes($raw, $secondBytes)
  Assert-RoutingTest ((Find-BuiltExe 'simple-vibe-ide') -eq $raw) 'fresh Cargo resolution treats bracket paths literally'
  $savedFirst = Save-BuiltExeSnapshot $raw 'simple-vibe-ide'
  $savedSecond = Save-BuiltExeSnapshot $raw 'simple-vibe-ide'
  Assert-RoutingTest ($savedFirst -ne $savedSecond -and $savedFirst -ne $legacy) 'runtime snapshot wrapper delegates to unique publication'
  Assert-RoutingTest ([System.IO.Path]::GetDirectoryName($savedFirst) -eq $snapshots) 'runtime snapshot is outside mutable release directory'
  [System.IO.File]::WriteAllBytes($raw, $firstBytes)
  Assert-RoutingBytes $savedFirst $secondBytes 'runtime snapshot is an independent copy'
  Assert-RoutingBytes $savedSecond $secondBytes 'repeated runtime publication is independent'

  # A source already inside the runtime directory must still get a new copy.
  $copied = Copy-ExeToRelease -Source $savedFirst -BinaryName 'simple-vibe-ide' -ReleaseDir $snapshots
  Assert-RoutingTest ($copied.Source -eq $savedFirst -and $copied.Exe -ne $savedFirst) 'temp launcher never reuses its source path'
  [System.IO.File]::WriteAllBytes($savedFirst, $firstBytes)
  Assert-RoutingBytes $copied.Exe $secondBytes 'temp launcher copy has separate bytes even for colocated source'
  [System.IO.File]::SetLastWriteTimeUtc($copied.Exe, [DateTime]::UtcNow.AddDays(1))
  Assert-RoutingTest ((Resolve-SourceExe -BinaryName 'simple-vibe-ide' -Required) -eq $copied.Exe) 'temp resolver prefers latest timestamped snapshot over raw Cargo output'
  Assert-RoutingTest ((Resolve-SourceExe -Requested $raw -BinaryName 'simple-vibe-ide' -Required) -eq $raw) 'an explicit source is honored'

  $resolver = Join-Path $PSScriptRoot 'resolve-built-exe.ps1'
  $hostExecutable = (Get-Process -Id $PID).Path
  $resolved = @(& $hostExecutable -NoLogo -NoProfile -NonInteractive -File $resolver `
    -BinaryName 'simple-vibe-ide' -RepoRoot $repo -FallbackTargetDir $target)
  Assert-RoutingTest ($global:LASTEXITCODE -eq 0 -and $resolved.Count -eq 1 -and $resolved[0] -eq $copied.Exe) 'standalone resolver defaults to saved runtime snapshot'
  $resolved = @(& $hostExecutable -NoLogo -NoProfile -NonInteractive -File $resolver `
    -BinaryName 'simple-vibe-ide' -RepoRoot $repo -FallbackTargetDir $target -PreferRelease)
  Assert-RoutingTest ($global:LASTEXITCODE -eq 0 -and $resolved.Count -eq 1 -and $resolved[0] -eq $raw) 'immediate post-build resolver explicitly prefers fresh Cargo output'

  # Exercise migration on a separate target with only the old stable snapshot.
  $legacyTarget = [System.IO.Path]::Combine($fixtureRoot, 'legacy target [test]')
  $legacyDir = [System.IO.Path]::Combine($legacyTarget, 'simple-vibe-build-sources')
  [System.IO.Directory]::CreateDirectory($legacyDir) | Out-Null
  $legacyOnly = [System.IO.Path]::Combine($legacyDir, 'simple-vibe-ide.exe')
  [System.IO.File]::WriteAllBytes($legacyOnly, $firstBytes)
  $env:CARGO_TARGET_DIR = $legacyTarget
  Assert-RoutingTest ((Resolve-SourceExe -BinaryName 'simple-vibe-ide' -Required) -eq $legacyOnly) 'temp resolver supports old stable snapshot fallback'
  $resolved = @(& $hostExecutable -NoLogo -NoProfile -NonInteractive -File $resolver `
    -BinaryName 'simple-vibe-ide' -RepoRoot $repo -FallbackTargetDir $legacyTarget)
  Assert-RoutingTest ($global:LASTEXITCODE -eq 0 -and $resolved.Count -eq 1 -and $resolved[0] -eq $legacyOnly) 'standalone resolver supports old stable snapshot fallback'
  $resolved = @(& $hostExecutable -NoLogo -NoProfile -NonInteractive -File $resolver `
    -BinaryName 'simple-vibe-ide' -RepoRoot $repo -FallbackTargetDir $legacyTarget -PreferRelease)
  Assert-RoutingTest ($global:LASTEXITCODE -eq 1 -and $resolved.Count -eq 0) 'post-build resolution fails if fresh Cargo output is absent instead of returning an old snapshot'
  Write-Host "Build routing smoke passed: $script:routingAssertions assertions; no build or app was launched."
} finally {
  foreach ($handle in $locks) { $handle.Dispose() }
  $env:CARGO_TARGET_DIR = $savedTarget
  $global:LASTEXITCODE = $savedExitCode
  if ($createdDrive) { Remove-PSDrive -Name D -Force }
  # Never clean a caller's targets or snapshots; remove only this run's tree.
  if ([System.IO.Directory]::Exists($fixtureRoot)) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
