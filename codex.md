# Codex Notes

This file is for privacy-safe implementation notes and patch notes that can be
kept with the repository.

## Writing Rules

- Do not include secrets, tokens, cookies, private URLs, customer data, or raw
  local home directory usernames.
- Use neutral placeholders for local machine details, such as `[USER]`,
  `[WORKSPACE]`, `[DISTRO]`, and `[PRIVATE_URL]`.
- Keep verified behavior separate from assumptions or follow-up ideas.
- Prefer short, dated entries that describe user-visible changes, technical
  changes, verification, and known limits.

## Handoff / Clear Session Rule

Before clearing/resetting a Codex session or handing work to another agent:
- Use the `handoff` skill in Save Mode.
- Update `.handoff/latest.md`.
- Also create a dated backup in `.handoff/YYYY-MM-DD-HHMMSS-session.md`.
- Keep `.handoff/` local-only; it is intentionally ignored by git because this
  repository is public.
- Summarize only current repo state, next actions, constraints, errors, and test results.
- Do not paste entire source files.

When starting fresh or picking up after another agent:
- Use the `handoff` skill in Resume Mode.
- Read `.handoff/latest.md` first.
- Read `CODEX.md` and repo instruction files (`AGENTS.md`, `CLAUDE.md`, `Claude.md`) if present.
- Check actual repo state with `git status` and relevant files.
- If snapshot and repo differ, trust the repo.
- Do not guess. Open files and verify.

The local `.handoff/` directory is shared by Codex, Claude, and Grok. Any of them can save; any of them can resume.

## Current Handoff Focus

- Latest snapshot: `.handoff/latest.md`.
- Current priority: verify the direct in-process PTY runtime in the real
  Windows app, especially WSL/SSH shell startup, fast typing, paste, Ctrl+C,
  prompt duplication, and multi-workspace switching.
- Most recent relevant commit before this handoff: `b34fcaf Restore`.
- Runtime keep-alive and pty-host reattach were removed because they harmed the
  primary product goal: a very responsive shell-first IDE.
- Workspace snapshots still restore UI/work context, but shell processes are
  recreated after app close/rebuild rather than reattached.
- Keep browser preview fixes general. The active browser path is currently the
  iframe/proxy preview; Edge CDP preview is disabled because earlier attempts
  caused startup freeze/endpoint readiness issues.

## Patch Notes

### 2026-06-12 - Close working/waiting detection gaps across all LLM CLIs

#### Changed

- Waiting (structured menus): Claude Code's selection cursor is `❯` (U+276F),
  which the cursor class `[›>]` never matched, and dialogs render inside box
  borders (`│ ❯ 1. Yes │`) that broke the line-start anchor. Menu patterns now
  accept `❯▶▸`, one leading border glyph, and radio/checkbox option markers
  (`❯ ◻ 1. …` multi-select rows). This is what makes Claude permission
  dialogs, AskUserQuestion menus (including keyword-free option labels), and
  chained dialogs inside the post-input suppression window actually
  detectable.
- Waiting (keyword gate): `allow`, `apply`, `execute`, `reject` were missing
  from the cheap pre-filter, which silently killed the claude `allow …?`
  branch, grok's `no, reject` and `execute … (●) yes` branches, and generic
  `apply?/allow?` prompts whose dialog text has no other gate word.
- Waiting (false-positive guard): the keyword-free consecutive-numbered-rows
  menu pattern no longer accepts a cursor glyph on the follow-up row, so
  markdown blockquotes (`> 1. …` / `> 2. …`) stay inert.
- Working: status verbs may carry a spinner frame prefix including braille
  (`⠼ Thinking…`, grok-style CLIs) which previously broke the line anchor;
  added common verbs (Loading/Connecting/Generating/Compiling/Building/
  Installing/Fetching/Planning); added a verb + parenthesized elapsed counter
  shape (`• Working (3s)`) for Codex frames where the hint has cycled out;
  extended the spinner-glyph class of the language-agnostic ellipsis+timer
  pattern with braille and bullet/geometric frames.

#### Verified

- Node regression harness extracting the real functions from `src/main.ts`:
  32 cases pass (bordered Claude permission dialog, keyword-free Korean
  AskUserQuestion, edit-permission menu, multi-select, grok execute/reject
  dialogs, braille spinner, hint-churned Codex line, blockquote/table/
  turn-end-prose false-positive guards, plus all prior cases).
- `npm run check`, `npm run build`.

#### Known limits

- Dialog shapes for grok/antigravity are modeled from their documented flag
  surfaces and generic TUI conventions, not captured frames; a real sample
  that still misses should be added to the harness.
- A turn-ending plain-prose question (no menu) still cannot stay marked as
  waiting: the completion footer that follows it is a clearly-not-waiting
  marker by design.

### 2026-06-12 - Detect non-English Claude status lines as active work

#### Changed

- LLM working indicator: Claude Code's spinner status text can be
  model-authored in any language (real sample: `✢ Phase B 구현 중 (…)…
  (16m 24s)`), and newer builds cycle the `esc to interrupt` hint out of the
  parenthetical, so a long turn could run with neither the Latin `-ing` verb
  shape nor the interrupt hint ever matching — the workspace dot stayed idle
  for the whole turn. `llmOutputLooksLikeActiveWork` now also accepts the
  language-agnostic structural shape: spinner glyph at line start + ellipsis
  + parenthesized elapsed-time counter (`(3s)`, `(16m 24s)`, `(1h 4m)`).
  Completion summaries ("Worked for 16m 24s") and persisted todo trees have
  no trailing ellipsis-plus-timer, so they stay inert.
- Confirmed the session-feedback survey ("How is Claude doing this session?"
  with `1: Bad 2: Fine 3: Good`) does not trip waiting detection: it has no
  cursor-marked menu rows and no approval keywords.

#### Verified

- Node regression harness extracting the real functions from `src/main.ts`
  (18 cases incl. the user's exact frame, English/Codex regressions,
  completion/todo/survey false-positive guards): all pass.
- `npm run check`, `npm run build`.

#### Known limits

- Working state still needs a frame that actually contains the status line;
  if a TUI repaints only the timer cell without the spinner glyph in the same
  chunk, that frame alone does not start a window (the next full repaint
  does).
- Spinner glyph classes include `*` and `·`; a prose bullet ending in `…`
  with a parenthesized digit+`h/m/s` token could briefly read as working.
  Judged acceptable vs. missing whole turns.

### 2026-06-10 - Fix SSH bash bootstrap quote loss and venv tracking misses

#### Changed

- SSH terminals: Windows PowerShell 5.1 hands native args to `ssh.exe` inside
  auto-added quotes without escaping embedded double quotes, and ssh.exe's
  MSVCRT argv parser strips them. The remote bash bootstrap therefore lost
  every `"` (visible as `bash: /dev/fd/63: line 3: syntax error near
  unexpected token ';'` on `case ;${PROMPT_COMMAND:-};`), bash aborted the
  rcfile there, and the codex/claude launcher command queued after that line
  never ran. The PS bootstrap now pre-escapes each quote (doubling any
  backslash run in front of it) so the argv round-trip is lossless. This also
  un-breaks OSC7 shell-ready/cwd reporting on SSH, which the same corruption
  silently disabled. WSL terminals were never affected.
- Python venv tracking: detection previously parsed only literally typed
  characters, so Tab completion (`source .v<TAB>`) and history recall (arrow
  keys) — the common ways to type the command — never registered an
  activation, which is why `source .venv/bin/activate` did not survive
  restarts in practice. On Enter the tracker now also reads the echoed
  logical prompt line from the xterm buffer (wrap-aware, prompt prefix
  stripped, alternate-screen and LLM/command panes excluded) and feeds it
  through the same activation/deactivation parser. The existing
  snapshot-restore path then re-sources the venv as designed.

#### Verified

- `npm run check`, `npm run build`, `git diff --check`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- Python simulation of PS `-replace` + MSVCRT argv parsing: old path reproduces
  the exact reported corruption; escaped path round-trips losslessly.
- Node regression sweep over 9 echoed-prompt-line shapes (bash/starship/venv
  prompts, chained commands, dot-source, redirects, quoted-mention and plain
  command false-positive guards).

#### Known limits

- Real SSH smoke still needed on Windows: spawn an SSH terminal, confirm no
  `/dev/fd/63` syntax error, codex/claude launch, and OSC7 cwd updates.
- Venv lines pasted together with their own newline (no typed Enter) are still
  not tracked; activation typed or recalled interactively now is.

### 2026-06-10 - Send IME commits directly to the PTY

#### Changed

- Composing keydowns (`isComposing`/keyCode 229/`Process`) are now suppressed from
  xterm via the custom key handler. xterm 6.0.0's CompositionHelper otherwise
  force-finalizes the composition synchronously when a non-229 key arrives
  mid-composition (Windows Korean IME delivers Space/Enter that way) and sends a
  stale helper-textarea slice, dropping the syllable tail. Keypress/keyup still
  reach xterm, so commit keys (space, CR) keep flowing through the keypress path.
- A `compositionend` interceptor now writes the IME-committed string straight to
  the PTY and flips xterm's private `_isSendingComposition` flag so its deferred
  `setTimeout(0)` re-read sends nothing. If a future xterm upgrade renames that
  private state, an onData dedup queue (exact-match, 1s window) swallows the
  duplicate echo instead. Same family of fixes as Wave Terminal PR #2938/#3264
  for the identical Hangul drop/reorder in Electron+xterm.
- `sendTerminalInputNow` immediate writes now join the same per-pane write chain
  as batched input. Two in-flight Tauri invokes are not order-guaranteed (sync
  commands run per-invoke on a thread pool), so an unchained immediate write —
  e.g. a Hangul commit followed by Enter — could previously reorder under load.
- IME commits mark user input/LLM activity and feed cwd tracking exactly like
  typed input did before.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`
- Bundled xterm 6.0.0 source inspection: `_core` delegation, `_compositionHelper`
  and `_isSendingComposition` names survive in both `lib/xterm.js` and the Vite
  ESM bundle; `_inputEvent` ignores composition inputTypes (no double-send path).

#### Known limits

- Needs a real Windows smoke: fast Hangul typing into Claude/Codex panes with the
  interceptor active (watch for drops, duplicates, and ordering around Space and
  Enter), plus Japanese/Chinese candidate-window flows.
- Any residual drop inside the CLI's own raw-mode stdin handling (Ink) is not
  reachable from the terminal layer; the typing pad remains the guaranteed path.

### 2026-06-10 - Harden LLM working/waiting detection

#### Changed

- `esc to interrupt` now counts as active work. It is shown by Claude and Codex
  only while a turn is running (waiting dialogs say `esc to cancel`), so it
  covers Codex's `Working (3s • Esc to interrupt)` shape (no ellipsis, `•`
  glyph) and early Claude status lines that have no token/time counters yet —
  both previously undetectable, which could leave a workspace idle-looking for
  the rest of a turn after one 2.5s output gap.
- Removed bare `quit` from the clearly-not-waiting list: Codex's always-visible
  footer (`⌃C quit`) could repaint in its own chunk and clear a waiting dialog
  that was still on screen. Dropped `usage:`/`tip:` too — the trailing `\b`
  after `:` never matched real `Tip: ...` spacing, so they were dead entries.
- Chained dialogs are no longer lost to the post-input suppression window:
  structured choice menus (option lists like `› 1. ...`) may set waiting even
  while echo suppression is active, since echoed prose cannot fake that shape.
  A second permission prompt arriving right after answering the first now turns
  the tab red instead of being discarded forever.
- Workspace snapshot replay now judges LLM waiting/working state only from the
  replay tail (last 8000 chars ≈ the final screen), so an old answered prompt in
  restored scrollback no longer shows a stale red indicator after restore.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`
- Regex regression sweep over 18 sampled status/prompt/footer lines (Claude,
  Codex, Grok shapes, Korean completion text, echo false-positive guards).

#### Known limits

- Inside a single chunk the prompt patterns still win over later completion
  text at the pure-function level; the replay-site tail slice mitigates the
  practical case (restore). Real Codex/Claude status line samples from the
  Windows app should still be captured during the next smoke to confirm shapes.

### 2026-06-10 - Detect dynamic workflow agent progress

#### Changed

- LLM activity detection now treats `Waiting for N dynamic workflow(s) to
  finish` as active background work instead of an idle/waiting-looking status.
- Agent progress summaries such as `0/3 agents done ... tokens` now keep the
  workspace in the working state while the done count is still below the total.
- This covers Ultracode/Claude-style dynamic workflow panes where tokens keep
  increasing while subagents are still running.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-10 - Detect Claude active progress status

#### Changed

- Workspace LLM activity now recognizes Claude's newer progress/status lines
  such as `Simmering…`, `Shimmying…`, `Running…`, token counters, and expanded
  agent/tool-use summaries as active work.
- Generic terminal output still only extends an already-working state, preserving
  the focus/repaint false-positive guard from the previous terminal patch.
- Active progress text now clears stale waiting/red state so a Claude agent that
  resumes work switches back to the working indicator.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-09 - Reduce LLM terminal focus repaint sweeps

#### Changed

- LLM launcher panes now suppress xterm DEC focus-report input (`ESC[I` /
  `ESC[O`) before it reaches Codex/Claude-style TUIs. This avoids the common
  reselect-focus repaint where the cursor visibly sweeps from the top of the
  terminal to the bottom.
- Hidden workspace terminals now keep draining output into xterm's offscreen
  buffer instead of waiting until the workspace becomes visible again, so a
  background Codex/Claude repaint is less likely to replay on return.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-08 - Preserve Browser state across workspaces

#### Changed

- Native Browser child WebViews now use workspace/tab-scoped labels instead of
  one shared `browser-preview-webview`, so switching to another workspace no
  longer navigates/reloads the previous workspace's Browser page when returning.
- Restoring a workspace shows the existing native Browser WebView without
  forcing navigation unless the user explicitly reloads, hard-refreshes, or
  clears cache.
- The iframe fallback now only hides workspace frames during normal workspace
  switches; it no longer replaces them with `about:blank` unless the app is
  actually hidden/unloading.
- Browser WebView load events include the scoped WebView label so stale hidden
  workspaces cannot report load status for the active Browser tab.

#### Verified

- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

### 2026-06-08 - Compact Explorer path controls

#### Changed

- Explorer path controls now use a compact three-column row: parent directory,
  current path, and a short `Use` button for the existing `Use This Folder`
  action.
- Removed the wrapping rule that forced the Explorer path badge onto its own
  full-width line when widget controls wrapping was enabled.
- The shortened `Use` button keeps the full `Use This Folder` action in its
  tooltip and accessibility label.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-06 - Separate Simple Vibe Terminal taskbar identity

#### Changed

- Added a dedicated `Simple Vibe Terminal` icon with a terminal prompt mark and
  wired the terminal Tauri config to use `icons/terminal.ico` instead of
  inheriting the IDE icon.
- Removed the hardcoded Rust startup title `Simple Vibe IDE - Windows / WSL /
  SSH`; the native window title now comes from the active Tauri `productName`.
- The frontend also sets the native Tauri window title to the current variant
  product name, so taskbar hover text should show `Simple Vibe Terminal` for
  the terminal build.
- Windows smoke now checks built exe `ProductName` and `FileDescription` for
  both `simple-vibe-ide.exe` and `simple-vibe-terminal.exe`.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `npm run tauri:terminal:build`
- `git diff --check`

### 2026-06-06 - Align status with market ticker row

#### Changed

- Moved the main IDE status message into the workspace control bar, immediately
  before the market ticker. The status now uses the empty left side of the
  price/ticker line while the ticker remains on the right.
- Removed the separate always-visible status row. Normal status messages are
  single-line with ellipsis and a full tooltip; danger details can still expand
  into the dedicated detail strip below when needed.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-06 - Run SSH file commands off the IPC thread

#### Changed

- Explorer/file commands that can run SSH or WSL subprocesses now execute in
  blocking worker tasks instead of directly inside the Tauri IPC handler.
- This prevents the IDE-local `SSH_ASKPASS` unlock flow from deadlocking the
  WebView: while a background `ssh.exe` waits for the passphrase, the frontend
  can still receive the askpass event, render the unlock modal, and submit the
  answer.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run build`
- `scripts/ssh-agent-fixture-smoke.sh`
- `bash -n scripts/ssh-agent-fixture-smoke.sh`
- `git diff --check`

### 2026-06-06 - SSH unlock Enter key submit

#### Changed

- The IDE SSH unlock dialog now treats `Enter` as the same action as clicking
  `Unlock`, even if focus is on the overlay instead of the password field.
- Added a one-shot guard so `Enter`, form submit, and button clicks cannot send
  duplicate answers for the same SSH prompt.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-06 - VS Code-style SSH askpass broker

#### Changed

- Replaced the agent-only SSH unlock strategy with an IDE-local
  `SSH_ASKPASS` broker for Windows SSH profiles. The running IDE now starts a
  loopback-only, token-protected askpass endpoint and points `ssh.exe` /
  `ssh-add.exe` at the app executable as the askpass helper.
- SSH key passphrase prompts now show as an IDE modal and are cached in process
  memory until the app exits. This matches the VS Code-style flow better than
  requiring the Windows OpenSSH Authentication Agent service to be enabled.
- Background Explorer/File/LLM SSH jobs no longer use `BatchMode=yes`; they use
  `PreferredAuthentications=publickey`, `NumberOfPasswordPrompts=1`, and the
  IDE askpass helper so encrypted keys can be unlocked from the visible IDE UI.
- Windows OpenSSH agent use is now opportunistic only: if the service is
  already running, commands can still use its pipe, but the IDE no longer
  launches UAC to enable/start it.
- The local SSH fixture now proves both flows: direct askpass without any agent,
  and ssh-agent reuse from a separate noninteractive process.

#### Verified

- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `scripts/ssh-agent-fixture-smoke.sh`
- `bash -n scripts/ssh-agent-fixture-smoke.sh`
- `npm run build`
- `git diff --check`

### 2026-06-06 - Stop gating SSH Explorer on shell login

#### Changed

- SSH Explorer/File reads no longer wait for a terminal shell-ready prompt before
  loading or refreshing. With the IDE-local `SSH_ASKPASS` broker, the hidden
  background `ssh.exe` can request a visible unlock dialog directly, so waiting
  for a shell login only blocked Explorer while LLM launcher terminals already
  worked.
- Kept the shell-ready gate for terminal input injection paths such as LLM
  launch typing and Python venv restoration, where sending text before a prompt
  can still corrupt an auth/login prompt.

#### Verified

- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-05 - Proper Windows SSH agent smoke and fallback

#### Changed

- Restored the Windows private `ssh-agent.exe -s` fallback for the case where
  the Windows OpenSSH Authentication Agent service remains unavailable after
  normal and elevated start attempts. Stale inherited agent env is still cleared
  when the service agent is running, but IDE-owned private agent env is now
  preserved and shared with SSH terminals, Explorer/File jobs, and LLM panes
  when the service agent cannot be used.
- The visible SSH bootstrap only clears `SSH_AUTH_SOCK`/`SSH_AGENT_PID` when it
  is intentionally using the Windows service agent. This avoids deleting the
  IDE private agent fallback before `ssh-add` runs.
- Added `scripts/windows-ssh-agent-smoke.ps1`, a Windows-side smoke test that
  uses the real Windows OpenSSH `ssh.exe`/`ssh-add.exe`/`ssh-agent.exe`, checks
  the `ssh-agent` service, optionally requests UAC with `-AllowElevate`, falls
  back to a private process agent, runs `ssh-add`, and verifies that
  `ssh -o BatchMode=yes <alias> <command>` works afterward.
- Extended the local SSH fixture to prove the unlocked agent also works from a
  separate noninteractive process that only inherits the agent environment,
  matching the Explorer/File/LLM job shape more closely.

#### Verified

- `scripts/ssh-agent-fixture-smoke.sh`
- `bash -n scripts/ssh-agent-fixture-smoke.sh`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `npm run build`
- Windows PowerShell execution for `scripts/windows-ssh-agent-smoke.ps1` is not
  available in this WSL/Linux validation environment and must be run on the
  affected Windows machine.

### 2026-06-05 - SSH agent env cleanup and local fixture smoke

#### Changed

- Windows SSH commands now clear inherited `SSH_AUTH_SOCK`/`SSH_AGENT_PID`
  instead of injecting an IDE-started agent fallback. This avoids stale or
  incompatible agent environment variables blocking the Windows OpenSSH named
  pipe agent after the user approves the OpenSSH Authentication Agent service.
- The visible SSH PowerShell bootstrap also removes inherited SSH agent
  environment variables before running `ssh-add`, so `ssh-add` uses the Windows
  OpenSSH agent pipe rather than a stale process-local socket.
- Added `scripts/ssh-agent-fixture-smoke.sh`, a tiny localhost SSH fixture that
  starts an unprivileged `sshd`, creates a passphrase-protected key, confirms
  BatchMode SSH fails before `ssh-add`, then confirms BatchMode succeeds after
  unlocking the key in `ssh-agent`.

#### Verified

- `scripts/ssh-agent-fixture-smoke.sh`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `npm run build`

### 2026-06-05 - Enable Windows OpenSSH agent for SSH reuse

#### Changed

- When the Windows OpenSSH Authentication Agent service is unavailable, the IDE
  now first tries to set it to Manual and start it normally, then launches an
  elevated PowerShell `RunAs` request once so the user can approve enabling and
  starting `ssh-agent`.
- SSH terminal bootstrap now waits briefly for the agent to become available
  after the UAC request before deciding that `ssh-add` cannot connect.
- The visible SSH warning and Explorer publickey error now point to approving
  the OpenSSH agent UAC prompt and reopening the SSH workspace once, instead of
  implying that passphrase entry in a regular SSH login can be reused without a
  working agent.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `npm run build`

### 2026-06-05 - Visible ssh-add unlock before SSH terminals

#### Changed

- SSH terminal startup now uses a visible PowerShell bootstrap again, but only
  to unlock the key in the same terminal before the remote `ssh.exe` session
  starts. The bootstrap starts/checks the Windows OpenSSH agent, inspects
  `ssh -G <alias>` for configured identity files, runs `ssh-add` for an
  available identity when the agent has no keys, and then starts the normal
  interactive SSH session.
- This is intended to make the first SSH Shell show the key passphrase prompt
  once via `ssh-add`, so later Explorer/File jobs and Codex/Claude/Grok SSH
  panes can reuse the key through the Windows OpenSSH agent instead of asking
  again.
- Explorer publickey errors now direct the user to reopen an SSH shell and
  answer the visible `ssh-add` prompt once, rather than relying only on
  `AddKeysToAgent`.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `npm run build`

### 2026-06-05 - SSH agent reuse for Explorer jobs

#### Changed

- Windows SSH commands now prefer the built-in Windows OpenSSH `ssh.exe` under
  `System32\OpenSSH` when available, avoiding Git/OpenSSH PATH mismatches
  between the interactive Shell and background Explorer/File jobs.
- Windows no longer injects an IDE-started process-local `SSH_AUTH_SOCK` into
  SSH terminal/background commands. Instead, when the Windows OpenSSH
  Authentication Agent service is running, SSH commands explicitly use
  `IdentityAgent=\\.\pipe\openssh-ssh-agent`; interactive Shell SSH still uses
  `AddKeysToAgent=yes` so a key passphrase entered in the visible shell can be
  reused by later noninteractive Explorer/File jobs.
- Explorer load/refresh publickey failures now explain that the visible Shell
  is interactive but Explorer/File jobs use separate noninteractive SSH
  processes and need the key in the Windows OpenSSH agent.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

### 2026-06-05 - Workspace surface and status row regression fix

#### Changed

- Moved the compact status text out of the Profile control stack into its own
  full-width row below the workspace toolbar, so Root input width can no longer
  truncate messages such as remote shell-login waiting states.
- Explicitly assigned the title, workspace tabs, workspace toolbar, status row,
  status detail, and main workspace area to fixed CSS grid rows. This prevents
  the hidden status-detail element from shifting `main-grid` into an auto-sized
  row and making Explorer/Shell panels appear missing.
- Open/Connect now explicitly reveals the workspace surface: Explorer is shown
  for IDE workspaces and active shell widgets are shown/brought forward even
  while SSH/WSL file loading is gated on shell login.

#### Verified

- `git diff --check`
- `npm run check`
- `npm run build`
- Privacy grep over the diff found no obvious private values or local home
  paths.

### 2026-06-05 - SSH prompt fallback and blank workspace connect

#### Changed

- SSH terminal startup now launches `ssh.exe` directly again instead of running
  a blocking `ssh-add` preflight in a PowerShell wrapper. The IDE still starts
  and passes an IDE-session `ssh-agent` environment when available, and
  interactive SSH uses `AddKeysToAgent=yes`, but an unavailable agent no longer
  prevents the normal key passphrase prompt from appearing in the terminal.
- New empty workspace tabs are rendered active immediately, and Open/Connect
  now fills the selected blank workspace tab instead of losing the selection and
  creating another workspace slot.

#### Verified

- `git diff --check`
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- Privacy grep over the staged diff found no obvious private values or local
  home paths.

### 2026-06-04 - SSH/WSL passphrase-safe shell startup

#### Changed

- SSH and WSL terminal panes now delay automatic startup input until the
  bootstrap shell emits its OSC7 ready marker. This keeps LLM launcher calls and
  restored Python venv activation from being typed into an SSH key passphrase
  prompt or another login-time prompt.
- Opening or restoring an SSH/WSL workspace starts the shell first and defers
  Explorer directory loading/watch refresh until that shell is ready, so a
  passphrase prompt remains interactive instead of being hidden behind a
  background file-list command.
- SSH terminal processes now start an IDE-session `ssh-agent` when possible and
  pass that agent environment to SSH terminals/background jobs. Interactive SSH
  starts `ssh.exe` directly with `AddKeysToAgent=yes`, so the terminal can still
  show the normal key passphrase prompt if no agent is usable, and later SSH
  terminals, Explorer refreshes, and port forwards can reuse a key that was
  added to the available agent.
- Background SSH file operations and port forwards now use noninteractive
  `BatchMode=yes`; they reuse the shared agent when available and fail fast
  instead of consuming or hanging on a passphrase prompt when no key has been
  unlocked yet.
- Red status errors now also render in a separate wrapped detail row below the
  workspace toolbar, so permission/authentication failures are visible even when
  the compact status chip truncates.

#### Verified

- `git diff --check`
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

### 2026-06-02 - LLM status dot and Codex TUI cursor query fixes

#### Changed

- Narrowed the red workspace LLM waiting dot so plain assistant text that asks a
  question or lists choices completes green unless a real selectable menu,
  trust prompt, approval prompt, or permission prompt is visible.
- Treat failed/unavailable choice-menu tool results such as
  `request_user_input is unavailable` as completed/not-waiting output.
- Fixed Codex Plan Mode menus where `Worked for ...` appears directly above
  `Implement this plan?`; the real interactive menu now takes priority over the
  completed-work marker and should show the workspace dot in red.
- After a user confirms a waiting menu, stale menu repaint output is suppressed
  briefly for waiting detection so the workspace dot clears red and switches
  back to green working activity.
- When answering terminal cursor-position queries for TUI apps, the frontend now
  drains already-queued xterm output before sending the cursor-position reply to
  the backend. This avoids stale cursor coordinates that could make Codex slash
  commands render offset, such as `/resume` appearing split or shifted.
- Added per-pane Python venv restore for plain shell panes. Bash/zsh-style
  `source .venv/bin/activate` / `. .venv/bin/activate` and Windows PowerShell
  `.venv\Scripts\Activate.ps1` commands are detected, saved in workspace
  snapshots, replayed after app/workspace restore, and inherited by new shell
  tabs/split panes. `deactivate` clears the saved venv state.

#### Verified

- `git diff --check`
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

### 2026-06-03 - Browser toolbar wrap, native WebView preview, and fallback cleanup

#### Changed

- Tightened Browser panel control wrapping so Back/Forward, address, Go, Reload,
  and Clear cache stay in one aligned row at normal panel widths. Device and
  console controls also keep compact columns before falling back to wrapped rows
  on narrow panels.
- Switched the in-app Browser away from iframe/proxy-first loading and away
  from the external headless Edge/CDP screencast attempt. The active path is now
  a Tauri child WebView2 surface positioned over the Browser preview area, so
  localhost apps load directly in an Edge/WebView runtime without waiting on a
  separate `msedge.exe --remote-debugging-port` endpoint.
- Added a local-preview fallback path after repeated preview-proxy asset
  failures. If critical assets such as app scripts keep failing through the
  proxy, the active local tab falls back to the direct local URL so the page can
  still render instead of stopping on a blank white preview.
- The earlier external Edge DevTools path remains compiled but is no longer the
  default because local runtime logs showed the DevTools endpoint never became
  ready even after the launcher exited successfully.
- Native Browser WebView bounds are synced from the DOM preview area on
  resize/zoom/panel drag so it stays in the Browser panel instead of relying on
  a canvas screencast.
- Native Browser WebView bounds are clipped to the visible preview grid cell,
  preventing non-fit device previews from painting over the Browser console or
  other IDE UI while the preview shell remains scrollable.
- Browser Fit is now a toggle: pressing Fit again restores the previous manual
  zoom instead of requiring `+` or `-` to leave fit mode.
- Enabled Tauri's `unstable` feature to use the child-WebView API required for
  the native Browser preview surface.

#### Verified

- `git diff --check`
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

#### Known Limits

- Native Browser WebView preview still needs a manual smoke test in the Windows
  Tauri app because WSL-side checks cannot launch and interact with the child
  WebView2 surface.

### 2026-05-28 - Saved workspaces and faster close

#### Changed

- Added a workspace Save/Load control so the current workspace layout can be
  saved separately from open workspace tabs and loaded again later.
- Made workspace-tab close detach terminal UI immediately and kill backend
  terminal sessions in the background, avoiding sequential close waits.
- Tightened terminal file-link opening so Ctrl+click opens detected text files
  in the editor and image paths in Image Preview without overwriting errors
  with a false success status.
- Reworked terminal file-link hit ranges to use xterm cell positions instead
  of raw string offsets, so links stay aligned when Korean/CJK text appears
  before a path.
- Restricted unquoted terminal file links to extension-bearing file names and
  stripped a leading `@` attachment marker when resolving paths, preventing
  prose after an image path from becoming part of the link.
- Restored the editor panel after failed terminal-link file opens so a bad path
  does not leave the editor stuck on `Opening file...`.
- Kept terminal output visible during IME composition and only deferred terminal
  fit/resize work, avoiding Korean text appearing only after space/commit.
- Added explicit xterm helper-textarea refocus after terminal-pane activation,
  app focus return, and IME composition release. The root issue was that a
  visible active shell could lack helper-textarea focus; switching shells fixed
  it by forcing a blur/focus reset.
- Added an Explorer context-menu action to run local Windows or WSL `.ps1`
  files through an elevated Windows PowerShell prompt.
- Added `scripts/run-temp-release.ps1` to copy the built Windows exe into a
  temp-local app folder, create reusable VBS/CMD launchers, and fall back to a
  timestamped exe when the stable temp exe is locked by a running app.
- Fixed the generated VBS launcher so each VBScript statement is written on one
  line; the previous split line could show a Windows Script Host compile error.
- Updated `AGENTS.md` with Windows build-cache and subagent ownership guidance.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- Windows smoke release build with `D:\build-cache\simple-vibe-ide-target`
  passed and produced the release exe.
- `scripts/run-temp-release.ps1 -NoLaunch` copied the release exe into
  `%TEMP%\simple-vibe-ide-target` and generated launchers.
- `cscript //nologo %TEMP%\simple-vibe-ide-target\run-built-temp.vbs` returned
  success after the VBS line-generation fix.

#### Known Limits

- IME feel and the elevated `.ps1` UAC flow still need a manual check inside
  the Windows app because they are interactive runtime behaviors.

### 2026-05-27 - Terminal IME path and public repo hygiene

#### Changed

- Upgraded xterm packages to the current stable line and enabled Unicode11
  width handling for CJK terminal rendering.
- Removed the app-side IME output hold layer so Korean/CJK composition is left
  to xterm's native CompositionHelper instead of competing event handlers.
- Sent non-ASCII terminal input and short control input directly to the PTY
  instead of routing it through the small input batcher.
- Marked `.handoff/` as local-only and removed tracked handoff snapshots from
  git to avoid publishing session notes in the public repository.

#### Verified

- `npm run check`
- `npm run build`
- Windows smoke release build with `scripts/windows-runtime-smoke.ps1 -NoLaunch
  -SkipNpmInstall`

### 2026-05-24 - LLM launchers use the same bash environment as manual shell

#### Changed

- Codex launcher auto-adds `--enable goals` again. The previous runtime error
  was not that `goals` is unsupported; manual `codex --enable goals --version`
  succeeds in the `coding` WSL profile.
- WSL/SSH launcher commands for Codex, Claude, Grok, and Antigravity no longer
  run in a separate login-interactive `bash -lic` environment.
- Startup commands are now handed to the final interactive bash session and run
  after `~/.bashrc` is sourced, matching what the user gets when typing
  the same command manually in a shell pane.
- Multiline launcher commands are inserted directly into the generated bash
  rcfile after `~/.bashrc` loads. This removes the extra environment-variable
  plus `eval` hop that made quote/parsing failures hard to reason about.

#### Why

- In a root-default WSL distro, a launcher started from a button could resolve a
  different environment/version than the same command typed manually in the
  same folder.
- The quote issue was in the launcher handoff layer, not in the `goals` feature
  itself. A mock Codex launcher confirmed argv is now passed as three clean
  arguments: `--dangerously-bypass-approvals-and-sandbox`, `--enable`, `goals`.

#### Verified

- In the `coding` WSL profile, login-interactive bash and normal interactive
  bash resolved different Codex versions before the patch.
- The launcher smoke in `coding` WSL resolved the expected interactive Codex
  path/version and did not produce the previous EOF quote error.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.

### 2026-05-24 - WSL root workspace shell cwd fix

#### Changed

- WSL terminal spawn now passes the selected workspace folder through
  `wsl.exe --cd` before starting bash, then still runs the existing bash-side
  cwd fallback.
- WSL home detection now first uses `wsl.exe --cd ~ --exec pwd`, avoiding
  login-shell/profile noise when the distro default user is root.

#### Verified

- `coding` WSL root home resolved with `wsl.exe --cd ~ --exec pwd`.
- `coding` WSL selected folder startup resolved with `wsl.exe --cd <folder>`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` passed and
  rebuilt the Windows release exe in `%TEMP%`.
- The rebuilt Windows exe was launched and the process reported responsive.

### 2026-05-24 - Remove runtime keep-alive and return to direct PTY

#### Changed

- Removed the user-facing runtime Keep control.
- Removed frontend live-terminal reattach and terminal snapshot replay paths.
- Removed the Windows pty-host process mode and hidden environment switch.
- Terminal, port-forward, and preview-proxy commands now use the direct
  in-process runtime.
- Workspace terminal snapshots no longer persist backend ids that could point
  at stale processes after restart.

#### Why

- The pty-host/re-attach design made interactive shell input and LLM TUI output
  noticeably slower.
- Simple Vibe IDE now prioritizes fast direct terminal feel over preserving
  shell processes across rebuilds or app restarts.

#### Verified

- `npm run check` passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run build` passed.
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` passed and
  rebuilt the Windows release exe in `%TEMP%`.
- The rebuilt Windows exe was launched and the process reported responsive.

### 2026-05-24 - Superseded terminal pty-host experiment

Superseded by the later direct PTY rollback above. This entry is retained only
as historical context for why the pty-host path was removed.

#### Changed

- A Windows pty-host runtime path was tested to keep terminal sessions alive
  across main-window restarts.
- That path was removed after user testing showed unacceptable typing latency,
  terminal animation stutter, and UI freezes.
- Current product direction is direct in-process PTY only. Closing or rebuilding
  the app intentionally terminates shell processes.

#### Verified

- `npm run check` passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` passed and
  rebuilt the Windows release exe.
- The pty-host smoke result is no longer relevant to current builds.

#### Known Limits

- The user still needs to manually confirm the newest UI build under real
  typing: multiple shell panes, paste, Ctrl+C, prompt duplication, keep-alive
  close/reopen, and rebuild/relaunch behavior.


### 2026-05-23 - Restore native script dialogs

#### Changed

- Reverted the Browser custom overlay for `alert`, `confirm`, and `prompt`.
  Those APIs are synchronous, and the overlay could not preserve page behavior
  that depends on the OK/Cancel return value.
- Kept the `window.open` routing improvement so popup navigations still flow
  through the Browser widget where possible.
- Removed the unused Browser dialog overlay DOM, styles, and message handling.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `cargo fmt --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `git diff --check` passed.
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` passed and
  rebuilt the Windows release exe.

#### Known Limits

- Native WebView script dialogs are still positioned by Windows/WebView2 rather
  than inside the Browser widget. Moving them while preserving synchronous
  dialog semantics likely requires a lower-level WebView2 script-dialog hook.


### 2026-05-23 - Browser-contained popups and dialogs

#### Changed

- Preview-injected pages now intercept `window.open` more aggressively, including
  the common empty-popup-then-set-location pattern used by login/OAuth flows.
  Those navigations are routed back through the Browser widget instead of
  leaking into a native WebView popup window.
- Preview pages now replace native `alert`, `confirm`, and `prompt` dialogs with
  a Browser-widget overlay so simple page dialogs appear inside the preview area
  rather than at the IDE window level.
- Added Browser dialog UI styles and message handling for popup/dialog bridge
  messages from preview frames.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `cargo fmt --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `git diff --check` passed.

#### Known Limits

- JavaScript `confirm` and `prompt` are synchronous browser APIs, while the IDE
  overlay is asynchronous. The overlay prevents native app-level dialogs, but
  scripts that require a blocking return value may need app-specific handling.


### 2026-05-23 - Browser reload controls and cache clear

#### Changed

- Replaced Browser Back, Forward, and Reload text buttons with compact icon-style
  controls that keep accessible labels and tooltips.
- Fixed Browser Reload so it bypasses the existing-frame early return and
  actually reloads the active preview tab.
- Added a Browser `Clear cache` action. For local preview-proxy tabs it drops the
  current proxy, starts a fresh proxy path, and hard-reloads with a cache buster;
  for other tabs it falls back to a cache-busting hard reload.
- Added the same cache-clear action to the Browser context menu.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `cargo fmt --check` passed.
- `git diff --check` passed.
- `npm.cmd run tauri -- build --no-bundle` passed and produced a Windows release
  exe.


### 2026-05-23 - Native Windows release build tuning

#### Changed

- Added a repo-local Cargo config for Windows MSVC builds so release builds use
  `-C target-cpu=native` for same-machine execution.
- Added Rust release profile tuning: Thin LTO, a single codegen unit, symbol
  stripping, and abort-on-panic for smaller/faster shipped binaries.
- Changed Vite production builds to omit source maps by default, skip compressed
  size reporting, and avoid the modulepreload polyfill for modern WebView2.
- Updated the Windows runtime smoke docs/scripts to describe local-machine
  optimized builds and avoid PowerShell/npm argument pitfalls.

#### Verified

- `npm run check` passed.
- `npm run build` passed with production source maps disabled by default.
- `cargo fmt --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed, and verbose Cargo output showed `-C target-cpu=native` in rustc calls.
- `npm.cmd run tauri -- build --no-bundle` passed and produced a Windows release
  exe.

#### Known Limits

- Native CPU release binaries are intended for the build machine. They should not
  be treated as portable release artifacts for older or different CPUs.


### 2026-05-23 - Browser preview proxy local-port miss cache

#### Changed

- Browser console local-port scanning now caches preview-proxy local-port misses.
- Repeated console lines that mention the same non-proxy local port no longer
  trigger a fallback scan across the preview proxy list after the first miss.
- Preview-proxy lookup changes clear or invalidate the miss cache so newly
  created proxy ports are still recognized.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 276 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `git diff --check` passed.
- Windows runtime smoke testing remains delegated to the external Windows LLM
  using `docs/WINDOWS_RUNTIME_SMOKE.md`,
  `.handoff/windows-external-llm-prompt.md`, and
  `scripts/windows-runtime-smoke.ps1`.


### 2026-05-23 - Clipboard image paste scan trim and Windows smoke handoff

#### Changed

- Replaced clipboard image detection's temporary array spread/find/some work with
  direct `DataTransferItemList`, `FileList`, and type-list loops.
- This keeps image paste behavior the same while avoiding extra allocation when
  clipboard payloads contain many files/items.
- Added `scripts/windows-runtime-smoke.ps1` as the Windows-side build/link/launch
  gate for the external Windows LLM/runtime.
- Added `docs/WINDOWS_RUNTIME_SMOKE.md` and
  `.handoff/windows-external-llm-prompt.md` with a privacy-safe manual smoke
  checklist and pass/fail report shape.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 275 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `git diff --check` passed.
- Windows runtime smoke testing is delegated to the external Windows LLM using
  `docs/WINDOWS_RUNTIME_SMOKE.md`,
  `.handoff/windows-external-llm-prompt.md`, and
  `scripts/windows-runtime-smoke.ps1`.


### 2026-05-23 - Terminal widget pane index

#### Changed

- Added a widget-to-terminal-pane index so terminal widget tab rendering,
  close-widget, active-pane sync, and widget fit scheduling no longer scan the
  full terminal list for every widget operation.
- Terminal pane creation, close, and close-all paths now keep the index in sync
  with the existing pane id/backend id lookups.
- This targets perceived responsiveness for heavy users with many terminal
  widgets/tabs and during workspace switches that restore or hide terminal
  widgets.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 275 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `git diff --check` passed.
- Windows runtime smoke testing is still required for terminal widget creation,
  tab creation/close, widget close, active-pane focus, fit scheduling, hidden
  workspace widgets, and workspace restore/switch behavior.


### 2026-05-23 - Browser console bounded structured serialization

#### Changed

- Replaced the visible Browser console object formatter's remaining full
  `JSON.stringify` path with a bounded structured serializer.
- Nested arrays/objects now stop at fixed depth, item, key, and output-length
  limits, with cycle protection.
- Hidden/compact console formatting now also truncates huge strings before they
  enter message concatenation.
- This further reduces Browser-widget stalls when preview pages log nested
  objects, large arrays, repeated references, or very large text payloads.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 275 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `git diff --check` passed.
- Windows runtime smoke testing is still required for visible Browser console
  formatting fidelity, nested payload responsiveness, hidden replay, trimming,
  and local-port scan behavior.


### 2026-05-23 - Browser console formatter bounding

#### Changed

- Visible Browser console formatting now bounds very large string output before
  it reaches the final message concatenation path.
- Large arrays and wide objects are summarized before `JSON.stringify`, avoiding
  expensive serialization of huge console payloads while keeping normal small
  console values detailed.
- This targets Browser-widget responsiveness when a preview app logs large
  objects, arrays, or text blobs.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 274 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `git diff --check` passed.
- Windows runtime smoke testing is still required for visible Browser console
  detail rendering, huge log payload responsiveness, console trimming, hidden
  replay, and local-port scan behavior.


### 2026-05-23 - Browser forward row allocation trim

#### Changed

- Browser forward/detected-port rendering now iterates rows directly instead of
  building a temporary render-row object array for every refresh.
- Same-order forward refreshes use a compact order signature and row count, then
  update cached row parts in place.
- Empty forward lists clear the row cache directly, preserving the existing
  detected-port/manual-forward/proxy actions while avoiding repeated allocation
  on idle or hidden Browser refreshes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 274 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- Windows runtime smoke testing is still required for detected-port rows,
  manual forwards, auto-forwarded Browser opens, stop/ignore actions,
  proxy-local-port filtering, hidden/visible Browser panel transitions, and
  workspace switching.


### 2026-05-23 - Windows target compile check

#### Changed

- No production source changes in this check; validated the current dirty
  worktree against the Windows MSVC Rust target as far as the WSL environment
  can support.

#### Verified

- `rustup target add x86_64-pc-windows-msvc` reported the target was already up
  to date.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
  passed, covering Windows-only Rust code type-checking including the
  target-gated `windows` crate dependency.
- `cargo build --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --release`
  compiled through the crate graph but failed at the link step because
  `link.exe` is not available in this WSL environment.
- Direct Windows interop from this WSL shell is unavailable:
  `/mnt/c/Windows/System32/cmd.exe` fails with `Exec format error`, so the
  final Windows build/run smoke test still needs to be executed in a Windows
  shell with Visual Studio Build Tools.


### 2026-05-23 - Rust/Tauri validation unblock

#### Changed

- Moved the `windows` crate dependency under `target.'cfg(windows)'.dependencies`
  so WSL/Linux validation does not compile Windows-only bindings that are guarded
  by `#[cfg(windows)]` in the Rust source.
- Added `src-tauri/icons/icon.png`, generated from the existing ICO asset, so
  `tauri::generate_context!()` can resolve the icon path required during the
  WSL/Linux no-bundle build.
- Ran Rust formatting with the package edition instead of bare Rust 2015
  defaults.

#### Verified

- `PATH="$HOME/.cargo/bin:$PATH" rustfmt --edition 2021 src-tauri/src/lib.rs`
  passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` passed.
- `npm run tauri -- build --no-bundle` passed in WSL and built
  `src-tauri/target/release/simple-vibe-ide`.
- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 274 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- Windows runtime smoke testing is still required; this validation proves the
  WSL/Linux no-bundle Tauri build path, not the final Windows runtime behavior.


### 2026-05-23 - Export job state update allocation trim

#### Changed

- Export jobs now maintain an id lookup map so progress events can preserve
  `createdAt` and resolve action rows without scanning the visible job array.
- Existing export job records are updated in place instead of replacing them
  with spread-cloned objects on every progress event.
- The export job list trim now pops old jobs and removes their lookup entries
  instead of slicing a new array after each upsert.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 274 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for repeated export progress
  updates, cancelled/failed/completed job transitions, export list trimming,
  workspace clearing, and completed export drag-out/open actions.


### 2026-05-23 - Export progress render allocation trim

#### Changed

- Export progress rows now keep their meta/progress/action DOM nodes and update
  text, progress width, and classes in place instead of rebuilding the entire row
  for every progress event.
- Same-order export refreshes now update cached rows directly without allocating
  a temporary `Set` or pruning caches when the job order and count already match.
- Export action buttons are rebuilt only when the action mode changes, and their
  handlers resolve the current row/job at event time to avoid stale job data.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 274 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for background export progress,
  cancel, completed export drag-out/open actions, export list reorder/prune, and
  UI responsiveness while Explorer/Browser/terminal work is busy.


### 2026-05-23 - Image history render allocation trim

#### Changed

- Visible image-history refreshes now update same-order rows directly without a
  temporary `Set` or cache prune when the row order and count already match.
- Image-history rows now cache their preview image, path label, and timestamp
  refs on creation, avoiding repeated nested DOM queries during history refresh.
- Empty image history now clears the row cache directly instead of creating an
  empty `Set` only to prune the cache.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 273 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for image paste history,
  previewing history rows, pasting tags into the active terminal, clearing
  history, workspace restore, and frequent image panel open/close.


### 2026-05-23 - Explorer watcher polling allocation trim

#### Changed

- Explorer background watcher path collection now uses a small linear key list
  helper instead of allocating a `Set` and closure on each poll.
- Directory-signature polling now avoids a per-poll `Map`; it keeps a compact
  parallel key list and performs bounded lookup over the small watched path
  batch.
- This reduces background Explorer watcher allocation while preserving the
  existing input/scroll/workspace-drag pause guards and UI-yield behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 273 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer background
  refresh, expanded directory polling, stale directory signature detection,
  scrolling pause behavior, workspace switching, and WSL/SSH large-folder
  interaction.


### 2026-05-23 - Terminal widget card direct DOM render

#### Changed

- Terminal widget cards now create the titlebar, tabbar, tab list, new-tab
  button, close button, and host stack with direct DOM nodes instead of parsing
  an `innerHTML` template and querying the card for child refs.
- Terminal widget creation now reuses the direct element references when building
  the `TerminalWidget` object and when wiring drag/close/new-tab handlers.
- The now-unused HTML escaping helper was removed because these hot paths use
  `textContent` and direct element attributes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for creating terminal widgets,
  dragging/resizing terminal cards, creating shell tabs inside a widget, closing
  widgets, restoring workspace terminal widgets, and active prompt targeting.


### 2026-05-23 - Market ticker render allocation trim

#### Changed

- Market ticker same-order refreshes now update existing chip elements directly
  without allocating a temporary `Set` or pruning caches when the chip order and
  count already match.
- Market ticker chip label/price/change/remove child references are cached on
  creation and reused on quote/status updates instead of querying the DOM every
  render.
- Remove-button creation remains lazy for custom symbols, with the cached
  reference cleared when a chip is no longer removable.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for live ticker quote refresh,
  add/remove custom symbols, persisted custom symbol restore, and UI updates
  while Explorer/Browser/terminal work is busy.


### 2026-05-23 - Browser tab same-order allocation trim

#### Changed

- Browser tab strip same-order refreshes now update cached tab elements directly
  without allocating a temporary `Set`.
- Browser tab element cache pruning is kept for actual order/length rebuilds,
  where stale tab ids can exist.
- This keeps many-tab title/URL/active-state refreshes lighter while preserving
  existing Browser tab direct DOM rendering and index lookup behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser tab open, activate,
  close active/inactive, title/URL updates, duplicate URLs, workspace restore,
  hidden/visible Browser panel transitions, and many-tab switching.


### 2026-05-23 - Workspace tab direct DOM render

#### Changed

- Workspace tab elements now create label/security/copy/close buttons directly
  instead of parsing the whole tab with `innerHTML` and then querying children.
- Workspace tab icon SVGs are built with DOM/SVG nodes, and the child-reference
  WeakMap is populated immediately during creation.
- Same-order workspace tab refreshes now update cached elements directly without
  allocating a temporary `Set` or pruning caches when the tab order and child
  count already match.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace tab activation,
  copy, close, capture-protection toggle, SVG icons, drag/reorder, restore, and
  frequent workspace switching.


### 2026-05-23 - Browser console single append fragment skip

#### Changed

- Browser console append rendering now detects the common single-new-log case and
  appends that row directly.
- `DocumentFragment` allocation is retained only for multi-log append batches or
  full console replacement, preserving batch behavior while making noisy
  one-at-a-time console output lighter.
- Existing tail trimming and scroll-to-bottom behavior is unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for single-log visible append,
  multi-log batch append, console clear, trimming, hidden console replay, and
  noisy Browser console output.


### 2026-05-23 - Browser console append index cache

#### Changed

- Browser console rendering now tracks the last rendered log index alongside the
  last rendered log id.
- Noisy append renders can usually jump directly to the previous tail row instead
  of scanning the visible console tail to find the last rendered id.
- Console trim and clear paths keep the cached index in sync, with fallback id
  scanning retained for safety after resets or unexpected log replacement.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for visible console append,
  console clear, hidden console replay, log trimming, workspace restore, Browser
  panel hide/show, and noisy Browser console output.


### 2026-05-23 - Explorer row child lookup cache

#### Changed

- Explorer virtual row elements now cache their disclosure/name/size child
  references in a WeakMap when the row is created.
- Explorer row and loading-row updates now use cached child refs instead of
  reading the row's live `children` collection on every visible-row patch.
- Reused Explorer row elements still rebuild child refs through a fallback helper
  if needed, preserving the existing row recycle/cache behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for large-directory scrolling,
  selection, drop-target highlight, inline rename, loading rows, file-size toggle,
  expanded/collapsed directories, row recycling, and workspace switching.


### 2026-05-23 - Browser frame iteration allocation trim

#### Changed

- Browser iframe lifecycle paths now iterate indexed frames through
  `forEachPreviewFrame()` instead of building a temporary `previewFrames()`
  array for each suspend, hide, clear, or active-frame switch operation.
- Workspace-level frame suspend/clear/hide and all-frame hide paths now avoid
  per-call frame array allocation while still pruning disconnected frames from
  the frame indexes.
- Active Browser tab switching still hides only competing frames in the current
  workspace and keeps the existing suspend/console-detail behavior intact.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser tab switching,
  workspace switching, inactive-frame suspension, frame restore/load, console
  capture-detail sync, Browser panel hide/show, and clearing Browser frames.


### 2026-05-23 - Browser forward row render allocation trim

#### Changed

- Browser forward/detected-port rows now cache their load/detail/stop child
  references in a WeakMap after the controls are first created.
- Forward row updates no longer query `.load`, `.forward-detail`, and `.stop`
  on every render/update pass.
- Same-order forward list refreshes now update cached row elements directly
  without allocating a temporary `Set` or pruning caches when the rendered order
  and child count already match.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for detected-port rows, manual
  forwards, auto-forwarded Browser opens, stop/ignore actions, proxy-local-port
  filtering, hidden/visible Browser panel transitions, and workspace switching.


### 2026-05-23 - Terminal widget tab render allocation trim

#### Changed

- Terminal widget tab elements now build their label/close buttons with direct
  DOM creation instead of `innerHTML` parsing followed by `querySelector`
  listener lookup.
- Terminal widget tab updates now use the known first child label button instead
  of querying `.widget-tab-label` on every terminal tab render/update.
- Same-order terminal widget tab refreshes now update cached elements directly
  without allocating a temporary `Set` or pruning caches when the widget tab
  order and child count already match.
- The hidden legacy shell tab list clear now uses `replaceChildren()` instead of
  assigning an empty `innerHTML` string.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal tab activation,
  close active/inactive, focus, title updates, terminal widget switching, hidden
  output buffering, workspace restore, and frequent workspace switching.


### 2026-05-23 - Editor Image Notes tab render allocation trim

#### Changed

- Editor, Image, and Notes tab elements now build their label/close buttons with
  direct DOM creation instead of `innerHTML` parsing followed by `querySelector`
  listener lookup.
- Editor/Image/Notes tab updates now use the known first child label button
  instead of querying `.widget-tab-label` on every render or activation update.
- Same-order Editor/Image/Notes tab refreshes now update cached elements directly
  without allocating a temporary `Set` or pruning caches that cannot have changed
  while the rendered order and child count match.
- The existing tab element caches, activation paths, close handlers, titles,
  active classes, and note theme classes are preserved.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Editor/Image/Notes many-tab
  open, activate-existing, close active/inactive, duplicate paths/source paths,
  note save/hydration timers, image history/source changes, restore/rebuild, and
  frequent workspace switching.


### 2026-05-23 - Workspace tab child lookup cache

#### Changed

- Workspace tab elements now cache their label/security/copy/close button
  references in a WeakMap after creation.
- Workspace tab render/update no longer queries the tab DOM for label and
  security buttons on every activation or render pass.
- Workspace tab creation also avoids a broad `querySelectorAll('button')` pass
  by setting draggable flags on the cached button references directly.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 272 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace tab activation,
  copy, close, capture-protection toggle, drag/reorder, restore, and frequent
  workspace switching.


### 2026-05-23 - Workspace snapshot index lookup cache

#### Changed

- Workspace snapshots now maintain an id-to-index lookup alongside the existing
  id-to-snapshot lookup map.
- Workspace copy, close, save, and drag-reorder paths can now resolve snapshot
  indexes through the cache instead of repeated `indexOf()` / `findIndex()`
  scans.
- Insert/remove/reorder operations refresh only the shifted index range, keeping
  workspace tab lifecycle work lighter during frequent workspace switching.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 271 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace create, copy,
  close, reorder, active snapshot save, restore, persistence, and frequent
  workspace switching.


### 2026-05-23 - Editor Image Notes tab index lookup cache

#### Changed

- Editor, Image, and Notes tabs now maintain id-to-index lookup maps alongside
  their existing id/path lookup maps.
- Tab close paths use the cached index and refresh shifted indexes after splice,
  avoiding repeated `indexOf()` / `findIndex()` scans during many-tab close and
  workspace tab lifecycle operations.
- Fallback id/path lookups now use explicit loops and refresh lookup state with
  the found index for later O(1) access.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 271 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Editor/Image/Notes many-tab
  open, activate, close active/inactive, duplicate paths, hydration, workspace
  restore, and workspace switching.


### 2026-05-23 - Browser tab index lookup cache

#### Changed

- Browser tabs now maintain an id-to-index lookup alongside the existing id/url
  lookup maps.
- Closing Browser tabs now uses the cached index and refreshes shifted indexes
  after splice, avoiding `indexOf()`/`findIndex()` scans in common many-tab
  close/switch paths.
- Browser tab fallback lookups now use explicit loops that refresh lookup state
  with the found index.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 270 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser many-tab open,
  activate, close active/inactive, duplicate URLs, workspace restore, and
  hidden/visible Browser panel transitions.


### 2026-05-23 - Browser preview proxy local-port lookup

#### Changed

- Preview proxy local-port checks now use a `Map<number, PortForwardResult>`
  instead of a port-only set plus fallback array scan in common paths.
- Workspace runtime cache save now checks the active Edge tab through the
  existing Browser tab lookup map instead of scanning `state.browserTabs` with
  `some()`.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for preview proxy reuse,
  local-port auto-forward skip logic, proxy stale removal, workspace switching,
  and Edge/browser tab runtime-cache transitions.


### 2026-05-23 - Browser console compact object formatter

#### Changed

- Hidden/compact Browser console object formatting now builds the small key
  preview string directly instead of allocating a `keys` array and joining it.
- This reduces allocation pressure when the Browser widget is hidden or the
  console is compacting noisy object logs during deferred payload flushes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for hidden Browser console
  object logs, noisy batches, deferred payload flushes, visible compact/detail
  formatting, and workspace switching.


### 2026-05-23 - Browser tab direct DOM render

#### Changed

- Browser tab elements are now built with direct DOM nodes instead of
  `innerHTML` plus follow-up `querySelector()` calls.
- Browser tab render/update now writes the label through the known first child,
  avoiding a DOM query on each tab activation or Browser tab render pass.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser tab open, activate,
  close, title/URL updates, workspace restore, and Browser hidden/visible
  transitions.


### 2026-05-23 - Explorer directory cache key reuse

#### Changed

- Explorer directory cache lookups now reuse the already-built cache key in
  fetch, batch fetch, and directory prefetch guard paths instead of building the
  same key string again for cache-hit checks.
- Directory cache invalidation now deletes the size/no-size variants directly
  instead of allocating a temporary boolean array for each invalidation.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer prefetch, cache
  hits, cache invalidation with/without file sizes, refresh, rename, delete,
  and workspace switching.


### 2026-05-23 - Explorer directory cache idle prune

#### Changed

- Explorer directory cache pruning now follows the row/path-key cache pattern:
  when scrolling or input is pending, prune work is deferred to UI idle instead
  of deleting all old directory entries synchronously.
- Added a directory-cache busy ceiling and bounded prune batch so aggressive
  directory prefetch/cache churn can still reclaim memory without causing a
  large one-shot pause during Explorer scroll.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for large-directory Explorer
  scrolling, visible-directory prefetch, cache reuse/expiry, refresh, rename,
  delete, and workspace switching.


### 2026-05-23 - Browser console local-port scan drain loop

#### Changed

- Deferred Browser console local-port scanning now processes up to 16 queued
  messages by index before trimming the queue, instead of allocating a temporary
  array with `splice(0, 16)`.
- This keeps hidden-console localhost auto-forward scans bounded while reducing
  transient array work during noisy Browser console output.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for hidden Browser console
  local-port auto-forward scans, duplicate suppression, manual/auto forwards,
  and workspace switching.


### 2026-05-23 - Browser console hidden single-payload queue

#### Changed

- Hidden Browser console single-record handling now queues the payload directly
  instead of allocating a one-element array for `queueBrowserConsoleHiddenPayloads()`.
- Batch hidden-console queuing shares the same payload-accept helper, keeping
  validation consistent while preserving the one-prune-per-batch behavior from
  the previous patch.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for hidden Browser console
  single logs, hidden batches, deferred flushes, console retention, and
  workspace switching.


### 2026-05-23 - Browser console batch append loop

#### Changed

- Browser console batch append now uses an explicit loop helper instead of
  `push(...entries)`, avoiding argument-list/spread work when noisy Browser
  logs arrive while still preserving retention trimming and local-port scanning.
- Hidden Browser console payload queuing now accepts a batch with one loop and
  prunes once after the batch instead of checking/splicing after every payload.
  This reduces synchronous hidden Browser console overhead while keeping the
  same bounded queue behavior after each enqueue call.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for hidden/visible Browser
  console batches, console retention, local-port auto-forward scanning, hidden
  payload flushes, and workspace switching.


### 2026-05-23 - Browser console runtime tail copy loops

#### Changed

- Browser console runtime snapshot, workspace restore, and large console batch
  replacement now copy retained log tails with a shared loop helper instead of
  `slice(-limit)`.
- Workspace runtime editor-tab snapshots now use an explicit loop instead of
  `slice()`, keeping workspace switch/cache save paths consistent with the
  other loop-based snapshot helpers.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser console retention,
  hidden/visible console restore, noisy console batches, workspace switching,
  and runtime-cache restores.


### 2026-05-23 - Workspace snapshot clone loop helpers

#### Changed

- Workspace copy now clones terminal, editor, image, note, browser, and
  calculator snapshot arrays through explicit loop helpers instead of multiple
  `map()` chains.
- Current workspace snapshot creation now copies image history and calculator
  history with bounded loops instead of `slice()` calls.
- This keeps workspace tab copy and frequent snapshot-save paths closer to the
  existing loop-based restore/persist optimizations.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 269 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace tab copy,
  active workspace snapshot save, image/calculator history retention, and
  workspace switching.


### 2026-05-23 - Workspace image store loop compaction

#### Changed

- Workspace store load now hydrates valid snapshots in one explicit loop instead
  of a `filter().map()` chain.
- Workspace image-store parsing now uses a guarded `for...in` copy instead of
  `Object.entries()` + `filter()` + `Object.fromEntries()`.
- Workspace image snapshot compaction and hydration now use loop helpers for
  image tabs and image history entries instead of nested `map()` calls, reducing
  callback/intermediate-array work during workspace save/load and image-ref
  persistence.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 268 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace store load/save,
  image tab/history restore, image data-ref persistence, workspace copying, and
  workspace switching.


### 2026-05-23 - Workspace restore tab loop helpers

#### Changed

- Workspace restore now rebuilds Editor, Image, Notes, Browser, and preview-proxy
  state through explicit loop helpers instead of `map()`/`filter().map()`
  chains.
- Notes restore now skips pathless note snapshots in one pass instead of
  allocating a filtered intermediate array before creating runtime note tabs.
- Browser restore now normalizes runtime or snapshot tabs in one loop and
  clones preview proxies with a loop, reducing callback/intermediate-array work
  during workspace switches.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 268 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace restore/switch
  behavior across Editor, Image, Notes, Browser tabs, preview proxies, hidden
  panels, and runtime-cache restores.


### 2026-05-23 - Explorer visible lookup map trim

#### Changed

- Explorer visible-row rebuild now reuses the existing visible-row and
  typeahead-candidate arrays by resetting their length, preserving capacity
  across repeated large-tree renders instead of allocating fresh arrays.
- The separate visible-entry lookup map was removed. Visible entry lookup now
  reuses the existing path-key to visible-index map and resolves the entry from
  `explorerVisibleRows`, cutting one map clear/set pass during every Explorer
  rebuild.
- Explorer drop-target hit testing now uses the row's cached visible entry
  lookup instead of going back through the broader Explorer entry resolver.
- Selection update compares cached path keys directly when deciding whether the
  previous and current selection differ.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer selection,
  visible-row lookup, drag/drop target detection, typeahead, scrolling, and
  workspace switching.


### 2026-05-23 - Explorer row render signature precompute

#### Changed

- Explorer visible-row rebuild now precomputes row disclosure text, file-size
  text, and the static row signature for each row.
- Virtual Explorer row updates can now compare the precomputed signature instead
  of recomputing expanded state, file-size text, and a multi-part signature
  string for every visible row during scroll/window patching.
- New-file/new-folder duplicate-name checks now build the sibling name set with
  a direct loop instead of creating an intermediate `entries.map()` array.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer scrolling,
  expanded directory disclosure state, file-size toggle/rendering, inline
  rename, new file/folder duplicate naming, and workspace switching.


### 2026-05-23 - Panel interaction DOM query trim

#### Changed

- Keyboard-resize target changes now track the previously highlighted panel or
  terminal element and remove the `keyboard-target` class directly, instead of
  querying all highlighted floating panels and terminal cards on every target
  change.
- Panel drag/resize snap-guide collection now walks the known panel cache,
  terminal widget list, and cached terminal grid element directly instead of
  building spread arrays from `querySelectorAll()` results.
- Workspace control rendering and LLM launcher binding now reuse cached button
  lists for panel toggles and LLM buttons, avoiding repeated DOM queries during
  workspace open/close state changes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for panel focus/keyboard
  resizing, panel/terminal drag snapping, workspace open/close control states,
  LLM launcher buttons, and workspace switching.


### 2026-05-23 - Terminal tilde cwd expansion allocation trim

#### Changed

- Terminal prompt cwd tilde expansion no longer builds a temporary candidates
  array with `filter()` or splits the tilde tail when resolving prompt cwd
  values such as `~/project`.
- Candidate cwd sources are checked in the same priority order as before:
  terminal cwd, workspace root, current Explorer dir, then active profile root.
- Home-directory detection now uses direct prefix/index checks for `/home/...`
  and `/Users/...` instead of a per-call regex match.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for tilde prompt cwd values,
  OSC7 cwd tracking, prompt-cwd fallback behavior, hidden/inactive terminal
  output, and workspace switching with noisy terminals.


### 2026-05-23 - Terminal OSC7 cwd scan exec loop

#### Changed

- Terminal OSC7 cwd extraction now reuses a shared regex and scans with an
  explicit `exec` loop instead of creating a per-call regex and `matchAll`
  iterator.
- The function still returns the last OSC7 cwd found in the incoming terminal
  data, preserving existing cwd tracking while reducing allocation on noisy
  terminal output.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for OSC7 cwd tracking,
  prompt-cwd fallback behavior, hidden/inactive terminal output, and workspace
  switching with noisy terminals.


### 2026-05-23 - Browser console local-port scan exec loop

#### Changed

- Browser console dependency auto-forward now reuses a shared local-URL port
  regex and scans with an explicit `exec` loop instead of recreating the regex
  and `matchAll` iterator for each console message.
- The scan captures the active profile id once per message, preserving the
  existing non-Windows auto-forward behavior while reducing allocation on noisy
  Browser console output and hidden-console replay.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser console local-URL
  detection, dependency auto-forward, duplicate suppression, and workspace
  switching with noisy Browser logs.


### 2026-05-23 - Terminal prompt cwd tail scan

#### Changed

- Terminal prompt-cwd detection now scans the most recent prompt-output lines
  backward from the buffer tail instead of building `split('\\n').slice(-40)`
  arrays on each scheduled cwd scan.
- The scan still checks the same recent 40-line window and the same PowerShell
  and POSIX prompt patterns, preserving prompt-cwd behavior while reducing
  allocation for noisy terminal output.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for PowerShell prompt cwd,
  bash prompt cwd, OSC7 cwd, manual `cd` tracking, hidden/inactive terminal
  output, and workspace switching with noisy terminals.


### 2026-05-23 - Terminal port scan allocation guard

#### Changed

- Terminal local-server detection now queues newly discovered ports directly
  while scanning regex matches, avoiding the previous `Set` -> array -> `filter`
  chain on noisy terminal output.
- Local-preview port regexes are now shared constants and scanned with explicit
  `exec` loops, so scheduled terminal port scans avoid recreating regex objects
  and intermediate iterables.
- The existing `seenPorts` behavior is preserved: once a terminal pane sees a
  preview port, it is queued once and then ignored on later scans.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal output port
  detection, detected-port rows, Browser auto-open/manual-open flow, duplicate
  port suppression, and noisy terminal output under workspace switching.


### 2026-05-23 - Explorer entry lookup cache

#### Changed

- Explorer loaded entries now maintain a path-key lookup cache, so selection,
  context menu, inline rename, export, drag/drop target, and open-selected paths
  avoid recursive tree scans over the loaded Explorer tree in common cases.
- The lookup cache is marked dirty when the root listing or loaded child
  directories are restored, refreshed, expanded, removed, or moved, then rebuilt
  lazily on the next lookup.
- Explorer watch-path collection now uses a `Set` of cached path keys instead
  of scanning the current path list for duplicates while building watch targets.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 267 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer selection,
  context menus, open-selected, inline rename, create file/folder, drag/drop
  target selection, expand/collapse, watcher refresh, and rapid scrolling in
  large loaded trees.


### 2026-05-23 - Connection profile lookup cache

#### Changed

- Connection profiles now maintain an id lookup cache, so workspace restore,
  profile selection, terminal restore, terminal cwd resolution, explorer cache
  TTL checks, Windows shell creation, and copy-`cd` helper paths avoid repeated
  linear scans over all profiles in common cases.
- Profile list updates rebuild the lookup cache after the initial profile load
  and after deferred WSL profile discovery merges in additional profiles.
- Windows-local fallback behavior remains explicit for terminal-only paths that
  can create a Windows PowerShell tab without a stored profile entry.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 266 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for initial profile load,
  deferred WSL profile merge, profile selection, workspace restore with saved
  profiles, terminal restore with per-pane profile ids, Windows PowerShell tab
  creation, and explorer cache TTL behavior by profile kind.


### 2026-05-23 - Workspace snapshot lookup cache

#### Changed

- Workspace snapshots now maintain an id lookup cache, so active workspace
  snapshot reads, tab activation, copy/close/toggle, context menus, and snapshot
  save/replace paths avoid repeated linear scans in common cases.
- Workspace snapshot insert/replace/remove helpers keep the lookup cache in sync
  with the ordered snapshot array while preserving the existing array order for
  tab rendering and persistence.
- Workspace tab drag/drop hit testing now iterates the existing tab children
  directly instead of allocating arrays from `querySelectorAll` during pointer
  movement, and drop-target lookup reuses the existing connected-tab cache.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 266 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace create/copy/
  close/activate/reorder, capture-protection toggle, snapshot persistence,
  workspace tab drag/drop, and rapid workspace switching.


### 2026-05-23 - Browser console row reuse

#### Changed

- Browser console log rows now use a small row-element cache keyed by log id, so
  reopening the console, restoring visible console state, or falling back to a
  full console render can reuse row DOM instead of recreating every visible log
  row.
- Browser console trimming and clear/reset paths now clear stale cached rows,
  keeping the cache bounded by the retained console-log window.
- The empty console state now uses `replaceChildren` with a created text node
  instead of assigning `innerHTML`, avoiding parser work on repeated clear/reset
  paths.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 266 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser console show/hide,
  clear, hidden-log replay, console resize/position, large log bursts, and
  workspace switching with console-visible Browser tabs.


### 2026-05-23 - Forward and detected-port lookup caches

#### Changed

- Manual forwards now maintain id and remote-port lookup caches, so local-preview
  reuse, manual/auto open-port checks, dependency-port auto-forward checks, and
  stop-forward paths avoid repeated linear scans in common cases.
- Detected ports now maintain an id lookup cache, and detected-port removal uses
  indexed splice instead of rebuilding the entire array with `filter`.
- Manual forward add/remove paths update the lookup caches while keeping fallback
  scans on cache misses for robustness.
- A few terminal pane lookup sites now reuse the existing pane-id map instead of
  scanning all terminal panes when opening terminal context menus, resizing the
  active terminal target, marking keyboard resize targets, or pasting image tags.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 266 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for manual forward start/stop,
  detected-port open/ignore, Browser dependency auto-forward, local-preview
  reuse, and terminal context-menu/image-tag paste behavior.


### 2026-05-23 - Editor/Image/Notes tab lookup caches

#### Changed

- Editor, Image, and Notes tabs now maintain lightweight id lookup caches, so
  active-tab reads, tab activation, close paths, hydration completion, and
  targeted tab activation rendering avoid repeated linear scans in common cases.
- Editor tabs also maintain a file-path lookup cache for open-existing-file
  checks, and Image tabs maintain a source-path lookup cache for open-existing
  image checks and rename/paste updates.
- Notes hydration order and dirty-note save-all now build pending work with
  direct loops instead of `filter`/`findIndex`/`splice` or `filter`/`map`
  chains, reducing avoidable allocation around Notes panel activation and
  workspace restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 265 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Editor/Image/Notes tab
  create/activate/close, existing file/image reuse, rename path updates, Notes
  hydration, and workspace switching with many tabs.


### 2026-05-23 - Browser device preset lookup guard

#### Changed

- Browser device presets now have an id lookup map, so device validation, device
  mode switching, iframe sizing, Edge viewport sizing, and device title updates
  avoid repeated linear scans over all presets.
- Browser device option rendering now loops once per preset group instead of
  allocating filtered preset arrays for phone/tablet groups.
- This targets Browser panel show/switch/restore/device-rotate paths where frame
  sizing can run repeatedly while the user is interacting with the Browser
  widget or switching workspaces.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 263 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser device select,
  rotate, iframe sizing, Edge fallback sizing, hidden tab activation after device
  changes, and workspace restore with device-mode Browser tabs.


### 2026-05-23 - Explorer path basename and typeahead guards

#### Changed

- Added a small allocation-free path basename helper and used it for Explorer text
  prefetch classification plus workspace, editor tab, image tab, and Notes labels.
- Replaced repeated `split/filter/pop` basename extraction in these paths with a
  manual scan, reducing small array allocations during Explorer prefetch, tab
  rendering, and workspace label/snapshot updates.
- Explorer typeahead candidate keys and query updates now use regular
  `toLowerCase()` instead of locale lowercasing, avoiding heavier locale work
  while preserving case-insensitive matching for the app's file navigation use.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 263 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer text prefetch,
  typeahead matching, workspace labels, Editor/Image/Notes tab labels, rapid
  Explorer scrolling, and path-heavy workspace switching.


### 2026-05-23 - Browser preview proxy lookup cache

#### Changed

- Browser preview proxies now maintain target-origin and local-port lookup caches,
  so preview-proxy reuse and preview-proxy local-port checks avoid repeated scans
  over all proxy forwards.
- Browser restore rebuilds the proxy lookup caches after hydrating runtime proxy
  state, and discard/reset paths clear the caches with the proxy list.
- Stale proxy removal and proxy restart now update the lookup caches while keeping
  the existing fallback scan on cache misses.
- Detected-port rendering now avoids a temporary filtered array for the active
  profile, and detected-port duplicate Browser tab checks reuse the Browser URL
  lookup cache.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 263 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for local preview proxy reuse,
  stale proxy recreation, hidden Browser restore with proxy tabs, detected-port
  rows, auto-forward dependency ports, manual forwards, and workspace switching
  with proxy-backed Browser tabs.


### 2026-05-23 - Browser tab lookup cache

#### Changed

- Browser tabs now maintain id and URL lookup caches, so active-tab selection,
  opening an existing URL, local-preview reuse, Edge URL updates, and current-tab
  reads avoid repeated linear scans over all Browser tabs.
- Browser restore rebuilds the lookup caches after hydrating runtime/snapshot tabs;
  open/close paths register and unregister cache entries.
- URL updates from Edge navigation update the URL cache while preserving the
  existing first-tab behavior for duplicate URLs.
- Fallback linear lookup remains in place on cache misses, then refreshes the
  relevant cache entry.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 263 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser tab restore,
  open-existing URL, local preview proxy reuse, active tab switch/reselect, close
  active/inactive tabs, Edge URL navigation updates, iframe frame reuse, and
  workspace switching with many Browser tabs.


### 2026-05-23 - Terminal widget lookup cache

#### Changed

- Terminal widgets now maintain id and element lookup caches, so
  `terminalWidgetForPane` and `terminalWidgetForElement` avoid repeated linear
  scans over all terminal widgets on terminal data, exit, snapshot, active-pane,
  focus, resize, and context-menu paths.
- Terminal widget creation registers the lookup caches immediately, and widget
  removal/close-all paths unregister them to avoid stale widget references.
- Fallback linear lookup remains in place if a cache miss ever occurs, preserving
  behavior while rebuilding the cache entry.
- This targets terminal-heavy workspaces where repeated pane-to-widget lookups
  happen during workspace snapshot saves, terminal tab rendering, pane activation,
  shell exit handling, and terminal output/activity updates.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 262 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal create/close,
  close-all, shell exit, active pane switch, terminal context menu, focus cycling,
  workspace snapshot save/restore, and workspace switching with multiple terminal
  widgets.


### 2026-05-23 - Workspace terminal snapshot allocation guards

#### Changed

- Workspace snapshot creation now builds active-workspace terminal snapshots,
  active terminal index, and terminal spawn rect in one pass over terminal state
  instead of filtering active workspace panes and then mapping/finding over the
  filtered array.
- Workspace terminal restore now uses direct active-pane existence and clamped
  pane lookup helpers instead of allocating active-pane arrays just to test
  length or select the restored active terminal.
- Removed the now-unused terminal spawn rect helper that depended on a filtered
  active-pane array.
- This targets workspace save/switch paths where terminal-heavy workspaces were
  doing extra synchronous allocation while snapshot persistence and restore were
  already active.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 262 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace snapshot saves,
  workspace restore with multiple terminal widgets/tabs, active terminal index
  restore, terminal spawn rect restore, rapid workspace switching, and app
  restart persistence.


### 2026-05-23 - Terminal widget render allocation guards

#### Changed

- Terminal widget tab rendering now builds tab render signature, order signature,
  and pane count in one pass over terminals, avoiding the previous filter-array
  and repeated order/signature loops on terminal tab changes.
- Shell-tab rendering and foreground-resume terminal fit now iterate active
  workspace widgets directly instead of allocating an active-widget array.
- Terminal pane close now uses direct first-pane lookup for next active pane and
  splices closed panes/widgets in place instead of rebuilding terminal arrays with
  filter in the close hot path.
- Terminal widget close and workspace terminal close now collect ids with simple
  loops before async close operations, avoiding chained filter/map allocations
  while preserving safe iteration over mutating terminal state.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 262 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for shell tab create/close,
  active pane switch, closing the active pane/widget, workspace terminal close,
  focus cycling, foreground resume fit, and workspace switching with multiple
  terminal widgets.


### 2026-05-23 - UI signature allocation guards

#### Changed

- High-frequency render signatures now avoid temporary `map/filter/join` arrays in
  market ticker rows, workspace tab order, Notes tabs, Calculator history, Export
  rows, Forward rows, Editor/Image tab order, Browser tab order, image history,
  and terminal widget tab order paths.
- Market ticker custom-count and persist paths now count/copy with bounded loops
  instead of allocating filtered arrays during add/render/persist updates.
- Terminal widget active-state helpers now use direct first-pane/first-widget lookup
  and loop over matching panes for fit/active-state sync, avoiding extra filtered
  arrays on terminal activation, focus, resize, and widget title updates.
- `activePaneForWidget` now verifies that a cached pane still belongs to the
  widget before using it, preserving the existing fallback while avoiding stale
  cross-widget pane use.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 261 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for market ticker updates,
  workspace/widget tab switching, terminal widget activation/resizing, Browser
  tabs, Forward rows, Export rows, and Notes/Calculator/Image/Editor render
  updates.


### 2026-05-23 - Workspace persistence signature allocation guards

#### Changed

- Workspace store persistence now reuses the existing workspace snapshot array when
  the snapshot count is within the persisted limit, avoiding an unnecessary slice
  before JSON compaction/serialization.
- Workspace store signature generation now uses a bounded loop instead of
  slice/map/join allocation on the persistence hot path.
- Workspace snapshot signature generation now concatenates the signature string
  directly instead of allocating a large temporary array before `join('|')`.
- Persist-driven workspace tab rendering now runs only when the visible tab
  signature, tab order, or tab count changed, so snapshot-only saves do not enter
  the full workspace-tab render path.
- This reduces synchronous allocation/render checks during workspace snapshot
  saves and workspace switching while preserving the existing 24-workspace
  persisted limit and tab fallback behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 260 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace switching,
  snapshot persistence after restart, workspace tab create/copy/close/reorder,
  and rapid snapshot-only saves while terminals/Browser tabs are active.


### 2026-05-23 - Terminal scan buffer bounded append

#### Changed

- Terminal port-scan and prompt-cwd scan buffers now append through a bounded
  helper that trims oversized incoming data before concatenation.
- Large output chunks no longer build an unnecessarily huge intermediate string
  just to keep the last few kilobytes needed for port/cwd detection.
- Existing scan limits and detection behavior remain the same; this only reduces
  string allocation/copy cost under noisy terminal output.
- This complements terminal write chunking by reducing non-render terminal work
  on large output bursts.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 260 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for local-port detection,
  prompt cwd detection, OSC7 cwd detection, very large terminal output bursts,
  hidden/background terminal output, and workspace switching with noisy shells.


### 2026-05-23 - Terminal buffered write chunking

#### Changed

- Terminal buffered output flushes now write bounded chunks instead of sending a
  very large accumulated buffer to xterm in one synchronous path.
- Visible terminals use a larger chunk and continue on the next animation frame;
  inactive/background terminals use smaller chunks and continue through the
  existing delayed/idle write path.
- This preserves terminal output while reducing the chance that noisy hidden
  terminals or large background output bursts block workspace switching, tab
  activation, or first interaction after restore.
- Existing background visibility, port-scan, and cwd-scan gating remains in
  place.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 260 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for noisy visible terminals,
  hidden/background terminal output catch-up, switching to a terminal with a
  large buffered backlog, shell tab activation, terminal close cleanup, and
  workspace switching with active background output.


### 2026-05-23 - Browser visible restore idle console flush

#### Changed

- Browser visible-layout restore now defers hidden console payload flushing to the
  existing idle flush path instead of formatting/append-rendering hidden console
  batches immediately while the Browser panel is being restored or shown.
- User-triggered console show still flushes immediately; only restore/layout sync
  uses the deferred path.
- Browser console visibility, position, frame active/hidden state, Edge preview
  state, and `has-preview` shell flags now use no-op guarded class/attribute
  writes where possible.
- Browser console position class updates are signature-guarded to avoid repeated
  remove/add cycles when the same console orientation is restored.
- This further separates Browser used and unused/hidden work so workspace restore
  and Browser panel show do less synchronous work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 259 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser panel show/hide,
  console show/hide/position changes, hidden-console log replay, iframe tab
  switching, Edge preview-disabled fallback, and workspace switching with Browser
  console logs queued while hidden.


### 2026-05-23 - Workspace restore snapshot idle save

#### Changed

- Workspace restore now delays the post-restore snapshot write with a longer
  restore-specific debounce, so JSON/signature/localStorage work is less likely
  to run immediately after first paint while the user starts interacting with the
  newly switched workspace.
- The delayed save still flushes through the existing snapshot pipeline and is
  cancelled/flushed by the next explicit workspace save or switch.
- Workspace close now no-op guards profile/root input resets, avoiding redundant
  control writes during empty-workspace and close flows.
- Notes opacity restore now no-op guards slider/value text updates.
- This targets workspace-switch perceived latency without removing the existing
  persistence path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 259 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for rapid workspace switching,
  immediate switch-away after restore, active workspace persistence after app
  restart, empty workspace switching, Notes opacity restore, and terminal restore
  follow-up saves.


### 2026-05-23 - Explorer scroll cache prune idle path

#### Changed

- Explorer row-element cache pruning now defers to scroll/input idle instead of
  running full prune loops during active scrolling; a hard busy limit still
  allows small batch pruning to prevent unbounded cache growth on very long
  scrolls.
- Explorer path-key cache pruning uses the same busy/idle strategy, avoiding
  large map-prune work while the user is scrolling or input is pending.
- Explorer row updates now no-op guard selected/drop-target class toggles,
  `aria-selected`, `role`, `tabIndex`, and depth style writes where possible.
- Explorer selection synchronization now uses no-op guarded class/attribute
  writes for old/new selected rows.
- This targets the visible scroll-stutter case by moving cache cleanup and
  redundant DOM writes away from the scroll frame path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 259 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for rapid Explorer scroll,
  long-directory scroll through many cached rows, selection, drag/drop target,
  rename row state, file-size toggle, and expand/collapse behavior.


### 2026-05-23 - Widget tab activation targeted render

#### Changed

- Editor, Image, and Notes tab activation now use targeted previous/next tab
  element updates when tab order, child count, and connected cache state are
  stable, instead of walking every tab on ordinary active-tab switches.
- Re-selecting an already active Editor/Image/Notes tab avoids unnecessary
  workspace snapshot saves and skips heavy preview/editor rerender work where
  the visible state is already current.
- Browser tab activation now has the same connected-cache fallback guard as
  workspace tabs, so stale or detached cached tab elements trigger a full render
  instead of creating detached updates.
- Notes render now no-op guards textarea/select/path/theme/pin writes, reducing
  redundant control and class churn during Notes tab activation and workspace
  restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 259 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Editor/Image/Notes tab
  switching, active-tab reselect, close/create paths, Notes save/status updates,
  Browser tab fallback cases, and workspace restore with many tabs.


### 2026-05-23 - Workspace tab activation targeted render

#### Changed

- Workspace tab activation now updates only the previous active tab and the next
  active tab when the tab order and child count are unchanged, instead of
  rerendering every workspace tab.
- The targeted path verifies that cached tab elements are still connected; if
  the cache/order is stale, it falls back to the full workspace-tab render.
- Workspace tab security button title/class/aria updates now use no-op guards,
  reducing redundant DOM writes during active workspace changes and capture
  protection sync.
- Full workspace-tab render is still used for create/copy/close/reorder or any
  order/DOM-count mismatch.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 257 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace tab activation,
  workspace tab create/copy/close/reorder, capture protection toggles, and rapid
  workspace switching.


### 2026-05-23 - Workspace restore control no-op guards

#### Changed

- Workspace restore now uses no-op guarded writes for profile/root inputs and
  editor/image option checkboxes, avoiding redundant form-control updates during
  rapid workspace switches.
- Panel toggle active state and `aria-pressed` updates now also use no-op guards
  in `setPanelVisible`, reducing unnecessary DOM/class/attribute writes when
  restoring panel visibility or repeatedly toggling the same state.
- These changes target the workspace-switching path where many controls and
  panel toggles are synchronized at once.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 257 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for workspace restore,
  panel toggle state, profile/root controls, and editor/image option persistence.


### 2026-05-23 - Browser active-frame sizing and input no-op guards

#### Changed

- Browser mode/device sizing changes now apply iframe sizing only to the active
  Browser frame. Hidden preview frames are resized lazily the next time they are
  shown, avoiding style writes across every cached iframe during device/desktop
  changes.
- Browser iframe titles are refreshed when a frame is shown, preserving visible
  behavior after deferring hidden-frame sizing/title work.
- Preview URL input updates now use a no-op guard, avoiding repeated input value
  writes during Browser restore, refresh, Edge URL updates, and tab activation.
- This further separates Browser used/visible work from hidden cached-frame work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 257 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser desktop/device
  mode switching, hidden tab activation after device changes, preview URL
  updates, and workspace restore.


### 2026-05-23 - Browser tab activation targeted render

#### Changed

- Browser tab activation now updates only the previous and next active tab
  elements when the tab order is unchanged, instead of rerendering every Browser
  tab.
- Re-selecting the already active Browser tab no longer forces a workspace
  snapshot save unless the tab metadata changed.
- Browser frame hide/show class updates now use no-op guarded class toggles,
  reducing DOM churn during tab switches, frame suspension, and workspace
  switching.
- This targets the Browser widget's used-state responsiveness when several
  preview tabs or frames are present.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 257 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Browser tab switching,
  reselecting the active tab, closing active/inactive tabs, proxy-tab activation,
  and workspace switching with Browser tabs.


### 2026-05-23 - Terminal active-pane targeted render

#### Changed

- Re-selecting the already active terminal pane now avoids a snapshot save and
  full terminal-tab render pass; it only refreshes focus target, buffered output,
  and fit scheduling.
- Switching active terminal panes now updates only the previous and next affected
  terminal widgets instead of rerendering every active-workspace terminal
  widget.
- The shell tab render guard now returns immediately when its signature is
  unchanged, avoiding redundant tab rendering after targeted widget updates.
- This reduces click/focus/tab-switch overhead for workspaces with many terminal
  widgets or panes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 256 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for repeated terminal focus
  clicks, terminal tab switching across widgets, shell exit title updates, and
  workspace restore tab rendering.


### 2026-05-23 - Terminal active-state scoped sync

#### Changed

- Terminal active-pane class synchronization now scopes work to the active
  workspace by default instead of scanning every terminal widget in every
  workspace on each active-pane change.
- The active-state update path now computes a widget's pane list once, uses
  no-op class toggles, and skips inactive host visibility updates while a widget
  is hidden.
- Showing a workspace terminal widget explicitly resyncs that widget before
  fitting/flushing, so hidden-pane work is deferred until it can become visible.
- This reduces active tab switching and workspace switching overhead when many
  terminal widgets or hidden workspaces exist.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 256 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal tab switching,
  closing widgets/tabs, hiding/showing workspaces, and restoring terminal
  widgets after workspace switches.


### 2026-05-23 - Inactive terminal fit suppression

#### Changed

- Terminal fit scheduling now checks whether the pane belongs to the active
  workspace and its widget/host are visible before queuing a fit frame.
- Terminal host `ResizeObserver` callbacks skip inactive tab hosts instead of
  scheduling fit work that would immediately hit a hidden xterm layout.
- Window/IDE-scale resume paths now fit only active visible terminal panes, and
  visibility resume schedules an active-pane fit to keep terminal geometry fresh
  after the app returns from the background.
- This reduces layout and backend resize traffic from inactive terminal tabs and
  hidden workspace terminal widgets during resizing, scaling, and workspace
  switching.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 256 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal tab activation,
  workspace switching, app background/foreground restore, and IDE/widget resize
  behavior.


### 2026-05-23 - Background terminal cwd snapshot defer

#### Changed

- Terminal cwd snapshot saves now receive the pane context that triggered the
  cwd change.
- Cwd changes from non-active workspaces no longer schedule an active-workspace
  snapshot save, avoiding unnecessary snapshot/signature/localStorage work while
  another workspace is selected.
- Cwd changes while the document is hidden are saved with a longer background
  delay, reducing timer churn from background OSC7 prompt updates while keeping
  visible terminal cwd changes responsive.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 256 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for terminal cwd persistence
  across hidden document state, background workspace output, and workspace
  switching.


### 2026-05-23 - Explorer watcher input-pending pause and hidden terminal title skip

#### Changed

- Background Explorer watcher work now pauses not only for hidden Explorer and
  active scrolling, but also while workspace tabs are being dragged or Chromium
  reports pending input. This prevents signature/listing processing from
  stealing frames during active user interaction.
- Explorer directory-cache pruning now has a small batch cushion, so cache
  maintenance does not run on every single insertion once the cache is near its
  limit.
- Hidden terminal widgets no longer rewrite title/cwd DOM text during background
  cwd updates. The title/cwd text is forced current when the terminal widget is
  shown again, preserving visible behavior while reducing hidden DOM churn.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 256 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer watcher freshness
  during heavy input/dragging and for terminal title/cwd refresh after switching
  back to hidden workspaces.


### 2026-05-23 - Explorer prefetch idle gate and background port-scan skip

#### Changed

- Explorer directory prefetch now waits for the shared UI-idle guard before
  starting backend directory reads. This keeps hover/visible-row cache warming
  from competing with active scrolling, pending input, or workspace switching.
- A pending-prefetch set prevents duplicate idle callbacks for the same
  directory while a prefetch is waiting for an idle window.
- Terminal preview-port detection now reuses the terminal visibility state and
  skips new scan-buffer work while the app/document is backgrounded.
- Hidden Browser local-port scan queue pruning now mutates in place instead of
  replacing the queue array, avoiding another small allocation path during noisy
  hidden console logging.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for Explorer hover/visible-row
  prefetch timing, hidden/background terminal port detection, and Browser
  console local-port auto-forward behavior.


### 2026-05-23 - Background terminal cwd and hidden Browser queue pruning

#### Changed

- Terminal output handling now reuses the visibility classification from the
  write-buffer path instead of recomputing it for prompt-cwd detection.
- Background terminals, including non-active workspace panes and document-hidden
  panes, skip the fallback prompt-regex cwd scan while still accepting OSC7 cwd
  updates immediately. This keeps non-visible terminal noise from competing with
  Explorer scrolling or workspace switching.
- Hidden Browser console payload buffering no longer builds a filtered payload
  array for every hidden console record/batch. It appends valid payloads
  incrementally and prunes in place, reducing allocation churn when the Browser
  widget is unused or hidden but the page is still logging.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed.
- Windows runtime smoke testing is still required for background terminal cwd
  fallback behavior, hidden Browser console logs, and noisy hidden Browser tabs.


### 2026-05-23 - Hidden terminal write idle flush

#### Changed

- Inactive/background terminal output timers no longer write buffered output to
  xterm directly when the timer fires.
- Non-visible terminal panes now flush their write buffers through the shared
  UI-idle guard, while visible panes still flush immediately for responsive live
  shell feedback.
- This reduces the chance that hidden terminal tabs or background workspaces
  compete with Explorer scrolling, Browser usage, or workspace switching frames.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for noisy hidden terminal tabs,
  background workspace output, and tab activation flush behavior.


### 2026-05-23 - Workspace persist input-pending defer

#### Changed

- Workspace snapshot creation and workspace-store localStorage persistence now
  share the same UI-busy delay guard.
- In addition to Explorer scrolling and workspace-tab dragging, pending user
  input now defers non-immediate snapshot/store writes briefly, reducing the
  chance that JSON/signature/localStorage work competes with active UI frames.
- Explicit immediate flushes for unload, workspace switches, and forced saves are
  unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for rapid panel moves,
  workspace tab switching, and snapshot persistence after idle.


### 2026-05-23 - Browser console active-frame sync

#### Changed

- Browser console visibility toggles and Browser panel hide now sync detailed
  console capture only for the active iframe instead of looping over every frame
  in the active workspace.
- Inactive frames are still forced to compact/no-detailed capture through the
  existing hide, tab switch, and suspend paths, so behavior is preserved while
  avoiding extra per-frame postMessage checks.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for Browser console show/hide,
  tab switching, and panel hide/suspend behavior.


### 2026-05-23 - Browser inactive frame load quieting

#### Changed

- Browser iframe `load` and `error` handlers now verify that the frame is the
  active, visible Browser tab before logging console messages or syncing detailed
  console capture.
- Hidden/inactive iframe loads caused by suspend/restore, tab switching, or late
  navigation now avoid extra Browser console work while preserving active-tab
  load/error feedback.
- The active-visible frame predicate is shared with detailed console capture to
  keep the Browser used/unused states consistent.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for Browser tab load/error
  logs, hidden tab switching, and suspend/restore behavior.


### 2026-05-23 - Browser inactive message parse skip

#### Changed

- Browser iframe message handling now verifies the message source is the active
  Browser frame before inspecting the message payload shape.
- Inactive frame messages no longer pay for bridge-payload key checks, and the
  now-unused frame-source WeakMap scan/cache path was removed.
- Active Browser tab behavior is unchanged: only the active iframe can drive
  console, refresh, open-url, and context-menu bridge actions.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for active Browser console,
  inactive Browser tabs, iframe context menu, and open-url bridge behavior.


### 2026-05-23 - Browser active message fast path

#### Changed

- Browser iframe message handling now checks the active Browser frame directly
  instead of scanning all frames in the active workspace before rejecting
  inactive-frame messages.
- This reduces per-message overhead for noisy inactive/hidden preview frames
  while preserving the existing rule that only the active Browser tab can drive
  console, refresh, open-url, and context-menu handling.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for active Browser console,
  inactive Browser tabs, iframe context menu, and open-url bridge behavior.


### 2026-05-23 - Live terminal restore active-fit only

#### Changed

- Restoring a workspace with existing live terminal widgets no longer re-applies
  layout and schedules `fit` work for every terminal pane unconditionally.
- When hidden terminal widgets become visible again, only the widget's active
  pane is fit immediately; inactive terminal tabs are left for their normal
  activation/resize paths.
- Already-visible terminal widgets skip redundant stored-layout application and
  fit scheduling during restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for workspace switching with
  multiple terminal widgets/tabs and terminal tab activation after restore.


### 2026-05-23 - Workspace restore first-paint yields

#### Changed

- Workspace restore now yields to the UI after applying the target workspace
  shell, panel visibility, layout, and status before continuing heavier restore
  work.
- It also yields again after Explorer restore/load before restoring editor, image,
  notes, and Browser state, letting the user see the workspace switch land before
  secondary widgets finish.
- Restore token checks keep stale post-yield work from continuing if the active
  workspace changes mid-restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for rapid workspace switching,
  visible Explorer restore, editor/notes restore, and Browser tab state.


### 2026-05-23 - Explorer scroll idle DOM window shrink

#### Changed

- Explorer virtual scrolling still uses a large overscan window while the user is
  actively scrolling, but now shrinks back to the normal overscan window after
  scroll idle through the shared UI-idle guard.
- This preserves smooth fast scrolling while reducing the number of live Explorer
  row DOM nodes and row-cache pressure once scrolling stops.
- If Explorer data becomes dirty during scrolling, the idle shrink path falls
  back to the existing full Explorer render so state stays consistent.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for large Explorer scroll,
  selection, rename, drag/drop, and expand/collapse behavior after scroll idle.


### 2026-05-23 - Browser hidden console idle batching

#### Changed

- Browser iframe console payloads are now queued while the Browser console is
  hidden instead of being formatted and appended synchronously on every message.
- The hidden queue is bounded to the hidden console retention limit and flushes
  through the shared UI-idle guard, preserving recent hidden logs and local-port
  auto-forward detection without competing with active UI frames.
- Showing or clearing the Browser console flushes/clears the pending hidden queue
  so visible console behavior remains current and explicit clears do not replay
  old hidden messages.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 255 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for noisy Browser console
  output, hidden/visible console toggling, and local-port auto-forward messages.


### 2026-05-23 - Browser proxy tab open latency reduction

#### Changed

- Local Browser preview tab opening no longer waits for preview-proxy setup
  before opening the Browser panel and selecting/creating the tab.
- Proxy preparation now happens through the existing async tab activation path,
  so the UI responds immediately while the iframe loads when the proxy URL is
  ready.
- Existing local preview tabs keep their current frame URL when available,
  preserving fast re-selection without forcing an extra proxy wait.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 254 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for manual port preview,
  auto-forwarded WSL/SSH previews, and repeated tab re-selection.


### 2026-05-23 - Explorer visible prefetch range tightening

#### Changed

- Explorer visible-directory prefetch now scans only the actual viewport rows plus
  a small padding window instead of the full rendered virtual-scroll overscan
  window.
- This prevents post-scroll prefetch from spending work on far-off overscan rows
  after fast scrolling, reducing background directory reads and cache churn while
  preserving near-visible directory warmup.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 254 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for large Explorer scroll,
  expand/collapse, and WSL/SSH visible-directory prefetch behavior.


### 2026-05-23 - Terminal prompt cwd continuation gating

#### Changed

- Terminal prompt-cwd detection no longer treats an existing `cwdOutputBuffer`
  as a reason to scan every subsequent small terminal output chunk.
- Prompt tracking now checks only the new chunk first, then a bounded 512-char
  likely-prompt continuation tail when needed.
- After a cwd scan, the terminal cwd buffer is cleared on a successful prompt
  match or reduced to only a likely partial prompt tail, preventing stale logs
  from keeping background cwd scans alive during noisy terminal output.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 254 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- Rust/Tauri formatting and no-bundle build still require the Windows/Rust
  toolchain because this WSL shell has no `rustfmt` or `cargo`.
- Windows runtime smoke testing is still required for terminal-heavy background
  output, prompt cwd detection, and workspace switching behavior.


### 2026-05-23 - Browser hidden port scan queue prune batching

#### Changed

- Hidden Browser console local-port scan queue now prunes in threshold batches
  instead of slicing the queue on every message after the hidden retention limit.
- This reduces allocation churn for noisy hidden Browser previews while keeping
  the queue bounded and preserving auto-forward detection for recent local-port
  messages.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for noisy hidden Browser
  preview behavior.


### 2026-05-23 - Terminal port scan pending-buffer skip

#### Changed

- Terminal port-detection gating no longer regex-checks the existing
  `outputBuffer` on every incoming output chunk.
- Once a port scan timer is already pending, later chunks are appended directly
  until that scan runs; otherwise only the new chunk is checked for a preview
  port hint.
- This reduces repeated regex work on the same buffered terminal output during
  noisy server logs while preserving automatic port detection.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for terminal-heavy output and
  auto-port detection behavior.


### 2026-05-23 - Explorer cache prune batching

#### Changed

- Explorer path-key cache pruning now runs in batches after a threshold instead
  of deleting one old key on every new path once the cache reaches its limit.
- Explorer row element cache pruning now uses the same batched threshold
  approach, avoiding repeated pruning work while rendering many new virtual rows.
- This reduces cache-maintenance overhead during large tree expansion, directory
  refreshes, and fast scroll window changes while keeping cache sizes bounded.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for large Explorer tree
  scroll/expand behavior.


### 2026-05-23 - Hidden Browser console lazy formatting

#### Changed

- Browser preview console bridge no longer formats console arguments
  immediately when the console is hidden/compact.
- Hidden mode now keeps only the latest compact raw argument tail in the iframe
  queue and formats it at flush time, reducing work for noisy background
  Browser previews whose older hidden logs would be discarded anyway.
- Visible/detailed console mode keeps the existing immediate formatting and
  low-latency flush behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for noisy Browser preview
  behavior and hidden/visible console toggling.


### 2026-05-23 - Terminal background scan idle defer

#### Changed

- Inactive/background terminal port and prompt-cwd scans now run through the
  shared UI-idle guard instead of running immediately after their debounce timer.
- Visible terminals keep the immediate scan behavior, preserving responsive cwd
  and port detection while the user is actively using a shell.
- Terminal preview-port hint checks now use a cheap colon/keyword prefilter
  before the full regex, reducing hot-path regex work on ordinary output.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for terminal-heavy workspace
  switching and background output behavior.


### 2026-05-23 - Directory listing allocation trimming

#### Changed

- Rust local/WSL directory listing and local signature collection now reserve
  vector capacity from `read_dir` before pushing entries when available.
- `join_posix()` now builds result strings with explicit capacity and `push`
  operations instead of `format!`, reducing formatting overhead in WSL/SSH path
  joins.
- This targets Explorer directory load, WSL/SSH visible-directory prefetch, and
  watcher refresh paths where many entries are processed repeatedly.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Rust/Tauri compilation still requires the Windows/Rust toolchain because this
  WSL shell has no `cargo`/`rustfmt`.


### 2026-05-23 - Remote directory size parse skip

#### Changed

- SSH/remote directory listing parser now skips numeric size parsing when file
  size display is disabled.
- The backend already emits `0` for sizes in that mode, so the parser now keeps
  the value at `0` directly instead of parsing every row.
- This reduces per-entry CPU work on the default no-file-size Explorer path for
  remote directory loads, visible-directory prefetch, and batch listings.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Rust/Tauri compilation still requires the Windows/Rust toolchain because this
  WSL shell has no `cargo`/`rustfmt`.


### 2026-05-23 - ASCII directory sort comparator

#### Changed

- Rust Explorer directory listing and directory signature sorting now use a
  byte-wise ASCII case-insensitive comparator for ASCII filenames.
- This removes the per-entry lower-case sort key allocation from common
  ASCII-heavy project trees while keeping the previous Unicode lower-case
  fallback for non-ASCII names.
- The change applies to local, WSL, and SSH listing results and to local/WSL
  signature checks used by Explorer watcher refreshes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Rust/Tauri compilation still requires the Windows/Rust toolchain because this
  WSL shell has no `cargo`/`rustfmt`.


### 2026-05-23 - FileEntry kind allocation removal

#### Changed

- Rust `FileEntry.kind` now uses static string slices for `dir`/`file`/`other`
  instead of allocating a new `String` for every directory entry.
- Local, WSL, and SSH directory listing paths now pass those static kind labels
  through sorting and signature generation unchanged.
- This reduces per-entry allocation pressure during Explorer directory load,
  visible-directory prefetch, and watcher refreshes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Rust/Tauri compilation still requires the Windows/Rust toolchain because this
  WSL shell has no `cargo`/`rustfmt`.


### 2026-05-23 - Workspace image ref hydrate cache

#### Changed

- Workspace image reference hydration now seeds the image ref cache with the
  already-known split-store key and hydrated data URL.
- This avoids re-hashing large image data URLs on the first workspace snapshot
  or persist after loading saved image tabs/history, improving workspace switch
  and snapshot behavior for image-heavy sessions.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for image-heavy workspace
  switching feel.


### 2026-05-23 - Directory signature ASCII fast path

#### Changed

- Rust Explorer directory signature generation now uses an ASCII fast path for
  UTF-16 length and FNV-style hash updates.
- Common Windows/WSL/SSH project trees usually have ASCII-heavy filenames, so
  Explorer watcher/signature checks avoid per-name UTF-16 iterator setup in the
  hot path while preserving the previous signature semantics for non-ASCII
  names.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Rust/Tauri compilation still requires the Windows/Rust toolchain because this
  WSL shell has no `cargo`/`rustfmt`.


### 2026-05-23 - UI-idle busy guard and Browser message fast path

#### Changed

- Shared `runWhenUiIdle()` work now re-checks active Explorer scrolling,
  workspace-tab drag activity, and `navigator.scheduling.isInputPending()`
  before running background callbacks.
- If the UI is busy, idle/background work reschedules itself instead of running
  on the same frame as scroll/input. This keeps Explorer watch, prefetch,
  terminal/runtime warmups, Browser suspend/scan work, and similar idle tasks
  away from active input frames.
- Browser preview message routing now checks the active iframe directly before
  consulting the source cache or scanning preview frames, reducing overhead for
  normal active-frame console/control messages.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for actual perceived lag.


### 2026-05-23 - Lazy Explorer typeahead and scroll-safe snapshot save

#### Changed

- Explorer render now marks typeahead candidates dirty instead of rebuilding
  the full directory/file typeahead index on every visible-row rebuild.
- Typeahead candidates are rebuilt lazily only when the user actually types a
  character in Explorer, keeping normal directory load/expand/render work
  focused on visible rows.
- Debounced workspace snapshot creation now waits until Explorer active
  scrolling and workspace-tab drag activity are idle before doing snapshot
  layout reads/signature work. Explicit immediate flush saves are unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 253 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for the actual Explorer
  scroll pause/stutter symptom and workspace switching feel.


### 2026-05-23 - Scroll-safe persist and terminal restore snapshot batching

#### Changed

- Workspace store deferred persist now waits until Explorer active scrolling
  and workspace-tab drag activity are idle before writing to `localStorage`.
  Explicit flush saves still flush immediately, preserving close/switch safety.
- Cold workspace terminal restore suppresses per-terminal snapshot saves and
  keeps the single post-restore snapshot save, avoiding repeated snapshot
  serialization while shell widgets are being recreated in the background.
- Explorer overlap scroll patch now updates the rendered-row map while removing
  rows instead of rebuilding it from all DOM children after each window shift.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 252 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for the actual Explorer
  scroll pause/stutter symptom and workspace switching feel.


### 2026-05-23 - Explorer virtual scroll overlap patching

#### Changed

- Explorer virtual scrolling now patches only the rows entering/leaving the
  rendered window when scroll windows overlap, instead of replacing the entire
  rendered row block at every virtual window boundary.
- Top and bottom virtual spacers are kept stable and resized in place, reducing
  DOM churn during fast up/down scrolling through large WSL/SSH trees.
- Browser compact console formatting now gathers object keys with a bounded
  `for...in` loop instead of materializing all keys with `Object.keys()`,
  reducing hidden/compact console overhead for large logged objects.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 252 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for the actual Explorer
  scroll pause/stutter symptom.


### 2026-05-23 - Workspace terminal restore and hidden console scan defer

#### Changed

- Workspace tab restore no longer waits for cold terminal creation before
  returning the main workspace UI. Existing live terminals are still restored
  immediately, while missing/cold shells start on an idle background path with a
  token guard so fast workspace switches do not continue stale terminal work.
- Terminal restore now yields between recreated shell tabs/widgets, preventing a
  multi-terminal snapshot from monopolizing a frame during workspace load.
- Explorer speculative text prefetch now runs only after UI idle and no longer
  warms CodeMirror/language chunks. Actual file open still warms the editor
  immediately, but hover/focus cache work stays off the scroll/input path.
- Hidden Browser console local-port auto-forward scanning is queued and flushed
  in small idle batches. Visible console scanning remains immediate.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 251 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- Windows runtime smoke testing is still required for user-perceived Explorer
  scroll smoothness, Browser widget responsiveness, and workspace switching.


### 2026-05-23 - Browser hidden Error stack compacting

#### Changed

- Browser preview console bridge now formats `Error` objects differently for
  visible and hidden console modes.
- Visible/detailed console mode still sends the full stack when available.
- Hidden/compact mode sends only the error message/string, avoiding stack
  serialization work for background or unused Browser console capture.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser console arg formatting cap

#### Changed

- Preview console bridge now formats only the first 8 console arguments before
  posting to the host, matching the host-side render limit.
- The bridge sends the original argument count separately so the host still shows
  the existing `... +N more` summary for logs with many arguments.
- This reduces iframe-side formatting/serialization work for noisy logs while
  preserving the visible console output contract.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer watch render idle defer

#### Changed

- Background Explorer watcher changes no longer force `renderExplorer()` if the
  user starts scrolling or the Explorer is hidden before the watcher finishes.
- Those changes mark Explorer render dirty instead, and the pending render is
  applied after scroll idle when the panel is visible.
- Manual refresh still renders immediately, preserving explicit refresh behavior
  while keeping background watcher updates off the active scroll hot path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser hidden console retain alignment

#### Changed

- Hidden Browser console bridge flushes now use the same batch-size ceiling as
  the host hidden-console retention window.
- This keeps the lower hidden-console `postMessage` frequency from the previous
  throttle patch while avoiding oversized hidden batches whose early entries
  would be discarded by the host before formatting/scanning.
- Visible console flush latency and batch size remain unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser console host append trim

#### Changed

- Browser console host-side append now computes visible/hidden mode once per
  incoming log batch and only schedules DOM rendering when the console is
  actually visible.
- If an incoming batch is already as large as the retained console limit, the
  host replaces the retained log window with the batch tail instead of pushing
  then splicing old rows away.
- Hidden console capture still retains the latest compact logs and local-port
  scanning behavior is preserved.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser hidden console batch throttle

#### Changed

- Preview console bridge batching now uses separate visible and hidden-console
  modes.
- When the Browser console is visible/detailed, logs keep the existing low-latency
  flush behavior.
- When the console is hidden, compact console messages are batched for longer and
  flushed in larger groups, reducing `postMessage` frequency and main-thread
  processing while preserving recent hidden console capture.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer scroll class no-op skip

#### Changed

- Explorer active-scroll tracking now toggles the `.scrolling` class only when a
  scroll idle timer is first started, not on every scroll event.
- Continuous scroll events still extend the idle deadline, but avoid repeated
  no-op `classList.contains/toggle` work on the hot path.
- Explorer background cleanup now resets the scroll deadline as well as the class
  and timer, preventing stale active-scroll state after workspace changes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer covered-window render skip

#### Changed

- Explorer virtual scrolling now checks whether the current rendered row window
  already covers the new scroll position before scheduling a render frame.
- Scroll movement inside the active overscan window can now stay on the browser's
  native scroll path without entering the virtual-row render function.
- When the scroll position reaches the edge of the rendered window, the existing
  virtual-row replacement path still runs as before.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 250 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer duplicate wheel work removal

#### Changed

- Explorer no longer listens to both `wheel` and `scroll` for the same active
  scroll bookkeeping.
- The `scroll` event remains the single source for marking active scrolling,
  scheduling virtual row rendering, hover suppression, and idle prefetch resume.
- Wheel, touchpad, scrollbar drag, keyboard, and programmatic scroll paths still
  converge through the existing scroll handler, avoiding duplicate work during
  fast wheel/touchpad scrolling.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer scroll cancel throttling

#### Changed

- Explorer scroll tracking now cancels hover and visible-directory prefetch only
  when a new active scroll window begins.
- Continuous scroll events still extend the scroll-idle deadline and keep hover
  repaint suppression active, but no longer repeatedly clear timers and bump
  prefetch tokens on every wheel/scroll event.
- Scroll idle still resumes visible directory prefetch after the user stops
  scrolling, preserving cache warmup behavior outside the hot path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Workspace clear placeholder skip

#### Changed

- Workspace restore uses `clearWorkspacePanels({ skipIntermediateRenders: true })`
  before loading the target snapshot. That path now skips creating temporary
  placeholder Editor and Image tabs that were immediately replaced by restore.
- Normal workspace close/reset paths still create the empty Editor/Image tab
  placeholders because they render the cleared UI.
- This reduces avoidable UUID allocation/state churn during workspace switching
  while preserving the visible empty-state behavior outside restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer restore refresh cancellation

#### Changed

- Delayed cached Explorer directory refreshes now carry a cancellation token so
  stale restore-time refresh work cannot run after the workspace changes or
  Explorer background work is cleared.
- Delayed refresh timers are tracked and cleared during Explorer background-work
  cleanup, reducing timer wakeups during rapid workspace switching.
- Existing refresh guards for current profile, workspace, current directory, and
  expanded state remain in place, so behavior is preserved for normal Explorer
  navigation.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Workspace restore background defer

#### Changed

- Explorer visible-directory prefetch now uses a longer initial delay while a
  workspace snapshot is being restored, so workspace switching can finish the
  visible UI before optional directory warmup starts.
- Cached Explorer directory refreshes scheduled during workspace restore are also
  deferred before entering the idle refresh path.
- Normal Explorer navigation and manual refresh behavior keep their existing
  cache refresh timing outside workspace restore.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Background Browser full suspend

#### Changed

- When the app document becomes hidden, all indexed Browser preview frames across
  workspaces are now suspended immediately instead of waiting on the panel-delay
  timer.
- Pending Browser frame suspend timers are cancelled before the immediate
  background suspend, preventing delayed duplicate work after the frames are
  already parked on `about:blank`.
- Removed the now-unused Browser panel suspend timer path, slightly reducing the
  Browser background bookkeeping code.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden Browser immediate frame suspend

#### Changed

- Browser frames are now suspended immediately when the Browser panel is hidden,
  instead of waiting for the delayed idle suspend path.
- Workspace switch runtime-cache saving now immediately suspends Browser frames
  when the Browser panel or document is hidden, while keeping the delayed path
  for visible Browser switches to avoid blocking the visible transition.
- Browser tabs, active URL, console log trimming, and reload-on-show behavior are
  preserved; hidden/unused preview pages stop running sooner.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer scroll pointerover guard

#### Changed

- Explorer pointer-over handling now returns immediately while active scrolling is
  in progress.
- Hover prefetch was already cancelled during scroll; this also skips row lookup
  and path resolution before the prefetch guard.
- Normal hover prefetch resumes after scroll idle, so existing Explorer hover
  behavior is preserved outside the active scroll window.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer scroll hover repaint guard

#### Changed

- Explorer now marks the file list as actively scrolling while scroll events are
  in progress and clears that marker after scroll idle.
- While active scrolling, row hover background painting is suppressed so rapid
  up/down scrolls do not keep repainting hover states under the pointer.
- Explorer background-work cleanup also clears the scrolling marker, preventing
  stale scroll styling after workspace switches or hidden-panel transitions.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser mode chrome no-op guards

#### Changed

- Browser desktop/device mode controls now avoid repeated class, disabled,
  dataset, text, and select-value writes when the mode is already in the desired
  state.
- Repeated Browser show/restore/layout calls still size active preview frames as
  before, but the surrounding Browser chrome no longer rewrites unchanged DOM
  state.
- Added small shared no-op helpers for class toggles, dataset writes, text
  writes, and disabled-state writes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer active-scroll wider window

#### Changed

- Explorer virtual scrolling now keeps a wider row window while active scrolling
  is in progress.
- Active-scroll overscan increased from 48 to 96 rows and scroll window step
  increased from 64 to 128 rows, reducing how often `fileList.replaceChildren`
  runs during fast up/down scrolls.
- Explorer row cache/recycle limits were raised to match the wider active-scroll
  window.
- The Explorer list now advertises `will-change: scroll-position` to give the
  WebView compositor a stronger scroll-path hint.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser message hot-path filter

#### Changed

- Browser iframe `message` handling now returns immediately while the Browser
  panel is hidden.
- Visible Browser message handling now checks for the Simple Vibe preview
  payload keys before resolving the source iframe, so unrelated object
  `postMessage` traffic from dev apps/HMR/widgets does not scan Browser frames.
- Console/open-url/refresh/context-menu behavior is unchanged for Simple Vibe
  preview messages.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Workspace chrome no-op guards

#### Changed

- App title/context rendering now keeps a signature and skips repeated
  `titleContext` and `document.title` writes when the workspace location has not
  changed.
- The clock renderer now skips a no-op text write if the computed second string
  is already displayed.
- Workspace open/closed controls now render through a small signature guard and
  only update button disabled states when they actually change.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Inactive terminal restore fit skip

#### Changed

- Terminal tab creation now checks whether the pane is actually visible before
  waiting for the two-frame initial xterm fit settle.
- Hidden/inactive terminal tabs still spawn and keep their saved cwd/profile,
  but they no longer make workspace restore wait for layout frames that cannot
  produce a useful fit while the host is hidden.
- Visible terminal panes keep the existing initial fit path, so the active shell
  still starts with a correctly sized terminal.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden panel layout restore deferral

#### Changed

- Workspace restore now records saved layout ratios for all panels but only
  applies actual panel style/layout work for panels that are visible.
- Hidden panels defer their stored layout application until the user opens the
  panel, avoiding unnecessary style writes and layout clamping during workspace
  switches.
- Showing a hidden panel now applies its stored layout ratio before focus/pin
  work, preserving saved placement without making workspace restore pay for all
  hidden panel layouts.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Terminal background output throttling

#### Changed

- Terminal output handling now separates panes into visible, inactive, and
  background states.
- Visible panes still flush output on animation frames for responsive typing and
  command output.
- Inactive panes batch xterm writes less aggressively, and background workspace
  panes avoid periodic xterm writes until a large output buffer must be flushed
  or the pane becomes active again.
- Terminal port/CWD scans now use longer debounce windows for inactive and
  background panes, reducing regex/metadata work from hidden long-running shells.
- When a workspace's terminal widgets are shown again, the active pane flushes
  any buffered output immediately.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 249 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden Explorer restore deferral

#### Changed

- Workspace restore no longer waits for a fresh Explorer directory listing when
  the Explorer panel is hidden and no in-memory Explorer runtime cache is
  available.
- Hidden restore now uses an existing directory cache if one is already present;
  otherwise it records the current directory as deferred and lets the workspace
  finish restoring without the remote/local listing round trip.
- When Explorer is shown later, the panel detects the deferred initial directory
  load and starts `loadDirectory()` through the normal visible Explorer path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 248 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Editor CodeMirror remount guard

#### Changed

- Editor rendering now reuses the existing CodeMirror view when the same file
  is already mounted with the same render mode and word-wrap setting.
- Repeated editor renders from save/status/tab refresh paths now update labels
  and controls without tearing down and rebuilding the editor DOM/runtime.
- Switching files, switching secure/raw mode, empty editor states, and word-wrap
  changes still invalidate the mounted view and rebuild as before.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 248 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden Explorer background work pause

#### Changed

- Explorer background watch scheduling is now cancelled when workspace/runtime
  background work is cleared, preventing stale idle callbacks from running
  during workspace switches or while the document is hidden.
- Non-manual Explorer watcher work now pauses when the Explorer panel is hidden,
  not only while the app is hidden or actively scrolling.
- Cached Explorer refreshes are skipped while Explorer is hidden; when the panel
  is shown again the existing show-path refresh/watch flow takes over.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 248 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Static control and calculator render no-op guards

#### Changed

- Profile, Settings, and Browser device select rendering now keeps per-control
  option signatures, so repeated renders only update the selected value instead
  of clearing and rebuilding unchanged option DOM.
- Settings mask-pattern text now avoids no-op textarea rewrites when the saved
  pattern text is already displayed.
- Calculator history rows now keep cached DOM elements and update in place when
  the history order is unchanged, avoiding full history list rebuilds after
  repeated calculator renders.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 247 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser preview proxy start coalescing

#### Changed

- Browser preview proxy startup is now coalesced per target origin.
- Repeated tab activation/reload/open calls for the same local origin while a
  proxy is still starting reuse the same pending promise instead of launching
  duplicate preview proxies.
- When a stale proxy is replaced, the new proxy replaces any existing proxy entry
  for the same target origin, keeping Browser runtime state smaller.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 246 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Image preview no-op guard

#### Changed

- Image preview rendering now tracks the last rendered label and data URL.
- Repeated image tab/history renders with the same image no longer rewrite the
  large `img.src` data URL or toggle preview classes unnecessarily.
- Label-only changes still update the label without touching the image source,
  reducing accidental image decode/repaint work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 246 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden layout resize trim

#### Changed

- Window resize handling now skips layout-ratio application for hidden floating
  panels and hidden terminal widgets.
- Terminal fitting now returns early for hidden terminal panes instead of calling
  into xterm/fit while the pane is not visible.
- Visible panels and visible terminal widgets still resize immediately; hidden
  widgets keep their stored ratios and are laid out when shown.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 246 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Image history in-place render

#### Changed

- Image paste history rows now keep cached DOM elements and update in place when
  history order is unchanged.
- Toggling/refreshing history avoids rebuilding preview/meta/paste button rows
  unnecessarily, reducing image widget cost when a workspace has many pasted
  image references.
- Empty-history and add/remove transitions still rebuild row order and prune
  stale cached history rows.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 246 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Export jobs in-place render

#### Changed

- Export job rows now keep cached DOM elements and update in place when export
  job order is unchanged.
- Frequent export progress events no longer rebuild the whole export list; only
  the changed job row refreshes its status, progress, and actions.
- New/removed export jobs still rebuild the row order and prune stale cached
  rows, preserving Cancel, Drag out, and Open behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 244 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser forwards in-place render

#### Changed

- Browser forward/detected-port rows now keep cached DOM elements and update in
  place when the row order is unchanged.
- Port detection and forward state changes no longer clear and rebuild the whole
  Browser forwards list for simple label/status updates.
- Add/remove/empty-list transitions still rebuild the row order and prune stale
  row cache entries, preserving Open/Ignore/Stop behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 244 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Market ticker in-place render

#### Changed

- Market ticker chips now keep cached DOM elements and update label/price/change
  text in place when ticker order is unchanged.
- Frequent quote refreshes no longer clear and rebuild the whole market ticker
  strip every render tick.
- Adding/removing custom ticker chips still rebuilds the strip and prunes stale
  cached chip elements.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 242 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Status render no-op guards

#### Changed

- App status updates now skip DOM writes when the message and danger state are
  unchanged.
- Notes status rendering now uses a compact signature and avoids repeated text
  and class writes when save/loading/dirty status has not changed.
- This trims small but frequent UI writes that can coincide with Explorer
  refreshes, note autosave, Browser logs, and workspace switching.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Workspace switch note save trim

#### Changed

- Workspace/tab switching now skips `saveNoteTabNow(...)` calls for notes that
  are neither dirty nor waiting on an autosave timer.
- Active-note blur/tab changes use the same dirty-or-pending guard, avoiding
  needless async save calls in the common no-op case.
- Note tab labels now find the first nonblank line without splitting the whole
  note into an array, reducing per-keystroke work for long notes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 242 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser console batch cap

#### Changed

- Browser console batch handling now formats only the newest records that can
  survive the current visible/hidden console retention limit.
- Large console bursts no longer spend time formatting entries that would be
  trimmed immediately, reducing Browser-widget jank during noisy dev-server
  reloads.
- The existing visible vs hidden console limits remain unchanged, so stored and
  rendered console history still follows the same caps.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Hidden Explorer render deferral

#### Changed

- Explorer rendering now defers full visible-row rebuilds and virtual DOM window
  swaps while the Explorer panel is hidden.
- Hidden resize/refresh paths mark the Explorer as dirty instead of rebuilding
  `fileList`; reopening Explorer renders the latest cached state before the
  normal silent refresh/watch resumes.
- This keeps workspace switching and background refresh lighter when Explorer is
  not currently being used, without dropping the underlying directory/cache
  state.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer virtual window hysteresis

#### Changed

- Explorer virtual scrolling now reuses the current rendered row window while
  the viewport plus overscan still fits inside it, instead of swapping DOM
  windows as soon as the quantized start index changes.
- This reduces full `fileList.replaceChildren(...)` calls during continuous
  up/down scrolling through large trees, which directly targets the visible
  "pause then move again" feel at virtual-window boundaries.
- Forced renders, directory changes, expand/collapse, rename, and row-count
  changes still rebuild the virtual window when needed.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser hidden suspend and panel no-op trim

#### Changed

- Browser iframes now suspend sooner when the Browser panel is hidden or when a
  workspace switch moves frames offscreen, reducing background page/console work
  for the "not using Browser" state.
- The shared panel visibility path now skips expensive per-panel restore/render
  work when a panel is already in the requested visibility state.
- Hiding Browser now immediately trims console logs down to the hidden-state
  limit before the delayed iframe suspend runs.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer active-scroll wide window tuning

#### Changed

- Explorer virtual scrolling now uses a wider active-scroll render window:
  overscan increased from 28 to 48 rows and the scroll-time window step from 32
  to 64 rows.
- This intentionally keeps more rows mounted while the user is actively
  scrolling, trading a modest amount of DOM work for fewer full virtual-window
  swaps and fewer visible scroll-boundary pauses in large trees.
- Idle Explorer renders still keep the tighter non-scroll window values, so
  selection, rename, typeahead, and normal click behavior remain precise after
  scrolling stops.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Note and image tab active-swap render trim

#### Changed

- Note and image tab rendering now track tab order separately from full visual
  signatures.
- Switching active note/image tabs, note dirty markers, note title changes, or
  image label changes with unchanged tab order update existing tab elements in
  place instead of replacing the whole tab strip.
- Opening/closing tabs still rebuilds the strip, keeping close/activate handlers
  and cache pruning intact.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Terminal widget tab active-swap render trim

#### Changed

- Terminal widget tab rendering now tracks pane order separately from each
  widget tab strip's full visual signature.
- Switching the active shell pane, changing pane titles, or command labels with
  unchanged pane order updates existing tab elements in place instead of
  replacing the widget's tab strip DOM.
- Creating, closing, or changing the pane list still rebuilds the strip, keeping
  close/focus handlers and cache pruning intact.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 241 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Editor tab active-swap render trim

#### Changed

- Editor tab rendering now tracks tab order separately from the full visual tab
  signature.
- Editor tab activation, dirty/loading label changes, and active-file updates
  with unchanged tab order update existing tab elements in place instead of
  rebuilding a fragment and replacing the whole tab strip.
- Opening, closing, or otherwise changing the editor tab list still rebuilds the
  strip, preserving tab button handlers and cache pruning.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser tab active-swap render trim

#### Changed

- Browser tab rendering now tracks tab order separately from the full visual tab
  signature.
- Browser tab activation with unchanged tab order updates existing tab elements
  in place instead of rebuilding a fragment and replacing the whole tab strip.
- Opening, closing, or reordering-equivalent tab list changes still rebuild the
  Browser tab strip, preserving close buttons and activation handlers.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Workspace tab active-swap render trim

#### Changed

- Workspace tab rendering now tracks the tab order separately from the full
  visual tab signature.
- When workspace switching only changes the active tab state and the tab order is
  unchanged, existing tab elements are updated in place instead of rebuilding a
  fragment and calling `replaceChildren` on the whole tab strip.
- Add/remove/reorder cases still rebuild the tab strip, preserving drag reorder,
  copy, close, and capture-protection controls.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer scroll window smoothing

#### Changed

- Explorer virtual scrolling now uses a larger overscan and larger row-window
  step while the user is actively scrolling.
- This slightly increases the rendered row buffer during scroll, but reduces how
  often the Explorer has to rebuild/replace the virtual row DOM while moving
  through large trees.
- Non-scroll renders keep the tighter existing window values, preserving precise
  selection/typeahead/open behavior when the list is idle.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer typeahead index and selection key trim

#### Changed

- Explorer typeahead now keeps a path-key to candidate-index map while building
  the cached candidate list, so single-character cycling can find the selected
  candidate without an extra linear `findIndex` scan.
- Full selection sync now compares rendered row `pathKey` values directly,
  avoiding fallback path normalization when rows already carry their normalized
  key.
- This builds on the typeahead candidate cache to keep Explorer keyboard
  navigation and selection repaint work lighter in large expanded trees.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Explorer typeahead candidate cache

#### Changed

- Explorer visible-row rebuild now also prepares a typeahead candidate list in
  the same directory-first/file-second order that keyboard typeahead already
  used.
- Typeahead search now scans the prepared candidate list once, using cached
  lowercase names, instead of walking the full visible row list twice and
  recalculating lowercase names per keypress.
- Rendered Explorer rows now keep their normalized path key in `dataset`, so
  pointer/focus/click event delegation can resolve visible entries without
  normalizing the path string on every event.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 240 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Terminal workspace visibility swap trim

#### Changed

- Workspace switching now tracks the currently visible terminal-widget workspace
  and hides only that previous workspace's terminal widgets before showing the
  next workspace.
- Showing terminal widgets now only touches widgets that belong to the target
  workspace instead of toggling every terminal widget across all workspaces.
- New terminal widgets mark their workspace as the visible terminal workspace,
  preserving active-shell behavior while reducing workspace-switch DOM class
  churn when many workspaces or shell widgets exist.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser console layout no-op guard

#### Changed

- Browser console visibility and position setters now detect when the DOM is
  already in the requested state and skip repeated class/attribute updates.
- Console frame-capture sync now runs only when visibility actually changes,
  instead of scanning preview frames on every Browser layout restore/open no-op.
- Browser console size application now skips identical CSS custom-property
  writes, reducing layout invalidation during workspace restore, Browser panel
  reopen, and repeated layout syncs.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-23 - Browser hidden console runtime cap

#### Changed

- Workspace runtime cache now keeps Browser console logs according to the
  visible/hidden console state instead of always copying a larger fixed slice.
- Hidden or unused Browser panels retain the smaller hidden-console limit, while
  visible Browser console sessions keep the full visible log window.
- Browser state restore applies the same cap before marking console logs changed,
  trimming workspace-switch copy/render pressure when the Browser is not in use.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Root style write guard

#### Changed

- Root CSS custom-property writes now go through a value-change guard instead
  of always mutating `document.documentElement.style`.
- Workspace restore, IDE scale changes, editor/note/calculator font sizing,
  note opacity, Browser zoom, font settings, and editor theme variable sync now
  skip no-op style writes.
- This reduces avoidable style invalidation during workspace switching and
  repeated keyboard resize/zoom operations while preserving the same visual
  state.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser frame sizing signature guard

#### Changed

- Browser iframe sizing now records a lightweight desktop/device/orientation
  signature on each frame and skips repeated width/height style writes when the
  requested sizing state is already applied.
- Desktop and device layout updates now route existing frames through the same
  guarded sizing helper, while preserving tab/device title updates.
- This trims redundant style mutation work during Browser tab activation,
  workspace restore, Browser panel reopen, and repeated device-layout syncs.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer watcher scroll-yield guard

#### Changed

- Background Explorer watcher work now re-checks hidden/scrolling state before
  starting signature scans, before fetching changed directory listings, and
  before applying each listing result.
- This prevents idle-scheduled watcher work from continuing into backend
  signature/listing calls after the user starts scrolling the Explorer.
- Manual Refresh keeps the previous eager behavior, while automatic watch
  refreshes yield to scrolling and resume on the next watch cycle.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser frame activation single-swap

#### Changed

- Browser iframe activation now swaps only the previously active frame and the
  newly selected frame on the normal tab-switch path instead of walking every
  preview iframe in the workspace.
- Console capture detail mode is synced only for the frame being shown, while
  the previous active frame is explicitly downgraded before hiding.
- A fallback cleanup still scans workspace frames only when the previous active
  frame id is missing or stale, preserving correctness after restore or unusual
  frame lifecycle changes.
- Hidden-frame helpers were centralized so Browser panel hide/suspend paths keep
  the same console-capture cleanup behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer prefetch and row-size guard

#### Changed

- Explorer rows now skip file-size text formatting and DOM text updates while
  file sizes are hidden. The row signature uses the displayed size text, so
  toggling file-size visibility no longer leaves hidden size strings behind.
- Re-selecting the already selected Explorer row without a scroll request is now
  a no-op, trimming duplicate pointerdown/click selection work.
- Text-file hover prefetch now requires file sizes to be visible/known. When
  the performance-first no-size listing mode is active, speculative reads are
  skipped so large logs or bundles are not pulled into the UI from a size=0
  placeholder entry.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 239 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace snapshot terminal pane reuse

#### Changed

- Workspace snapshot creation now reuses the already computed active-workspace
  terminal pane list when calculating the remembered terminal spawn rectangle.
- This avoids re-filtering all terminal panes during frequent snapshot saves
  triggered by terminal cwd updates, layout changes, and workspace switching.
- Snapshot contents and terminal layout persistence remain unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal data hot-path scan trim

#### Changed

- Terminal output now only runs the OSC7 cwd extractor when the data chunk
  contains the OSC7 marker.
- Terminal preview-port accumulation no longer repeats the same port-hint regex
  checks after the caller has already decided a port scan is needed.
- This trims redundant string/regex work from high-frequency terminal output
  chunks while preserving cwd tracking, OSC7 handling, and local server port
  detection.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console resize layout-read trim

#### Changed

- Browser console resize now captures the Browser workspace rectangle once at
  drag start instead of reading layout on every pointer-move event.
- Resize movement still uses the saved console position and clamps to the same
  size bounds, preserving the existing resize behavior.
- This removes repeated forced layout reads from a high-frequency Browser widget
  interaction path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - WSL UNC batch listing parallelism

#### Changed

- WSL Explorer batch directory listing now processes UNC-backed WSL paths with a
  small bounded worker pool instead of scanning each reachable UNC directory
  serially.
- WSL directory signature batches use the same low parallelism so background
  Explorer watcher signature preflights over multiple expanded WSL directories
  can complete sooner.
- The cap is intentionally lower than Windows-local listing parallelism to avoid
  overloading the WSL UNC bridge.
- Existing shell fallback behavior is preserved for WSL paths that are not
  reachable through UNC or that return ambiguous bridge/transport failures;
  permanent local access errors still return directly.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here; the new Rust backend
  parallelism must be validated on the Windows/Rust toolchain.


### 2026-05-22 - Browser proxy pending frame deferral

#### Changed

- Local preview proxy loading no longer creates and activates a new blank iframe
  before the proxy URL is ready.
- If the target Browser tab already has an iframe, that frame is reused while
  the proxy is prepared; otherwise the previous preview frame is hidden and the
  new iframe is created only when the resolved proxy URL is ready to load.
- This trims Browser tab activation work for local preview URLs and avoids extra
  sizing/console-capture sync on placeholder frames.
- Hard refresh and existing-frame behavior are preserved.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser snapshot state source trim

#### Changed

- Browser device mode is now recorded from the app state instead of checking the
  Browser shell DOM class during workspace snapshot creation.
- Selecting desktop mode updates the Browser device state to `desktop`, so hidden
  Browser restore paths do not depend on stale visible DOM classes from a
  previous workspace.
- This keeps hidden Browser workspace switching cheaper and more predictable
  after the Browser restore UI deferral work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer visible prefetch coalescing

#### Changed

- Restoring a workspace from the Explorer runtime cache now defers the forced
  background refresh to an idle window instead of launching backend directory
  work immediately after the cached tree is rendered.
- Visible-directory speculative prefetch is now coalesced behind a single timer
  and canceled whenever Explorer scrolling resumes or Explorer background work
  is cleared.
- Visible prefetch waits if another speculative directory prefetch is already
  active, reducing backend/IPC contention with scroll rendering, terminal input,
  and workspace switching.
- Demand-driven directory expand/open and manual refresh behavior are unchanged;
  only speculative warmup is less aggressive.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Hidden Browser restore UI deferral

#### Changed

- Restoring a workspace while the Browser panel is hidden now updates Browser
  state directly instead of mutating hidden console/device DOM controls.
- Browser console position, visibility, size, and device layout are applied when
  the Browser panel is actually shown, preserving controls while keeping hidden
  restore work cheaper.
- Restored Browser device and console position values are normalized before use
  so older or malformed snapshots fall back safely.
- Inactive Browser iframe suspension now uses the same short idle window as the
  hidden/workspace-switch suspend path, reducing background iframe work sooner.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser hidden suspend and Explorer cache-hit smoothing

#### Changed

- Browser iframe suspension after hiding the Browser panel is now much sooner,
  reducing the time hidden preview pages can keep running scripts/network work.
- Workspace switching now schedules old Browser iframe suspension especially
  quickly when the Browser panel is already hidden, while still keeping a short
  delay for visible Browser quick-switch behavior.
- Hidden Browser tab activation no longer calls the Browser tab renderer that
  already no-ops when the panel is hidden.
- Explorer cache-hit navigation now defers its background refresh to an idle
  window instead of immediately competing with the just-rendered directory.
- Explorer non-cache directory loads no longer write the same directory cache a
  second time after `fetchExplorerDirectory` already cached the listing, avoiding
  an extra directory-signature pass on large folders.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 238 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Hidden utility widget startup render deferral

#### Changed

- Startup no longer eagerly renders the hidden Calculator body, Calculator key
  grid, or IDE Settings form.
- Calculator keys are created lazily the first time the Calculator is actually
  rendered, preserving button behavior while avoiding hidden widget DOM/listener
  setup on boot.
- Workspace restore now explicitly renders Calculator and Settings only when
  those panels are visible in the restored workspace, so saved visible utility
  panels still appear populated.
- This trims small but unnecessary main-thread work during boot and workspace
  restore, keeping hidden utility widgets in the unused-cost path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - WSL Explorer fallback spawn trim

#### Changed

- WSL UNC directory listing and signature scans now return obvious permanent
  local access errors directly instead of spawning the slower WSL shell fallback.
- The skip list covers ordinary missing path, not-a-directory, and permission
  denied cases; ambiguous bridge/transport failures still keep the existing
  shell fallback path.
- This avoids extra `wsl.exe` process startup during background Explorer watch
  when an expanded directory was deleted, became inaccessible, or is no longer a
  directory.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here; this Rust change must be
  validated on the Windows/Rust toolchain.


### 2026-05-22 - Explorer performance-first file size default

#### Changed

- New workspaces now default Explorer file-size display to off.
- Older workspace snapshots that do not yet have a saved file-size preference
  also fall back to the performance-first off state.
- Existing workspaces that already saved `showFileSizes: true` keep that
  preference, and the Explorer `Size` toggle still performs a manual refresh
  when the user turns sizes back on.
- This avoids per-file metadata reads on initial Windows/WSL/SSH listings for
  the default path, which is especially important for large project trees,
  OneDrive/network-like folders, and Defender-scanned directories.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer watch cache preflight reuse

#### Changed

- Background Explorer watch now checks fresh in-memory directory cache entries
  before calling the backend `directory_signatures` command.
- Fresh cached directories whose signature still matches the active Explorer
  state are skipped entirely, avoiding both signature IPC and full listing IPC.
- Fresh cached directories with changed signatures are applied through the
  existing listing path without forcing another backend read.
- Manual refresh continues to bypass this shortcut and performs full forced
  listing fetches.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer direct local signature scans

#### Changed

- Windows-local `directory_signatures` now computes directory signatures
  directly from filesystem entries instead of building full `FileEntry` lists
  and then converting them to signatures.
- WSL paths that are reachable through the Windows UNC bridge use the same
  direct signature scan; shell fallback is still retained for WSL paths that
  cannot be reached through the bridge.
- Direct signature scans preserve the existing Explorer signature semantics:
  directory-first sorting, ASCII/Unicode lowercase sort key behavior, UTF-16
  name length, name/kind/size/hidden hashing, and the same base-36 hash suffix.
- The existing full listing path is kept for manual refresh, changed
  directories, SSH, and WSL fallback cases.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here; these Rust changes must be
  validated on the Windows/Rust toolchain.


### 2026-05-22 - Explorer watcher signature preflight

#### Changed

- Added a backend `directory_signatures` command that returns the same
  name/kind/size/hidden directory signature format used by the frontend
  Explorer state.
- Background Explorer watch now asks for directory signatures first and fetches
  full `FileEntry` lists only for directories whose signature changed.
- Manual Explorer refresh still performs full listing fetches, preserving the
  user-triggered correctness path.
- Signature hashing mirrors the existing frontend FNV-style signature, including
  UTF-16 string units and lower-32-bit numeric hashing, so unchanged directories
  can avoid large Tauri IPC payloads.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here; the new Rust command must be
  validated on the Windows/Rust toolchain.


### 2026-05-22 - Explorer watcher and backend listing backpressure

#### Changed

- Explorer directory cache TTLs are now slightly longer for Windows-local and
  WSL paths, reducing duplicate directory reads during quick expand/scroll/watch
  bursts while manual refresh still forces a fresh poll.
- Background Explorer watching now caps Windows-local breadth below manual
  refresh breadth and records the previous poll duration.
- If a background poll is slow, the next background watch temporarily backs off
  both poll interval and watched directory count; manual refresh remains
  unaffected.
- Windows-local backend batch directory listing now uses bounded parallel worker
  threads, preserving input result order and per-directory error reporting.
- Backend directory sorting now uses an ASCII lowercase fast path and keeps the
  previous Unicode lowercase behavior for non-ASCII names.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 237 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here; the Rust backend changes
  still need Windows/Rust toolchain validation.


### 2026-05-22 - Explorer scroll window and render signature trim

#### Changed

- Explorer virtual scrolling now renders a wider overscan/window step so fast
  wheel or touchpad scrolls cross fewer DOM replacement boundaries while still
  keeping the rendered row count bounded.
- Virtual Explorer rendering no longer writes `scrollTop` after a row-window
  replacement when the value is already correct.
- Visible Explorer directory prefetch now walks the rendered viewport indexes
  directly instead of allocating a temporary visible-entry array.
- Workspace clearing now hides Browser preview frames only for the active
  workspace when possible, avoiding a global scan over inactive workspace
  iframes during workspace changes.
- Workspace, editor, image, terminal, image-history, and forward render
  signatures now use direct loops/template strings instead of temporary
  map/filter/join arrays on frequent render guard paths.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 236 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser cold-restore and panel-open cost trim

#### Changed

- Restored Browser tabs with no ready iframe now stay in an explicit idle state
  until the user clicks the tab or uses Reload, instead of scheduling a cold
  auto-resume shortly after workspace switch.
- Runtime cache snapshots now skip Browser tab/proxy/console array copies when
  those collections are empty, and use direct loops for non-empty Browser tab and
  proxy snapshots.
- Workspace switch now hides/schedules Browser frame suspend work only when the
  workspace actually has indexed Browser frames.
- Opening the Browser panel now lets the active-frame path perform the necessary
  tab render/console sync, avoiding a duplicate render/sync pass.
- Browser desktop/device sizing now touches only the active workspace preview
  frames; inactive workspace frames are sized when that workspace is restored.
- Browser tab render signatures now use a direct loop instead of per-tab
  temporary arrays.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 236 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace snapshot and Browser frame index trim

#### Changed

- Workspace snapshot creation now uses direct loop helpers for editor, image,
  note, browser, and calculator snapshot arrays instead of map/filter chains on
  the frequent save path.
- Workspace snapshot signatures now build terminal, editor, image, note,
  browser, calculator, panel, and layout signatures with direct loops/string
  builders, avoiding several temporary arrays during debounced no-op saves.
- Browser preview iframes are now indexed by workspace id as well as tab id.
  Workspace switch, Browser tab show/hide, console capture sync, and suspend
  paths can walk only the relevant workspace frames instead of filtering every
  kept-alive frame.
- Stale/disconnected Browser frames are removed from both indexes when detected
  or cleared, preserving existing iframe reuse and suspend behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 236 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console auto-forward scan profile guard

#### Changed

- Browser console local-port auto-forward scanning now skips the whole per-entry
  scan loop when there is no active profile or the active profile is Windows.
- The local-host hint check now exits immediately for messages without any colon,
  so ordinary log text avoids the chain of local host substring checks.
- WSL/SSH local URL auto-forward behavior is preserved for messages that include
  explicit localhost/127.0.0.1 style URLs.
- This keeps Browser preview logging cheaper for Windows-local previews and for
  noisy pages whose console messages do not contain local preview ports.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 235 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console append DOM batching

#### Changed

- Visible Browser console append-mode rendering now builds newly arrived rows in
  a `DocumentFragment` and appends once instead of appending each row directly.
- The append path now checks the first child for the empty-state marker instead
  of running a selector query on every render.
- This reduces DOM work when a visible Browser console receives several records
  in one animation frame while preserving the existing trim and auto-scroll
  behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace snapshot no-op timestamp deferral

#### Changed

- Active workspace snapshot creation now carries forward the previous
  `updatedAt` value while computing the change signature.
- A fresh timestamp is generated only after the snapshot signature proves that
  something actually changed and the snapshot will be stored.
- The existing workspace snapshot array index is reused for the update, avoiding
  a second lookup after signature comparison.
- This reduces small but frequent allocation/work during debounced no-op
  snapshot saves from panel focus, terminal cwd checks, hidden-widget restores,
  and other UI paths that often discover no persisted state change.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console render slice removal

#### Changed

- Visible Browser console rendering no longer creates a sliced `visibleLogs`
  array on each render.
- The renderer now computes the bounded render window indexes and walks the
  shared log array directly for append and full redraw paths.
- Console signatures now use the tracked render count plus latest log id
  without allocating a derived log list.
- This trims visible Browser console repaint cost for noisy local dev apps while
  preserving the same log limit, append behavior, and auto-scroll behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console argument formatting allocation trim

#### Changed

- Browser console message formatting no longer uses `slice().map()` for console
  argument lists.
- Console arguments are formatted with a small bounded loop and appended into one
  message string, preserving the existing argument cap and truncation behavior.
- This reduces short-lived array allocation in noisy Browser preview pages,
  especially when framework logs include several arguments per record.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console batch formatting context reuse

#### Changed

- Browser console batch handling now reuses one timestamp string for the whole
  bridge flush instead of calling the timestamp helper for every record.
- Batch formatting also reuses one visible/hidden formatter choice for the
  whole batch, avoiding repeated Browser panel visibility checks per log item.
- Single-message console behavior is unchanged; batch messages still preserve
  per-entry level/message formatting and local-port scan behavior.
- This further trims Browser widget overhead for noisy dev servers where many
  console records arrive in one iframe bridge batch.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console batch append coalescing

#### Changed

- Browser console bridge batches are now formatted into log entries first and
  appended to state in one operation.
- Log trimming, console version bumping, and render scheduling happen once per
  batch instead of once per individual console record.
- Local-port auto-forward scanning still runs per relevant log entry, but only
  after the existing cheap local-host hint guard.
- This reduces main-thread churn when dev servers or frameworks emit many
  console messages in one bridge flush, especially with the Browser panel hidden
  or console collapsed.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console local-port scan guard

#### Changed

- Browser console auto-forward detection now runs the heavier local-URL
  `matchAll` scan only when the message has cheap local-host port hints.
- Log-heavy apps that print ordinary objects, status messages, or framework
  debug output no longer pay the local-port regex scan on every console event.
- Auto-forward behavior for explicit local preview URLs such as
  `http://localhost:3000` and `http://127.0.0.1:5173` is preserved.
- This complements the Browser console source-cache work by keeping hidden or
  compact Browser preview mode lightweight even when the page is noisy.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 234 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console hot-path allocation trim

#### Changed

- Browser iframe `postMessage` routing now caches the message source to iframe
  lookup in a `WeakMap`, so log-heavy local apps do not scan every preview
  frame for every console/control message.
- Browser console log rows now use a cheap monotonic log id instead of the
  general browser-tab id generator.
- Console timestamp formatting is cached per second, avoiding a fresh `Date`
  formatting pass for every message during bursty console output.
- Workspace runtime cache keeps console log entries by reference because those
  entries are immutable after creation, reducing workspace-switch allocation
  while preserving the same restored console content.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 233 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer scroll row recycling and typeahead scan

#### Changed

- Explorer virtual scrolling now keeps a small detached-row recycle pool in
  addition to the bounded row cache.
- When the user scrolls through more rows than the path-keyed cache can keep,
  pruned detached rows are reused instead of creating fresh DOM nodes for every
  newly encountered path.
- Explorer typeahead no longer allocates intermediate visible-entry and
  directory/file candidate arrays on each key press; it scans the existing
  visible-row list directly while preserving the directory-first match order.
- Visible-window directory prefetch now walks the rendered row range directly
  instead of slicing/mapping/filtering the virtual row list.
- Row update signatures reuse the precomputed normalized path key instead of
  concatenating the full path string for every virtual-row refresh.
- This targets the remaining "scroll a long tree once" and "keyboard search in
  a large tree" allocation spikes without changing Explorer behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 233 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace image signature ref reuse

#### Changed

- Workspace snapshot signatures now reuse the same image reference key cache used
  by the split image-data store.
- Large pasted-image `dataUrl` values in image tabs/history no longer need to go
  through the generic string fingerprint path during repeated workspace snapshot
  comparisons.
- The image signature path handles already-compacted refs directly and still
  falls back to the normal workspace string signature for non-image values.
- This further reduces repeated large-string hashing during workspace switching,
  autosaves, and image-heavy snapshot persistence.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 233 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace image reference hash cache

#### Changed

- Workspace image split-store persistence now caches image reference keys per
  workspace/image scope, so repeated snapshot writes for unchanged pasted images
  no longer re-hash large `dataUrl` strings.
- The cache is LRU-bounded and pruned together with the split image store, so
  stale image references do not grow without bound.
- Store safety is preserved: cached refs still ensure the image payload exists
  in the split image store, and the existing full-data fallback remains in place
  if that store cannot be written.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 232 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace image data split store

#### Changed

- Workspace persistence now stores large pasted-image `dataUrl` payloads in a
  separate image-data store and writes compact image references into the main
  workspace snapshot JSON.
- Loading workspaces hydrates those references back into normal in-memory
  `dataUrl` values, so image preview/history behavior remains unchanged while
  the app is running.
- Existing older workspace snapshots that still contain full image data are
  migrated into the split store on load/persist, and unused image payloads are
  pruned when compact snapshots are written.
- If the split image-data store cannot be written, persistence falls back to the
  full image data in the main workspace payload for that attempt instead of
  saving broken references.
- This keeps the frequently rewritten workspace tab/snapshot store much smaller,
  reducing `JSON.stringify` and `localStorage` write cost during workspace
  switching and routine snapshot saves after image paste workflows.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 232 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer directory signature rolling hash

#### Changed

- Explorer directory change detection now builds a compact rolling hash
  signature instead of allocating one string per entry and joining the full
  directory listing into a large temporary string.
- The signature still includes entry count, total name length, total file size,
  names, kinds, sizes, and hidden flags, preserving watcher sensitivity while
  reducing allocation and GC pressure.
- This benefits background watcher polls, manual refresh, cache writes, and
  expand/prefetch comparisons on large WSL/SSH directories.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 231 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer directory immutable cache snapshots

#### Changed

- Explorer directory listings are now treated as immutable snapshots across the
  cache, current Explorer state, watcher polls, and prefetch pipeline.
- Cache hits, pending reads, batch listings, and workspace restore paths no
  longer create extra shallow array copies of large directory listings before
  handing them to state/render code.
- Cached directory signatures are still preserved through the same helper, but
  the helper now returns the existing immutable listing reference instead of
  cloning.
- This reduces allocation and GC pressure when scrolling/expanding large WSL or
  SSH directories and when watcher refreshes repeatedly compare unchanged
  directory contents.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 231 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer row key and signature split

#### Changed

- Explorer visible rows now carry a precomputed normalized path key, avoiding
  repeated path normalization lookups while building the visible-row map and
  while rendering cached rows during scroll.
- Virtual row rendering computes the selected, drop-target, and active-rename
  path keys once per render window instead of re-normalizing those paths for
  each visible row.
- Explorer row updates now split static content signatures from dynamic state
  signatures. Selection/drop-target changes can update only classes and aria
  state, while unchanged cached rows skip text, size, disclosure, and rename DOM
  work.
- Loading rows also use the lighter static signature path so cached loading
  placeholders avoid unnecessary per-render updates.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 231 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser hidden restore layout deferral

#### Changed

- Browser workspace restore now distinguishes hidden and visible Browser panels.
  When the Browser panel is hidden, restore applies state and control values but
  skips frame sizing loops, console iframe sync messages, console rendering,
  restore-time Browser log entries, and snapshot-save attempts.
- Browser layout work is applied when the Browser panel is actually opened, so
  device/desktop sizing and console sizing remain correct without paying that
  cost during workspace switching when Browser is not in use.
- Showing an existing Browser frame now reapplies frame sizing, covering frames
  that were restored while hidden and then displayed later.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 230 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer scroll timer and virtual window tuning

#### Changed

- Explorer virtual scrolling now advances the rendered window in larger row
  chunks, reducing how often fast scrolls need a `replaceChildren` pass while
  keeping the existing overscan buffer.
- Scroll-idle prefetch scheduling no longer clears and recreates a timeout on
  every scroll event. A single timer now follows the latest scroll deadline and
  runs visible directory prefetch only after the scroll burst actually settles.
- Keyboard/selection auto-scroll now reuses the cached Explorer viewport height
  instead of reading `clientHeight` twice on the selection path.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 230 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace switch deferred store flush

#### Changed

- Immediate workspace snapshot saves can now update in-memory workspace state
  without forcing a synchronous `localStorage` write on the current interaction.
- Workspace tab activation, active tab close-to-next, blank workspace creation,
  workspace copying, and workspace root switching now save the outgoing
  workspace snapshot into memory first, then defer persistence outside the
  switch-critical path.
- Workspace tabs are still re-rendered immediately for visible active-tab
  feedback, while durable store writes remain scheduled and are still flushed on
  page hide / unload.
- This reduces the chance that large persisted workspace payloads, especially
  image histories or many workspace snapshots, cause visible stutter during
  workspace switching.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 230 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace switch deferred notes hydration

#### Changed

- Workspace restore no longer blocks on reading every saved Notes tab when the
  Notes panel is visible. It now restores tab metadata immediately, renders a
  loading state, and hydrates note contents during idle time.
- Deferred note hydration prioritizes the active note tab first, then yields
  between remaining note reads so workspace switching and first paint stay
  responsive.
- Switching between note tabs now reschedules hydration for the newly active
  loading tab instead of forcing all notes to load synchronously.
- Loading, non-dirty note tabs are skipped by autosave/save-all paths, preventing
  deferred empty note placeholders from being written back over existing notes.
- Pending note hydration is invalidated when the workspace panel state is
  cleared, avoiding stale background work after a workspace switch.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser proxy header allocation cleanup

#### Changed

- Browser preview request, upgrade, and response header rewriting now preallocates
  output buffers near the original header size instead of growing from empty
  strings on every proxied request.
- Hot header paths now push `Host`, `Origin`, `X-Forwarded-Host`, and
  `Content-Length` values directly into the output buffer instead of building
  short temporary formatted strings.
- Proxy `Referer` and `Location` URL rewrites now use prefix slicing and
  pre-sized strings for the normal absolute-local URL case.
- `Set-Cookie` domain/secure/SameSite cleanup no longer lowercases every
  cookie attribute or collects attributes into a temporary vector before
  joining.
- HTML-injection eligibility now detects `text/html` case-insensitively without
  allocating a lowercase copy of the Content-Type header value.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk remains about 229 kB minified, CSS
  remains about 40 kB minified, and the terminal runtime remains split into the
  separate lazy `xterm` chunk.
- `git diff --check` passed before this note was written.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - CSS containment for panel repaint isolation

#### Changed

- Floating panels and terminal cards now use layout/style containment to reduce
  how much panel movement, resize, and content updates can invalidate nearby
  UI.
- Terminal hosts, editor body, settings body, notes body, calculator history,
  image history, Explorer list, Browser shell, and Browser console log now use
  tighter layout/paint containment where clipping is already expected.
- Major scroll containers now use `overscroll-behavior: contain` and stable
  scrollbar gutters, reducing scroll chaining and layout churn when users scroll
  Explorer, Browser, console, editor, or side widgets.
- Paint containment was intentionally not added to outer floating panels so
  shadows, focus outlines, and resize grips remain visible.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified, CSS is
  about 40 kB minified, and the terminal runtime remains split into the separate
  lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console host render signature

#### Changed

- Browser console rendering now uses a small monotonically increasing log
  version signature instead of joining every visible console log into one large
  comparison string on each render attempt.
- Console log versioning is updated on restore, clear, workspace reset, append,
  and trim paths so stale DOM skips remain safe.
- This complements iframe-side console batching by reducing host-side work when
  local apps produce many Browser console messages.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser console postMessage batching

#### Changed

- The injected Browser preview console bridge now batches console/error/network
  diagnostic messages before posting them to the host window.
- Detailed/visible console mode flushes quickly, while compact hidden mode uses
  a longer batch delay and immediate flush only for larger bursts.
- The frontend Browser message handler now accepts both the new batched payload
  and the previous single-message payload for compatibility with already-loaded
  preview pages.
- This preserves console capture behavior while reducing `postMessage` and host
  `message` event overhead on log-heavy local apps.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser proxy HTML injection allocation cleanup

#### Changed

- The Rust preview proxy no longer converts full HTML responses into a `String`
  and then builds a second lowercase copy just to inject the Browser console
  bridge.
- HTML insertion now scans response bytes case-insensitively for `<head>` /
  `<body>` and writes the injected response into one pre-sized `Vec`.
- This preserves the same injection locations while reducing allocation and
  copy cost on Browser first load / reload of local HTML apps.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.
- `rustc`, `cargo`, `rustfmt`, `powershell.exe`, and `cmd.exe` are not
  available in this shell's PATH, so Rust/Windows build verification remains
  pending.


### 2026-05-22 - Browser console bridge compact hidden mode

#### Changed

- The injected Browser preview console bridge now defaults to compact argument
  formatting instead of running full `JSON.stringify` for every logged object.
- The host app now sends a lightweight console-detail mode message to preview
  iframes: only the active, visible Browser iframe uses detailed console
  formatting while the Browser console is open.
- Hidden/inactive preview iframes are explicitly switched back to compact mode
  when they are hidden, suspended, or when the Browser panel is closed.
- This preserves Browser console behavior when the user is actively viewing it
  while reducing page-side formatting cost when the Browser widget is not in
  active use.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 229 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.
- A direct Windows toolchain probe is also blocked from this shell because
  `powershell.exe` is not available in PATH.


### 2026-05-22 - Explorer virtual row render cleanup

#### Changed

- Explorer virtual scrolling now reuses the top and bottom spacer DOM nodes
  instead of allocating new spacer elements for every virtual window shift.
- Virtual row rendering no longer performs an extra full selection pass after
  rows are rendered; row selection state is already included in each row's
  render signature.
- File-size text formatting now happens only after a row's render signature has
  changed, avoiding repeated formatting on cached row renders.
- These changes target the direct scroll path and reduce per-window DOM writes
  while preserving the existing virtual row behavior and selection state.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 228 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer interaction path-key cache

#### Changed

- Explorer path normalization now uses a bounded cache so row rendering,
  pointer/focus events, selection sync, drag/drop targeting, and watcher
  comparisons do not repeatedly allocate and normalize the same path strings.
- Keyboard up/down navigation now walks the existing virtual visible-row list
  instead of rebuilding a separate visible-entry array for each key press.
- Typeahead and other visible-entry operations now derive entries from the
  already-built virtual row list rather than recursively walking the expanded
  tree again.
- This keeps Explorer behavior unchanged while reducing repeated work on the
  interaction paths that users notice during fast scrolling and keyboard use.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 228 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace switch Explorer runtime cache reuse

#### Changed

- Workspace runtime caches now keep Explorer expanded paths, child listings, and
  directory signatures as in-memory `Set`/`Map` references instead of converting
  them to arrays and rebuilding new collections on every workspace switch.
- Restoring a workspace now reuses those Explorer runtime collections directly,
  avoiding extra O(number of expanded directories) allocation work on the hot
  switch path.
- Explorer file-size/open-mode control rendering now has small signatures, so a
  normal Explorer render does not repeat the same class/text/ARIA updates when
  those modes did not change.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 228 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser hidden-state and workspace restore throttling

#### Changed

- Browser workspace restore no longer reconnects an idle/restored preview after
  a fixed short delay. It now waits for the workspace to settle and resumes only
  from an idle callback while the Browser panel is still visible and active.
- Hidden Browser consoles no longer rebuild the console DOM when logs are
  cleared/restored or when workspace state is restored; rendering resumes when
  the console is explicitly visible.
- Preview `postMessage` traffic is now accepted only from the active, visible
  preview iframe in the active workspace. Hidden/inactive browser tabs can no
  longer spend frontend time formatting console/open/refresh/context-menu
  messages.
- These changes keep Browser features available when the user is actively using
  the panel, while reducing workspace-switch and "Browser not in use" work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 228 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer batch directory read de-duplication

#### Changed

- WSL Explorer batch directory listings now try the existing direct
  `\\wsl.localhost`/drive-path filesystem path per directory before falling
  back to the shell batch path for entries that cannot be read directly.
- Remote directory listing parsers now avoid short-lived `Vec` allocations for
  every parsed line by reading tab-separated fields directly from split
  iterators.
- Frontend Explorer batch reads now de-duplicate repeated directory misses
  before invoking the backend.
- Batch reads also register per-directory pending reads while the batch request
  is in flight, so hover prefetch, watcher refresh, and direct expand actions
  can share the same backend work instead of racing duplicate list calls.

#### Verified

- `git diff --check` passed.
- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 228 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal metadata ANSI cleanup deferral

#### Changed

- Terminal metadata handling no longer strips ANSI/control text for every
  backend output chunk that may contain a port or prompt cwd hint.
- Port and prompt-cwd fallback buffers now store raw bounded output and perform
  ANSI stripping plus CR normalization only inside the already debounced scan
  callbacks.
- OSC7 cwd tracking still remains immediate, and terminal display writes still
  use the existing frame/timer batching path.
- This reduces per-chunk string allocation and regex work during high-volume
  terminal output while preserving local-preview port detection and prompt-cwd
  fallback behavior.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 227 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal output metadata scan debounce

#### Changed

- Terminal output still writes to xterm through the existing frame/timer
  batching path, but fallback metadata scans are now debounced.
- Local preview port detection appends candidate output to a bounded buffer and
  scans it after a short delay instead of running full port extraction for every
  backend output chunk.
- Prompt-based cwd fallback parsing is also delayed briefly; OSC7 cwd updates
  and typed `cd` tracking still apply immediately.
- Terminal cleanup now cancels pending port/cwd scan timers along with pending
  write timers.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 227 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Image and Notes tab hidden/render reuse

#### Changed

- Image tab rendering now returns immediately while the Image panel is hidden,
  and visible Image tabs reuse cached DOM elements by tab id.
- Notes tab rendering now returns immediately while the Notes panel is hidden,
  and visible Notes tabs reuse cached DOM elements by tab id.
- Image/Notes tab updates patch active state, theme, title, and label from
  compact render signatures instead of recreating markup and listeners on each
  tab strip update.
- Closed Image/Notes tabs are pruned from their tab element caches.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 227 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Editor tab hidden/render reuse

#### Changed

- Editor tab rendering now returns immediately while the Editor panel is hidden,
  so hidden workspace restore/open-file state changes do not rebuild editor tab
  DOM.
- Visible Editor tabs now reuse cached DOM elements by tab id instead of
  recreating tab markup and event listeners every time the tab strip updates.
- Editor tab updates patch only active state, title, and label from a compact
  render signature.
- Closed Editor tabs are pruned from the tab element cache.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 226 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal widget tab DOM reuse

#### Changed

- Terminal widget tabs now reuse cached DOM elements per terminal pane instead
  of recreating tab markup and event listeners whenever shell tabs render.
- Widget tab updates patch only active state, title, tooltip, and label from a
  compact render signature.
- Closed terminal panes are pruned from each widget's tab element cache.
- Terminal widget header title/cwd updates now avoid writing unchanged text,
  reducing layout/style churn during pane activation and cwd tracking.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 225 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser tab hidden/render reuse

#### Changed

- Browser tab rendering now returns immediately while the Browser panel is
  hidden, keeping hidden Browser state changes from doing tab DOM work.
- Visible Browser tabs now reuse cached DOM elements by tab id instead of
  recreating tab markup and event listeners for every activation/reload.
- Browser tab updates patch only the active class, title, and label from a
  compact render signature.
- Closed tabs are pruned from the Browser tab element cache when the tab strip
  is rendered.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 224 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace tab DOM reuse

#### Changed

- Workspace tabs now reuse cached DOM elements by workspace id instead of
  recreating the full tab markup and event listeners on every workspace-tab
  render.
- Tab updates now patch label, active/protected classes, tooltip, and capture
  protection button state from a compact render signature.
- Removed per-render button listener allocation for workspace tabs; each cached
  tab keeps stable handlers that read the current workspace id from `dataset`.
- Closed/removed workspace tabs are pruned from the tab element cache so stale
  DOM does not accumulate.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 224 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace restore intermediate render trimming

#### Changed

- Workspace restore now skips intermediate empty-state renders while clearing
  the outgoing workspace. The final restore paths still render the active
  Explorer, Editor, Image, Notes, Calculator, and Browser state after the target
  workspace data is applied.
- Restored panel visibility now avoids repeated focus/z-index/pin work for
  every visible panel during workspace switching; those behaviors still run for
  normal user panel toggles.
- Panel toggle button lookups are now cached, reducing repeated DOM queries
  during workspace restore and layout visibility updates.
- Close/new-workspace paths still use the normal clearing render path so the UI
  is actually cleared when there is no immediate target workspace to show.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 223 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace switch runtime cache shallow snapshots

#### Changed

- Workspace runtime caching now keeps shallow references for active editor tabs
  and Explorer directory arrays instead of deep-copying large editor contents,
  parsed secret lines, root entries, and expanded child listings on every
  workspace switch.
- Restoring a cached workspace reuses the cached Explorer arrays directly, so
  switching back avoids another round of large array cloning before virtual row
  rendering.
- Snapshot persistence remains separate from this runtime cache; durable
  workspace JSON still stores the same semantic data, while the hot switch path
  does less CPU and allocation work.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 223 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer virtual row element reuse

#### Changed

- Explorer virtual scrolling now keeps a bounded LRU cache of rendered row DOM
  elements and reuses them as the visible window moves.
- Row updates now patch existing disclosure/name/size cells when the row's
  semantic render signature changes, instead of allocating a fresh row tree for
  every virtual-window shift.
- The cache is capped at 512 row elements, which is intentionally larger than
  the rendered viewport window to trade a small amount of memory for smoother
  scroll behavior and lower GC pressure on large WSL/SSH folders.
- Inline rename rows still render their input when active, while ordinary rows
  preserve the delegated Explorer event model and current selection/drop-target
  synchronization.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 223 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace store active-id serialization cache

#### Changed

- Workspace store persistence now caches the serialized workspace-list JSON
  separately from the active workspace id.
- Switching workspace tabs can update the small `activeId` part of the stored
  payload without re-stringifying every workspace snapshot and pasted image
  `dataUrl`.
- The full workspace-list JSON is regenerated only when the semantic workspace
  content signature changes; image data persistence remains unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 223 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser workspace-switch suspend deferral

#### Changed

- Workspace switching now hides the previous workspace's Browser iframes
  immediately but defers the expensive `src = about:blank` suspension to a UI
  idle slot shortly afterward.
- If the user switches back quickly and the Browser panel is visible, the
  pending suspend is cancelled so the iframe can resume without forced reload
  work on the critical workspace-switch path.
- Hidden/unused Browser behavior is stricter: automatic local-port detection no
  longer opens the Browser panel by itself. It records the detected port and
  tells the user to open Browser to preview, keeping Browser costs separate
  from terminal output when Browser is not being used.
- Closing/removing a workspace cancels any pending Browser frame suspend timer
  for that workspace before frames/proxies are cleaned up.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 222 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Workspace snapshot signature comparison trimming

#### Changed

- Workspace store persistence now compares a compact semantic signature instead
  of serializing the full workspace store JSON just to detect unchanged saves.
- Workspace snapshot comparison no longer uses a full stable-object
  `JSON.stringify`; it now builds field-level signatures for panels,
  terminals, editor tabs, image tabs, notes, browser tabs, calculator state,
  and display settings.
- Large strings such as pasted image `dataUrl` values are represented in the
  comparison path with bounded cached fingerprints, while shorter values stay
  exact. Image persistence is unchanged; only the comparison/signature path is
  trimmed.
- `localStorage.setItem()` still writes the full workspace JSON payload, but
  only after the semantic store signature changes.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 222 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer virtual scroll window chunking

#### Changed

- Explorer virtual scrolling now snaps the rendered row window to small row
  chunks instead of moving the DOM window by one row at a time.
- The virtual render keeps a few extra rows in the rendered window so the
  viewport remains covered while reducing how often `replaceChildren()` runs
  during continuous scroll.
- Selection sync, rendered-row lookup, and drop-target highlighting continue to
  use the rendered-row map built during each virtual window render.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 219 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer watcher idle scheduling

#### Changed

- Background Explorer watcher polling now waits for a UI idle slot before
  touching directory listings, so automatic local/WSL/SSH watch checks are less
  likely to compete with active scrolling, typing, resizing, or terminal output.
- Watcher idle callbacks are token-guarded; manual refreshes, workspace
  switches, hidden state, or a newly scheduled watch invalidate stale idle
  callbacks before they can poll the wrong workspace.
- The watcher still backs off when the app is hidden, when Explorer is hidden,
  or while Explorer scrolling is active; these checks now run both before and
  after the idle wait.
- Manual Explorer refresh still calls the directory polling path immediately,
  preserving explicit refresh behavior while only background polling is moved
  to idle scheduling.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 219 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Resize and drag-over event coalescing

#### Changed

- Window resize work is now coalesced through one `requestAnimationFrame`
  callback, so layout-ratio reapplication, terminal fitting, Explorer virtual
  rerendering, CodeMirror measuring, and Browser viewport updates no longer run
  once per raw resize event.
- Explorer drag-over drop-target detection is now coalesced through
  `requestAnimationFrame`, using the latest drag position per frame instead of
  doing `elementFromPoint()` and row/class updates for every drag-over event.
- Drag-leave/drop cleanup cancels pending drop-target frames and clears pending
  positions, avoiding stale delayed highlights.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 219 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Hidden panel restore/render trimming

#### Changed

- Workspace restore now skips Calculator rendering when the Calculator panel is
  hidden, while still restoring Calculator state for later use.
- Clearing/switching workspaces now avoids Editor, Image, Notes, Calculator,
  Browser tab, Browser console, and forward-list DOM renders when those panels
  are hidden.
- Showing the Calculator, Settings, and Browser panels now explicitly renders
  their current state, so hidden-panel render skipping does not leave stale UI
  when the user opens a widget.
- Browser forward-list rendering now returns immediately while the Browser
  panel is hidden and refreshes when Browser is shown.
- Hidden Notes/Image/Editor behavior remains lazy: state is preserved/restored,
  and DOM/editor hydration happens when the panel is opened.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 219 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal output write batching

#### Changed

- Terminal backend output is now buffered per pane and flushed to xterm at most
  once per animation frame for visible panes, reducing many tiny `term.write()`
  calls during high-volume shell output.
- Hidden or inactive terminal panes flush output on a short timer instead of
  every backend chunk, so background shells do less UI work while not visible.
- Very large terminal output buffers force an immediate flush to avoid
  accumulating excessive memory.
- Switching to a terminal pane flushes any pending output immediately, so the
  active terminal stays visually current.
- Terminal exit and terminal close/full teardown now flush or cancel pending
  write buffers cleanly before updating title or disposing xterm.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 219 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer pointer/drop row lookup trimming

#### Changed

- Explorer's currently rendered virtual rows are now indexed by path in a map
  when the visible window is rendered.
- Explorer selection sync and row lookup now use that rendered-row map instead
  of querying/scanning `.file-row` elements in the DOM.
- `findExplorerEntry()` now checks the visible-entry path map before falling
  back to recursive tree search, reducing work for common selected/hovered rows.
- Drag-over drop target updates now no-op when the target directory has not
  changed, instead of clearing/reapplying classes for every drag event.
- Drop target class cleanup now touches only the previous and next rendered
  target rows rather than querying all dropped-highlight rows.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 218 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Explorer signature and panel lookup cache follow-up

#### Changed

- Explorer directory signatures are now cached per `FileEntry[]` array via a
  `WeakMap`, and cloned directory arrays carry their cached signature forward.
  Background Explorer polling can therefore compare repeated cached listings
  without rebuilding the full directory signature string every pass.
- Explorer directory cache insertion now computes the directory signature once
  and associates it with the cached array copy, reducing repeated work during
  refresh/watch/prefetch cycles.
- Floating panel lookups now use a small cache behind `getPanel()`, avoiding
  repeated `document.querySelector()` calls in hot UI paths.
- Browser panel hidden checks now use the cached Browser panel element instead
  of querying the DOM each time console/frame/background logic checks hidden
  state.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 218 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal output and hidden console parsing trim

#### Changed

- Terminal output now writes to xterm immediately but only strips ANSI and runs
  prompt/port parsing when the chunk has OSC7, prompt-like cwd hints, existing
  partial prompt state, or local-server/port hints. Plain output chunks skip the
  extra parsing path.
- Terminal cwd detection still uses OSC7 directly from raw terminal data and
  preserves prompt-based fallback parsing when chunks look like shell prompts.
- Terminal local-port detection now checks cheap raw/output-buffer hints before
  cleaning and scanning output for previewable ports.
- Browser console messages use compact formatting while the console is not
  visible, avoiding expensive JSON stringification of large logged objects in
  the background.
- Browser console background log retention is capped lower while hidden, and
  long messages are truncated before storage/rendering.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 218 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Terminal event and duplicate snapshot persist trimming

#### Changed

- Terminal backend events now resolve panes through maps keyed by backend id
  instead of scanning every terminal pane for each `terminal-data` and
  `terminal-exit` event. This reduces overhead during heavy shell output.
- Terminal pane activation and widget active-pane lookup now use the pane-id
  map for the common path, avoiding repeated linear scans when switching shell
  tabs or syncing terminal widgets.
- Terminal backend id maps are updated on spawn, exit, close, and full terminal
  teardown so stale backend events are ignored cheaply.
- Workspace snapshot writes now keep a semantic signature that excludes
  `updatedAt`; if a debounced save produces no real workspace change, it skips
  replacing the snapshot and skips store persistence.
- Workspace store persistence now skips `localStorage.setItem()` and workspace
  tab rerendering when the serialized store is unchanged.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 217 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Layout snapshot and Explorer selection hot-path trimming

#### Changed

- Workspace snapshot saves now prefer cached panel/terminal layout ratios
  instead of forcing `getBoundingClientRect()` reads for every visible panel and
  terminal card on routine saves. Layout ratios are still updated whenever
  panels are applied, moved, resized, or restored.
- Panel drag/resize snapping now collects snap guides once at the start of the
  pointer operation rather than querying and measuring every floating panel on
  every pointermove frame.
- Panel drag/resize handlers now reuse cached workspace and panel dimensions
  during the pointer operation, reducing layout reads while the user is moving
  widgets.
- Explorer visible-row rebuild now records a path-to-index map, so keyboard
  selection/typeahead scroll-to-selected no longer scans the full virtual row
  list.
- Explorer virtual scrolling uses a cached viewport height from
  `ResizeObserver`, avoiding a hot `clientHeight` read on every scroll render
  frame except for initial fallback.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 216 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Browser hidden/inactive workload suspension

#### Changed

- Browser preview iframes are now suspended after the Browser panel is hidden,
  so local dev pages, animations, timers, and console bridges do not keep
  running while the Browser widget is not being used.
- Inactive Browser tab iframes are also suspended after a short idle delay while
  another Browser tab is active. Reopening the tab reloads the preview through
  the existing tab/proxy path.
- Workspace switching now suspends the previous workspace's Browser iframes
  instead of merely hiding them, reducing background CPU from old previews while
  preserving Browser tab state for reload-on-use.
- Browser console DOM rendering now returns immediately while the Browser panel
  is hidden, and it renders again only when the panel is shown and the console
  is visible.
- Opening a Browser tab brings the Browser panel forward before loading, while
  hidden-tab activation only records selection and avoids hidden iframe loads.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk is about 216 kB minified and the
  terminal runtime remains split into the separate lazy `xterm` chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Startup/background work throttling

#### Changed

- Market ticker startup is now delayed until the UI has had an idle window,
  instead of opening Binance REST/WebSocket work shortly after first paint.
- Market ticker rendering is capped to at most about once per second and skips
  unchanged render signatures, reducing DOM churn from frequent live quote
  packets while preserving the ticker feature.
- Market ticker network timers, fetches, reconnects, and WebSocket sessions are
  paused when the app is hidden and resumed lazily when the app becomes visible
  again.
- Startup WSL profile discovery now runs through an idle/background scheduler
  instead of competing immediately with initial UI work.
- Browser iframe console messages are ignored while the Browser panel is hidden,
  so a preview that is not being used cannot keep formatting/rendering console
  traffic in the background.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The main app chunk remains below the earlier warning
  threshold at about 214 kB minified, with `xterm` still split into its lazy
  chunk.
- `git diff --check` passed.
- `rustfmt src-tauri/src/lib.rs` is still blocked in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Cache and Browser hot-path follow-up

#### Changed

- `xterm.js` and its fit addon are no longer statically imported into the
  main app chunk. Terminal runtime now lazy-loads on first shell use and warms
  during idle time, cutting the main JS chunk from about 503 kB to about 212 kB
  minified while preserving shell behavior.
- Explorer watcher polling now uses a batch directory-listing API, reducing
  multiple Tauri invokes into one frontend/backend round trip per watch pass.
- SSH watcher polling now batches expanded directory checks into one remote
  shell command instead of starting one `ssh.exe` process per watched folder;
  WSL multi-directory polling also attempts one batched shell pass and falls
  back to the existing single-directory path if needed.
- Routine workspace snapshot creation is now debounced, so frequent UI events
  no longer rebuild the full workspace snapshot, panel layout ratios, terminal
  list, image history, and browser state immediately on every call. Workspace
  tab switches, copies, new tabs, root switches, hide, and unload still flush
  synchronously before state changes or shutdown.
- Text-file extension detection and CodeMirror language loading now reuse
  module-level caches instead of recreating extension sets or language support
  promises during hover prefetch and repeated editor opens.
- Explorer directory cache now uses short profile-aware freshness TTLs, so
  background polling and hover prefetch can reuse very recent local/WSL/SSH
  listings instead of hitting filesystem or SSH again immediately.
- Explorer directory caches are invalidated on file save, note save, create,
  rename, drag/drop copy, clipboard paste, and image attachment save, preserving
  freshness while allowing more aggressive cache reuse.
- Browser preview iframes are now tracked in a map by tab id, avoiding repeated
  DOM `querySelectorAll` scans during tab activation and frame show/hide.
- Browser Console rendering now appends new log rows incrementally when
  possible and trims old rows, instead of rebuilding the whole visible log list
  on every console burst.

#### Verified

- `npm run check` passed.
- `npm run build` passed. The previous oversized main chunk warning disappeared
  after lazy-loading the terminal runtime; the main app chunk is about 212 kB
  minified and the separate `xterm` chunk is about 290 kB.
- `git diff --check` passed.


### 2026-05-22 - Responsiveness follow-up for hidden widgets and hot paths

#### Changed

- Editor typing no longer serializes the full CodeMirror document on every
  keystroke; dirty state is marked immediately and full text sync happens only
  on save, tab switch, hide, render, or runtime handoff.
- Routine workspace snapshot saves no longer force active editor document
  serialization, reducing lag from panel moves, terminal cwd updates, and other
  frequent UI state changes.
- Hidden Editor and Notes panels now avoid heavy restore/hydration work until
  the panel is actually opened, separating "using" and "not using" widget
  costs.
- Editor, Notes, Calculator history, and Browser Console renders now use
  lightweight signatures so repeated calls skip DOM rebuilds when visual state
  is unchanged.
- Browser tab activation now fast-paths already-loaded iframes even when
  switching between browser tabs, instead of re-entering proxy/load logic.
- Browser frame show/hide work is scoped to the current workspace's frames
  rather than all cached iframe previews.
- Terminal output now strips ANSI once per backend event and only runs local
  preview-port detection when the cleaned output looks relevant.
- CodeMirror resize/measure requests are coalesced through
  `requestAnimationFrame` and no longer run for unrelated panel shows.
- Explorer directory signatures no longer sort on the frontend because backend
  listings are already stable-sorted, reducing polling CPU for large folders.
- Background Explorer polling yields between watched directories and stops
  early if the UI becomes hidden, scrolling resumes, or the workspace changes.
- Explorer path-row controls skip rebuilds when the current directory has not
  changed.
- Directory listing now accepts an `includeSizes` flag; when file sizes are
  hidden or a path is only probed for terminal cwd validation, Windows/WSL
  listings skip per-file metadata calls and remote `find` returns size `0`.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npm run tauri -- build --no-bundle` is still blocked in this WSL shell
  because `cargo` is not installed/available here.


### 2026-05-22 - Responsiveness pass for Explorer and Browser

#### Changed

- Explorer virtual scrolling now skips DOM replacement when the scroll position
  stays inside the same rendered row window.
- Explorer selection updates now touch only the old/new rendered rows on normal
  selection changes, while full sync still runs after virtual rerenders.
- Background Explorer work now backs off while the user is scrolling, while the
  app is hidden, and for WSL/SSH polling/prefetch concurrency.
- Workspace switches now cancel stale Explorer prefetch/read timers before they
  can compete with the newly active workspace.
- Browser preview activation now fast-paths already-loaded iframes, avoids
  normal proxy probes until a TTL/hard refresh, and batches Browser Console DOM
  rerenders with `requestAnimationFrame` while rendering only the newest live
  rows.
- Browser restore leaves uncached previews idle during the workspace switch,
  then resumes them after first paint only when the Browser panel is visible.
- Workspace snapshot persistence is now debounced for routine UI changes and
  flushed on hide/unload, reducing repeated synchronous `localStorage` writes
  and workspace-tab rerenders.
- Hidden Notes/Image panels now defer heavier note file reads and image DOM
  rendering until after the first paint or until the panel is opened.
- Explorer directory cache reuse now avoids per-entry object cloning on hot
  cache reads, reducing GC churn during expand/refresh/workspace restore.
- Workspace and Browser tab bars now skip full DOM rebuilds when their render
  signature has not changed.
- Windows/WSL directory listing now avoids metadata calls for directories and
  computes lowercase sort keys once per entry, improving large Explorer folder
  loads over local and UNC-backed WSL paths.
- Inactive editor tab hydration and visible Explorer directory prefetch now run
  through idle scheduling, so first paint, scrolling, and workspace switching
  get priority over background warm-up work.
- Shell, terminal widget, export job, forward list, image tab, and image
  history renders now use lightweight signatures to skip repeated DOM rebuilds
  when visible state has not changed.
- Explorer and Browser heavy regions now use extra CSS containment to reduce
  layout/paint spillover.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `rustfmt src-tauri/src/lib.rs` could not run in this WSL shell because
  `rustfmt` is not installed/available here.
- `npm run tauri -- build --no-bundle` could not run in this WSL shell because
  `cargo` is not installed/available here; rerun from the Windows build
  environment before replacing the release exe.


### 2026-05-22 - Explorer scroll performance

#### Changed

- Explorer now virtualizes visible rows, keeping only the viewport and a small
  overscan window in the DOM while large folders or expanded trees scroll.
- Explorer row events are delegated from the list instead of attaching multiple
  listeners to every file row.
- Hover prefetch is paused while the Explorer is scrolling, so WSL/SSH directory
  and text prefetch work does not compete with scroll frames.
- Explorer viewport prefetch now focuses on rows near the current viewport
  instead of the beginning of the full visible tree.

#### Verified

- `npm run check` passed.
- `npm run build` passed.
- `npm run tauri -- build --no-bundle` passed and rebuilt the Windows release
  exe.


### 2026-05-22 - Terminal cwd persistence fix

#### Fixed

- Shell workspace restore now keeps the full bash working directory reported by
  OSC7 instead of truncating it to the final path segment.
- Terminal cwd snapshot saves flush when the app is hidden or closed, reducing
  the chance that a just-changed shell directory is lost on restart.
- `run-built.cmd` and `run-built.vbs` now prefer the freshly built release exe
  in the repo before falling back to the cached `%TEMP%` copy.

#### Verified

- Confirmed the OSC7 parser keeps a full redacted-style nested POSIX path.
- `npm run check` passed.
- `npm run build` passed.
- `npm run tauri -- build --no-bundle` passed and rebuilt the Windows release
  exe.


### 2026-05-22 - Browser preview common dev-server safeguards

#### Added

- Preview iframes now allow common local-dev capabilities such as clipboard,
  fullscreen, camera, microphone, and display capture.
- Injected preview diagnostics now report failed `fetch`, `XMLHttpRequest`,
  `EventSource`, and `WebSocket` connections to the IDE Browser console.
- Preview proxy tests now cover cookie rewriting and partial-content HTML
  injection skips.

#### Changed

- Preview proxy strips additional iframe/cross-origin policy headers that often
  make pages work in Chrome but fail inside a preview iframe.
- Injected HTML previews are sent with `Cache-Control: no-store` to avoid stale
  dev-server pages during quick reloads.
- Loopback auth cookies are normalized for preview mode by dropping `Domain` and
  `Secure`, and converting `SameSite=None` to `SameSite=Lax`.
- HTML console/script injection now skips `206 Partial Content` responses so
  range-based media/PDF requests stay byte-for-byte compatible.


### 2026-05-22 - Browser proxy socket.io origin handling

#### Fixed

- Browser preview proxy now rewrites `Host`, `Origin`, and `Referer` from the
  preview proxy origin back to the real loopback target origin for normal HTTP
  requests and WebSocket upgrades.
- Socket.IO polling and upgrade traffic can stay on the proxy origin, making
  the proxy behave more like a transparent reverse proxy for local dev servers.
- Removed the injected WebSocket URL rewrite shim because it could bypass the
  proxy and leave the browser-sent `Origin` on the preview proxy port.
- Browser tabs now probe an existing preview proxy before reuse and reopen it
  when the saved proxy port is stale.
- HTML preview injection now patches the Socket.IO browser factory so same-origin
  Socket.IO clients connect to the real loopback target origin while the page
  itself can still render through the iframe-friendly preview proxy.

#### Verified

- Added a Rust unit test for the proxy path used by Socket.IO polling requests.
- Rebuilt the Windows release exe with the updated proxy code.


### 2026-05-22 - Editor theme and widget resize polish

#### Added

- IDE Settings now includes an Editor theme selector with multiple dark themes.
- Floating widgets and terminal widgets can be resized from every edge and
  corner, while keeping the existing snap behavior.
- Browser tabs now keep their own iframe alive while switching tabs, preventing
  tab clicks from reloading the preview page.
- Terminal panes track their last detected working directory, so workspace
  snapshots and new shell tabs can resume from the folder where the shell was
  actually used.
- Workspace switching now restores live shell widgets before heavier panels,
  reuses the last Explorer directory listing immediately, and reads restored
  editor/notes tabs in parallel for a snappier tab switch.
- Editor/browser workspace switching now keeps runtime state in memory: editor
  tabs can be reused without rereading, inactive editor tabs hydrate in the
  background, and browser iframes/proxies are hidden per workspace instead of
  being torn down on every tab switch.
- Bash terminals now report their real working directory through a lightweight
  OSC7 prompt hook, reducing reliance on prompt parsing or guessed `cd` input.

#### Changed

- Secure env editor raw/comment blocks now edit as multiline plain text blocks
  instead of one editable control per line.
- Editor and secure editor caret colors now stay bright on dark themes.
- Terminal paste normalizes CRLF/CR newlines before bracketed paste, preventing
  doubled blank lines in LLM TUIs.
- Hovering into the Browser preview area brings the Browser widget to the front,
  so iframe content no longer feels stuck behind other widgets.
- Local preview URLs now open through a lightweight loopback preview proxy that
  strips iframe-blocking headers, so paths such as `/test.html` and `/admin`
  can render inside the IDE even when they work in Chrome but reject iframes.
- The local preview proxy injects a small console bridge for HTML pages and
  tunnels WebSocket upgrade requests, allowing IDE Console to show page
  `console.*`, runtime errors, promise rejections, and WebSocket failures.
- IDE editor themes now use distinct syntax palettes, including keyword,
  string, type, property, function, regex, metadata, markdown heading/link, and
  diff token colors rather than mostly changing editor background colors.
- Editor panels now expose a per-workspace word-wrap toggle.
- Workspace tabs can be duplicated, new empty workspaces open immediately to
  the right of the active tab, and drag reorder updates the tab order
  immediately with before/after drop markers.


### 2026-05-22 - Secure editor plain comment lines

#### Changed

- Secure env editor raw/comment lines now render like plain text lines instead
  of boxed textareas.
- Raw/comment lines remain directly editable in place.


### 2026-05-22 - Workspace terminals, settings, and editor polish

#### Added

- Added IDE Settings with UI font, mono font, and extra secret-mask file
  patterns.
- Workspace tabs can now be reordered by drag and drop.

#### Changed

- Workspace tab switching now hides inactive workspace terminals instead of
  killing them, so Codex sessions and dev servers can keep running.
- New shell and LLM terminals now start from the workspace root by default.
- Editor cursor, active line, active gutter, selection, and matching bracket
  colors were strengthened for the dark theme.
- Notes autosave debounce was increased and tab rerendering while typing was
  reduced.
- Multiline terminal paste now uses bracketed paste wrappers so LLM TUIs receive
  the paste as one text block when supported.
- Browser preview preserves path/query/hash for full local URLs when forwarding
  WSL/SSH ports.

#### Fixed

- `*.env` and `*.env.*` files such as `api.env` and `prod.env.local` now open in
  the masked editor by default, while example/sample files remain excluded.


### 2026-05-22 - Explorer refresh and shell change detection

#### Added

- Added a manual Explorer Refresh button.
- Added lightweight Explorer polling while a workspace and Explorer panel are
  open, so shell-created files and folders appear without reopening the
  workspace.
- The watcher checks the current folder and a capped set of expanded folders,
  with a slower interval for SSH profiles.


### 2026-05-22 - LLM build guide

#### Added

- Added `docs/LLM_INSTALL_GUIDE.md` with agent-focused Windows install, build,
  release, verification, troubleshooting, privacy, and reporting instructions.
- Linked the LLM/agent guide from README in both Korean and English sections.


### 2026-05-22 - Notes opacity

#### Added

- Notes now has a background opacity slider in the panel header.
- The opacity setting is saved per workspace and restores with the rest of the
  Notes layout state.
- Opacity affects the note body and footer backgrounds while keeping the header
  and text readable.


### 2026-05-22 - Toolbar clock and ticker colors

#### Changed

- Market ticker label, price, and percent text now follow the up/down color
  direction together.
- Added a lightweight local date/time clock near the titlebar status area.


### 2026-05-22 - Market ticker

#### Added

- Added a lightweight top-toolbar market ticker for BTC and NAS100.
- NAS100 is represented by the Binance USD-M `QQQUSDT` symbol because a stable
  Binance `NAS100USDT` symbol is not available.
- Users can add one extra Binance USD-M symbol from the toolbar.
- Market data starts after the app shell is interactive, uses Binance USD-M
  WebSocket ticker streams, and falls back to slow REST snapshots when the
  socket is unavailable.

#### Changed

- Tauri CSP now allows only the Binance USD-M REST and WebSocket hosts needed by
  the ticker.


### 2026-05-21 - Calculator keys and note theme tabs

#### Changed

- Notes theme colors are now previewed on each note tab.
- The active Notes theme applies only below the tab bar, leaving the panel title
  and tab strip in the default IDE chrome.

#### Fixed

- Calculator keyboard input now accepts the number row, numpad digits and
  operators, `Enter`/`NumpadEnter`, `Backspace`, and `Delete`.


### 2026-05-21 - Explorer clipboard paste

#### Added

- Explorer now handles Ctrl+V as file paste when Explorer has focus.
- Windows clipboard file lists copied from File Explorer are copied into the
  current Explorer folder using the same safe copy path as drag-in.
- Image files copied from File Explorer stay file operations; they no longer fall
  through to the image preview paste workflow while Explorer is focused.
- If Explorer is focused and the clipboard contains a raw image instead of a file
  path, the image is saved as a normal image file in the current Explorer folder.


### 2026-05-21 - Async export and drag-out

#### Added

- Explorer can export the selected item into a Windows temp export folder without
  blocking the UI, editor, terminal, or browser.
- Export jobs show progress, support cancellation, and expose completed items with
  Open and Drag out actions.
- Drag out uses a completed Windows-side export path so files can be dragged to
  Windows Explorer using DownloadURL/file URI data.
- SSH exports run in a separate backend task. SSH folders are streamed as tar
  archives so long transfers do not require loading the whole folder into memory.

#### Known Limits

- Native Shell drag-out support depends on WebView2 accepting DownloadURL/file URI
  drag data. Open remains available as a reliable fallback.
- SSH folder export requires tar on the remote host.


### 2026-05-21 - Drag-and-drop import

#### Added

- Explorer accepts files or folders dragged in from Windows and copies them into
  the current Explorer folder or the hovered folder row.
- Dropped items never overwrite existing files; duplicate names are copied with a
  numbered suffix.
- WSL targets use the Windows-accessible WSL filesystem when available, while SSH
  targets copy files through the configured SSH profile.

#### Known Limits

- Dragging files out from the IDE into Windows Explorer is not implemented yet;
  WebView/Tauri can receive OS file drops cleanly, but initiating native Windows
  file drags from web content needs a separate native drag-out path.

### 2026-05-21 - Frameless window chrome

#### Changed

- Removed the native Windows title bar by disabling Tauri window decorations.
- Added in-app minimize, maximize/restore, and close controls.
- Added app-titlebar dragging, double-click maximize/restore, and thin edge/corner resize hit zones for frameless windows.

#### Verification

- Frontend type check passed with TypeScript.
- Frontend production build passed with Vite.
- Rust backend check passed with cargo check.
- Tauri release build without bundling passed.
- WebView2 DOM check confirmed three window control buttons and top-right hit targeting.
### 2026-05-21 - Public README refresh

#### Changed

- Reworked README into a user-first guide with overview, requirements, quick
  start, WSL checkout notes, feature tour, safety/privacy notes,
  troubleshooting, limitations, and project layout.
- Added a safe demo screenshot that shows an SSH demo workspace, image preview,
  terminal server detection, and browser preview without private user data.

#### Verification

- Created a disposable SSH demo folder under a temp path.
- Verified a temporary localhost preview server on port 48125 with curl before
  stopping it.
- Checked the screenshot manually for private paths, secrets, and user data.

### 2026-05-21 - Launcher polish

#### Changed

- README now includes collapsible Korean and English sections for public users.
- LLM launchers inspect aliases, functions, and readable wrapper scripts before
  appending approval-bypass flags, so wrapped commands do not receive duplicate
  flags.
- Bash launchers inspect a larger readable prefix of CLI wrapper files, covering
  npm-style wrappers that keep default flags below the first few KB.
- Terminal tabs wait for the first visible xterm fit before spawning the PTY, so
  full-screen LLM TUIs start with the correct column width instead of needing a
  manual widget resize to rerender.
- New terminal widgets opened from shell or LLM buttons reuse the last terminal
  widget size saved for the active workspace.
- New LLM terminal sessions open taller, and terminal widgets keep a larger
  minimum height so Codex, Claude, Grok, and Antigravity panes do not start in a
  cramped broken-looking state.

#### Verification

- Frontend type check passed with TypeScript.
- Frontend production build passed with Vite.

### 2026-05-21 - Workspace notes

#### Added

- Added a separate Notes panel for sticky-note style scratch text outside the
  code editor.
- Notes support multiple tabs per workspace and autosave to
  `.vibe-ide-temp/notes/*.txt` inside the active workspace.
- Notes can be pinned above other IDE widgets, and each note tab can use its own
  Default, Sticky, Mint, Rose, or Paper theme.
- Workspace snapshots remember open note tabs, the active note tab, and whether
  the Notes panel was visible.
- Ctrl+plus/minus now adjusts Notes text size and Browser preview zoom instead
  of resizing those widget frames.

### 2026-05-21 - Calculator widget

#### Added

- Added a workspace Calculator panel with basic arithmetic, parentheses, `%`,
  and clickable calculation history.
- Workspace snapshots remember calculator input, history, and calculator text
  size.

#### Verification

- Frontend type check passed with TypeScript.
- Frontend production build passed with Vite.

### 2026-05-21 - Windows IDE usability pass

#### Added

- Windows launch helpers for running the built app without showing an extra
  console window.
- Main-window startup behavior tuned for Windows: launch on the primary monitor,
  maximize by default, and bring the app to the front.
- Empty initial workspace state so the IDE does not open a private folder until
  the user chooses local, WSL, or SSH work.
- Workspace tabs with saved/restored layout state, including panel positions,
  sizes, and open working context.
- Workspace-level capture protection control with an in-app protected overlay
  and a dedicated capture-cover window for Windows capture APIs.
- Movable, resizable, snapping widgets for explorer, editor, terminal, image
  preview, and browser areas.
- Per-widget zoom controls with Ctrl+plus and Ctrl+minus, while global zoom
  applies only when the app shell itself has focus.
- Shell tabs inside each terminal widget, plus z-index promotion when new shell
  widgets or tabs are opened.
- Separate Windows PowerShell launcher that starts in an app-owned temporary
  folder instead of a user home directory.
- LLM launch buttons with approval-bypass defaults for Codex and Claude, plus
  equivalent bypass mode where supported by Grok.
- Browser tabs, hard refresh, local URL loading, port-only loading, device
  presets for desktop/mobile/tablet preview, and an optional console pane.
- Automatic local/WSL port discovery and proxy setup for detected development
  servers, while keeping manual forwarding as a fallback.
- Explorer tree behavior with expandable folders under the selected root.
- Explorer inline create/rename flows for files and folders, including F2.
- Explorer typeahead selection, mouse back-button parent navigation, size-column
  toggle, and narrow-width filename truncation.
- Double-click execution for Windows executable files, including WSL path
  translation where possible.
- Image preview history, clear history, copy/paste support, and optional
  auto-paste-to-shell behavior for externally pasted images.
- Workspace-local temporary attachment storage under the app temp attachment
  folder.
- Secure env-file editing that allows adding new keys while values remain masked.

#### Changed

- Example and sample env files remain excluded from default secret masking.
- Image files selected in explorer open in the image preview instead of being
  decoded as UTF-8 text.
- The editor gutter styling now matches the dark theme.
- Editor loading uses lazy CodeMirror initialization and warmup to reduce the
  perceived delay when selecting files.
- WSL and SSH workspace selection flow now favors choosing a working directory
  instead of requiring the user to type an exact path first.
- Browser mobile mode can be selected directly from the device menu, including
  desktop presets in the same control.
- Manual forwarding controls remain available, but the primary flow is now
  automatic detection plus user confirmation/opening in browser tabs.

#### Fixed

- Avoided opening user-home paths by default on first launch.
- Avoided extra command windows during common WSL explorer operations.
- Fixed image paste handling for existing copied image files as well as fresh
  screenshots.
- Fixed terminal copy/paste behavior so selected terminal text can be copied
  without breaking normal interrupt behavior.
- Fixed secure-editor insertion so new masked env keys can be saved without
  revealing existing values.
- Fixed browser behavior around stale local server views by adding a hard refresh
  path.
- Fixed LLM launcher flag detection so Claude's
  `--dangerously-skip-permissions` and similar defaults are not skipped just
  because the underlying CLI executable contains the option name in its own help
  or parser code.
- Claude launcher now also passes `--permission-mode bypassPermissions` so the
  session mode is explicit in current Claude Code builds.
- Claude launcher now bypasses the alias-wrapper duplicate-detection path and
  directly launches `claude --dangerously-skip-permissions --permission-mode
  bypassPermissions`, because duplicate flags are tolerated by Claude and the
  explicit command better matches the expected button behavior.
- Terminal panes now guard IME composition by letting composing key events pass
  through, pausing input flush/fit work during composition, and flushing after
  composition ends to reduce Korean input loss in Claude/xterm sessions.
- Explorer now supports Ctrl/Shift multi-select, Delete to move selected items
  into the workspace temp trash, Ctrl+Z restore, and context-menu Delete/Export
  for multi-selection.
- Export rows now include Clear actions, and multi-export completion reports a
  compact item-count summary instead of a long per-file message stream.

#### Verification

- Frontend type check passed with npm run check.
- Frontend production build passed with npm run build.
- Rust backend check passed with cargo check.
- Windows release build passed with Tauri build no-bundle.
- Manual smoke checks covered app startup, secure env editing, capture-protection
  toggling, and browser/port-forwarding paths.

#### Known Limits

- Capture protection depends on the capture API used by OBS or other capture
  tools. The app now displays a protected overlay before enabling OS-level
  exclusion so frozen capture frames do not expose workspace content, but some
  capture modes may still require OBS-side configuration.
- Manual forwarding remains available for edge cases where automatic server
  detection cannot infer the intended local port.
- Restored workspaces save UI/work context, but long-running shell processes are
  still recreated rather than resumed from an old process snapshot.
