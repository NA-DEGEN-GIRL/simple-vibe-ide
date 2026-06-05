param(
  [Parameter(Mandatory = $true)]
  [string]$Alias,

  [string]$RemoteCommand = "printf svi-agent-ok",

  [switch]$AllowElevate,
  [switch]$SkipSshAdd,
  [switch]$KeepPrivateAgent
)

$ErrorActionPreference = "Stop"

function Format-DisplayPath {
  param([string]$Path)
  if (-not $Path) { return $Path }
  $display = $Path
  if ($env:USERPROFILE) {
    $display = $display -replace [regex]::Escape($env:USERPROFILE), "%USERPROFILE%"
  }
  if ($env:TEMP) {
    $display = $display -replace [regex]::Escape($env:TEMP), "%TEMP%"
  }
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

function Get-OpenSshCommand {
  param([Parameter(Mandatory = $true)][string]$Name)
  $system = Join-Path $env:WINDIR "System32\OpenSSH\$Name"
  if (Test-Path -LiteralPath $system) { return $system }
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Could not find $Name"
}

function Test-AgentServiceRunning {
  $svc = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue
  return [bool]($svc -and $svc.Status -eq "Running")
}

function Try-Start-AgentService {
  try {
    $svc = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    Set-Service -Name ssh-agent -StartupType Manual -ErrorAction SilentlyContinue
    if ($svc.Status -ne "Running") {
      Start-Service -Name ssh-agent -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Host "normal ssh-agent service start failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Request-Elevated-AgentServiceStart {
  $script = "try { Set-Service -Name ssh-agent -StartupType Manual -ErrorAction SilentlyContinue; Start-Service -Name ssh-agent -ErrorAction SilentlyContinue } catch { Write-Host `$_.Exception.Message; exit 1 }"
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($script)
  $encoded = [Convert]::ToBase64String($bytes)
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) -Verb RunAs | Out-Null
}

function Start-PrivateAgent {
  param([Parameter(Mandatory = $true)][string]$SshAgent)
  $output = & $SshAgent -s
  foreach ($line in $output) {
    if ($line -match "^(SSH_AUTH_SOCK|SSH_AGENT_PID)=([^;]+);") {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
    }
  }
  if (-not $env:SSH_AUTH_SOCK) {
    throw "private ssh-agent did not provide SSH_AUTH_SOCK"
  }
  return @{
    SSH_AUTH_SOCK = $env:SSH_AUTH_SOCK
    SSH_AGENT_PID = $env:SSH_AGENT_PID
  }
}

function Stop-PrivateAgent {
  param([Parameter(Mandatory = $true)][string]$SshAgent)
  try {
    & $SshAgent -k | Out-Null
  } catch {
    Write-Host "private ssh-agent stop failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Get-IdentityFiles {
  param(
    [Parameter(Mandatory = $true)][string]$Ssh,
    [Parameter(Mandatory = $true)][string]$Alias
  )
  $files = @()
  $config = & $Ssh -G $Alias 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ssh -G failed while resolving identity files:" -ForegroundColor Yellow
    foreach ($line in $config) { Write-Host $line -ForegroundColor Yellow }
    return @()
  }
  foreach ($line in $config) {
    if (-not ($line -is [string])) { continue }
    if ($line -match "^identityfile\s+(.+)$") {
      $path = $Matches[1]
      if (-not $path -or $path.Contains("%")) { continue }
      if ($path -eq "~") {
        $path = $env:USERPROFILE
      } elseif ($path.StartsWith("~/") -or $path.StartsWith("~\")) {
        $path = Join-Path $env:USERPROFILE $path.Substring(2)
      }
      if (Test-Path -LiteralPath $path) { $files += $path }
    }
  }
  return @($files | Select-Object -Unique)
}

function Get-SshAddStatus {
  param([Parameter(Mandatory = $true)][string]$SshAdd)
  $output = & $SshAdd -l 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $output) { Write-Host $line }
  return [int]$code
}

$ssh = Get-OpenSshCommand "ssh.exe"
$sshAdd = Get-OpenSshCommand "ssh-add.exe"
$sshAgent = Get-OpenSshCommand "ssh-agent.exe"
$privateAgentStarted = $false

try {
  Write-Host "Simple Vibe IDE Windows SSH agent smoke"
  Write-Host "Alias: $Alias"
  Write-Host "ssh: $(Format-DisplayPath $ssh)"
  Write-Host "ssh-add: $(Format-DisplayPath $sshAdd)"
  Write-Host "ssh-agent: $(Format-DisplayPath $sshAgent)"

  Invoke-Step "Clear inherited SSH agent env" {
    Remove-Item Env:SSH_AUTH_SOCK -ErrorAction SilentlyContinue
    Remove-Item Env:SSH_AGENT_PID -ErrorAction SilentlyContinue
  }

  Invoke-Step "Start Windows OpenSSH Authentication Agent if possible" {
    Try-Start-AgentService
    if (-not (Test-AgentServiceRunning) -and $AllowElevate) {
      Write-Host "Requesting UAC to enable/start ssh-agent..." -ForegroundColor Yellow
      Request-Elevated-AgentServiceStart
      for ($i = 0; -not (Test-AgentServiceRunning) -and $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
      }
    }
    if (Test-AgentServiceRunning) {
      Write-Host "agent mode: Windows service"
    } else {
      Write-Host "agent service unavailable; using private process agent for this smoke" -ForegroundColor Yellow
      $private = Start-PrivateAgent -SshAgent $sshAgent
      $privateAgentStarted = $true
      Write-Host "agent mode: private process"
      Write-Host "private agent will be rejected if ssh-add cannot connect to it"
      Write-Host "private SSH_AUTH_SOCK: $(Format-DisplayPath $private.SSH_AUTH_SOCK)"
    }
  }

  Invoke-Step "Check ssh-add before unlock" {
    $status = Get-SshAddStatus -SshAdd $sshAdd
    Write-Host "ssh-add -l exit code: $status"
    if ($status -eq 0) {
      Write-Host "agent already has at least one identity"
    } elseif ($status -eq 1) {
      Write-Host "agent is reachable but has no identities"
    } else {
      throw "ssh-add cannot connect to an agent. Exit code: $status"
    }
  }

  if (-not $SkipSshAdd) {
    Invoke-Step "Unlock identity with ssh-add if needed" {
      $status = Get-SshAddStatus -SshAdd $sshAdd
      if ($status -eq 0) {
        Write-Host "skipping ssh-add because an identity is already loaded"
      } else {
        $identities = Get-IdentityFiles -Ssh $ssh -Alias $Alias
        if ($identities.Count -gt 0) {
          foreach ($identity in $identities) {
            Write-Host "ssh-add $(Format-DisplayPath $identity)"
            & $sshAdd -- $identity
            if ($LASTEXITCODE -eq 0) { break }
          }
        } else {
          Write-Host "ssh-add with default identities"
          & $sshAdd
        }
        $after = Get-SshAddStatus -SshAdd $sshAdd
        if ($after -ne 0) {
          throw "identity unlock did not leave a usable key in the agent. ssh-add -l exit code: $after"
        }
      }
    }
  }

  Invoke-Step "BatchMode SSH must work after unlock" {
    $output = & $ssh -o BatchMode=yes $Alias $RemoteCommand
    $code = $LASTEXITCODE
    Write-Host "ssh exit code: $code"
    Write-Host "ssh output: $output"
    if ($code -ne 0) {
      throw "BatchMode SSH failed after agent unlock"
    }
  }

  Write-Host ""
  Write-Host "ok: Windows SSH agent path can support noninteractive Explorer/File/LLM jobs for $Alias" -ForegroundColor Green
} finally {
  if ($privateAgentStarted -and -not $KeepPrivateAgent) {
    Stop-PrivateAgent -SshAgent $sshAgent
  } elseif ($privateAgentStarted) {
    Write-Host "kept private agent running for this PowerShell process environment only" -ForegroundColor Yellow
  }
}
