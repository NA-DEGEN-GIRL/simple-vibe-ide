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
- Keep browser preview fixes general. The active path is a scoped Tauri child
  WebView when capture protection is off, with iframe fallback for capture-safe
  workspaces. Edge CDP preview remains disabled because earlier attempts caused
  startup freeze/endpoint readiness issues.

## Patch Notes

### 2026-07-16 - Prevent false SSH workspace wakes and Explorer hover Glass trails

#### Changed (`src/main.ts`, `src/styles.css`, `src-tauri/src/lib.rs`, `docs/USER_GUIDE.ko.md`)
- Memory Saver inactivity now starts when the user actually leaves a workspace, so a quiet but active
  SSH workspace cannot be slept immediately after a switch. Backend-less failed/exited pane shells no
  longer inflate the live-workspace count.
- A slept workspace remains visibly `waking` until its saved terminal restore operation has completed
  and every saved pane backend is running. Failed or cancelled split restores remain slept and can
  be retried by clicking the active workspace again. Enabling `Keep live` prevents future sleeps but
  does not pretend that already-stopped shells are still alive.
- Renderer hang recovery is disabled while the native window is hidden, minimized, or unfocused. A
  foreground-resume grace, long system-suspend rearm, immediate frontend heartbeat, and main-thread
  recheck prevent a background WebView2 timer pause from draining healthy WSL/SSH/PTY sessions.
- Explorer row hover-only Glass now reasserts exactly one active row and one visible local mirror on
  every filtered render. Pointer leave, window blur/hide, full list replacement, and virtual-row
  detach/recycle clear stale hover ownership, including coalesced pointer transitions during rapid
  movement or scrolling.
- Memory Saver thresholds, SSH keepalive, SSH multiplexing, and terminal restore fan-out policy are
  unchanged; use `Keep live` for workspaces whose long-running shell processes must remain alive.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Real packaged Windows/WebView2 smoke is still required for 2x2 SSH wake/retry, minimize/Alt-Tab and
  system sleep, intentional foreground renderer-hang recovery, and rapid Explorer hover/leave/scroll.

### 2026-07-16 - Preserve and harden Browser previews across workspace switches

#### Changed (`src/main.ts`, `src/styles.css`, `src/api.ts`, `src-tauri/src/lib.rs`)
- Browser Console now exposes the Browser Glass surface instead of compositing its configurable
  translucent toolbar/log colors over a hard-coded opaque parent.
- Workspace and Browser-tab switches retain Browser page/scroll/form state. Hidden contexts use a
  five-minute grace period; retained native and iframe workspace contexts are each capped to the four
  most recent contexts. Explicit panel close destroys that panel's children, while minimize/background
  handling suspends iframe work immediately and shortens every retained native child's close grace.
  Browser state restores before remote editor/note file hydration, and retained native previews
  reappear after layout paint rather than waiting for idle hydration.
- Native preview bounds are intersected with both the Browser cell and renderer viewport. A temporary
  zero/offscreen rect can recover on focus, resize, scale, or layout sync; overlapping same-label show
  requests no longer let an obsolete completion hide the current child, and an in-flight retention
  close repairs the still-active preview after it finishes.
- Native page navigation updates the tab/address state, hard-refresh cache markers are stripped before
  persistence, and Browser Back/Forward now works on the active child WebView. Address suggestions,
  global popovers/context menus, and higher floating widgets hide an overlapping OS child surface and
  re-show its preserved page when the DOM surface no longer blocks it.
- Manual port forwards remain attached to their workspace UI across switches and are stopped when that
  workspace runtime is actually discarded. A forward that finishes starting after a workspace switch
  is returned to its originating runtime or stopped instead of leaking into the new workspace.
- Backend child bounds update atomically. Hide/close-all attempts every Browser child even if one fails,
  and a child created successfully but failing its first show is closed immediately. Existing renderer
  generation and app-exit cleanup barriers remain authoritative.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Real packaged Windows/WebView2 smoke is still required for retained scroll/form state, capture-safe
  iframe fallback, rapid workspace/tab switching and panel resize, DPI/minimize recovery, Browser Glass
  settings, Back/Forward, and repeated titlebar/Alt+F4 exit with child `msedgewebview2.exe` verification.

### 2026-07-16 - Drain IDE-owned WSL/SSH clients before exit and renderer replacement

#### Changed (`src/main.ts`, `src/api.ts`, `src-tauri/src/lib.rs`)
- Window close now stays backend-owned: native close is prevented, the window is hidden, new runtime
  starts are blocked, tracked terminal/forward/export/Edge/helper roots are drained through a bounded
  cleanup pool, and Tauri exits only after that barrier. A hard timeout and the Windows Job Object
  remain crash/failure fallbacks instead of replacing explicit cleanup.
- Persistent starts and generation-owned browser mutations carry a backend-issued renderer token.
  A terminal, forward, preview proxy, export, Edge action, or native child-WebView request dispatched
  by an obsolete renderer can no longer register or mutate the replacement generation after its
  cleanup barrier. Failed or cancelled post-spawn setup uses owned-child guards so the partially
  created process tree is reaped.
- Per-pane termination now waits for its bounded backend cleanup instead of spawning another
  fire-and-forget thread. Natural terminal exits, timed-out late starts, and stale tmux client
  reconnects also remove their backend sessions. Listener-backed forwards retain and join their
  listener worker during teardown.
- Active exports and short-lived WSL/SSH helpers are tracked during their process lifetime. The
  Windows OpenSSH service probe is cached and timeout-bounded, cleanup Job assignment failures are
  reported without local path data, and app exit explicitly terminates the cleanup Job after tracked
  roots have been handled.
- Cleanup targets only IDE-owned local client trees such as `wsl.exe`, the PowerShell wrapper, and
  `ssh.exe`. It does not call `wsl --shutdown`, terminate a distro, or stop tmux; tmux servers and the
  shell/LLM processes they own inside WSL/SSH remain available for the next app launch.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Real packaged Windows/WebView2 smoke is still required with repeated titlebar and Alt+F4 closes,
  mixed 2x2 WSL/SSH panes, active forwarding/export, renderer reload, and a check that local IDE
  client PIDs disappear while `tmux ls` remains intact.

### 2026-07-16 - Preserve the editor viewport across Ctrl+S

#### Changed (`src/main.ts`)
- Saving updates the file baseline, dirty state, tabs, label, and snapshot without rebuilding or
  detaching the CodeMirror split surface, so the current scroll position and selection stay in place.
- The saved text and path are captured before the asynchronous write. If the user keeps typing,
  switches tabs, or renames the file while a remote save is in flight, the saved baseline advances
  only when it still belongs to that path and newer/current-path content remains dirty.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`
- Real WebView2 smoke is still required for a long file scrolled to the middle, split editor panes,
  slow SSH saves with continued typing, and secure/raw editor modes.

### 2026-07-15 - Keep shell command history independent per terminal pane

#### Changed (`src/main.ts`, `src/api.ts`, `src-tauri/src/lib.rs`)
- Every new shell pane now receives its own persistent history scope. This applies equally to split
  panes, tabs, separate terminal widgets, Simple Vibe Terminal, and the outer shells created by the
  Codex/Claude/Grok launch buttons.
- WSL and SSH Bash sessions use a private per-pane `HISTFILE`; Windows PowerShell sessions clear any
  shared in-memory PSReadLine entries before selecting a private `HistorySavePath`. If private
  storage cannot be prepared, history becomes session-only instead of falling back to the shared
  shell history file. Bash profiles that explicitly disable `HISTFILE` persistence remain
  session-only. Custom prompt hooks that explicitly hard-code another history filename remain
  user-owned shell configuration.
- Normal workspace/app restore retains each pane's history scope. Workspace Copy and a fresh Load
  of a saved workspace generate new scopes, while a retry or stale tmux client reconnect retains the
  existing pane scope.
- Arrow keys inside a running Codex/Claude/Grok TUI remain owned by that CLI. Explicitly opening the
  same existing tmux session also intentionally reconnects to the same live process; neither case is
  shell-history sharing between otherwise independent panes.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- A temporary-home Bash pseudo-TTY smoke confirmed two pane IDs stay isolated, a hostile `.bashrc`
  cannot leak the shared history into either pane, and reopening the same pane ID restores only its
  own commands. A second smoke confirmed `unset HISTFILE` remains session-only without private-file
  writes. A Windows PowerShell 5.1 parser/capability smoke accepted the generated bootstrap.
- Real packaged Windows/WebView2 smoke is still required for two-pane WSL, SSH, and PowerShell
  history isolation, app restart continuity, workspace Copy/Load re-keying, and LLM/tmux behavior.

#### Known limit
- Per-pane history files are retained so dormant workspace panes can recover their history. An
  automated retention/garbage-collection policy for histories no longer referenced by any layout is
  not part of this patch.

### 2026-07-15 - Restore saved terminal splits before restarting shells

#### Changed (`src/main.ts`)
- Cold workspace restore now creates every terminal widget/xterm surface first, installs the saved
  split tree once, and only then starts shell backends. A saved 2x2 layout no longer has to pass
  through an intermediate four-column layout while each shell starts.
- Restored shells start active-pane-first through a bounded four-wide queue, so a typical 2x2
  WSL/Windows layout starts all four shells in one wave. For SSH, the first pane for each profile
  authenticates alone; after its real remote prompt is confirmed, same-profile panes fan out through
  a separate four-wide readiness queue. Password/interactive profiles remain serial because those
  prompts are intentionally not cached. Repeated Windows cwd probes are coalesced per restore.
- Same-workspace restores are serialized, cancelled cold restores remove every pane/widget they
  prepared, and late backend sessions are still killed. Normal user-created terminals keep the
  existing direct low-latency startup path.
- Workspace saves preserve the last complete terminal tree while structure is incomplete but still
  retain current non-terminal panel/tab state. Liquid Glass capture waits for the final layout and
  then recaptures once. Completion also avoids stealing focus if the user moved to another control
  while shells were starting.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`
- Real packaged Windows/WebView2 smoke is still required for multi-pane WSL/SSH/Windows restore,
  cancellation during slow startup, saved 2x2 geometry, LLM/tmux relaunch, and Glass on/off.

### 2026-07-14 - Self-heal shifted frameless WebView and stale Glass tilt

#### Changed (`src/main.ts`, `src/api.ts`, `src-tauri/src/lib.rs`)
- The frameless main window now reasserts the main WebView at physical `(0, 0)` with the native
  window's full client size after startup, focus/visibility return, DPI changes, maximize/restore,
  and a debounced resize settle. This repairs a transient WebView2 child-controller offset without
  reloading the app, nudging the native window, or changing terminal sessions.
- Bounds repair is coalesced and force-limited so raw resize events do not add synchronous work to
  terminal typing or repeatedly trigger Glass layout work. A detected mismatch records only
  geometry diagnostics.
- Window wake also clears an invalid root scroll offset and resets only stale LiquidGL hover/tilt
  transforms before restoring the configured tilt behavior. Glass material and visual settings are
  unchanged.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Real Windows/WebView2 smoke is still required across minimize/restore, maximize/titlebar double
  click, mixed-DPI monitor moves, non-100% IDE scale, Glass on/off, and capture protection.

### 2026-07-14 - Auto-connect local server ports in Simple Vibe Terminal

#### Changed (`src/main.ts`, `src/styles.css`, `src/api.ts`, `src-tauri/src/lib.rs`, docs)
- Simple Vibe Terminal now keeps an independent, workspace/profile/generation-scoped port list
  instead of sending detected ports into the IDE Browser panel that the Terminal flavor hides.
- High-confidence positive server startup output starts WSL/SSH forwarding automatically. Broad or
  negative/error-like matches stay pending for explicit confirmation. Confidence is evaluated on
  the matching line only, and total automatic attempts are capped per terminal workspace.
- Added a compact top-bar `Ports` dialog with active/pending/error counts plus Open, Copy, Forward,
  Stop, and Ignore actions. It does not create a hidden Browser widget or preview WebView.
- Pending starts are cancelled safely across layout/root/profile changes; a late backend result is
  stopped immediately, and active results are stopped before their scoped UI state is discarded.
- WSL direct exposure and SSH tunnels stay in `Starting` until their Windows localhost port passes
  a bounded readiness probe. Unreachable/no-op results are stopped and shown as retryable failures
  instead of being reported as active.
- Added a numeric-port-only localhost opener for the Windows default browser. Terminal output is
  never passed to `cmd`, and SSH automatic forwards request an available local port with
  `ExitOnForwardFailure=yes` enabled on the tunnel command.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Targeted detection heuristic smoke covered Vite, Uvicorn, Python HTTP server, refused URLs,
  duration-like false positives, and documentation-only localhost URLs.
- Real packaged Windows/WebView2 runtime validation is still required.

### 2026-07-13 - Keep Windows Codex and Claude launchers in bypass mode

#### Changed (`src/main.ts`, launcher docs)
- Windows LLM launch setup is now submitted as one semicolon-delimited PowerShell command instead
  of embedded line feeds followed by a single Enter. This avoids depending on host/version-specific
  multiline parsing during fresh ConPTY/PSReadLine startup and keeps setup plus invocation ordered.
- PowerShell duplicate detection now inspects only the effective command, follows aliases, and
  reads a bounded prefix only for effective text wrappers. Lower-priority commands and native CLI
  option/help strings can no longer suppress flags for the command that is actually invoked.
- Codex always receives repeatable Windows config overrides for approval `never` and sandbox
  `danger-full-access`; Claude always receives explicit `--permission-mode bypassPermissions`.
  These enforce the intended mode even if best-effort wrapper source detection skips a canonical
  dangerous flag. The canonical flags are still deduplicated because Codex rejects duplicates.
- Windows launchers print a compact `[simple-vibe-ide] launching ...` line containing only the
  executable and app-added argv, never environment values, so the effective launch can be checked
  without exposing bridge data.
- Added exact Windows runtime smoke checks for both launchers.

#### Verified
- Local Codex CLI accepted repeated `-c approval_policy=...` / `-c sandbox_mode=...` overrides and
  accepted them together with `--dangerously-bypass-approvals-and-sandbox`.
- Local Claude Code accepted `--dangerously-skip-permissions --permission-mode bypassPermissions`.
- Real packaged Windows/WebView2 runtime validation is still required.

### 2026-07-11 - Make workspace loading, Glass, and Korean terminal input feel immediate

#### Changed (`src/main.ts`, `src/api.ts`, `src/styles.css`, `src-tauri/src/lib.rs`, package lock/theme files)
- Upgraded to the reviewed xterm beta line that contains the upstream helper-textarea composition
  fixes. The app no longer stages, reconstructs, deduplicates, or reorders committed IME text;
  xterm owns Hangul, Space, and Enter. Composition-aware blur and workspace/pane click guards only
  delay destructive focus changes until xterm finishes its canonical commit.
- Terminal input now has a Rust PTY-writer flush barrier for tmux client reconnects, so an accepted
  key cannot remain behind the channel while the old client is killed. Direct output uses one
  persistent 4 ms/16 KiB batch worker per terminal and preserves hard ordering around cursor
  queries and exit events.
- WSL warmup now executes `true` directly without a login shell/profile, shares successful warm
  state across terminal and profile-shell commands, and keeps the existing bounded transient
  service retry. Terminal cwd validation uses a directory probe instead of listing whole folders.
- Workspace restore starts the active terminal group first, limits parallel widget startup to two,
  and yields between groups. Core xterm loads before optional WebGL; WebGL promotes only a visible,
  live pane after idle and stops retrying a failed pane until the user explicitly toggles DOM back
  to Auto.
- Explorer root loads start after the next paint, show a loading row immediately, reject stale
  path/workspace completions, and use Canvas text metrics instead of per-row layout probes. Editor,
  Notes, Image, Browser, and Calculator paint workspace-scoped loading shells so hidden panels can
  never reveal the previous workspace while restoration is in flight.
- Notes, image previews/history, snippets, browser WebViews, agent-hook checks, and image-store JSON
  now hydrate lazily or single-flight. Async note/image/Explorer work carries explicit workspace,
  profile, path, and tab scope so a late result cannot mutate the next workspace.
- LiquidGL snapshot jobs for app, workspace, and Explorer Glass are serialized and paused during
  primary restore, then one recapture is queued afterward. CSS Glass remains visible immediately;
  the visual material settings are unchanged. The bundled theme no longer embeds a duplicate
  170k-character wallpaper data URL because the same tracked JPG is already imported separately.
- Rapid activation is last-click-wins across note saves, capture-protection waits, path switches,
  and close/copy/new operations. Protected-workspace capture setup temporarily makes the old shell
  inert, and unavailable profiles fail closed instead of leaving another workspace interactive
  under the selected tab.
- Debug performance markers and long-task entries are batched so diagnostics do not create their
  own storage/render feedback loop.

#### Verified
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `npm ls @xterm/xterm @xterm/addon-fit @xterm/addon-unicode11 @xterm/addon-webgl`
- `cargo test --manifest-path src-tauri/Cargo.toml` (15 passed)
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `node --check public/vendor/liquidgl/liquidGL.js`, theme JSON parse, and `git diff --check`
- Real Windows/WebView2 smoke is still required for Microsoft Korean IME (including Alt-Tab), live
  WSL service recovery, tmux reconnect, multi-workspace loading, and Glass visual/performance checks.

### 2026-07-10 - Keep dimmed Glass workspace content above the renderer

#### Changed (`src/styles.css`)
- Memory Saver and drag dimming create an opacity stacking context on the whole
  workspace row. In Glass mode that context now receives a narrow `z-index: 2`,
  keeping the row header, controls, status, and agent cards above the dock's
  LiquidGL canvases without changing the normal row paint order.
- The capture-block marker itself does not hide workspace text. The reported
  click-to-restore behavior came from activating a slept workspace, which
  removed its dimming context and accidentally repaired the paint order.

#### Verified
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`
- Real Windows/WebView2 smoke is still required with an inactive protected
  workspace entering Memory Saver while workspace row Glass is enabled.

### 2026-07-10 - Harden Windows Korean IME and terminal input ordering

#### Changed (`src/main.ts`, `package.json`, `package-lock.json`)
- xterm now remains the single owner of committed IME text through its helper-textarea delta.
  Removed the `compositionend.data` direct-send path, private `_core` mutation, and time-window
  string dedup that could drop empty/stale Chromium commits or valid repeated Hangul.
- Space/Enter around composition finalization are ordered without guessing candidate input. Early
  delimiter `onData` is held until xterm's canonical commit, observed Enter newlines are normalized
  to CR, and independent escape protocol reports do not consume the IME commit boundary.
- Helper-textarea contents and selection are preserved across xterm's blur clear while composition
  or deferred commit is active. Missing `compositionend` can fall through to xterm's supported
  next-key finalize path, with bounded stale-state release for hidden, blurred, or long-lived IME.
- All terminal writes now reserve a pane-local FIFO position before awaiting Tauri: batched keys,
  Hangul/control input, paste, Type pad, image tags, launcher commands, and cursor-position replies.
  Cursor replies use backend-bound protocol priority and cannot cancel queued user input.
- WSL/Windows startup and explicit tmux reconnect type-ahead are bounded and flushed on backend
  attach. Rust queue-full responses use bounded safe retries; an unconfirmed user-stream head
  cancels its suffix so a detached Enter cannot execute a truncated command.
- Delayed startup, app restore, and post-composition focus recovery now re-check the current shell,
  Type pad, panel, or IDE keyboard owner. Focus changes cancel stale retries instead of letting a
  terminal steal IME from another editable control.
- Type pad paste is single-flight. A pending submission cannot be duplicated, and edits made while
  it waits are preserved on both success and failure.
- `@xterm/xterm` is pinned to `6.0.0` because the commit-order bridge relies on that reviewed
  CompositionHelper listener/timer contract and must be revalidated before an xterm upgrade.

#### Verified
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`
- Real Windows WebView2 + Microsoft Korean IME smoke is still required, including fast Hangul with
  Space/Enter, candidate selection, repeated syllables, Alt-Tab/minimize, workspace/pane switches,
  WSL cold start, tmux reconnect, paste, and Codex/Claude raw-mode prompts.

### 2026-07-10 - Recover transient WSL service startup failures

#### Changed (`src-tauri/src/lib.rs`, `src/main.ts`)
- Localized `wsl.exe` output is decoded as UTF-16 when appropriate, so service
  failures remain readable and `Wsl/Service/E_UNEXPECTED` can be classified
  instead of being hidden by mojibake and interleaved NUL characters.
- Transient WSL commands and warmup now use four bounded attempts with
  0.5/1/2-second backoff. Concurrent starts for one distro wait on the same
  warmup rather than allowing later PTY launches to race ahead of it.
- WSL profiles keep `~` as their neutral root until the distro has warmed.
  Successful home detection is cached afterward, so a transient probe failure
  no longer permanently substitutes `/home` for a root-default distro.
- A terminal retries one `E_UNEXPECTED` start in the same pane. A pane whose
  start ultimately failed no longer blocks workspace terminal restoration, and
  clicking the already-active workspace retries its failed saved shells when
  no terminal backend is running.
- Recovery remains non-destructive: the IDE does not automatically terminate a
  distro or run a global `wsl --shutdown`.

#### Verified
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo test --manifest-path src-tauri/Cargo.toml` (10 passed)
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Real Windows/Tauri WSL failure-and-recovery smoke is still required.

### 2026-07-10 - Reduce Glass recapture and Explorer hover churn

#### Changed (`src/main.ts`, `public/vendor/liquidgl/liquidGL.js`, `theme/glass_set_01.json`)
- Glass renderers now share revision-aware snapshots per source stage. New
  renderers can seed from the cached canvas, concurrent requests join one
  capture, and a source change during an in-flight capture requests one
  trailing refresh instead of accepting the stale frame.
- Focus, visibility, and restore wake signals are coalesced before Glass
  geometry work. Hidden/tiny-window applies are deferred, then eligibility is
  checked again after async script loads and captures.
- Workspace row/container renderers no longer keep an unconditional RAF or
  rebuild their WebGL contexts after every settled resize. A single app-owned
  ticker runs only for currently visible specular material, including only the
  active row while hover-only mode is enabled.
- Explorer virtualization now reconciles lenses by live DOM identity instead
  of disposing the renderer whenever the visible row signature changes.
  Retained rows reuse their lenses, effect options are reapplied only when the
  material changes, and removed rows run the vendored lens cleanup path.
- Explorer hover-only rendering filters to the active lens, creates/copies only
  its local mirror, coalesces pointer moves to one animation frame, and avoids
  a second scroll render after the active hover row is cleared.
- App Glass applies now capture/render once per unique shared renderer and skip
  inactive cached owners. Redundant per-lens geometry passes were removed when
  the following renderer pass already updates the same metrics.
- Vendored LiquidGL now supports deferred/seeded snapshots, joins concurrent
  capture promises, lazily creates and disposes its dynamic worker, cancels
  pending observers/timers, and releases lens/WebGL resources on disposal.
  `preserveDrawingBuffer` remains enabled because local mirrors and derived
  Glass composites still read the rendered canvas.
- Bundled Glass diagnostics now default to off, with a one-time migration for
  existing settings, avoiding the Explorer diagnostic measurement/storage loop
  during normal use.

#### Verified
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `node --check public/vendor/liquidgl/liquidGL.js`
- JSON parse and `git diff --check`
- Real Windows/Tauri visual and performance smoke is still required.

### 2026-07-05 - Simplify LLM card background controls

#### Changed (`src/main.ts`, `src/styles.css`)
- Terminal render watchdog refreshes now wait until the xterm write pipeline is
  fully drained before forcing a full viewport repaint. This avoids presenting
  half-applied GL frames while large TUI output is still being chunk-written,
  which is the likely cause of the brief left-edge glyph fragments.
- Grok Build terminal panes now use xterm's DOM renderer even when the global
  terminal renderer setting is `auto`. Grok's fullscreen TUI can trigger stale
  glyph fragments in xterm WebGL, and the attempted texture-atlas reset path was
  removed because WebGL glyph atlases can be shared across terminal instances
  and disturb otherwise healthy GL panes.
- Grok launcher commands now use a reduced embedded-terminal contract:
  `TERM=xterm`, empty `COLORTERM`, `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`,
  `NO_COLOR=1`, `FORCE_COLOR=0`, and `grok --no-alt-screen`. These are
  applied only to Grok launcher panes so other shells and agents keep their
  existing terminal capabilities.
- Grok panes now use xterm's built-in Unicode 6 width provider while other
  panes keep the Unicode 11 add-on active. This is scoped to Grok because its
  OpenTUI inline redraw can desync from newer xterm width tables on ambiguous
  punctuation/symbol cells.
- LLM launcher panes now disable xterm `convertEol`, because LLM TUIs already
  own cursor movement and xterm's LF-to-CRLF compatibility mode is intended for
  non-PTY streams. Plain shell panes keep the existing setting for now.
- Grok panes also get a post-write/scroll viewport refresh after xterm's write
  queue drains. This is throttled and Grok-only, nudging the DOM/transparent
  WebView compositor without adding a heavy refresh path to normal shells.
- Grok output now normalizes bare carriage-return redraws to `CR + erase to
  end-of-line` before xterm writes. This is scoped to Grok panes and targets
  stale front-edge cells from partial-line TUI repaint/wcwidth mismatches.
- Terminal-focused `Ctrl++` / `Ctrl+-` now resize the terminal font before
  xterm can treat the key as shell input, so the shortcut works even when the
  terminal helper textarea has focus. Font resize shortcuts now report the
  current percent and pixel size in the status line instead of adding more
  header chrome.
- LLM terminal `Tmux` menus now open immediately with a loading row while
  existing sessions are listed asynchronously; recent results are cached per
  profile/workspace/LLM so repeat opens show the last list immediately while a
  background refresh runs. The same menu now includes a guarded `Kill all`
  action for the currently listed sessions of that LLM only.
- Closing the sole `Empty` tab in Editor or Image Preview now hides that panel,
  matching the panel/widget `x` button instead of recreating another empty tab.
- Workspace restore now respects an intentionally empty shell/widget state:
  if the last saved workspace had no terminal widgets, reopening it no longer
  creates a fallback `shell`. IDE workspace folder switches also stop
  auto-spawning a shell; the Terminal app variant keeps its shell-first open.
- Glass-mode workspace LLM/Agy card color overlays no longer own a separate
  border. `LLM 카드 단일 테두리 강도` now drives the real card outline instead,
  with the same 1px outline on all sides, so background geometry controls
  cannot create an internal vertical border.
- Replaced the LLM color `inset`/`extension`/`width`/`overflow` controls with a
  simpler rectangle model: background size left/right/top/bottom and move X/Y,
  plus one visible card/container radius.
- The LLM/Agy color background is now an independent 62%-wide rectangle instead
  of a full-card layer. The inner color rectangle stays square, while
  `LLM 카드 R값` changes the real card/container radius that clips the final
  visible shape.
- The simplified LLM/Agy model now defaults its card radius to
  `0`; old saved default radius `9` from the removed inset/width model is
  migrated to `0` unless the simplified size/move fields are already present.
- Added finer LLM detail-card controls: title/activity/meta text colors, sizes,
  weights, and line-heights; logo badge size/weight/height/padding/radius,
  border width, and alpha controls; and variable LLM background gradient start,
  middle, end alpha, stop positions, and angle.
- `LLM 카드 단일 테두리 강도` now paints through a card-outline `::after`
  layer above the inner color background, so the border remains visible instead
  of being hidden by the LLM background layer/clipping.
- Expanded `explorer-scroll` diagnostics for the intermittent Explorer
  scrollbar/layout issue. The log now records render/resize/watch/glass-apply
  lifecycle reasons, expected vs actual vertical scrollbar state, virtual row
  content height, spacer heights, child count, extra scroll height, and changed
  fields from the previous diagnostic snapshot.
- Explorer row liquidGL's viewport-sized internal mirror now stays in the
  Explorer overlay host instead of being adopted into each `.file-row`; only the
  small row-local mirror remains inside the row. This prevents the hidden
  mirror from inflating the file list's `scrollWidth`/`scrollHeight` after
  `glass-apply`.
- In glass-mode side workspace rows, the gap between the workspace row header
  and the first LLM/Agy detail card now reuses `LLM 카드 간격`, instead of
  stacking the detail top padding plus the agent-list top margin.
- Workspace row LLM status spacing now treats the setting as
  `상태 점-이름 간격`: the name starts from the status-dot right edge plus that
  gap, instead of using an absolute left padding that made `0` still look too
  far from the dot. The glass-mode status dot now renders inside the label's
  local coordinate system, so row padding/glass planes no longer add hidden
  space between the dot and workspace name. Old absolute saved values are
  migrated to an equivalent dot-to-name gap.
- Fixed a protected/capture-applied workspace row override that could keep the
  old row-level LLM status dot visible above the new label-local dot. That
  stale dot made `상태 점-이름 간격 = 0` still look widely separated.
- Replaced the glass-mode workspace row status dot with a real inline dot/span
  inside the workspace label, using CSS `gap` for `상태 점-이름 간격` instead of
  pseudo-element padding math. Workspace glass diagnostics now log the label,
  dot, and text rects plus the actual measured dot-to-text gap.
- Glass-mode workspace labels are now stretched and `justify-content:flex-start`
  so the status-dot/name group stays left-aligned inside the header grid instead
  of visually centering as an intrinsic inline-flex group.
- Added detailed selected badge controls for workspace row glass: text color,
  background alpha, font size/weight, height, padding, radius, left gap,
  X/Y offset, and line-height.
- Workspace row glass now reserves an inner edge gap around the scrollable row
  list, using the larger of `카드 간격` and `rail glow`, so the first row's
  rail/glow is not clipped against the workspace header and side glow has room
  to render.
- The row edge gap is vertical-only; horizontal padding is kept at `0` so the
  row glass width no longer shrinks left/right when the gap is enabled.
- Selected workspace rail glow also paints on the row outline plane with a
  uniform `0 0` shadow, so the rail glow reads with the same thickness on
  left/right and top/bottom instead of mainly showing below the row.
- Window resize now does an immediate workspace glass geometry pass and then,
  after resize settles, rebuilds the workspace row/container liquidGL lenses.
  This clears stale mirror/clip rectangles that could leave the workspace
  container or rows stretched/misaligned after shrinking and expanding the app.
- Moved the workspace row/tab liquidGL master toggle into the `Glass 사용 범위`
  group and renamed it as an explicit row/tab on/off control, so it no longer
  feels hidden inside the workspace material section.
- Workspace hover-only row glass now keeps row render layers after the container
  glass layers even when the container lens is toggled on later. The hover-only
  active set also includes both the row/add button and their glass planes, so
  legacy and current row lenses stay renderable on hover while inactive rows
  remain filtered out.
- Workspace side rows now reserve horizontal rail-glow bleed outside the row
  list by expanding the scroll container outward while keeping the actual row
  glass width unchanged, so increasing row width no longer clips the selected
  rail glow at the left/right edges.
- The workspace row rail bleed keeps the actual row/add-button glass at full
  width, while side-dock header highlights are clipped horizontally to the row
  header/glass width. This keeps manual highlight expansion from spilling into
  the extra rail-glow safety space.
- Workspace idle/tab header highlights no longer apply to the active workspace
  row/tab. Active rows now show only the selected-highlight layer when that
  option is enabled, and show no idle highlight when selected highlight is off.
- Explorer glass row scrolling now has a semantic vertical-overflow guard:
  when the real file row content fits but row-local glass/mirror overflow
  inflates native `scrollHeight`, the Explorer hides only the bogus vertical
  scrollbar and resets stale `scrollTop`. Diagnostics now include `guardY`.
- Explorer glass row scrolling clips row-local glass overflow so rows do not
  inflate native scroll height, and logs visible vs native vertical scrollbar
  state separately.
- Explorer horizontal overflow is now driven by a semantic row-content width
  computed from an offscreen DOM-measured file row using the same CSS grid,
  depth indentation, file name, and optional size text, then applied to rows
  and virtual spacers. This restores the horizontal scrollbar when content is
  wider than the glass viewport without relying on row/mirror overflow that
  previously broke vertical scroll height.
- Explorer now also has a semantic horizontal-overflow guard. When the panel is
  widened until the horizontal scrollbar disappears and then narrowed again
  while vertical scrolling is still not needed, the guard forces horizontal
  scrolling back on from the measured content width instead of waiting for a
  later vertical-overflow recalculation.
- The Explorer horizontal guard now compares the real row-content right edge
  (`padding-left + measured row content width`) against `clientWidth`, instead
  of treating clipped trailing right padding as meaningful content overflow.
- Explorer horizontal overflow detection now uses strict rounded
  `scrollWidth > clientWidth` semantics instead of the previous one-pixel
  tolerance, so the `contentOuterW=300` / `cw=299` boundary no longer suppresses
  the horizontal guard. Diagnostics also log `hBar` for the actual reserved
  horizontal scrollbar height.
- Explorer scroll diagnostics now log `hiddenContentX`, `hBar`, native `xOff`,
  and `xMax` near the front of each line, making it clear when semantic row
  content is clipped and whether native horizontal scrolling is actually
  available before log truncation.
- Removed the attempted glass-attached custom horizontal rail/thumb and the
  virtual X-offset path. Native file-list scrolling owns horizontal movement
  again, including in glass mode, so dragging the scrollbar no longer snaps
  back to the left during virtual render/scroll diagnostics.
- Removed the forced glass file-list height snap. The Explorer grid now owns
  file-list height again, and resize observation includes the title/path/export
  rows so wrapped Explorer controls cannot overlap the list body.
- Glass-mode Explorer native scrollbars are styled to fit the glass look
  instead of being replaced by a separate custom bar.
- Explorer scroll diagnostics now include the remaining horizontal-scroll
  decision points needed for the no-vertical-scroll case: native vs semantic X
  ranges, glass scope state, panel/list/title/path/export dimensions, row/name
  measured widths, computed `--explorer-content-width`, grid rows, overflow,
  gutter, and key class names.
- When the Explorer glass row vertical-overflow guard hides a bogus vertical
  scrollbar, it now keeps `scrollbar-gutter: stable`. This preserves the same
  client-width budget as the vertical-scroll case, so horizontal overflow does
  not disappear only because vertical scrolling is semantically unnecessary.
- Restored the geometry recalculation that snaps the glass Explorer file-list
  height to the panel bottom, now with the current wrapped title/path rows in
  the resize observer. The native horizontal scrollbar can therefore sit on the
  Explorer glass bottom boundary without reintroducing the old custom rail.
- Glass settings export now tries the WebView save-file picker first, so users
  can choose the JSON destination. If that API is unavailable, it falls back to
  the previous browser download behavior and the status message says it used the
  default downloads folder.
- Wrapped glass widget headers no longer apply the single-line topbar content
  Y-offset to each child. This keeps narrow Explorer headers from being pushed
  upward and clipped when their controls wrap onto multiple lines.
- Wrapped glass widget headers now use their own multi-line layout metrics:
  top-aligned rows, larger line-height, row gap, and child margins. This avoids
  reusing single-line topbar typography that clipped the first Explorer header
  row when the controls wrapped to two or more lines.
- Explorer glass layout now measures the wrapped title bar's actual child
  bottom and adds a title-bottom gap when the visual controls overflow the
  computed title box. This prevents the path/use row from overlapping a
  multi-line Explorer header while keeping the file-list bottom snap.
- Removed the Explorer `Auto Edit` title-bar button and its toggle/update path.
  The double-open Explorer mode now always auto-opens a single selected
  non-executable file in the editor; single-open mode still opens through the
  direct entry action.
- Explorer glass headers now use the wrapped/auto-height title layout
  unconditionally, independent of the generic widget title-wrap setting, and
  the title-overflow gap measurement runs for Explorer glass headers whenever
  the panel glass shell is active. This keeps the path/use row below wrapped
  title controls instead of letting them overlap.
- Added a Glass theme row at the top of the Glass settings popover. The bundled
  `theme/glass_set_01.json` + `theme/glass_bg_01.jpg` pair is exposed as
  `기본 Glass 테마 01`, and `테마 저장` exports the current background plus glass
  settings as a reusable theme JSON.
- Fresh default IDE settings now seed from that bundled Glass theme, while
  existing persisted settings are left unchanged unless the user applies it.
- `테마 저장` embeds the active wallpaper image when it is stored as a local or
  bundled image URL small enough for settings, so saved themes can carry the
  background as well as the glass slider/toggle values.
- Background image load/error events now recapture workspace, Explorer, and app
  glass surfaces, so applying a theme with a bundled wallpaper refreshes all
  glass snapshots after the image is actually available.
- Grok hook-tracked panes now only use Grok title/OSC signals as a waiting
  supplement; title `working`/`idle` no longer overrides the hook source. Grok
  symbol-only logo/art repaint frames also no longer extend an existing
  ambiguous `working` window.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check -- src/main.ts src/styles.css src/vite-env.d.ts codex.md`

### 2026-07-04 - Reduce app-glass WebGL contexts and recover context loss

#### Changed (`src/main.ts`, `src/styles.css`)
- App-glass surfaces now share one liquidGL renderer/context with multiple per-surface lenses instead of creating a separate WebGL context for each titlebar/profile/widget surface. The individual glass planes and per-scope material settings remain intact; only the number of WebGL contexts is reduced.
- App-glass planes that fall back with `init-failed` are no longer skipped forever. They now keep a retry backoff, clear the fallback marker when the retry is due, and attempt to promote back to liquidGL when a refresh runs.
- Removing a liquidGL renderer now schedules a recoverable retry pass for any active `init-failed` planes, so closing widgets can let previously failed glass surfaces come back.
- Added forced diagnostic breadcrumbs for app-glass `init-failed`, `retry-init-failed`, and `context-lost` events with active target count, renderer count, init-failed count, and lost-context count.
- The `glass diagnostics` toggle now makes app-glass diagnostics actually enter the diagnostic log even when the broader debug log toggle is off.
- App-glass canvases now hide immediately on `webglcontextlost` before disposal/retry, so a lost context is less likely to leave a white fallback surface over the main UI.
- Shared app-glass canvases/mirrors are layered under the normal titlebar/profile/widget content so reducing contexts does not intentionally remove glass surfaces or overlay text/buttons.
- Floating panels and terminal widgets now keep a minimum z-index above the shared app-glass canvas, and `bringPanelToFront` bases its next value on the actual current max z-index from restored panels/widgets. Shared app-glass lens paint order is also sorted by owner z-index so the glass surface order follows widget stacking.
- After internal-agent and Claude review, the shared app-glass canvas is now treated as a hidden render source instead of the visible glass layer. Each app-glass lens copies only its own rendered rect into a small owner-local mirror canvas inside that widget's stacking context, restoring the intended `glass plane < glass render < widget content` order without returning to one WebGL context per widget.
- The vendored liquidGL renderer exposes a narrow per-lens post-render hook so the app can copy the just-rendered lens rect into its local mirror without allocating viewport-sized mirrors for every widget.
- App-glass mirror geometry now avoids using liquidGL's frozen `_baseRect` outside active tilt, so normal drag/resize/layout refreshes continue to use the live target rect.
- Follow-up Claude/internal-agent review cleanup split owner-local glass shadows back below mirror canvases, compensated edge-clipped mirror blits so top/title surfaces do not stretch their 2px bleed, keeps the owner-local mirror visible immediately when a transient tilt mirror is destroyed, clips local mirrors to the target radius, and guards the per-lens hook so one failed mirror copy cannot abort later lenses.
- Explorer row glass now uses the same hidden-source/local-mirror model inside each file row. The Explorer row renderer keeps one hidden WebGL canvas, but each visible row receives a small row-local mirror so row glass is no longer lost behind the Explorer/file-list stacking context. Follow-up fixes hide inactive hover-only row mirrors after transient tilt cleanup and force row-local mirror synchronization after Explorer row renders, so always-on rows do not stay blank until hovered and hover-only rows do not leave a glass trail.
- Added targeted `explorer-scroll` diagnostics without changing Explorer layout. When app diagnostics or glass diagnostics are enabled, Explorer scroll/render/resize and bottom/right pointer attempts log scrollTop/scrollLeft, client/scroll sizes, rendered virtual row window, padding/overflow, file-list rect, and resize-grip rects so the horizontal-scroll/resize-hit overlap can be diagnosed from runtime evidence.
- Explorer glass resize hit zones are now narrowed only for the Explorer panel after diagnostics showed the bottom resize grip fully overlapping the native horizontal scrollbar. Corner resize handles remain available while the horizontal/vertical scrollbars get most of their clickable area back.
- Added an Explorer-specific glass setting for horizontal scrollbar bottom gap. The existing side inset came from the shared glass widget horizontal padding, but the Explorer row glass overlay means the file list is not always the final child, so the generic bottom margin was not applied to the horizontal scrollbar.
- Workspace row/container glass and Explorer row glass now bind WebGL context-loss handlers, log forced `glass` diagnostics, dispose lost renderers, and retry after a short backoff instead of staying permanently blank or stale.

#### Verification
- `npm run check`
- `npm run build`
- `node --check public/vendor/liquidgl/liquidGL.js`
- `git diff --check -- src/main.ts src/styles.css public/vendor/liquidgl/liquidGL.js codex.md`

### 2026-07-03 - Widget-local app glass show/hide refresh

#### Changed (`src/main.ts`, `src/styles.css`)
- Opening, closing, hiding, or restoring a floating/terminal widget now refreshes only that widget's app-glass owner instead of scheduling a full app-glass recapture across every visible widget.
- Terminal widget teardown explicitly cleans up only its own app-glass renderer/tilt state before removing the widget element.
- Added a workspace LLM `done-unread` state so finished inactive LLM work stays visually marked until that workspace is clicked, with configurable glass colors for the workspace status dot and agent status badge.
- Simplified glass widget header highlights to one shared color/strength/X-length/Y-length/inset model, rendered as a single 2D radial gradient instead of separate selected/idle horizontal/vertical gradient layers.
- Wired Image Preview tabs to the glass chrome variables so global and Image Preview custom tab/selected-tab backgrounds apply to image editor tabs.
- Extended glass chrome settings with configurable colors for common/per-panel buttons, tabs, cards, dividers, and top-down/select controls. Profile dropdowns now expose body text plus option/selected-option background and text colors in glass mode.
- Follow-up subagent review fixes: scoped common top-down/select styling to glass settings and active glass widgets, hid per-panel select controls where the panel has no select menu, restored header-highlight move/radius controls, prevented Browser tab child buttons from inheriting generic button glass backgrounds, fixed Notes select hover specificity, and wired Snippets tabs/search/form chrome to global/custom glass chrome variables.
- Split selected glass widget header highlights from the base header highlight in the same settings group while keeping both on the single radial-gradient model.
- Added direct header-highlight gradient controls for general and selected headers so light origin, spread, softness, afterglow, and edge falloff drive the single radial gradient instead of fixed visual stops.
- Reworked the visible header-highlight controls around a softer model: labels now distinguish general vs selected headers, exposed stop controls were replaced with spread/softness/afterglow-style controls, and defaults use a wider lower-alpha falloff to avoid a visible two-step band.
- Replaced editable glass range value `<output>` fields with real text inputs and guarded global shortcuts while editing, so typing numbers, minus signs, decimals, Escape, and Ctrl +/- no longer get stolen by IDE-level key handlers.
- Added Glass settings export/import buttons. The JSON package includes IDE background, common glass material, workspace row/dock glass, and app glass settings, and import re-applies/persists them with a full glass recapture.
- Wired Shell/LLM terminal widget tabs to the common glass chrome variables so global tab background, selected tab background, divider, button outline, hover, and padding settings visibly apply to terminal tabs instead of staying transparent/hard-coded.
- Changed danger status details from an in-grid row to a fixed overlay toast, so long error messages no longer push the main widget area down.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-07-02 - Glass chrome controls, Explorer copy/paste, and agent alert fixes

#### Changed (`src/main.ts`, `src/styles.css`, `src/api.ts`, `src-tauri/src/lib.rs`)
- Added a shared glass `탭/버튼/내부 surface` settings block plus per-panel overrides for Profile/actions, Explorer, Editor, Image Preview, Browser, Notes, and Snippets.
- Applied those glass chrome variables to Explorer path/export rows, Notes scroll/body/footer, Snippets cards/forms, Image Preview chrome/history/stage, Browser empty/chrome surfaces, and Profile/actions controls.
- Removed the `Reset panel layout` toolbar button and handler.
- Added Explorer-internal multi-select Copy/Paste via `Ctrl+C`/`Ctrl+V` and context menu. Same-folder copies use `_copy_000`, `_copy_001`, etc.; directory self-copy is rejected by the backend.
- Added a clearer dev-mode message when the frontend is hot-reloaded before the Tauri backend has restarted with `copy_profile_paths`, and preserved remote copy basenames instead of applying attachment-style filename sanitizing.
- Fixed LLM status edge cases: Codex title-only panes now still run output waiting detection for implement/choice prompts, Claude/output-scraped working states can produce done alerts, scrollback waiting false positives are suppressed more aggressively, and workspace tab rename/drag classes survive LLM activity rerenders.

#### Verification
- `npm run check`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

### 2026-07-01 - Port full-wrapper app glass mode

#### Changed (`src/main.ts`, `src/styles.css`)
- Added an opt-in app-wide `appGlass` settings group for full-wrapper glass mode while keeping the default glass-off UI path unchanged.
- Extended the Glass settings popover with controls for app-wide scope toggles, liquidGL material, titlebar/window buttons, floating widget wrappers/topbars, terminal readability, Explorer row hover, and diagnostics.
- Added wrapper glass planes for titlebar, window controls, profile/actions, floating panels, terminal widgets, Settings, Notes, and Snippets; xterm, browser iframe, editor, and other content remain normal overlay content above the glass plane.
- Added target-isolated app glass renderers so high-z window controls do not force one global liquidGL canvas over panel contents.
- Wired panel show/hide, z-order, drag, resize, terminal widget creation, settings changes, and background changes to app glass geometry refresh or recapture.
- Follow-up self/Claude review hardening: stopped the vendored per-renderer scroll RAF loop for app glass, fixed teardown observer cleanup before dispose, skipped repeated renderer creation for init-failed CSS fallbacks, moved app renderer overlays into each target owner stacking context, RAF-coalesced panel drag/resize geometry renders, and kept window-control hit targets full-size while centering the smaller glass plane.
- Fixed owner-local app glass renderer alignment by positioning viewport-sized canvases/mirrors with negative owner offsets instead of `position: fixed`, so left-docked workspace layouts do not shift Explorer/widget refraction. App-glass renderers now own their viewport resize/zoom and mirror clip correction instead of letting the vendored default resize path overwrite local stacking-context math. Removed the visible floating-panel resize corner glyph; resize hit zones still work through cursor changes.
- App glass tilt now links normal overlay content to the tilting glass plane, so titlebar/window-button labels and widget contents follow the glass motion instead of leaving only the liquid surface tilted.
- Hardened high-angle app-glass tilt by letting the active shell overflow during tilt and restoring follower transform/backface/transform-box styles on cleanup, so content and attached title/background layers do not shear away from the glass plane or clip one side.
- Fixed the liquidGL tilt mirror/background layer to keep using the frozen pre-tilt lens rect and scaled pivot while the mirror is transformed; this keeps the refracted background attached to the glass instead of re-clipping separately from the tilted text/content.
- Repainted app-glass renderers immediately after a tilt mirror is destroyed on mouse leave, so the normal liquidGL canvas redraws instead of leaving the wrapper as a plain transparent fallback after hover. Settings-panel grid rows are now explicit so glass overlay/canvas children cannot steal an implicit grid row and leave dead space below the Settings body.
- Made app-glass tilt followers consistent again: Settings panel bodies now tilt with the glass instead of only the header, and the top titlebar tilt carries the window-controls group with it. Glass-mode resize hit zones are moved inside the rounded widget bounds with higher z-index so hidden overflow no longer makes resize feel unavailable, and Settings keeps extra bottom scroll padding.
- Floating widget drag/resize now flushes the owner-local liquidGL geometry immediately instead of waiting for the deferred full app-glass refresh, so the glass surface stays attached to the moving content. Starting a widget drag/resize or titlebar window drag also suspends/resets active tilt first, then restores tilt after the interaction.
- Stabilized glass-mode widget resize coordinates by suspending tilt before measuring the widget, using layout offset metrics instead of transformed viewport rects for active panel rects, exempting resize grips from the generic glass overlay `position: relative` rule, and giving corner resize hit zones priority over edge hit zones so diagonal cursors remain reachable.
- Fixed the app-glass master toggle so turning `Glass 테마 사용` off also deactivates workspace dock/container/row glass without deleting the saved per-workspace glass settings. Glass mode also no longer rewrites floating widgets from `position:absolute` to `position:relative`, and drag start now commits layout-space panel metrics instead of transformed viewport metrics, preventing widgets from jumping down when grabbing their header.
- Moved the panel visibility/z-order fix back into the common floating-panel path instead of treating it as glass-only: panel toolbar toggles now bring an already-visible but buried widget to the front before hiding it, workspace restore clears stale geometry for panels whose snapshot has no rect, and the Settings panel is no longer saved/restored per workspace so `Set` cannot be hidden by workspace switching.
- Added an IDE Settings `Glass 테마 사용` toggle for app-wide glass, split the profile/action toolbar into optional two-card glass surfaces, and made app-glass shadow on/off visually obvious with dedicated CSS shadow strength/Y/blur controls instead of relying only on the clipped liquidGL internal shadow element. Shadow-off now becomes truly shadowless, and the shadow sliders are disabled while the shadow toggle is off.
- Moved the saved workspace controls into the connection/profile card when profile/actions are split, and stretched the split profile/action cards to a shared row height.
- Moved the `개별 workspace row liquid glass 켜기` master toggle out of the top of the Glass popover and into the workspace-row section it controls.
- Kept the Glass popover open while clicking elsewhere in the IDE or changing window focus; it now closes through the explicit close button or Escape key.
- Aligned Glass/settings checkbox rows so checkbox marks sit on the same vertical line as their labels instead of dropping to a second row.
- Fixed non-split profile/action glass mode so controls inside `display: contents` profile cards are lifted above the shared glass plane instead of disappearing behind it.
- Reworked the Glass popover into collapsible setting groups. Fast on/off toggles for App Glass scopes, Explorer row overlay, workspace row liquidGL, and workspace dock container glass now live together near the top, while detailed material/layout controls stay in their own foldable sections.
- Range value outputs in the Glass popover are now directly editable: click the displayed number, type a value, then press Enter or blur to apply.
- Replaced the real app Explorer row glass overlay with inner per-row liquidGL lens targets that follow the shared common glass material by default, keep text as a normal overlay, rebuild safely around virtual-row recycling, and refresh after scroll/panel geometry changes without leaving a continuous liquidGL RAF loop running.
- Cleaned up terminal-widget glass chrome: removed the header focus-target controls from the visible shell header, added static-style full-header highlight controls with gradient stop/inset/glow settings, suppressed legacy active/focus outlines in glass mode, and made the terminal host/tabbar/type pad/input/split backgrounds individually transparent/tunable over the glass surface.
- Added glass-only widget spacing and chrome cleanup controls so widget contents can breathe inside the outer glass lens: widget padding X/Y, header button background/outline/hover/active/radius, and glass-scoped overrides for terminal/floating-panel header buttons. This removes old solid button/background residue from the terminal header so full-width highlights can be tuned seamlessly.
- Clarified Glass settings naming around one `전체 공통 material` plus explicit per-scope `개별 material` sections for titlebar, window buttons, profile/actions, terminal widgets, floating panels, Notes/Snippets, Settings panel, Explorer rows, and workspace rows; the workspace-row liquidGL master toggle now lives with the row material section instead of the top scope switches. Widget header highlights are always full-header now, and their X/Y inset controls accept negative values so the highlight can overrun widget padding up to the outer glass edge.
- Removed hidden CSS-line residue from glass widget chrome by making button outline width, header divider line, glass-plane inset line, and title-highlight inset-line width separately tunable; the new defaults leave those line widths at zero instead of drawing permanent CSS outlines. Glass widget title bars now keep the non-glass wrapping behavior when toolbar controls spill to two lines, instead of clipping wrapped menus under the fixed glass topbar height.
- Removed the widget opacity (`Op`) menu from glass mode: the button is hidden in glass headers, and any open opacity popover is closed/blocked while `Glass 테마 사용` is active. Non-glass widget opacity controls remain unchanged.
- Renamed the confusing `일반 탭 highlight` workspace setting to `Workspace row idle highlight`, and renamed the paired selected controls to `Workspace row selected highlight / rail` so this row-specific idle/selected highlight does not look like the separate widget title selected/idle highlight controls.
- Fixed terminal widget header highlight state in glass mode: terminal cards no longer use selected header highlight merely because they keep the internal `.active` terminal-card class; selected highlight now follows the actual keyboard-target widget state, while inactive terminals use the idle header highlight.
- Added glass-mode calculator chrome cleanup: calculator display, input, key grid, operator/equals buttons, and history rows now use transparent/translucent glass-compatible backgrounds instead of opaque black blocks.
- Added terminal-specific glass controls for the `+` tab button, Recall/Paste type-pad buttons, and xterm/history scrollbars. These now have separate bg/outline/hover/disabled or thumb/track/width CSS variables so they can be made translucent like the rest of the terminal glass chrome.
- Restored the terminal `Focus: Shell/Type` button that switches a shell widget's default focus target between the xterm shell and Type pad. The button is visible again in glass headers and uses the glass active button styling when Type pad is selected.
- Cleaned up the Glass settings material menu so generic `Floating panels` / `Notes/Snippets` material groups are no longer shown as duplicate widget-level controls. Explorer, Editor, Image Preview, Browser, Notes, Snippets, Calculator, Settings, and Shell terminal now each expose their own `개별 material` group, while shared chrome/highlight controls are labeled as common panel/header settings. Header highlight also gained separate X/Y move controls in addition to inset/overrun.
- Removed the old side workspace `Glass` button because workspace glass is now controlled only from the central Glass settings. This also removes the stale startup event binding that caused `Cannot read properties of undefined (reading 'addEventListener')` and could prevent later startup work such as ticker price updates from running.
- Fixed shell glass selected-header state by marking the owning terminal card as the keyboard target even when the internal split leaf owns resize focus; clicking a shell now applies selected highlight again, while other widgets still show idle highlight. Also nudged the `GL` renderer badge down for better vertical alignment with neighboring header controls.
- Extended workspace tab/row glass beyond the left/right side dock: the same workspace row liquidGL/material/outline/text/highlight/selected-rail settings now also apply when workspace tabs are at the top or bottom. In top/bottom mode the LLM detail dock stays absent, but the tabs and `+` button can still use container glass, row/tab liquidGL, and selected glass highlighting.
- Extended common widget header highlights with separate vertical strength and vertical gradient-stop controls, while renaming the existing start/mid/end controls as horizontal so both axes can be tuned independently.
- Reworked widget header highlight rendering so horizontal and vertical strength controls blend into one single-color highlight mask instead of stacking two colored gradient layers.
- Added real-app hover-only row liquidGL toggles for workspace tab/row glass and Explorer row glass, matching the static lab behavior where glass-over-glass only renders under the current mouse hover target.
- Made Editor and Notes glass panels transparent internally like the shell widget: editor tabs/body/CodeMirror surfaces and notes tabs/body/footer drop their solid backgrounds in glass mode.
- Clarified terminal glass as a shared Shell/LLM scope and keeps terminal widgets first in app-glass setup order, so Shell, Codex, Claude, Grok, and Antigravity widgets share the same terminal glass material.
- Matched glass-mode app scroll containers to the shell terminal scrollbar variables/style instead of inventing a separate scrollbar look, and hardened the terminal history/cache overlay so top-scroll cache view no longer inherits generic glass widget margins or stale tilt geometry.
- Removed the app-glass liquidGL renderer cap: all active app glass targets now request real liquidGL, and only genuine init failures remain on CSS fallback.
- Optimized app-glass interaction refresh: clicking/focusing/z-ordering widgets and drag/resize/drop now refresh only the affected widget's owner-local liquidGL geometry, while full recapture stays reserved for background, visibility/topology, window resize, and settings changes. Diagnostics now distinguish local/topology/recapture app-glass refresh reasons.
- Implemented the first liquid-glass performance stage without lowering visual quality: vendored liquidGL now skips empty dynamic-node work, reuses same-size textures with `texSubImage2D`, hoists snapshot-stage geometry reads per render pass, and the app avoids redundant pre-render `updateMetrics()` loops on owner-local/app-glass reuse paths.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`

### 2026-07-01 - Stabilize Windows dev launcher and tmux stale delivery recovery

#### Changed (`src/main.ts`, `vite.config.ts`, `vite.terminal.config.ts`, `scripts/windows-tauri-dev.cmd`)
- Ignored local agent/worklog/temp folders such as `.antigravitycli/` in Vite dev watchers so Windows dev mode does not crash on WSL-mapped directory entries that look like JSON files.
- Added automatic stale-delivery recovery for visible LLM tmux panes: when tmux probe state keeps changing while IDE terminal data stays stale, the app now replaces only the IDE PTY backend and reattaches to the same tmux session instead of killing the LLM process.
- Kept stale-delivery probes active for visible tmux-backed LLM panes even when the diagnostic panel is not open; normal probe logs still respect the debug-log setting, while reconnect start/finish/failure logs are forced for auditability.
- Hardened the Windows Tauri dev `.cmd` launcher against `Program Files (x86)` batch parsing issues and normalized the repo path shown in its startup output.

#### Verification
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `git diff --check`

### 2026-07-01 - Add background apply toggle and clean static terminal glass

#### Context
- Requested: let the real app disable the decorative background that is tuned from the glass settings, and fix the static terminal glass prototypes whose text disappeared after refresh.
- Also requested: remove the static reference card and preempt the square shadow/aura seen around rounded terminal glass surfaces.

#### Changed (`src/main.ts`, `src/styles.css`, local static glass labs)
- Added a `배경설정 적용` toggle to the glass settings. When off, the app hides the decorative IDE background layer, disables glass background grid/noise/wallpaper effects, restores the title/workspace chrome to the normal default dark style, and keeps liquidGL snapshots on a plain safe fallback background.
- Raised the static terminal overlay content above liquidGL mirror/canvas layers and forced its labels visible, matching the earlier workspace/titlebar fix pattern.
- Removed external terminal prototype box-shadows/glow auras so rounded glass cards do not show rectangular shadow artifacts outside their radius.
- Removed the static reference glass card from the glass debug page and workspace virtual lab.
- Reworked the static terminal glass preview into one real-UI-shaped terminal instead of four decorative variants: no visible parent container, codex/claude/shell tabs, tmux green status bar, split shell panes, typing pad, Recall/Paste controls, and detailed static controls for terminal radius, outline, soft outline, padding, chrome, buttons, split panes, tmux bar, and text sizing.
- Updated the static terminal lab so codex and split-shell examples are separate draggable/resizable glass widgets, added a resizable Explorer glass widget beside the workspace dock, and added per-widget GL buttons that open a compact glass settings popover.
- Added a static `topbar text Y` control so glass widgets can test vertical content offsets separately from topbar height; the real app's default topbar layout should still center content automatically with flex alignment.
- Fixed the static workspace container glass toggle by keeping the container plane measurable in layout, hiding it with opacity/visibility when off, raising it above the dock surface but below workspace rows, and logging its visible/opacity/z-index state in the glass diagnostics.
- Restored the static Explorer row hover/selection tint with a dedicated per-row highlight layer and controls for hover color, hover alpha, and active alpha, so future file-hover effects can target individual `.explorer-row` lines.
- Raised the static workspace container liquidGL renderer to sit just below the dock/titlebar stacking layer instead of using the lower row-canvas z-index, and logged the container canvas parent/z-index so the container lens can be distinguished from plain CSS opacity.
- Added a separate static `workspace glass` checkbox so individual workspace row/+ liquidGL lenses can be disabled while leaving the workspace container glass, titlebar/window glass, and terminal/explorer glass enabled for comparison.
- Re-aligned the static workspace container renderer with the working workspace-virtual lab layering: the shell remains above body-level liquidGL canvases, container liquidGL uses a body-level `9996` layer with preserved target opacity, and row inset highlights now derive from row/background/outline/shadow alpha so fully-zero row effects do not leave a faint separator line.
- Moved the static titlebar liquidGL target to an inner glass plane, leaving the title text/window controls as normal overlay content; added a final high-z override for the workspace dock so body-level container/row canvases cannot cover the row text.
- Split the static workspace-container liquidGL renderer from the titlebar-container renderer and added console-backed glass diagnostics (`ccanvas`, `tcanvas`, `containerLenses`, `titlebarLenses`) so the workspace container on/off state can be verified independently.
- Moved the static workspace-container renderer canvas into the workspace dock stacking context at the same layer as the container plane, instead of leaving it behind the whole dock as a body-level canvas; row/content layers remain above it.
- Adjusted the dock-local workspace-container canvas to stay viewport-aligned while living inside the dock stacking context (`position:absolute` with negative dock offset), and expanded diagnostics with `cpos` so placement/opacity can be checked from console logs.
- Put the workspace-container WebGL canvas below the container plane and gave the plane its own frost-derived backdrop blur/tint layer, so container glass on/off is visible even when the WebGL texture is subtle or transparent over a dark background.
- Normalized titlebar and workspace container glass to the same structure: a persistent outer container surface plus an inner liquidGL lens target, keeping container tint/blur from being wiped by liquidGL target initialization.
- Added a separate static `titlebar R` control so titlebar container radius can be tuned independently from workspace row radius.
- Split the static top-glass renderers by stacking context: workspace row/+ lenses now render inside the workspace dock, titlebar button/clock lenses render inside the titlebar, and terminal lenses stay body-level. This keeps glass above container surfaces but below text/content overlays.
- Kept liquidGL hover/tilt mirror canvases on the same local glass layer instead of raising them above overlay content, so workspace/titlebar labels stay visible while top glass tilts.
- Split the static `+` workspace control into a glass lens surface plus an overlay label, matching the titlebar button pattern, so the `+` control keeps its liquidGL surface on hover without sacrificing visible text.
- Ensured newly created hover/tilt mirror canvases for the static `+` workspace lens and titlebar button lenses are immediately re-parented into their local dock/titlebar renderer layer; otherwise liquidGL clears the active lens from the WebGL canvas and the glass appears to disappear while hovered.
- Added static global glass effect controls. Workspace rows, dock container, titlebar container, buttons, and terminal/explorer panes each have a `개별 설정` toggle; when a scope toggle is off, that scope follows the global refraction/bevel/frost/magnify/specular/shadow/tilt/reveal settings and global radius.
- Added a static widget selected-state title highlight for non-workspace widgets. The selected/idle terminal, shell, and explorer examples now color only the title text area instead of the full topbar chrome, with separate controls for selected/idle color, strength, width, padding, radius, and selected widget.
- Added tilt followers for non-workspace glass overlays so titlebar button labels and terminal/explorer/shell content tilt with their glass surface instead of remaining flat while only the lens moves.
- Added global outline settings to the static global glass controls. Scope-level outline controls now follow the global outline color/alpha/width/softness when their `개별 설정` toggle is off.
- Removed fixed inset/glow residue from the static non-workspace title highlight, so selected/idle title highlights leave no visible CSS scar when their strength controls are zero.
- Reorganized the static glass debug settings into grouped cards for background/snapshot source, global glass defaults, per-scope glass overrides, workspace dock/row styling, titlebar/terminal chrome, widget title highlighting, and log output. Added the missing container/titlebar soft-outline controls while grouping.
- Fixed static per-scope custom glass toggles so switching `workspace 개별 설정` and other scope inheritance toggles forces a full liquidGL rebuild/recapture instead of only doing a lightweight option refresh. This makes workspace-specific glass settings immediately override or follow the global glass defaults as intended.
- Split static workspace rows into a hidden inner `.workspace-tab-glass` liquidGL surface plus normal overlay content, so workspace refraction/bevel/frost/magnify/tilt settings affect the actual glass plane instead of being visually buried under the row/text layer. Added workspace glass diagnostics that log custom/global scope values and first-lens options.
- Fixed a liquidGL options-sharing bug in the static lab: liquidGL stores the same options object on every lens in a renderer, so the workspace `+` button lens could overwrite all workspace row lens options with button/global values. Each lens now gets an isolated options object before scope settings are applied, and diagnostics include `liso=1` when isolation is active.
- Added a static `hover row만 glass` experiment for workspace rows. When enabled, all workspace row lenses stay initialized but the row renderer only draws the currently hovered workspace or `+` lens; non-hover rows show the normal CSS row surface, and diagnostics report `hoverOnly` plus active hover lens count.
- Made the hover-only workspace glass experiment respond immediately by tracking the active row in JavaScript, rendering synchronously on pointer enter/leave/move, and forcibly clearing inactive tilt mirror/transform state instead of waiting for liquidGL's default smooth tilt reset.
- Extended the same static row-glass pattern to Explorer file rows: each file line now has an inner liquidGL row plane, separate Explorer row effect/outline controls, and an optional hover-only mode that renders glass only for the currently hovered file row.
- Hid the static terminal/explorer widget corner resize glyphs by default; the resize hit zones remain active and reveal the glyph only when the pointer is near a corner or while resizing, matching the desired future glass-mode behavior for the real app.
- Generalized the static `top glass samples container` toggle so it now applies to glass-over-glass stacks beyond workspace rows: workspace rows sample dock container glass, titlebar buttons sample titlebar container glass, and Explorer file-row glass samples the terminal/explorer panel glass underneath.
- Added a visible Explorer row style overlay for row bg/inset/outline/soft-outline controls, because liquidGL clears the target element background while rendering the WebGL lens; the controls now affect the visible row shell as well as the lens geometry.
- Fixed the static Explorer row off-state: hover-only glass tracking is disabled when Explorer row glass is off, row dividers no longer leave residual top/bottom lines, and hover text/glow fades to neutral when Explorer hover intensity is set to zero.
- Changed the static non-workspace widget selected/idle highlight from a title-text-only box to a full topbar-line overlay. The settings now expose separate selected/idle start/mid/edge alpha and gradient stop controls, plus topbar inset/radius, so the highlight can match the real app chrome without leaving an unwanted rectangular title box.
- Extended the same detailed gradient controls to the existing static workspace normal/selected header highlights as separate workspace-only settings, adding mid alpha plus mid/edge/fade stop controls without sharing the widget topbar highlight settings.
- Added separate static widget topbar highlight top/bottom cut controls in addition to the shared Y inset, so the lower edge of the full-line highlight can be trimmed independently without shifting the whole topbar content.
- Added a static full-glass Profile tab strip above the terminal board. The left workspace dock now stays beside both the Profile strip and terminal area like the real app layout, while the terminal/explorer/shell examples remain below as draggable/resizable widgets.
- Removed the static active prompt-target/focus chips from the terminal and split-shell chrome preview, since that control is planned to be removed from the real app as well.
- Split the static Profile strip into two separate glass surfaces: a connection/profile/root card and a workspace actions/launch card. Removed the `Copy cd` action from both the static preview and the real app toolbar/Explorer context menu.
- Filled the static workspace actions card with the full default workspace-bar button set after `Copy cd` removal: saved workspace controls, shell/Windows shell, Codex/Claude/Grok/Antigravity, panel toggles, reset/status, and ticker add controls.
- Added static full-card glass mockups for the Editor, Image Preview/Paste Target, Calculator, and Browser widgets so their chrome/content can be compared on the same glass board. The widget close buttons and titlebar minimize/maximize/close controls now use macOS-style traffic-light circles in glass mode, with static controls for circle size, circle opacity, and icon opacity.
- Refined the static traffic-light buttons using closer macOS color/border/icon references: titlebar controls now persist after reload even if old saved settings disabled `window buttons glass`, use red/yellow/green order, and show hover-only close/minimize/zoom glyphs.
- Updated the static Editor/Image/Browser mockups for style review: the Editor body is transparent like terminal text-over-glass with sample code, the Image widget shows a small sample image preview, and the Browser mock labels the transparent area as an empty-page placeholder rather than implying loaded webpages should become transparent.
- Compared the static glass board against the app's floating panel list. The static board currently covers Profile/action strip, Workspace dock, Explorer, terminal/codex/shell split, Editor, Image Preview, Calculator, Browser, and Settings; Notes and Snippets remain to be mocked before the board is fully app-complete.
- Added the static right-side Settings panel as a single glass surface that follows the shared terminal/default glass material, with the settings controls rendered as normal overlay content above it.
- Reverted the static titlebar/window/widget close controls from macOS traffic-light circles back to a clean Windows-style square control treatment, with controls for size, gap, radius, background/hover alpha, close-hover red alpha, outline alpha, and icon opacity/size.
- Restored the static titlebar window-control order to the Windows order (`minimize`, `maximize`, `close`) and added a separate hover-highlight overlay so minimize/maximize also visibly highlight above the liquidGL surface.
- Optimized static panel movement/resizing so draggable widget panels and dock width changes only update liquidGL lens metrics and re-render existing canvases instead of recapturing/recreating all glass renderers on every layout change.
- Optimized the static glass lab boot/rebuild path: the page now paints CSS UI first, starts the heavy liquidGL/html2canvas boot during idle time, logs apply timings, switches static renderers to on-demand rendering instead of continuous RAF loops, and disposes liquidGL renderer resize/scroll/WebGL resources when rebuilding.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`
- Local HTML script syntax checks for `.vibe-ide-temp/glass-lab/index.html`, `.vibe-ide-temp/glass-lab/demos/workspace-virtual.html`, and `.vibe-ide-temp/glass-debug/index.html`.

### 2026-06-30 - Fix container-glass sampling and shared text/outline controls

#### Context
- Reported: enabling container glass made the workspace row glasses lose their glass effect, and enabling top-row container sampling made the result worse.
- Also reported: the common/base outline color did not visually apply to selected/captured/+ rows, the `Workspaces` header only exposed size, and agent base text color did not affect visible agent title/activity/meta text.

#### Changed (`src/main.ts`, `src/styles.css`, local static glass labs)
- Container glass now uses an isolated liquidGL renderer/canvas instead of being added to the same global row renderer, so row lenses keep their own material/effect.
- Top-row container sampling now composites the isolated container renderer into a dedicated hidden sample canvas before row recapture.
- Kept the base safe snapshot stage active while container sampling is enabled so the container renderer still has a stable background source.
- Added a `상태별 외곽선 색 사용` toggle. When it is off, active/locked/captured rows and the `+` button all use the common/base outline color and shared outline width/softness.
- Added `헤더 굵기` for the `Workspaces` dock header.
- Agent base text color/weight now cascades to title/activity/meta when the base control is changed, and saved custom base values also apply if detailed colors/weights are still at defaults.
- LLM/agent card base tint, border, and inset highlight now derive from the agent-card background alpha, and the per-LLM top highlight derives from the LLM border alpha. When those controls are set to zero, the faint hidden card boundary disappears in both the app and local static glass labs.
- Split normal tab highlight from selected tab highlight. Both can be independently enabled/disabled and tuned for color, opacity, center/edge strength, size, offset, and radius.
- Added glass controls for agent status labels such as `작업`, `idle`, `대기`, `오류`, and `종료`: shared padding/radius/border/background intensity plus per-status colors. The local static workspace lab mirrors these controls for visual testing.
- Added a static-only prototype for titlebar glass: the full `Simple Vibe IDE` title row and clock use non-reactive/container-style glass by default, while minimize/maximize/close buttons stay separate reactive row-style glass lenses above it. Titlebar container/button styling now reuses the shared container/row settings instead of separate one-off controls, and the lab preserves button text opacity/pointer layers.
- Expanded tmux freeze diagnostics with capture/title/window marker and checksum parse states, probe output size, pane visibility, writer frame/timer ages, backend output char count, and a short `tmux stale-delivery` warning line when tmux changes while IDE-side terminal data is stale.
- Raised/fixed static titlebar button content layers so window button glyphs stay visible above liquidGL canvases/mirrors. The static titlebar buttons now target a separate inner glass plane while the glyph label stays as a non-liquid overlay, so hover/tilt cannot hide the text. The titlebar clock now uses the same row liquidGL material via its own inner glass plane, with only its tilt disabled, and exposes/defaults a clock horizontal padding control so the time glass is not cramped. When titlebar/window-button glass is disabled, the inner glass planes are fully hidden so no faint button-shaped ghost remains.
- Added a static-only 4-way terminal liquid glass comparison board to the glass debug mini app. Each variant uses one whole-card glass plane with terminal text/chrome as overlay content, shares the existing liquidGL effect controls, and can be dragged/repositioned with localStorage persistence.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`
- Local HTML script syntax checks for `.vibe-ide-temp/glass-lab/index.html`, `.vibe-ide-temp/glass-lab/demos/workspace-virtual.html`, and `.vibe-ide-temp/glass-debug/index.html`.

### 2026-06-30 - Trim source-smear experiment and align workspace status previews

#### Context
- Follow-up glass tuning made the source-smear highlight experiment feel unnecessary, while the real IDE still needed the static lab's clearer LLM/header coloring and consistent workspace status-dot previews.

#### Changed (`src/main.ts`, `src/styles.css`, local static glass labs)
- Removed the source-smear highlight controls and source-smear snapshot drawing from the local static glass lab/debug pages. The real IDE did not have the source-smear setting ported.
- Added separate selected-header highlight center/edge strength controls in the real IDE and wired them to the glass highlight gradient.
- Updated the real IDE glass agent cards so LLM/Agy color backgrounds use the same left-to-right fade and right/bleed sizing behavior as the static lab.
- Workspace tabs now always render a status dot; workspaces without an active LLM state use the idle dot for visual consistency.
- Added static preview rows for working, waiting/input-required, done/exited, and plain idle workspace states.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`
- Local HTML script syntax checks for `.vibe-ide-temp/glass-lab/index.html`, `.vibe-ide-temp/glass-lab/demos/workspace-virtual.html`, and `.vibe-ide-temp/glass-debug/index.html`.

### 2026-06-30 - Fill missing glass container and status-dot controls

#### Context
- Follow-up testing found that some static glass-lab controls were still missing from the real IDE popup, especially container glass on/off and whether top workspace rows sample the container glass result.
- The LLM working status dot also lost the old soft green pulse in workspace glass mode, and capture-blocked/applied workspace examples needed to prove that the dot remains visible.

#### Changed (`src/main.ts`, `src/styles.css`)
- Added real IDE controls for container glass lens on/off, top-row container sampling, container glass background/outline, row height, header/pill text, control padding/slot, detail/agent padding, agent badge sizing, LLM status-dot position, and working pulse tuning.
- Added a workspace container glass plane and a separate container snapshot stage so workspace rows can optionally refract either the plain IDE background or the container-glass result.
- Restored configurable working-dot pulse in side-dock glass mode and kept explicit protected/capture-applied LLM dots visible.
- Updated local static glass labs with working-dot pulse controls and capture-blocked working examples.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`
- Local HTML script syntax checks for `.vibe-ide-temp/glass-lab/index.html`, `.vibe-ide-temp/glass-lab/demos/workspace-virtual.html`, and `.vibe-ide-temp/glass-debug/index.html`.

### 2026-06-30 - Port latest static glass tuning controls into the app

#### Context
- Requested: take the latest static workspace/liquid glass tuning options and apply them to the real IDE app, then review the settings for missing wiring.

#### Changed (`src/main.ts`, `src/styles.css`)
- Expanded liquidGL effect ranges in the app to match the static lab: wider refraction, bevel depth, and bevel width controls.
- Added shared workspace row outline controls with common width/softness and separate colors for normal, active, locked, and captured rows.
- Added separate selected highlight color so the header highlight can be tuned independently from the selected accent/fill.
- Added LLM/Agy agent-card color gradient controls: per-agent colors, background/border alpha, left/right/top/bottom sizing, left/right bleed, radius, and overflow toggle.
- Added LLM status-dot color/size/glow/label-padding controls for glass side docks.
- When a wallpaper/custom background image is selected, the procedural base/mid/end background no longer tints the image behind it; only explicit overlays such as grid/noise remain controlled by their own settings.
- The side-dock `+` glass button now follows the shared row outline width/soft outline variables.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`
- Local settings wiring review found 141 glass controls across 11 sections with no duplicate paths.

### 2026-06-30 - Refine workspace glass dock controls and probe reliability

#### Context
- Follow-up glass testing showed selected workspaces could receive both the legacy workspace highlight and the new glass highlight, plus-button glass did not tilt, noise controls were hard to verify, and container blur could visually soften the liquidGL rows.
- The new tmux freeze probe also failed in the real app because the checksum helper used an `awk` command whose field references were stripped before execution in that environment.

#### Changed (`src/main.ts`, `src/styles.css`, `src-tauri/src/lib.rs`, `docs/USER_GUIDE.ko.md`)
- In side-dock glass mode, legacy active workspace border/title highlighting is suppressed so glass highlight/rail/badge are the only selected-state visual.
- The side-dock `+` button now uses the same liquidGL tilt settings as workspace rows.
- Added an explicit IDE background noise on/off setting and made noise size/contrast visibly affect the procedural noise CSS.
- Side-dock rows keep full width without reserving a permanent scrollbar gutter, including when glass is disabled.
- Capture lock buttons now color only the lock/capture icon in both glass and non-glass modes, without the old yellow/green button background.
- Capture-applied rows keep their capture outline in glass mode; normal/protected rows respect the configured glass outline alpha.
- Selected glow and rail glow now default to zero, and the capture-applied row uses a crisp outline without a baked-in blur glow. This keeps CSS decoration separate from the liquidGL `shadow` option.
- Dock/container blur now renders on a separate container surface layer instead of applying `backdrop-filter` on the parent, so it does not blur the liquidGL row canvases underneath.
- Added a separate container surface opacity setting and auto-hide the container surface when bg, blur, and saturation are neutral, so setting the container to zero returns to the original background instead of leaving a faint compositor haze.
- Glass settings and Diagnostics log popovers can be dragged by their header.
- Replaced the tmux probe checksum `awk` calls with a shell `read` helper so the probe no longer fails with `awk: ... printf ..., ,`.
- Updated the local static glass labs so the workspace tuner includes a same-effect reference card, migrates old default selected glows to zero, exposes dock surface opacity/bg/blur/saturate, and the mini app supports custom background image upload/URL/fit for faster visual comparisons before rebuilding the IDE.

#### Verification
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Local tmux smoke confirmed the checksum helper emits tab-delimited checksum/byte rows without `awk`.

### 2026-06-30 - Add privacy-safe tmux freeze probes

#### Context
- Reported: when an IDE-launched tmux LLM pane appears frozen, the existing terminal watchdog and title-poll logs can say the pane was refreshed but still do not reveal whether tmux content itself is changing.

#### Changed (`src-tauri/src/lib.rs`, `src/main.ts`, `src/api.ts`, `src/types.ts`, `docs/USER_GUIDE.ko.md`)
- Added a backend `llm_tmux_pane_probe` command for IDE-managed WSL/SSH tmux sessions.
- When Diagnostics log is enabled, visible tmux-backed LLM panes now emit compact `terminal: tmux probe` records with tmux pane state, command/pid, activity/history, checksum+byte summaries for recent capture/title/window data, and IDE-side data/refresh/write backlog ages.
- The probe intentionally does not log raw terminal output, pane titles, clipboard, file contents, env values, or secrets; checksums are only for change detection.

#### Expected debugging signal
- `cap` changing while `dataAge`/`refreshAge` stay old points toward IDE/PTY delivery or render-path stalls.
- `cap`, title/window checksums, and session activity staying fixed points more toward the tmux pane/process itself being idle or stuck.
- Nonzero `pending`/`writes` points toward a frontend xterm write backlog.

#### Verification
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Local tmux smoke confirmed the probe format returns tab-delimited metadata plus checksum/byte lines without raw pane contents.

### 2026-06-29 - Add workspace liquid glass and IDE background tuning

#### Context
- Requested: port the static liquidGL workspace experiment into the real app, with IDE background selection and per-workspace glass settings available from an in-app floating popup.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`, `docs/GLASS_WIDGETS.md`, `docs/THIRD_PARTY_NOTICES.md`, `public/vendor/liquidgl/*`)
- Added a decorative IDE background layer with selectable presets, custom image upload/URL, light/noise tuning, and persistence in IDE settings.
- Added a `Glass` popup for left/right workspace dock that controls workspace row liquidGL on/off, effect parameters, dock/container shell styling, row radius/padding, text/icon styling, selected highlight/rail/badge styling, and background tuning.
- Real liquidGL is applied per `.workspace-tab` row instead of to the entire dock, so individual workspaces can tilt independently.
- The app now follows the static demo structure more closely: each `.workspace-tab` row is the liquidGL target, the safe snapshot stage contains only the IDE background, and the real workspace row DOM is kept visible above the lens so text/icons stay sharp instead of being refracted from a cloned dock texture.
- The side workspace dock shell stays transparent like the static lab; only a subtle outline remains around the group so the individual workspace rows own the visible glass.
- The side dock `+` button now also receives the same glass material, but its liquidGL tilt is forced off.
- The vendored liquidGL copy has a local `preserveTargetOpacity` option used by workspace glass so rows do not stay blank if snapshot/reveal is delayed.
- The top IDE chrome now lets the decorative background continue behind the `Simple Vibe IDE` titlebar/workspace controls with a light translucent blur, giving the app a more seamless future-friendly shell.
- The global liquidGL canvas and liquidGL hover mirror/shadow overlays are moved under `.shell`; the side dock itself is raised as a transparent stacking layer above those canvases, so row-shaped glass stays behind the real labels/icons even during tilt. Diagnostics log emits compact `glass` entries with canvas/mirror parent and z-index, dock/shell z-index, label hit-test, target opacity, and label metadata.
- In glass side-dock mode the workspace resizer remains an absolute high-z hit target, and the workspace list no longer reserves a permanent scrollbar gutter so row widths line up with the glass `+` button.
- Dock/container shell settings were added separately from row glass settings: padding, gap, background alpha, blur, saturation, side border, outline alpha/inset/radius, shadow, header opacity, and header pill background can be tuned while keeping the default static-demo-like transparent shell.
- The liquidGL snapshot target is the safe `#ide-glass-snapshot-stage`, not terminal/browser/editor content.
- Added docs describing supported glass scope and why terminal/browser widgets need separate compositor-safe approaches.

#### Verification
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Guard Codex done alerts during tmux scrollback

#### Context
- Reported: while Codex was still working inside an IDE-launched tmux session,
  scrolling up/down in the terminal could make the workspace briefly look idle
  and send a false "finished" alert.

#### Changed (`src/main.ts`, `src-tauri/src/lib.rs`, `src/api.ts`, `src/types.ts`)
- Codex tmux status-line parsing now ignores `Ready`/idle candidates from the
  tmux-painted title fallback. Direct OSC/window-title updates are still allowed;
  the guard only blocks stale tmux status repaints from overriding active work.
- Added a direct tmux pane-title query path for IDE-launched Codex tmux
  sessions. While a Codex title-based working state is active, the frontend asks
  the backend for `#{pane_title}` from tmux itself and treats that as trusted
  title state, independent of terminal scrollback/copy-mode redraws.
- While the terminal is actually viewing xterm scrollback or the terminal
  history overlay, title-expiry completion is deferred and re-checked instead
  of relying on one fixed short timeout.
- A short wheel-time fallback remains for tmux mouse/copy-mode redraws where
  xterm cannot prove whether the viewport is still scrolled back.
- Diagnostics log records when a stale Codex tmux idle title is ignored or a
  title idle/expiry is deferred after scrollback activity.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Local tmux smoke confirmed `tmux display-message -p '#{pane_title}'` follows
  OSC 2 title changes from `SVI_PROBE_WORKING` to `Ready`.

### 2026-06-28 - Make agent alert banners clickable and minimal

#### Context
- Requested: clicking an agent alert should jump directly to the relevant
  workspace/LLM, the banner should use the app icon, and banner text should only
  say which workspace/LLM needs input or finished.

#### Changed (`src/main.ts`, `src-tauri/src/lib.rs`, `docs/USER_GUIDE.ko.md`, `public/icon.png`)
- Real agent status alerts now use a frontend clickable Web Notification first,
  with the Simple Vibe IDE app icon and a click handler that focuses the app,
  activates the target workspace, and selects the target LLM pane when it still
  exists.
- If the clickable frontend notification fails, the existing backend native
  banner path remains as a fallback.
- Sound continues to use the backend native alert path and remains independent
  from banner display.
- Agent alert title/body are now intentionally minimal: LLM + state in the title
  and workspace name in the body. Pane title, cwd, and activity text are not
  included.
- Windows tray balloon fallback now tries to reuse the main window/class icon
  before falling back to the generic system application icon.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

### 2026-06-28 - Add Grok Build hook bridge

#### Context
- Grok Build title/OSC status is useful but not enough for precise
  `working`/`waiting`/`done` detection, especially because plan/question screens
  can still show spinner-like activity.
- Actual Grok hook testing showed Grok 0.2.67 emits snake_case event names such
  as `session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`,
  and `stop`.

#### Changed (`src/main.ts`, `src-tauri/src/lib.rs`, `docs/USER_GUIDE.ko.md`)
- Added `Set` -> `Agent event bridge` -> `Grok hooks` with ask / auto / off.
- When launching Grok in a WSL workspace, Simple Vibe IDE can install/update
  `~/.grok/hooks/simple-vibe-ide.json` and
  `~/.grok/hooks/simple-vibe-ide-hook.sh`.
- The global Grok hook stays inert unless the IDE launches Grok with temporary
  `SVIDE_AGENT_*` bridge env vars; no port/token is stored in the hook files.
- The hook posts only compact metadata to the local bridge
  (event/session/cwd/toolName/timestamps/truncation flags), not prompt text or
  tool input/output bodies.
- The backend now canonicalizes Grok snake_case hook names to the existing
  PascalCase bridge event names and maps Subagent/compact events to status.
- Grok hook events now drive working/done/error status, while Grok title/output
  can still supplement question/approval waiting detection without letting idle
  title text prematurely end a hook-tracked turn.

#### Verified (repo-side only)
- Created a temporary global Grok hook and confirmed real headless Grok emitted
  `session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, and
  `stop` payloads.
- Ran a local bridge smoke test and confirmed the final hook script shape posted
  five compact events to `/agent-event?agent=grok&session=...`.
- Temporary test hook files were removed afterward.
- `npm run check`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### 2026-06-28 - Add in-app diagnostics log popup

#### Context
- Reported debugging pain: terminal/tmux freeze, agent status transitions, and
  notification banner failures are hard to diagnose from screenshots alone.
- A lightweight debug-mode log panel can let the user copy event metadata back
  to the agent without exposing raw terminal output or secrets.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Added `Set` -> `Diagnostics log` with enable, open, copy, and clear actions.
- The log is a local ring buffer and is off by default.
- A small previous-session heartbeat is persisted so a force-close/freeze can be
  reported on the next launch as an unclean shutdown breadcrumb with the last
  heartbeat/event time.
- Captured events include terminal render watchdog refreshes, visible pane
  flushes, agent status/source transitions, hook bridge events, alert requests,
  and memory-saver sleep decisions.
- Renderer watchdog recovery notices are forced into the diagnostic log even if
  general diagnostic capture is off.
- Log text is sanitized/truncated and intentionally avoids raw terminal output,
  clipboard text, file contents, tokens, and env values.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Add visible terminal render watchdog

#### Context
- Reported: tmux panes can look frozen until the user clicks/triple-clicks the
  terminal, even when the underlying session has continued.
- Memory Saver is unlikely for the active workspace because it never sleeps the
  currently active workspace; the symptom matches stale xterm write/render
  flush more closely.

#### Changed (`src/main.ts`)
- Visible terminal output now records recent data time and schedules a short
  render watchdog.
- The watchdog cancels a stale visible `requestAnimationFrame` write flush,
  flushes pending output, and forces an xterm viewport refresh for recently
  received data.
- Workspace activation/resume now flushes and refreshes all visible panes in the
  active terminal split group, not only the widget's single active pane.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Fix done alerts on working timeout expiry

#### Context
- Reported: a workspace visibly changed from `작업중` to `idle` while viewing
  another workspace, but no Windows/sound alert fired.
- Follow-up concern: `Prompt sent` / temporary UI working should not be treated
  as a real completed job, or simply typing/submitting a prompt could create a
  false done alert when the short activity window expires.

#### Changed (`src/main.ts`)
- Alert transition detection now treats a recently expired raw `working`
  progress record as previous `working` when the next state is `idle`/`exited`.
- This fixes the timeout-driven path where `effectiveAgentSessionStatus()` had
  already converted the previous record to `idle` before the alert predicate ran.
- Added done-alert eligibility flags to agent progress records.
- `Prompt sent`, launcher startup, and generic heuristic working are excluded
  from done alerts.
- Codex/title working can fire a done alert on a short title-expiry transition.
- Claude/hook working can fire a done alert only on an explicit hook transition
  such as `Stop`/`SessionEnd`; hook working timeout alone does not fire done.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Auto-update saved workspace layouts

#### Context
- Reported: after pressing `Save WS` once, later panel/widget layout changes are
  easy to forget to save manually, so restarting can load an older saved layout.

#### Changed (`src/main.ts`, `docs/USER_GUIDE.ko.md`)
- Saved workspace entries now keep a lightweight link from the live workspace
  snapshot to the saved entry.
- When a linked live workspace snapshot changes, the matching saved workspace is
  automatically updated in place instead of requiring another manual `Save WS`.
- A 30-second safety timer also snapshots the active workspace, and hiding the
  app flushes a snapshot, so missed UI-save triggers are less likely.
- Existing saved workspaces are linked lazily when the open workspace name,
  profile, and root match the saved entry.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Tighten tmux launcher/runtime status follow-up

#### Context
- Reported: a freshly rebuilt app still appeared to type the old tmux launch
  command shape (`env ... 'claude' ...`) and some Claude sessions still exposed
  the non-demo account identity.
- Reported: Codex in another workspace could remain `작업중` after the turn had
  already finished, then flip to idle only after clicking that workspace.
- Reported: the LLM widget `Tmux` and `+` buttons still looked misaligned.

#### Changed (`src/main.ts`, `src/styles.css`)
- Bumped the typed POSIX LLM launcher marker to `__svi_launch_v=5`; a pasted
  launch command without this marker is from an older built runtime.
- Claude local hook setup now also keeps `.claude/settings.local.json` `env`
  current for the safe `IS_DEMO` passthrough, so Claude itself gets demo/privacy
  mode even if shell alias expansion differs.
- tmux status-line title detection now stops extending a Codex `working` state
  when the exact same quoted working title repeats for more than a short stale
  window. A changing spinner still refreshes normally.
- Terminal `+` no longer inherits the global tab-add button class, and both LLM
  tab controls share explicit button box styling.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`
- Local shell/tmux smoke confirmed an alias-based `claude` launch can still set
  `IS_DEMO`.

### 2026-06-28 - Preserve Claude aliases for demo/privacy env

#### Context
- Reported: manually entering tmux then running `claude` hid the email, but the
  IDE-created tmux Claude session still showed it, so `IS_DEMO`/privacy launch
  customization was not actually equivalent.
- Also reported: Claude hook install prompt appeared again even after the local
  hook was already installed.

#### Changed (`src/main.ts`, `.gitignore`, `docs/USER_GUIDE.ko.md`)
- POSIX LLM launch now builds a shell-quoted launcher command and runs it via
  `eval`, with env assignments before the command name. This keeps safe env
  passthrough while allowing user `claude` aliases/functions/wrappers to expand.
- tmux LLM launch now starts `bash -ic` with that launcher command, so tmux
  sessions also source normal interactive shell customizations before launching
  Claude/Codex/Grok/Agy.
- `Ask` mode for Claude hooks now checks whether the Simple Vibe IDE local hook
  is already present; if it is, launch continues without asking again.
- Ignored the generated local Claude hook files so the public repo does not
  accidentally track workspace-local hook configuration.

#### Verified (repo-side only)
- `npm run check`
- `git diff --check`
- Local shell smoke confirmed an alias-based `claude` launch can set `IS_DEMO`
  through the new launcher shape.

### 2026-06-28 - Restore Codex working detection inside tmux

#### Context
- Reported: Codex sessions stayed `idle` / `Prompt sent` even while the model
  was visibly working, including in a newly created tmux session.
- Root cause verified with a synthetic tmux PTY smoke: tmux did not forward the
  inner app's OSC title to the outer xterm stream. Instead it repainted the app
  title inside its status line, e.g. a quoted `Thinking`/spinner segment. The
  previous Codex title-only patch was looking only at OSC/onTitleChange signals,
  so tmux-backed Codex never refreshed `working`.

#### Changed (`src/main.ts`, `src/styles.css`)
- Codex remains title-only, but tmux status-line title text is now treated as a
  title signal. Generic Codex terminal output is still not used as fallback.
- OSC title parsing now also accepts OSC 1 in addition to OSC 0/2.
- Codex title classifier recognizes more spinner glyphs and a few direct
  waiting-title phrases.
- Matched the LLM widget `Tmux` and `+` button margins/font sizing so the two
  controls line up consistently.

#### Verified (repo-side only)
- `npm run check`
- `git diff --check`
- Synthetic tmux PTY smoke confirmed a quoted spinner title can be extracted
  from tmux status output.

### 2026-06-28 - Remove pinned Notes yellow outline

#### Context
- Reported: a Notes widget could show a yellow outer border while not selected.
- Root cause: the Notes `Pin` state intentionally added a yellow box shadow,
  which looked like a stale selection/focus outline.

#### Changed (`src/styles.css`)
- `Pin` now only keeps Notes above other widgets. It no longer changes the
  widget outer border/shadow color.
- Active widget indication still comes from the normal focus border/title
  settings.

#### Verified (repo-side only)
- `git diff --check`

### 2026-06-28 - Add Claude hook bridge and safe tmux env passthrough

#### Context
- Planned: keep Codex status title-only, but improve Claude status by using
  Claude Code local hooks when available.
- Reported: Claude launched through Simple Vibe IDE's tmux path did not inherit
  benign local environment such as `IS_DEMO=1`, so demo/privacy mode could
  differ from a manually typed shell launch.

#### Changed (`src/main.ts`, `src/api.ts`, `src/types.ts`, `src-tauri/src/lib.rs`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Added a token-protected local Agent Event Bridge in the Tauri backend. It
  accepts small hook JSON events and emits `agent-bridge-event` to the frontend.
- Added `Set` -> `Agent event bridge`:
  - Claude hook mode: ask / auto / off.
  - tmux env passthrough allow-list, defaulting to `IS_DEMO`.
- WSL Claude launches can install/update workspace-local
  `.claude/settings.local.json` and `.claude/simple-vibe-ide-hook.sh`. The hook
  script contains no port/token; those are injected only into the launched
  Claude process environment.
- Claude hook events now drive `working` / `waiting` / `idle` / `error` /
  `exited` workspace agent status with `hook` source precedence. Once a pane
  receives hook events, title/output heuristics no longer override it.
- POSIX LLM launcher commands now wrap tmux/direct launches with `env
  "${__svi_env_args[@]}" ...`, so safe allow-listed env vars such as `IS_DEMO`
  survive tmux process startup without printing their values in the typed
  command.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`

#### Needs real Windows/WSL smoke
- Confirm WSL Claude hook events reach the backend and update workspace detail
  status while another workspace is active.
- Confirm `IS_DEMO=1` or another safe non-secret env var is visible to a newly
  launched Claude tmux session.

### 2026-06-28 - Improve Type pad recovery, workspace dock UI, and alert fallback

#### Context
- Reported: pasting from Type pad into tmux-backed sessions can appear to drop
  text when the shell/CLI is not ready for cursor input.
- Reported: side workspace active-title highlighting looked segmented around
  the lock/copy/close buttons, and expanded LLM detail cards were hard to
  distinguish from each other and from the next workspace.
- Reported: `Banner` alert test logs showed permission granted and backend OK,
  but no visible Windows banner.

#### Changed (`src/main.ts`, `src/styles.css`, `src/api.ts`, `src/types.ts`, `src-tauri/src/lib.rs`, `docs/USER_GUIDE.ko.md`)
- Type pad paste now explicitly returns focus/keyboard ownership to the active
  shell before writing the paste payload.
- Added a runtime-only Type pad `Recall` button that restores recently pasted
  Type pad text, so swallowed text can be recovered without retyping.
- Workspace tab controls now sit inside one header row, so active title
  highlighting paints as one consistent block instead of per-button segments.
- Expanded side-dock workspace detail now has stronger spacing/dividers, and
  LLM cards use cheap status-colored left accents plus compact styling. Agent
  cards now also get subtle agent-specific backgrounds/top accents so Codex and
  Claude rows are easier to distinguish.
- LLM widget `Tmux` and `+` buttons now share an explicit fixed width as well
  as height/padding, preventing the controls from visually drifting apart.
- Codex `Model interrupted to submit steer instructions` output is treated as
  explicitly not-waiting, and clearly-active/not-waiting output now clears stale
  waiting buffers before older prompt text can re-trigger `대기`.
- LLM title/status detection now recognizes Simple Vibe IDE tmux session prefixes
  such as `svi_<workspace>_codex_1:` and also tests a stripped title candidate,
  so tmux-backed tabs can still drive Codex/Claude/Grok status indicators.
- Ambiguous background terminal output no longer starts a new `working` state by
  itself. It can only extend that same pane's existing working window; explicit
  active-work text or title signals are required to start working. This avoids
  prompt/footer repaints in other workspaces briefly flipping to `작업중`.
- Mouse-wheel scrolling inside tmux-backed LLM terminals now briefly suppresses
  LLM title/output detection, so tmux copy-mode/scrollback redraws containing an
  old approval prompt do not flip the workspace into `대기`.
- Codex status is now title-only: OSC/window-title signals drive Codex
  `working`/`waiting`/`idle`, while terminal output is no longer used as a
  Codex fallback. Manually typed `codex` still registers the pane, but ongoing
  status comes from title changes to avoid tmux scrollback false positives.
- Windows agent alert banners now also try a native tray balloon fallback after
  the Tauri notification plugin path. The debug log reports plugin/tray results.
- Added a backend-native `Banner 5s` delayed alert test button so Windows
  background delivery can be tested without relying on a WebView timer after the
  click. Real LLM-triggered alerts also write request/OK/FAILED debug lines, so
  status-event failures and Windows banner-delivery failures are distinguishable.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`

#### Needs real Windows smoke
- Confirm `Banner` test shows either a normal notification or tray balloon while
  another app has focus.
- Confirm Type pad `Recall` recovers a swallowed tmux paste without persisting
  the text after app restart.

### 2026-06-28 - Add workspace detail privacy controls

#### Context
- Reported: side workspace detail cards can reveal path/folder text too
  prominently, and capture-blocked workspaces should have a compact option that
  hides non-essential detail rows.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Added `Set` -> `Workspace detail content` toggles:
  - `Show activity/title line`
  - `Show path/source line`
  - `Hide both extra lines on capture-blocked workspaces`
- Capture-blocked workspace detail cards now default to hiding the activity and
  path/source rows, while still showing the agent badge/name/status row.
- Reduced the activity/title detail row typography to match the smaller
  path/source row so it reads as secondary information.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Polish LLM toolbar and alert diagnostics

#### Context
- Reported: in LLM terminal widgets, the `Tmux` button and `+` button had
  visibly different sizing.
- Reported: active workspace highlighting was too subtle compared with active
  widget title highlighting.
- Reported: native alert test sound plays, but Windows banner output still is
  not visible; the Settings panel needed a clear diagnostic trail.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Matched the LLM widget `Tmux` and `+` button height, padding, alignment, and
  tab-shaped radius.
- Strengthened active workspace blue border/title highlighting. The title
  highlight now uses the same blue as active widget title bars, while protected
  workspace title highlights keep stronger amber/green variants.
- Added an inline `Agent alerts` debug log below the `Test native path`
  buttons. Test clicks now record permission checks, backend
  `send_agent_alert` OK/FAILED results, elapsed time, and a warning when the OS
  may have hidden or blocked the banner despite a successful backend call.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Add numbered LLM tmux sessions and picker

#### Context
- Requested: LLM launcher buttons should usually create a new tmux-backed
  session instead of attaching to the one saved workspace+agent tmux session.
- Requested: still make it easy to open or kill a specific existing tmux
  session from the LLM widget.

#### Changed (`src/main.ts`, `src/api.ts`, `src/types.ts`, `src-tauri/src/lib.rs`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- WSL/SSH LLM launcher buttons now allocate numbered workspace+agent tmux
  sessions such as `svi_<workspace>_codex_1`, `_2`, `_3`.
- LLM terminal widgets now show a `Tmux` button beside `+`; it lists existing
  sessions for that agent, can attach one as an additional tab, and can kill a
  session after confirmation.
- The LLM widget `+` button now opens a new numbered tmux session for the same
  agent. Plain shell widgets keep the old plain-shell `+` behavior.
- Terminal tab `x` still closes only the IDE tab/PTY; tmux session kill is
  explicit from the `Tmux` menu.
- Workspace snapshots now persist the tmux session name for LLM panes so restore
  reattaches the same session; older snapshots still attach the legacy
  workspace+agent session name.

#### Verified (repo-side only)
- `npm run check`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### 2026-06-28 - Polish workspace dock detail indicators

#### Context
- Reported: when a left/right workspace dock detail row is expanded, the LLM
  status dot is vertically centered against the full expanded card instead of
  staying beside the workspace title row.
- Requested: make the active workspace selection indicator configurable like
  active widget indicators.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- In side workspace docks, the LLM status dot is now anchored to the first
  30px title row, so it stays beside the workspace name when detail is open.
- Added `Set` -> `Active workspace indicator`:
  - `Blue outer border`
  - `Highlight tab title`
- The two active-workspace indicators are independent and persisted in IDE
  settings.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-28 - Route agent alerts through native backend

#### Context
- Reported: agent notification banners and light sound alerts did not fire
  while another program had focus; clicking back into the IDE later could play
  a delayed short sound.

#### Changed (`src/main.ts`, `src/api.ts`, `src/types.ts`, `src-tauri/*`, `docs/USER_GUIDE.ko.md`)
- Added a backend `send_agent_alert` command that emits Tauri desktop
  notifications and plays the light alert from native Rust/Windows code.
- Removed the WebAudio oscillator alert path, so background alerts no longer
  wait for the next WebView user activation/focus click.
- Added `Set` -> `Agent alerts` -> `Test native path` buttons for `Banner`,
  `Sound`, and `Both`. These bypass LLM status detection and call the same
  backend alert command directly.
- Frontend alert throttling, privacy-capped alert text, and independent
  banner/sound toggles are preserved.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`

#### Needs real Windows smoke
- Confirm the banner appears while another app is focused.
- Confirm the native beep plays immediately on `waiting`, `error`, and
  completion transitions.
- Use the `Test native path` buttons first to distinguish native Windows/Tauri
  alert delivery from LLM status-detection failures.
- If banners still do not appear, check Windows notification/Do Not Disturb
  settings for the app.

### 2026-06-27 - Stabilize workspace agent detail and tmux launchers

#### Context
- Requested: fix false `대기` after workspace resume, make side-dock agent
  detail expandable per workspace, reduce detail flicker, and keep LLM button
  sessions alive through app rebuilds when `tmux` is available.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Snapshot/replay terminal output no longer drives LLM `waiting`/`working`
  detection, so old approval prompts restored from scrollback do not mark a
  workspace as waiting.
- Live title/output/input detection still drives actual `waiting`, including
  live choice/question prompts.
- Side workspace dock detail now renders inline under each workspace row.
- Each workspace has an independent runtime detail toggle, and the dock `Detail`
  button now expands/collapses all workspace details.
- Agent detail rendering is throttled and title-spinner activity is normalized
  to reduce flickering text while a CLI is working.
- POSIX LLM launchers now use `tmux new-session -A` with a workspace+agent
  session name when `tmux` exists, and fall back to direct launch otherwise.
  Windows profiles keep the existing direct launcher path.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

#### Needs real Windows/WSL smoke
- Confirm resume no longer shows stale `대기` from old scrollback.
- Confirm live request/choice prompts still switch to `대기`.
- Confirm WSL/SSH LLM buttons attach/reuse the expected tmux session, and no-tmux
  shells fall back to direct launch.

### 2026-06-27 - Add opt-in agent notification alerts

#### Context
- Requested: add configurable Windows notification banners for LLM sessions that
  appear to need user input or have finished, and add a separate lightweight
  sound alert toggle.

#### Changed (`src/main.ts`, `src/styles.css`, `src-tauri/*`, `package.json`, `package-lock.json`, `docs/USER_GUIDE.ko.md`)
- Added Tauri notification plugin wiring and `notification:default`
  capability.
- Added `Set` -> `Agent alerts` toggles:
  - `Windows notification banners`
  - `Light sound alert`
- Agent progress transitions now trigger alerts for `waiting`, `error`, and
  `working -> idle/exited` completion.
- Banner and sound toggles are independent. The first implementation used a
  short WebAudio beep; this is superseded by the 2026-06-28 native backend
  alert path above.
- Alert text is based on capped/sanitized agent progress summaries and does not
  persist raw transcript content.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

#### Needs real Windows smoke
- Superseded by the 2026-06-28 native backend alert smoke items above.

### 2026-06-25 - Add frontend workspace agent activity dock

#### Context
- Requested: implement the prepared Helm-inspired workspace activity plan so
  side workspace docks can show which LLM sessions are working, waiting, idle,
  errored, or exited without storing raw transcripts.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`, `docs/designs/workspace-agent-activity-dock.md`)
- Added runtime-only `AgentSessionProgress` tracking per terminal pane.
- Existing launcher, terminal title, terminal output, prompt input, cwd/title
  rename, and backend-exit paths now update normalized agent state.
- LLM shell startup failures mark that agent session as `error` instead of
  looking idle.
- Workspace tab aggregate priority now uses session progress first:
  waiting, error, working, idle, exited, then none.
- Left/right workspace dock `Detail` now shows active-workspace agent cards with
  agent badge, status chip, shell title, cwd/source, recent activity, and click
  to focus the matching shell.
- Detail data is capped/sanitized and kept in memory only; structured
  todo/tool/context sources remain a future backend watcher task.
- High-volume LLM output keeps extending the working window with a short
  fast-path throttle so the xterm write path does not rebuild/sanitize/render
  agent progress for every output chunk.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

#### Needs real Windows smoke
- Confirm the side dock cards update from real Claude/Codex/Grok title changes
  while another workspace is active.
- Confirm click-to-focus returns to the correct shell after workspace switching.

### 2026-06-24 - Normalize widget titlebars and show terminal renderer state

#### Context
- Requested: show the terminal renderer status directly in the shell titlebar
  after the WebGL/DOM renderer investigation.
- Requested: make titlebar controls such as `Op`, `Hist`, `Type`, and
  `Focus: ...` use consistent font/button sizing, and make one-line widget
  titlebar heights consistent across Editor, Image Preview, shell, and other
  widgets.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Shell titlebars now show a small renderer badge: `GL`, `DOM`, `GL?`, or
  `GL!` for WebGL active, DOM selected/fallback, startup pending, or WebGL
  context-loss fallback.
- Terminal WebGL context loss now updates the visible badge immediately.
- Widget titlebar height and titlebar control sizes now share CSS variables,
  so titlebar buttons/selects/checkbox labels align to the same one-line
  baseline.
- Floating-panel and terminal widget grid rows now use the same titlebar height
  variable; wrap mode can still grow titlebars when enabled.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-24 - Add configurable workspace tab dock

#### Context
- Requested: prepare the workspace tab UI for future Helm-like LLM activity
  details by allowing workspace tabs to move to top, bottom, left, or right.
- Left/right should reserve real layout space, be resizable, and keep widgets
  from being hidden underneath the dock.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- IDE Settings now stores global workspace tab placement, side dock width, and
  side dock detail visibility.
- Top remains the default and keeps the previous compact tab bar layout.
- Bottom uses the same compact tab bar at the lower edge of the IDE chrome.
- Left/right use a true side dock that pushes the main workspace area instead
  of overlaying it.
- Side dock resizing updates a CSS variable during drag and persists on release.
- Vertical workspace reorder now uses the pointer Y midpoint; horizontal tabs
  keep the existing X midpoint behavior.
- Added a placeholder detail panel and render hook for later LLM progress UI
  without implementing log/hook-based LLM status details yet.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

#### Needs real Windows smoke
- Confirm native Browser WebView bounds do not overlap the side dock while
  switching dock positions or resizing left/right docks.
- Confirm terminal fit/IME behavior remains stable after dock changes.

### 2026-06-23 - Keep new workspace tabs truly blank

#### Context
- Reported: clicking workspace `+` could create a tab that partially inherited
  the previous workspace. Choosing a profile/path from that tab then made the
  clicked tab disappear and opened a different new workspace.
- Reported: long workspace tab names correctly ellipsized visually, but
  hovering the visible label showed the generic "Open workspace..." tooltip
  instead of the full workspace name.
- Reported: workspace LLM status dots could disappear for older/manual
  Codex/Claude panes, and working/waiting state could fail to propagate while
  viewing a different workspace.

#### Changed (`src/main.ts`)
- `createBlankWorkspaceTab()` now inserts the blank snapshot but keeps the
  previous workspace active until `closeWorkspace()` finishes tearing down the
  previous live UI.
- This prevents `closeWorkspace()` snapshot flushing from writing the old
  profile/root/panels into the new blank workspace id, and avoids clearing the
  previous workspace's capture-protection flag during that flush.
- The blank tab is activated only after teardown, so the next profile/path
  selection can fill that same tab.
- Workspace tab label tooltips now mirror the full workspace tab tooltip, so
  ellipsized labels reveal the full name/root/status on hover.
- Terminal panes now have a runtime-only detected LLM id for manual/older
  Codex/Claude/Grok/Antigravity sessions. This drives indicators and
  waiting/working detection without saving inferred sessions as launcher-owned
  restore state.
- Raw terminal OSC 0/2 title updates are parsed before xterm write flush, so
  background workspace LLM title changes can update the workspace tab dot even
  when that workspace's terminal widget is hidden.
- Follow-up: raw title parsing now also accepts C1 OSC/ST sequences, and
  background known-LLM panes can mark activity from meaningful non-idle output
  even when a CLI version does not expose a recognizable title/progress pattern.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-22 - Fix widget bottom-edge resize consistency

#### Context
- Reported: Explorer, shell widgets, and notes could stop short of the visible
  workspace bottom while Editor/Image Preview could resize to the bottom edge.

#### Changed (`src/styles.css`)
- Removed the fixed `16px`/responsive inset from floating-panel and terminal
  widget `max-height` / `max-width` caps. The existing JavaScript resize clamp
  remains responsible for keeping widgets inside the workspace, so widgets that
  start near the top can now expand down to the same bottom edge as other
  widgets.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

### 2026-06-22 - Add per-widget opacity controls

#### Context
- Requested: make it easier to notice widgets behind the active widget by
  letting each widget become partially transparent, without adding runtime
  overhead or losing the value on restart.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Floating panels and terminal widgets now get an `Op` titlebar button.
- `Op` opens a single body-level popover with a `45%`-`100%` slider and `100%`
  reset button. The popover is outside the widget so it does not inherit the
  widget opacity.
- Widget opacity is applied through a CSS variable on the widget container; no
  widget body rerender is needed while dragging the slider.
- Floating panel opacity is saved in each panel snapshot. Terminal widget
  opacity is saved per terminal widget in the workspace snapshot.
- Dragging/resizing keeps widgets at a readable opacity while preserving the
  saved value afterward.
- Browser widgets can use the control for DOM chrome/iframe/canvas content, but
  native child WebView content may remain opaque because it is an OS-level child
  surface.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

#### Needs real Windows smoke
- Confirm per-widget opacity persists across app restart and workspace restore.
- Confirm Browser native WebView opacity limitations are understandable and do
  not break preview positioning.

### 2026-06-22 - Add terminal scrollback controls and session history overlay

#### Context
- Requested: if terminal scrollback contributes to lag/RAM usage, expose a
  setting to shorten it, but still allow older terminal output to be viewed via
  a cache-like flow.

#### Changed (`src/main.ts`, `src/styles.css`, `docs/USER_GUIDE.ko.md`)
- Settings now includes `Terminal scrollback rows`. The default remains
  xterm's previous behavior (`1000` rows); `0` means no terminal scrollback /
  fastest, not unlimited history.
- Settings now includes `Terminal history cache` with `Off`, `Balanced`, and
  `Deep` session-memory modes.
- Terminal output is copied into a per-pane, session-only plain-text history
  cache. It is not saved to workspace snapshots or disk.
- Shell widgets gained a `Hist` button. The History overlay can copy visible
  history, copy all cached history, page older/newer, or clear the cache.
- When a normal terminal is already scrolled to the top, scrolling upward again
  opens the History overlay near the older cached output. Alternate-screen TUI
  buffers do not auto-open the overlay.
- Terminal scrollbars were made more visible.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`

#### Needs real Windows smoke
- Confirm the built app applies scrollback settings to new and existing
  terminals.
- Generate long output, scroll to the terminal top, and confirm `Hist` opens
  older plain-text history without interfering with Claude/Codex/Grok TUI
  screens.

### 2026-06-22 - Prioritize capture protection and reduce workspace memory pressure

#### Context
- Reported: after restarting the IDE, opening a workspace that was still marked
  capture-protected could briefly show real content in OBS until workspace
  loading finished.
- Reported: many workspaces increased lag/RAM, and terminal left columns could
  show rendering artifacts during resize/scroll.

#### Changed (`src/main.ts`, `src/styles.css`, `package.json`, `docs/USER_GUIDE.ko.md`)
- Protected workspace selection now auto-arms the persisted marker for the
  current session and awaits native capture protection before restoring that
  workspace's content.
- If native protection fails while opening a protected workspace, the app fails
  closed by keeping the protection guidance frame visible instead of revealing
  the workspace.
- Terminal renderer setting added: `Auto` loads `@xterm/addon-webgl` with a DOM
  fallback/context-loss recovery; `DOM compatibility` keeps the old renderer.
- Workspace Memory Saver setting added. The default `Balanced` mode can sleep
  old inactive workspace shells while keeping their tabs/layout snapshots.
- Workspace tab context menu gained `Keep live` for long-running servers/jobs.
- Hidden native browser WebView cleanup delay was reduced from 45s to 12s.
- Settings gained live widget appearance controls: corner radius, active widget
  outer-border indicator, and active title-bar highlight.
- Settings now also shows the current IDE scale and provides a `Reset 100%`
  button, so terminal rendering artifacts can be compared at exact 100% scale.
- Claude review found Memory Saver could treat output-producing non-LLM shells
  as idle. Memory Saver now tracks terminal output activity, re-checks sleep
  eligibility immediately before killing panes, and shows a status notice when
  a workspace is slept.
- Claude review also recommended a post-await active-workspace guard in the
  capture-protection restore barrier; that guard was added before content
  restore begins.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `git diff --check`
- `npm audit --omit=dev`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

#### Needs real Windows + OBS smoke
- Restart the built app, click a capture-protected workspace, and confirm OBS
  never shows real content before protection is active.
- Test terminal resize/scroll with Korean output using the default renderer.
- Open 7+ workspaces and confirm Memory Saver sleeps only inactive unpinned
  workspaces.

### 2026-06-22 - Support terminal OSC 52 clipboard copies

#### Context
- Reported: while using Claude/Codex-style terminal TUIs, dragging/copying an
  address could show a message like `sent N chars via OSC 52`, but the text was
  not actually available in the desktop clipboard.

#### Changed (`src/main.ts`)
- Added an xterm OSC 52 handler for terminal panes. When a TUI emits
  `OSC 52 ; c ; <base64>`, the app now decodes the UTF-8 payload and writes it
  to the native clipboard through the existing Tauri clipboard plugin.
- Clipboard writes are capped at 1 MiB and clipboard queries / non-clipboard
  selections are ignored.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`

#### Notes
- This makes terminal-app copy paths that rely on OSC 52 work as expected.
- For normal xterm text selection while a full-screen TUI has mouse reporting
  enabled, hold `Shift` while dragging to force terminal selection.

### 2026-06-21 - Fix active workspace capture-block toggles

#### Context
- Reported: capture block works when toggled from another workspace, but the
  protected active workspace could fail to toggle with `current webview is not a
  WebviewWindow` or stay on an `Applying capture block...` status.
- Reported: when OBS respects the native block it can keep the last real frame,
  so the user wanted the broadcast-protection guidance frame to be the frozen
  frame instead, without leaving that card over the local IDE.

#### Changed (`src-tauri/src/lib.rs`, `src/main.ts`)
- `set_capture_protection` no longer depends on Tauri injecting the caller as a
  `WebviewWindow`. The command now uses the app handle plus the cached main HWND
  first, then falls back to locating the main webview window.
- Active capture re-apply paths use the same app-level helper, so Browser child
  WebView page-load refreshes do not require a currently focused webview window.
- Enabling capture block briefly paints the existing "방송 송출 보호 중" DOM
  frame before applying the native Windows display-affinity flag, then hides the
  frame locally within about one second. OBS Window Capture should therefore
  retain the safe guidance frame instead of the last real workspace frame.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`

#### Needs real Windows + OBS smoke
- Rebuild the Windows app, enable capture block inside the active protected
  workspace, then disable it from the same workspace. The status should not hang.
- In OBS Window Capture, enable capture block and confirm the short protection
  guidance frame is what remains visible while the local IDE returns to normal.

### 2026-06-21 - Add global Snippets cheat-sheet panel

#### Context
- Requested: a global, app-wide cheat sheet for frequently copied commands,
  flags, and short paste-ready snippets. This should not be tied to a single
  workspace like Notes.

#### Changed (`src/main.ts`, `src/styles.css`, `src/api.ts`, `src/types.ts`, `src-tauri/src/lib.rs`)
- Added a `Snip` toolbar toggle and a global `Snippets` floating panel.
- Snippets are grouped by category tabs; `+` creates a new tab/category.
- Each snippet stores paste content plus an optional description, and each row
  has one-click `Copy`, `Edit`, and `Del` actions.
- Snippet row actions use a compact right-side action column with `Copy`
  visually emphasized, so short snippets do not waste a separate footer row.
- Search filters the current tab by both content and description.
- Snippets are saved through Tauri into a plaintext app config JSON file instead
  of workspace snapshots.
- The panel copy path never auto-runs commands; it only writes the selected
  snippet content to the clipboard.

#### Safety note
- Snippets are plaintext local convenience entries, not a secret manager. Do not
  store passwords, tokens, private keys, or other secrets.

#### Needs real Windows smoke
- Open `Snip`, create/rename/delete tabs, add/edit/delete snippets, copy a
  snippet into a terminal, restart the app, and confirm global persistence.

### 2026-06-21 - Add renderer white-screen recovery watchdog

#### Context
- Reported: under memory pressure WebView2 can degrade to a plain white page,
  consistent with the renderer process becoming unresponsive or being killed.
- Direct WebView2 `ProcessFailed` hooks are not exposed cleanly through the
  current Tauri/wry surface, so the low-risk recovery path is an app-level
  heartbeat plus backend watchdog.

#### Changed (`src-tauri/src/lib.rs`, `src/main.ts`, `src/api.ts`, `src/types.ts`)
- Frontend sends a lightweight `renderer_heartbeat` IPC every 5 seconds and
  listens for `renderer-recovery` notices.
- Backend watchdog waits through startup grace, then reloads the main WebView if
  heartbeats stop for the timeout window.
- Watchdog has a reload cooldown and keeps the recovery notice available for
  the next renderer, so a white-screen recovery does not immediately loop or
  lose the user-visible status message.
- Watchdog-triggered reload deliberately closes native Browser WebViews and
  drains in-process runtime sessions before reloading. The app does not support
  reattaching those JS/runtime objects after a renderer crash, and draining is
  safer than leaving orphaned shells or child WebView2 surfaces.
- `beforeunload` now flushes workspace/editor/cwd state without marking a
  full app shutdown, so a watchdog UI reload does not take the normal close
  path. Explicit window close still uses the Rust/JS shutdown paths.

#### Verified (repo-side only)
- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
- `git diff --check`

#### Needs real Windows smoke
- Stress/kill the renderer or force a severe UI hang and confirm the app returns
  from a white page after the watchdog timeout.
- Confirm the recovery status appears after reload and that terminal/browser
  runtime sessions are restarted cleanly rather than orphaned.

### 2026-06-19 - Make broadcast capture protection reliable (Window Capture)

#### Context
- Reported: with block enabled, OBS still shows the real workspace. User
  verified on a fresh build and captures the app with OBS **Window Capture**.
- Key fact: Window Capture grabs exactly one window's rendered surface, so the
  separate `capture-cover` decoy window can NEVER appear in it (it only helps
  monitor/Display Capture). The only protection Window Capture respects is the
  main window actually carrying `WDA_EXCLUDEFROMCAPTURE` — which then shows
  **black** in OBS, not the branded cover. "Real content shows" therefore means
  the affinity was not effectively applied.

#### Changed (`src-tauri/src/lib.rs`, `src/main.ts`)
- `set_capture_protection` now applies `set_window_capture_protection` FIRST and
  unconditionally; the decoy cover became best-effort (`if let Err … eprintln`).
  Previously `show_capture_cover(...)?` could fail and skip the affinity entirely
  via `?` — the most likely reason the rebuild still leaked.
- `set_window_capture_protection` now also propagates the affinity to every
  descendant HWND via `EnumChildWindows`, because WebView2 renders into child
  windows (`Chrome_WidgetWin` / GPU surface) that Window Capture can latch onto
  even when the top-level is excluded.
- Frontend `applyWorkspaceCaptureProtection` no longer `await`s the ~600ms
  freeze-frame overlay before calling `setCaptureProtection`, and dropped the
  first no-redispatch bail, so the OS exclusion is applied immediately on toggle.
- Cover decoy (for Display Capture users) restored + hardened in the same file:
  kept strictly behind main via `SetWindowPos(SWP_NOACTIVATE | SWP_SHOWWINDOW)`
  (no `set_focus` z-order fighting), `focused(false)` + click-through, hidden
  while moving/resizing (debounced re-align) and while minimized — so it never
  leaks onto the user's own display (the bug that got it removed before).

#### Verified (repo-side only)
- `cargo fmt --check`, `cargo check --target x86_64-pc-windows-msvc`,
  `npm run check`, `npm run build`: all OK (pre-existing GNU-target warning only).

#### Needs real Windows + OBS smoke
- Window Capture: enable block → OBS should go **black** (not branded), user
  still sees the real workspace. This is the user's setup and the primary test.
- If a branded "방송 송출 보호 중" screen is wanted in OBS, that requires
  **Display Capture**; then the restored decoy cover shows. Confirm the cover
  never appears on the user's own monitor during drag/resize/minimize/toggle.
- If Window Capture still shows real content after this, the next suspect is the
  OBS capture method (BitBlt ignores `WDA_EXCLUDEFROMCAPTURE`; only the WGC
  "Windows 10 1903+" method respects it).

### 2026-06-14 - Split native Browser WebView hide/close and harden shell restore

#### Changed

- Native Browser preview lifecycle is now split by intent:
  - workspace tab switching hides Browser child WebViews so returning to a
    workspace can re-show the same preview without reloading;
  - closing the Web panel, closing/deleting a workspace, changing workspace
    root, or app exit closes/destroys the relevant Browser child WebViews so
    hidden audio and OS-level click interception cannot linger.
- Added a dedicated `close_browser_webview` backend command instead of using
  `hide_browser_webview` for both preserve and destroy paths.
- Terminal startup now runs through a blocking worker instead of the Tauri
  command thread, reducing the chance that slow WSL/SSH PTY startup makes the UI
  feel frozen.
- Terminal output/cursor/exit events that arrive before the frontend receives
  the spawned backend id are buffered briefly and replayed after the pane maps
  the id. This prevents fast startup/failure output from being dropped and
  leaving an apparently blank shell.
- WSL/SSH shell-ready waiters now have a short fallback so workspace restore and
  Explorer loading cannot wait forever for an OSC7 prompt marker when shell
  startup is still warming up or a user rcfile blocks the prompt hook.
- Terminal startup has a timeout; if a backend id arrives after the timeout, the
  late process is killed so orphan WSL/SSH processes do not accumulate.
- Terminal startup timeouts are split by profile kind: Windows keeps a short
  timeout, while WSL and SSH get longer cold-start windows.
- If a terminal pane is closed while startup is still pending, any backend id
  that arrives later is killed instead of being attached to a disposed pane.
- WSL terminal panes are no longer gated on a fake "shell login" state. Once the
  backend PTY exists, WSL is considered ready and LLM launcher input can be sent
  immediately.
- Explorer/file reads no longer wait for terminal shell-ready. They use their
  own backend timeout and SSH askpass path so one stuck shell cannot block
  unrelated workspace tabs.
- Pending shell-ready actions now have their own fallback timer and are cleared
  if the pane closes, exits, or the workspace restore becomes stale.
- Switching workspace roots now detaches/kills old terminals in the background,
  and backend terminal kill removes the session map entry immediately before
  process-tree cleanup waits in a worker thread.
- The bash rcfile bootstrap emits the IDE OSC7 ready marker before and after
  sourcing user `.bashrc`, so slow or noisy rcfiles do not leave the IDE stuck
  at "Waiting for ... shell login".
- WSL Linux paths no longer use `\\wsl.localhost\...` for Explorer/file reads.
  They go through timeout-controlled `wsl.exe` shell commands instead, avoiding
  Windows filesystem calls that can hang after a distro is restarted or killed.
- WSL/SSH workspace restore now starts the workspace shell independently and
  loads Explorer in the background, so file listing delays do not leave the
  workspace stuck at "shells starting".

#### Verified

- `npm run check`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target
  x86_64-pc-windows-msvc`
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch`
- `git diff --check`

#### Needs real Windows smoke

- Switch away from a workspace with an active native Browser preview and return:
  the preview should be preserved/re-shown without reload.
- Close the Web panel or workspace while preview audio is playing: audio should
  stop and the native WebView should not intercept titlebar/tabs/close clicks.
- Open WSL `[USER]` workspaces including `simple-vibe-ide` and
  `[WORKSPACE]`; shell panes should either start or show a startup failure
  instead of remaining blank.
- Open SSH `ubuntu-dev` and launch Codex/Claude; `Loading ./useful-skills...`
  may still be a CLI-side startup step, but the workspace UI should remain
  interactive and shell output should not be dropped.

### 2026-06-14 - Keep SSH workspace open/close responsive

#### Changed

- SSH Explorer startup now follows the same visible-shell-first path as WSL:
  workspace activation renders the workspace and starts the terminal first, then
  loads Explorer after shell-ready/fallback. A stuck background `ssh.exe` directory
  read should no longer make workspace tabs or the window close button feel dead.
- Remote Explorer/listing/signature probes now have a short backend timeout and
  frontend timeout. Timed-out SSH reads clear auth cache and kill the spawned
  process tree instead of lingering indefinitely.
- General remote file operations keep a longer timeout so normal larger file
  reads/writes are not cut off by the Explorer probe timeout.
- Terminal backend close now kills first instead of waiting for pending input
  flushes, and the backend `kill_terminal` command runs on a blocking worker so
  closing a stuck SSH PTY does not tie up the Tauri command thread.

#### Verified

- `ssh ubuntu-dev` noninteractive smoke for a basic command, `sh -lc`, and the
  base64 bootstrap loader all returned successfully.
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target
  x86_64-pc-windows-msvc`
- `git diff --check`

#### Follow-up smoke

- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch` completed after
  the WSL/SSH startup-timeout follow-up and produced both Windows release exes.

### 2026-06-14 - Harden WSL root-account workspace resolve

#### Changed

- WSL home detection is now cached per distro for the IDE process lifetime.
  Root-account distros such as `coding` no longer spawn a fresh WSL probe every
  time profile/root resolution runs.
- WSL home probes now have a hard timeout and kill the probe process tree on
  timeout. If the primary home probe fails, the IDE falls back to `id -un` and
  maps root users to `/root`.
- `resolve_profile_path` now runs on a blocking worker instead of a synchronous
  command path, and the frontend wraps root resolution in a longer timeout. A
  stuck WSL resolve should show an error and leave the window close path
  responsive.
- The Open / Connect button now catches resolve failures instead of continuing
  into a half-open workspace after a timeout.
- During this investigation, a stuck Simple Vibe IDE process tree was terminated:
  the app process plus child WebView2, WSL, WSL host, and console host processes.

#### Verified

- `coding` direct home probe returned `/root`.
- `coding` `--cd /root` shell smoke returned `/root`.
- `npm run check`
- `npm run build`
- `npm run build:terminal`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target
  x86_64-pc-windows-msvc`
- `scripts/windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch`
- `git diff --check`

### 2026-06-13 - Harden SSH bootstrap and stop hidden preview audio

#### Changed

- SSH terminals: the previous PowerShell quote pre-escape was not sufficient on
  every Windows OpenSSH path; a real SSH launch could still strip double quotes
  from the remote bash rcfile and fail at `case ;${PROMPT_COMMAND:-};`. SSH
  terminal launches now pass a quote-free base64 loader through `ssh.exe`, decode
  the full bash bootstrap on the remote host, and source it inside remote bash
  before `exec bash --rcfile ... -i`. This keeps `codex`/`claude` launcher
  commands and OSC7 cwd bootstrap out of the fragile Windows argv quote path.
- Browser preview: native child WebViews keep playing media after `hide()`.
  Closing the Web panel, closing/switching workspace preview state, or removing
  preview tabs now destroys the child WebView via the existing hide command path,
  so background music stops instead of continuing invisibly.

#### Verified

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --target
  x86_64-pc-windows-msvc`
- `cargo check --manifest-path src-tauri/Cargo.toml`

#### Known limits

- Real Windows smoke is still required: SSH launch should no longer show the
  `/dev/fd/63` quote-loss syntax error, and a local preview page with audio
  should stop when Web/workspace is closed.

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
- Capture lock now survives restart via the saved workspace flag while OS-level
  capture protection is applied asynchronously, so workspace loading, shell
  startup, and app close are not blocked by capture-protection work.
- Removed the persistent native capture-cover window from capture lock. The app
  now uses the main window capture affinity directly and closes any stale cover,
  avoiding input/focus issues where the IDE looked alive but tabs and close
  controls stopped responding.
- Claude launcher now checks the effective uid again at launch time and runs
  plain `claude` as root, preventing stale `__svi_args` from passing
  `--dangerously-skip-permissions` in root WSL/SSH shells.
- WSL workspace and terminal startup now treat `Wsl/Service/E_UNEXPECTED` as a
  transient WSL service error: terminal spawn warms the distro with a short
  probe, and WSL shell/file commands retry briefly before surfacing the error.
- WSL warmup is now cached per distro and guarded while in flight, preventing a
  workspace restore with multiple terminals from launching duplicate warmup
  probes that can slow WSL cold start.

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
