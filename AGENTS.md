# AGENTS.md

## Project Overview

Simple Vibe IDE is a Windows-first Tauri v2 desktop app for fast WSL/SSH/Windows shell based LLM coding sessions. The frontend is TypeScript/Vite in `src/`, the Rust/Tauri backend is in `src-tauri/`, and terminal responsiveness is the top product constraint.

## Read First

- Read `codex.md` for current patch notes, privacy rules, and active local handoff focus.
- If present locally, read `.handoff/latest.md` when resuming after a clear, switching agents, or debugging a recent regression.
- This repository is public. Never commit secrets, tokens, private URLs, raw local usernames, customer data, or real home paths.
- Treat actual repo state as the source of truth. Verify with `git status --short` and relevant files before editing.

## Commands

- Install: `npm install`
- Typecheck: `npm run check`
- Frontend build: `npm run build`
- Tauri dev: `npm run tauri:dev`
- Tauri release: `npm run tauri -- build --no-bundle`
- Rust format check: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- Rust Windows check: `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- Windows-local smoke build: `.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch`
- Windows release from a WSL checkout: load the Visual Studio developer environment, use Git for Windows, then run `scripts\windows-staged-runtime-smoke.ps1 -NoLaunch` through `cmd pushd`. The helper stages source and npm dependencies on Windows-local NTFS.

When running from a WSL-hosted checkout with Windows tools, prefer `cmd /d /c "pushd ""\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide"" && ..."` so Windows gets a temporary drive mapping instead of a raw UNC working directory.

## Build And Runtime Notes

- Set `CARGO_TARGET_DIR` to a Windows-local folder such as `%TEMP%\simple-vibe-ide-target` for Windows builds from a WSL checkout. If `%TEMP%` quota is tight, use another spacious local path such as `D:\build-cache\simple-vibe-ide-target`; do not put Cargo target output on a WSL/UNC path.
- Never alternate WSL npm and Windows npm in one checkout's `node_modules`. Use the staged Windows smoke for a WSL-hosted checkout or a Windows-local clone/worktree for HMR development.
- Release builds use `.cargo/config.toml` with `target-cpu=native`; produced binaries are intended for the build machine, not portable distribution.
- `scripts/windows-runtime-smoke.ps1` redacts local usernames in displayed paths. Keep that behavior.
- If running Windows tools from WSL says `cmd.exe: command not found` or `.exe` returns `Exec format error`, verify WSL interop/binfmt before declaring Windows builds impossible.
- Runtime keep-alive and pty-host reattach were removed because they made shell input and TUI output too slow. Do not reintroduce a background terminal host without a fresh low-latency design and explicit user approval.
- Closing or rebuilding the app terminates in-process shell sessions. Optimize for fast direct terminal I/O over restart persistence.

## Terminal Cautions

- Terminal responsiveness is product-critical. Do not add large synchronous work to the WebView main thread.
- xterm writes should remain chunked; large terminal output can freeze the whole IDE if written in one big block.
- The Rust direct PTY reader owns terminal DSR cursor query handling: respond to `ESC[6n` in the backend and do not leak it to the UI.
- Preserve normal shell semantics: selecting text plus `Ctrl+C` copies; no selection plus `Ctrl+C` interrupts; `Ctrl+V` pastes text.

## Code Style

- Follow the existing plain TypeScript/Rust style. Keep edits narrow and close to established helpers.
- `src/main.ts` is large and tightly coupled. Prefer small local changes over broad refactors unless the user explicitly asks.
- Use structured APIs/parsers where existing code provides them; avoid ad hoc string manipulation for structured data.
- Do not edit generated or dependency directories such as `node_modules/`, `dist/`, or `src-tauri/target/`.
- Use `apply_patch` for manual edits.

## Testing Expectations

- There is no dedicated unit-test suite in this repo right now; use typecheck/build/smoke commands as the baseline.
- For frontend-only changes, run `npm run check`; run `npm run build` when UI bundling could be affected.
- For Rust/backend changes, run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`.
- For runtime-sensitive changes in a Windows-local checkout, run `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch`. From a WSL-hosted checkout, run `scripts/windows-staged-runtime-smoke.ps1 -NoLaunch` through a Windows developer shell. Then manually smoke the affected feature in the built app.
- Clearly separate verified Windows runtime results from assumptions.

## Privacy And Public Repo Safety

- Redact local usernames in paths before showing output. Use placeholders like `[USER]`, `[DISTRO]`, `[WORKSPACE]`, and `%TEMP%`.
- Do not print env files, tokens, cookies, auth headers, private URLs, SSH details, or clipboard contents.
- `.env.example`, sample, and example files are not secrets by default, but still avoid exposing real values.
- Review screenshots, docs, and handoff notes for private data before committing.

## Handoff Workflow

- Before `/clear` or handing work to another agent, update `.handoff/latest.md` and create a dated `.handoff/YYYY-MM-DD-HHMMSS-session.md`.
- `.handoff/` is local-only and ignored by git because this repository is public.
- Keep handoffs factual and compact: current state, files touched, known issues, next actions, commands run, and constraints.
- Do not paste full source files into handoff notes.

## Subagents

- Prefer explorer subagents first for bounded read-only questions: terminal freeze causes, direct PTY lifecycle, browser proxy behavior, workspace snapshot churn, or Windows build diagnostics.
- Use worker subagents only for independent patches with explicit ownership and a disjoint write set. Avoid broad workers in `src/main.ts` or `src-tauri/src/lib.rs`; if either file is already dirty, keep it main-agent-owned unless the user explicitly assigns it.
- Good worker ownership boundaries: `scripts/` + `docs/`, `src/privacyPolicy.ts`, one isolated UI widget area, or a backend-only change in `src-tauri/src/lib.rs` when no other agent is editing backend runtime code.
- Use verification subagents after integration-heavy work. Good verification prompts: inspect terminal input/IME semantics, DSR filtering, chunked xterm writes, WSL/SSH cwd launch behavior, Browser preview proxy regressions, or Windows smoke output.
- Main agent should keep final integration, conflict resolution, release builds, user-facing product decisions, and commits.
