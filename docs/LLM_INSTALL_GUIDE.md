# LLM / Agent Build Guide

This guide is written for coding agents and LLM assistants that need to help a
user install, build, run, or verify Simple Vibe IDE.

Simple Vibe IDE is a Windows-only Tauri v2 desktop app. The frontend is
TypeScript/Vite and the backend is Rust/Tauri. WSL, SSH, and Windows shells are
runtime targets, but the desktop app itself should be built and verified with
Windows Node.js, Windows Rust, and the MSVC toolchain.

## Privacy Rules For Agents

- Never print secrets, tokens, private env values, cookies, Authorization
  headers, private URLs, or raw local home directory usernames.
- Use placeholders such as `[USER]`, `[DISTRO]`, `[WORKSPACE]`, and
  `[PRIVATE_URL]` in reports and examples.
- Do not commit `.env`, private screenshots, attachments, workspace temp output,
  or user-specific machine paths.
- Separate verified results from assumptions. If a command failed, report it as
  failed.

## Required Environment

Run these from PowerShell on Windows:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

Expected:

- Node.js 22 or newer
- npm matching the installed Node.js
- Rust installed through `rustup`
- MSVC Rust toolchain, commonly `stable-x86_64-pc-windows-msvc`
- Visual Studio Build Tools C++ workload if Rust/Tauri asks for linker or C++
  build tools

Optional runtime tools:

- WSL distro for WSL workspaces
- Windows OpenSSH client for SSH workspaces
- LLM CLIs if the launcher buttons should work: `codex`, `claude`, `grok`,
  `antigravity`

## Normal Windows Checkout

Use this when the repo is on a normal Windows filesystem.

```powershell
npm install
npm run check
npm run build
cd src-tauri
cargo check
cd ..
npm run tauri:dev
```

For a release executable:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
npm run tauri:build -- --no-bundle
.\run-built.vbs
```

`run-built.vbs` starts the built app without an extra console window.
`run-built.cmd` is the debug launcher when the console output is useful.

## WSL Checkout Built From Windows

Use this when the repo lives inside WSL but Windows Node/Rust/Tauri should build
the desktop app. Do not rely on Linux `cargo` unless it is actually installed
and the task is Linux-only frontend checking.

Prefer `cmd pushd` so Windows gets a temporary drive mapping for the WSL UNC
path, and keep Cargo output on a Windows-local temp directory:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && npm install && npm run check && npm run build && cd src-tauri && cargo check && cd .. && npm run tauri:dev'
```

Release build from a WSL checkout:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && npm run tauri:build -- --no-bundle'
```

Then launch:

```powershell
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && run-built.vbs'
```

Replace `[DISTRO]` and `[USER]` before running. Do not expose the real values in
public reports.

## Verification Checklist

At minimum, verify:

```powershell
npm run check
npm run build
cd src-tauri
cargo check
cd ..
```

For a real desktop app verification, also run:

```powershell
npm run tauri:dev
```

or build the release executable:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
npm run tauri:build -- --no-bundle
.\run-built.vbs
```

Smoke test in the app:

- First launch opens an empty workspace.
- Windows, WSL, and SSH profiles are shown when available.
- Opening a workspace updates Explorer, shell, editor, image preview, browser,
  notes, and calculator state.
- Shell, Windows shell, Codex, Claude, Grok, and Antigravity launchers open
  terminal widgets.
- Env files open in the secure masked editor; `.env.example` and sample/example
  files are not masked by default.
- Image files open in Image Preview, not as UTF-8 text.
- Clipboard image paste saves an attachment and optionally pastes an `@...` tag
  into the active shell.
- Browser tabs can open a local port or full URL.
- Notes, Calculator, and Browser keyboard zoom controls affect the focused
  widget content, not the whole widget frame.

## Common Failure Modes

### `cargo` is missing in WSL

This is expected on some development machines. Do not claim Rust verification
passed from WSL. Run Windows `cargo check` or Windows Tauri build instead.

### `listen EACCES` on dev server startup

The app pins Vite/Tauri dev to `127.0.0.1:15320`. If that port is unavailable,
update both `vite.config.ts` and `src-tauri/tauri.conf.json` together.

### WSL path translation errors

Use `run-built.vbs` after a release build. It starts the executable from a
Windows-local working directory and passes the repo root separately.

### LLM launcher command not found

Install the matching CLI in the selected profile environment. Windows, WSL, and
SSH each have separate PATHs.

### Binance ticker is stale

The toolbar market ticker uses Binance USD-M public WebSocket data and a slow
REST fallback. If the network blocks Binance, the ticker may stay stale while
the IDE remains usable.

## Agent Reporting Template

Use a short final report:

```text
Changed files:
- ...

Verified:
- npm run check: pass/fail
- npm run build: pass/fail
- cargo check: pass/fail/not run
- Windows Tauri build: pass/fail/not run
- Manual smoke test: pass/fail/not run

Known limits:
- ...

Next command for the user:
- ...
```

Only list commands that were actually run. If a command failed or could not be
run, say so directly.
