# Handoff Snapshot

## Metadata
- Created at: 2026-05-23 16:32:04 +0900
- Repo root: `/home/[USER]/simple-vibe-ide`
- Branch: main
- Commit: 0153880
- Mode: Save
- Agent: codex
- Git dirty: yes; ongoing performance optimization diff is uncommitted

## Project Goal
- Optimize the Windows-built Simple Vibe IDE for best perceived performance while preserving all current features.
- Focus areas: lag-free Explorer scrolling, lightweight Browser used/unused states, cache behavior, terminal/background work, workspace switching, and direct tab/control updates without visible stutter.
- Windows runtime smoke testing is delegated to an external Windows LLM/runtime because this WSL shell cannot execute Windows binaries or provide `link.exe`.

## Current State
- Done:
  - Broad performance stack is implemented in the dirty tree: Explorer virtualization/cache/watcher gating, workspace restore/snapshot/index optimizations, terminal lazy xterm/chunked writes/scan trims, Browser frame/console/proxy/forward/tab optimizations, tab/control direct DOM updates, export/image/market render trims, and Rust backend directory/signature/proxy/console bridge optimizations.
  - Latest code patch: Browser preview proxy local-port miss cache. Repeated Browser console local-port scans for the same non-proxy port no longer rescan the preview-proxy list after the first miss; proxy lookup updates clear/invalidate the miss cache.
  - Previous code patch: Clipboard image paste scan trim. Clipboard image detection scans `DataTransferItemList`, `FileList`, and type lists directly instead of allocating temporary spread arrays and using `find`/`some`.
  - Latest handoff/delegation patch: Added `scripts/windows-runtime-smoke.ps1`, `docs/WINDOWS_RUNTIME_SMOKE.md`, and `.handoff/windows-external-llm-prompt.md` for the external Windows LLM to run build/link/launch plus manual performance smoke tests.
  - Recent terminal patch: Terminal widget pane index avoids full terminal-list scans for per-widget tab render, close-widget, active-pane sync, and fit scheduling.
  - Recent Browser patches: bounded structured console serialization, huge payload formatter bounding, and direct Browser forward/detected-port row iteration.
  - Rust/Tauri validation is unblocked in WSL: `windows` crate is target-gated and `src-tauri/icons/icon.png` exists for Tauri context generation.
  - Windows MSVC target type-check passes for the current dirty tree.
  - `codex.md` has privacy-safe patch notes through the Browser preview proxy local-port miss cache patch.
- In progress:
  - External Windows LLM/runtime must run the new smoke package and report pass/fail for real Windows build/link/launch/manual smoke.
- Broken / incomplete:
  - Full Windows release linking is still external here because this WSL shell cannot run Windows interop and lacks `link.exe`/Visual Studio Build Tools.

## Files Touched
- `src/main.ts`: main frontend performance work, including latest Browser preview proxy local-port miss cache, clipboard image paste scan trim, terminal widget pane index, and Browser console/forward trims.
- `scripts/windows-runtime-smoke.ps1`: Windows-side build/link/launch gate for external LLM/runtime.
- `docs/WINDOWS_RUNTIME_SMOKE.md`: privacy-safe Windows runtime manual smoke checklist and report template.
- `.handoff/windows-external-llm-prompt.md`: direct prompt for the external Windows runtime LLM.
- `src-tauri/src/lib.rs`: Rust backend performance changes; formatted with Rust 2021 edition.
- `src-tauri/Cargo.toml`: `windows` crate moved to Windows-only target dependencies.
- `src-tauri/icons/icon.png`: generated PNG icon required by Tauri context generation.
- `src/api.ts`, `src/types.ts`: backend API/type updates.
- `src/styles.css`: Explorer/Browser/widget performance-related styles.
- `codex.md`: privacy-safe patch notes and validation notes.
- `.handoff/latest.md`, `.handoff/YYYY-MM-DD-HHMMSS-session.md`: repo-local handoff snapshots.

## Important Decisions
- Responsiveness over aggressive background freshness: defer hidden/background/prefetch/watch/cache-prune/snapshot/console/terminal work behind idle/input-pending guards where behavior remains acceptable.
- Preserve existing terminal, Browser, Explorer, Editor, Image, Notes, forwarding, profile, export, clipboard image paste, and workspace behavior while reducing repeated scans, DOM queries, same-order set/prune allocations, `innerHTML` rebuilds, object/array churn, large synchronous writes, unbounded console formatting/serialization, all-terminal scans for per-widget terminal work, clipboard array allocation, and repeated preview-proxy miss scans.
- Keep normal Browser console detail for small values, but bound nested object/array traversal and summarize deep/large values to avoid preview log stalls.
- Keep common lookup paths O(1) with fallback validation for robustness.
- Actual repo state remains source of truth over old snapshots.

## Known Issues / Errors
- `cargo build --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --release` reached the link step earlier but failed because `link.exe` is not available in this WSL environment.
- `/mnt/c/Windows/System32/cmd.exe /C "ver"` failed earlier with `cannot execute binary file: Exec format error`; direct Windows interop is unavailable from this shell.
- Static/build validation does not prove real perceived responsiveness; external Windows runtime profiling/smoke is still required.

## Next Actions
1. Send `.handoff/windows-external-llm-prompt.md` to the external Windows LLM/runtime.
2. On Windows, run `scripts/windows-runtime-smoke.ps1` from PowerShell in the repo root, then follow `docs/WINDOWS_RUNTIME_SMOKE.md`.
3. Smoke test Browser console/local-port behavior: repeated non-proxy local-port logs, actual proxy-local-port filtering, manual/auto forwards, hidden console replay, and noisy visible console logs.
4. Smoke test terminal widgets: create many widgets/tabs, close active/inactive tabs, close whole widgets, switch active prompt target, resize/fit widgets, hide/show workspaces, and restore/switch workspaces.
5. Smoke test Explorer large-directory scrolling, selection, typeahead, rename/delete, file-size toggle, expanded/collapsed trees, cache reuse/expiry, and workspace switching.
6. Smoke test image clipboard paste: browser/source screenshots, multiple files in clipboard, image history update, image preview, and paste-tag-to-terminal.
7. If lag remains, profile the real Windows runtime to separate Explorer DOM/cache/backend polling, terminal write/scan/fit/layout, Browser iframe/console/frame/proxy/forward, workspace persistence, clipboard image processing, and tab/control render work.

## Commands
```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run check
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
npm run tauri -- build --no-bundle
git diff --check
# Windows PowerShell only:
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

## Last Test Result
- Command: `npm run check`
  - Result: pass.
- Command: `npm run build`
  - Result: pass; main app chunk 275.56 kB minified, CSS 40.13 kB minified, `xterm` lazy chunk 289.71 kB minified.
- Command: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
  - Result: pass.
- Command: `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  - Result: pass.
- Command: `npm run tauri -- build --no-bundle`
  - Result: pass in WSL/Linux; built `src-tauri/target/release/simple-vibe-ide`.
- Command: `git diff --check`
  - Result: pass.
- Command: `scripts/windows-runtime-smoke.ps1`
  - Result: not run here; requires real Windows PowerShell and MSVC `link.exe`.

## Constraints
- Do not revert unrelated or user changes.
- Preserve all current features while optimizing perceived performance.
- Keep Windows-first runtime behavior.
- Avoid committing secrets, tokens, raw local usernames, private URLs, or real home paths.
- Keep docs and handoff snapshots compact and privacy-safe.

## Resume Instructions
- Start by reading this file and `codex.md`.
- Verify actual repo state before editing: `git status --short`, `git diff --stat`, and relevant functions in `src/main.ts`.
- Trust repo state over this snapshot if they differ.
- If running on Windows, execute `.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall`, then follow `docs/WINDOWS_RUNTIME_SMOKE.md`.
- Do not mark the goal complete until the external Windows runtime report proves build/link/launch and manual smoke success.

## Unknowns
- Whether the full optimization stack eliminates perceived lag in the actual Windows-built app.
- Whether Windows MSVC linking/runtime behavior passes once run in a Windows shell with `link.exe`.
- Whether every optimized same-order/direct-DOM/cache/index/bounded-console/terminal-pane-index/clipboard-scan/preview-proxy-miss path preserves edge-case runtime behavior under heavy real interaction.
