# Clone Build Handoff

This note is for an LLM or developer starting from a fresh GitHub clone.
Start with [AGENTS.md](../AGENTS.md) and the current
[portable development handoff](DEVELOPMENT_HANDOFF.md). Detailed
[OS setup](DEVELOPMENT_ENVIRONMENTS.md), [architecture](ARCHITECTURE.md), and
[testing](TESTING.md) are self-contained for a new machine. This older compact
checklist remains as a quick reference; `codex.md` is historical context.

## Project Shape

- Windows-first Tauri v2 desktop app.
- Frontend: TypeScript/Vite in `src/`.
- Backend/runtime: Rust/Tauri in `src-tauri/`.
- Terminal responsiveness is the main product constraint.

## Fresh Clone Baseline

```powershell
npm install
npm run check
npm run check:regressions
npm run build
npm run build:terminal
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

For a Windows runtime smoke build:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

If building from a WSL checkout with Windows tools, do not share that checkout's
`node_modules` between WSL and Windows. Run the staged gate from a Visual Studio
Developer PowerShell with Git for Windows available:

```powershell
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-staged-runtime-smoke.ps1 -NoLaunch'
```

If `%TEMP%` is too small, pass `-StageRoot` and `-CargoTargetDir` with spacious
Windows-local paths such as `D:\build-cache\simple-vibe-ide-win-src` and
`D:\build-cache\simple-vibe-ide-target`.

## Browser Preview Context

- The Browser preview should use the Tauri native child WebView2 surface.
- Do not return to iframe/proxy-first loading as the default.
- Do not return to external `msedge.exe --remote-debugging-port` CDP screencast
  as the default. That path was tried and the DevTools endpoint did not become
  ready reliably.
- Native WebView bounds must be clipped to the visible Browser preview grid cell
  so scrollable device previews cannot paint over the Browser console or other
  IDE UI.
- Browser `Fit` is a toggle. Pressing `Fit` again should restore the previous
  manual zoom.

## Terminal Context

- Do not reintroduce the old pty-host keep-alive/background terminal host.
- Direct in-process PTY I/O was kept for responsiveness.
- Keep xterm writes chunked.
- Rust filters TUI cursor-position queries (`ESC[6n`), flushes preceding output
  and emits a dedicated event. The frontend drains pending writes, calculates
  current xterm coordinates and queues CPR through the input sequencer. Never
  forward the raw query to xterm as well.
- Normal shell semantics must remain: selected text + `Ctrl+C` copies; no
  selection + `Ctrl+C` interrupts; `Ctrl+V` pastes.
- SSH/WSL startup injections must wait for the shell-ready OSC7 marker. Do not
  type LLM launcher calls, restored venv activation, or deferred workspace file
  loading into a login/passphrase prompt.
- SSH terminals and background Explorer/File/LLM jobs on Windows use the IDE's
  own `SSH_ASKPASS` broker. The first encrypted-key prompt should appear as a
  Simple Vibe IDE modal, and the passphrase is kept only in IDE process memory
  until the app exits.
- The Windows OpenSSH Authentication Agent service is optional now. If it is
  already running, SSH can still use it; otherwise the IDE askpass path should
  handle encrypted keys without requiring UAC, `ssh-add`, or service setup.
- Background SSH file operations use public-key auth with
  `NumberOfPasswordPrompts=1` plus the IDE askpass helper instead of
  `BatchMode=yes`, so a hidden Explorer job can request a visible unlock dialog
  rather than failing immediately.
- Do not gate SSH Explorer loading/refresh on terminal shell-ready state. The
  shell-ready gate is still correct for typing commands into terminals, but SSH
  Explorer reads should run directly through the askpass-capable background
  command path.
- SSH/WSL Explorer and file commands must stay off the synchronous IPC path
  because the askpass flow needs the WebView to remain responsive while the
  background SSH process waits for an unlock answer.
- For a local passphrase/agent regression check on Linux/WSL, run
  `scripts/ssh-agent-fixture-smoke.sh`. It starts a temporary localhost `sshd`,
  proves BatchMode SSH fails before unlock, proves direct `SSH_ASKPASS` works
  without an agent, unlocks a passphrase-protected key into `ssh-agent`, then
  proves BatchMode SSH succeeds both in the current shell and in a separate
  noninteractive job that only inherits the agent env.
- For the legacy Windows OpenSSH agent path, run
  `.\scripts\windows-ssh-agent-smoke.ps1 -Alias <ssh-config-alias> -AllowElevate`
  from Windows PowerShell. This is no longer the primary app path, but remains
  useful when diagnosing a machine-level OpenSSH agent/service problem.

## Release Portability

`.cargo/config.toml` currently uses:

```toml
rustflags = ["-C", "target-cpu=native"]
```

This means local release binaries are intended for the build machine. For a
portable build for other PCs, remove or override that setting and rebuild.

For a proper distributable artifact, prefer:

```powershell
npm run tauri -- build
```

Then use the installer under the selected Cargo target's `release\bundle\`
(normally `src-tauri\target\release\bundle\` without a target override).
For local builds, use the timestamped executable published by the Windows smoke
helpers instead of running mutable Cargo output. Building with `-NoLaunch` keeps
existing apps running; restarting the app, not compiling alone, ends its PTYs.

## Privacy / Public Repo Safety

- Do not commit `.handoff/`, `.vibe-ide-temp/`, local target directories, tokens,
  cookies, private URLs, private account IDs, or real local home paths.
- Use placeholders such as `[USER]`, `[DISTRO]`, `[WORKSPACE]`, and `%TEMP%`.
- Keep Windows runtime results separate from repo-side validation.
