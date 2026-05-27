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
- Windows smoke build: `.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch`

When running from a WSL-hosted checkout with Windows tools, prefer `cmd /d /c "pushd ""\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide"" && ..."` so Windows gets a temporary drive mapping instead of a raw UNC working directory.

## Build And Runtime Notes

- Set `CARGO_TARGET_DIR` to a Windows-local temp folder such as `%TEMP%\simple-vibe-ide-target` for Windows builds from a WSL checkout.
- Release builds use `.cargo/config.toml` with `target-cpu=native`; produced binaries are intended for the build machine, not portable distribution.
- `scripts/windows-runtime-smoke.ps1` redacts local usernames in displayed paths. Keep that behavior.
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
- For runtime-sensitive changes, run `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` on Windows and manually smoke the affected feature in the built app.
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

- Use explorer subagents for bounded read-only questions such as terminal freeze causes, direct PTY lifecycle, or browser proxy behavior.
- Use worker subagents only for independent patches with clear ownership. Avoid multiple workers editing `src/main.ts` at once.
- Good worker ownership boundaries: `scripts/` + `docs/`, or `src-tauri/src/lib.rs` backend-only, or one specific UI widget area.
- Main agent should keep final integration, conflict resolution, release builds, and user-facing product decisions.
