# AGENTS.md — Astra development entry point

## Mission and authority

Simple Vibe IDE is a Windows-first Tauri v2 desktop app for Windows/WSL/SSH LLM
coding sessions. The same runtime builds Simple Vibe Terminal. Terminal input
latency and correct process ownership take priority over cosmetic features.

These instructions are organized for Astra: explicit outcomes, focused source
maps, bounded delegation and verifiable completion. They also apply to other
agents. This file does not select a model or configure a Codex account. Do not
copy an old machine's model/auth configuration into the repository.

## Start here on every machine

1. Run `git status --short` and `git log -5 --oneline`. Preserve existing edits.
2. Read [portable handoff](docs/DEVELOPMENT_HANDOFF.md) for current implementation,
   verification dates, outstanding work and migration boundaries.
3. Read [architecture](docs/ARCHITECTURE.md) for the affected subsystem and
   [development environments](docs/DEVELOPMENT_ENVIRONMENTS.md) for the host OS.
4. Use [testing](docs/TESTING.md) to select gates. Read relevant recent entries in
   `codex.md`; it is historical evidence, not an instruction to undo newer code.
5. If present, read `.handoff/latest.md` for uncommitted local context. It is
   optional and ignored: a fresh clone must work without it or private chat history.

Actual source/configuration wins over stale notes. Investigate disagreements and
correct the docs. Do not assume an old successful test ran on this machine.
Search symbols and inspect relevant ranges/callers instead of loading all of
`src/main.ts`, `src-tauri/src/lib.rs` or `codex.md` into context.

## Working contract

- State the intended outcome and affected subsystems for nontrivial changes.
- Trace failures from UI through IPC to native process/resource owner. Separate
  evidence from hypotheses; patch the cause, not just an error message.
- Make narrow changes in the existing plain TypeScript/Rust style. Use
  `apply_patch` for manual edits; never edit dependencies/generated output.
- Extend a focused regression fixture when changing behavior. Do not weaken tests
  just to obtain a green run. Separate helper benchmarks from Windows UI latency.
- Deliver implementation, relevant tests and durable docs together. Report changes,
  commands/results, limitations and manual follow-up in concise Korean unless asked
  otherwise. Do not claim a full audit or runtime pass from static checks alone.
- Ask before destructive operations, terminating user sessions, broad environment
  changes or unrelated refactors. Never reset/clean/stash someone else's work,
  force-push, or silently change global PowerShell/tmux/SSH settings.

## Invariants that must survive changes

- **PTY:** direct in-process I/O; no persistent background pty-host/keep-alive server
  without explicit approval and a new latency design. App exit ends ordinary PTYs;
  workspace tab switches preserve live sessions. A no-launch build must not close apps.
- **Output:** bounded backend credit/acknowledgements and chunked xterm writes.
  Never do unbounded scrollback parsing, serialization or DOM work on each chunk.
- **DSR:** Rust filters raw `ESC[6n`, flushes preceding output and emits
  `terminal-cursor-query`; frontend drains writes, reads xterm coordinates and queues
  CPR in the input sequencer. Do not leak raw DSR to xterm or reorder replies against
  user input. See `push_terminal_output_without_dsr_queries` and
  `respondToTerminalCursorQueryNow`.
- **Input:** preserve IME composition ownership/exactly-once commits. Selected text
  plus Ctrl+C copies; without selection Ctrl+C interrupts; Ctrl+V pastes.
- **Async scope:** capture workspace/profile/root and generation before waiting.
  Reject stale results; dispose late-created resources; never apply them to a new tab.
- **Windows shell:** literal absolute cwd; repair a drive-relative root only after
  existence probing and user confirmation. `#` is valid in a quoted literal path.
- **Windows tmux:** new Codex/Claude sessions load PS5.1 profiles and set only their
  own shell defaults. Preserve name-based function dispatch and existing sessions.
  Test on an isolated server; never kill/reconfigure production sessions to test.
- **Ports:** forwarding/restore is independent of Browser visibility and must not
  open a browser implicitly. Persist rules, not process IDs. Clean up owned resources.
- **Browser:** native child WebView normally; capture-safe iframe/proxy fallback.
  Keep console/body capture/retention bounded. Do not revive disabled Edge CDP preview.
- **SSH:** askpass-capable background jobs remain async; shell-ready gating belongs
  to terminal command injection, not Explorer. Optional agent absence is not an error.

## Commands and environment boundaries

Run from repository root unless a guide says otherwise:

```text
npm ci
npm run check
npm run check:regressions
npm run build
npm run build:terminal
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

- Windows native desktop proof requires Windows Node/Rust/MSVC and WebView2.
  Linux cross-target `cargo check` is not a Windows link or UI test.
- Never share `node_modules` between Windows and Linux/WSL. Windows-local HMR:
  `npm run tauri:dev` or `npm run tauri:terminal:dev`.
- Windows-local release: `scripts/windows-runtime-smoke.ps1 -NoLaunch`.
  `-SkipNpmInstall` is only for an already-valid Windows dependency tree.
- WSL source release: `scripts/windows-staged-runtime-smoke.ps1 -NoLaunch`
  through a Windows developer shell / `cmd pushd`; stage and Cargo target on NTFS.
  Use the environment guide's commands, not a private machine-specific wrapper.
- `.cargo/config.toml` uses `target-cpu=native`. Rebuild on the destination;
  old binaries are not portable releases. Immutable timestamped output avoids
  replacing running executables; use the repo artifact resolver/publisher.

## Delegation and review

- Prefer bounded read-only explorers for independent runtime/build/privacy questions.
- Workers need explicit disjoint file ownership. Keep `src/main.ts` and
  `src-tauri/src/lib.rs` main-agent-owned if already dirty. Do not overlap edits.
- Give workers an outcome, write boundary and verification requirement. Main agent
  integrates, resolves conflicts, runs release gates and commits/pushes.
- Use independent verification for lifecycle, IME, proxy or build integration work.
  Do not delegate just to duplicate work or wait without useful local progress.

## Privacy, delivery and portable handoff

- Public repository: no tokens, private keys, cookies, real local home paths,
  private URLs/SSH aliases, account IDs, private screenshots or clipboard contents.
- Use `[USER]`, `[DISTRO]`, `[WORKSPACE]`, `[PRIVATE_URL]`. Masked UI does not mean
  underlying files/logs/snapshots are safe to publish.
- Review staged diff, new names and secret scan before commit. Never force-add
  ignored files or push `refs/worklog/*` / backup refs.
- Keep source changes and tests/docs together. Update portable handoff when behavior,
  migration requirements or verification status changes.
- Before clearing/switching agents, update ignored `.handoff/latest.md` and a dated
  local note when available. Public continuity must not depend on private skills,
  Telegram hooks, old machine paths or a locally installed tmux implementation.

Workflow references: [official AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [Astra guidance](https://developers.openai.com/api/docs/guides/latest-model).
These inform agent workflow only; repository tests establish app behavior.
