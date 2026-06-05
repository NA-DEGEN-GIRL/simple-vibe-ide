# Clone Build Handoff

This note is for an LLM or developer starting from a fresh GitHub clone.
Read `AGENTS.md` and `codex.md` first, then use this file as a compact build
and runtime checklist.

## Project Shape

- Windows-first Tauri v2 desktop app.
- Frontend: TypeScript/Vite in `src/`.
- Backend/runtime: Rust/Tauri in `src-tauri/`.
- Terminal responsiveness is the main product constraint.

## Fresh Clone Baseline

```powershell
npm install
npm run check
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

For a Windows runtime smoke build:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

If building from a WSL checkout with Windows tools, run from a Windows shell and
use a Windows-local Cargo target directory:

```powershell
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

If `%TEMP%` is too small, use a spacious local path such as
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
- TUI cursor-position queries (`ESC[6n`) should be answered using current
  frontend cursor coordinates after pending terminal writes drain.
- Normal shell semantics must remain: selected text + `Ctrl+C` copies; no
  selection + `Ctrl+C` interrupts; `Ctrl+V` pastes.
- SSH/WSL startup injections must wait for the shell-ready OSC7 marker. Do not
  type LLM launcher calls, restored venv activation, or deferred workspace file
  loading into a login/passphrase prompt.
- SSH terminals on Windows should show a visible `ssh-add` unlock step before
  the remote SSH session if the Windows OpenSSH agent has no keys. This keeps
  the first key passphrase prompt in a visible shell and lets later
  noninteractive Explorer/File jobs and additional SSH LLM panes reuse the key
  through the Windows OpenSSH agent.
- Background SSH file operations are intentionally noninteractive
  (`BatchMode=yes`). They should reuse the shared agent if a key is unlocked
  and fail fast instead of prompting from hidden Explorer jobs when no key is
  available.

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

Then use the installer under `src-tauri\target\release\bundle\`.

## Privacy / Public Repo Safety

- Do not commit `.handoff/`, `.vibe-ide-temp/`, local target directories, tokens,
  cookies, private URLs, private account IDs, or real local home paths.
- Use placeholders such as `[USER]`, `[DISTRO]`, `[WORKSPACE]`, and `%TEMP%`.
- Keep Windows runtime results separate from repo-side validation.
