# Windows Runtime Smoke Test For External LLMs

This file is the handoff target for an external Windows-side LLM or agent.
WSL-side validation can cover TypeScript/Vite checks and Windows-target Rust
type-checking, but the final proof must come from a real Windows runtime with
MSVC `link.exe`. Do not treat Linux Tauri builds as a substitute for this
Windows smoke.

Release builds are intentionally local-machine optimized: `.cargo/config.toml`
sets `-C target-cpu=native` for `x86_64-pc-windows-msvc`. Do not redistribute
that built exe as a portable artifact for older or different CPUs.

## Privacy Rules

- Do not print secrets, tokens, cookies, private config values, private URLs,
  raw usernames, or raw home paths in the final report.
- Use placeholders such as `[USER]`, `[DISTRO]`, `[WORKSPACE]`, and
  `[PRIVATE_URL]`.
- Do not commit local runtime artifacts, screenshots with private content,
  secret config files, workspace temp output, or generated logs.
- Report exact command pass/fail status. Do not claim runtime success without
  launching the Windows-built app.

## One-Command Build Gate

### Windows-local checkout

Run from PowerShell in the repo root:

```powershell
.\scripts\windows-runtime-smoke.ps1
```

If dependencies are already installed and you want to skip dependency install:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

`-SkipNpmInstall` is valid only when the existing `node_modules` was installed
for Windows. The script now checks Windows npm shims and native esbuild/Rollup
packages first and fails with a clear message for a WSL-created or mixed tree.

If you only want build/link validation without launching:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

If PowerShell blocks unsigned local scripts, use an execution-policy bypass for
this process only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

### WSL-hosted checkout

Never run Windows npm over the same `node_modules` used by WSL. From a Visual
Studio Developer PowerShell with Git for Windows available, map the source
temporarily and invoke the staged gate instead:

```powershell
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-staged-runtime-smoke.ps1 -NoLaunch'
```

The staged gate uses Git's tracked files plus allowlisted new source, copies the working tree
to Windows-local `%TEMP%`, runs `npm ci --no-audit --no-fund`, verifies
`npm audit --audit-level=low`, then runs this smoke with `-SkipNpmInstall`.
Pass `-StageRoot` and `-CargoTargetDir` to keep both on another Windows-local
drive. The script refuses a WSL/UNC stage and refuses to delete a directory it
did not create. New nonignored Rust modules under `src-tauri/src`, frontend code under
`src`, build scripts under `scripts`, `src-tauri/build.rs` and capability JSON are
included by default, without changing the Git index. Other untracked assets/docs need
`-IncludeUntracked`; it remains an explicit wider opt-in, not a blanket default copy.

`windows-stage-manifest.mjs` reads Git's NUL-delimited UTF-8 output and sends ASCII-safe
JSON to Windows PowerShell, preserving Hangul/space/bracket filenames. Manifest, private
untracked names, Windows filename/case collisions and symlink validation happen before
the previous stage is removed. This is a path-based preflight, not a guarantee that code
contents contain no secrets; always keep private local files ignored.

The script runs:

- `node --version`
- `npm --version`
- `rustc --version`
- `cargo --version`
- `Get-Command link.exe` (reported as advisory; build result is authoritative)
- `npm.cmd audit --audit-level=low`
- `npm.cmd run check`
- `npm.cmd run build`
- `npm.cmd run build:terminal`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm.cmd run tauri -- build --no-bundle`
- `npm.cmd run tauri:terminal:build`
- launch of the built `simple-vibe-ide.exe` unless `-NoLaunch` is passed; the
  Terminal executable is built and reported for separate manual launch

## Manual Runtime Smoke Checklist

### Rebuild while an earlier app is running

The smoke now publishes separate runtime copies under
`<CargoTargetDir>\simple-vibe-build-sources\`, for example
`simple-vibe-ide-20260906-063000-123-<GUID>.exe` (UTC timestamp).
IDE and Terminal each receive a unique name. Completed copies are published with a
no-overwrite rename; earlier snapshots, including the old fixed-name snapshot, are
never deleted or replaced by a later build. The shared Cargo cache is unchanged.

- Keep the previous snapshot open, rerun the same external staged build cmd, and confirm
  both new paths differ from the running files. With `-NoLaunch`, the new files are built
  and reported but not started. Existing sessions/processes must not be killed by the build.
- Repeat rapidly and keep both IDE/Terminal snapshots open. Runtime launchers and
  `build-and-copy.cmd` use separate timestamped copies rather than Cargo's mutable output.
  Snapshot discovery is per binary and ignores partial copies; a newer direct Cargo build
  is preferred over a saved snapshot only when its Windows product metadata matches.
- Validate IDE metadata and save its snapshot before building Terminal: Tauri's Terminal
  build renames the shared Cargo executable. Do not replace the IDE snapshot with that
  later output or silently use an older artifact after a failed build.
- Let smoke launch a snapshot, then rebuild again. Its cwd is now the runtime directory,
  not the disposable source stage. User-selected terminals/projects within the stage can
  still hold files open; this fix does not forcibly clear those handles.
- **One-time legacy exception:** an app launched directly from Cargo's raw
  `release\simple-vibe-ide.exe` / `release\simple-vibe-terminal.exe` can still lock the linker
  output. Close that directly launched instance once, then use a timestamped path or
  `run-built.cmd` / `run-built.vbs`. The originally reported locked file inside
  `simple-vibe-build-sources` does not need to be closed.
- Snapshots are retained intentionally. Remove unwanted old copies manually only after
  their apps are closed; running instances can reuse their executable for SSH askpass.

Helper and routing fixtures (temporary files only, no application/build launch):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-build-artifacts-smoke.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-build-routing-smoke.ps1
```

Both fixtures also run in the normal smoke preflight. Linux PowerShell execution
covers parser/routing/file-copy behavior, not Windows image locks, WSH/CMD or MSVC linking.

### Isolated Windows tmux profile smoke (opt-in)

Prerequisites: native Windows tmux on PATH and a Windows PowerShell 5.1 profile that
defines the Codex function. This does not execute Codex or an account selector.

```powershell
$env:SVI_TMUX_SMOKE_FIXTURE_DIR = Join-Path $env:TEMP 'svi-tmux-profile-fixture'
cargo test --manifest-path src-tauri/Cargo.toml --lib export_windows_tmux_profile_smoke_fixture -- --ignored
.\scripts\windows-tmux-profile-smoke.ps1 -FixturePath (Join-Path $env:SVI_TMUX_SMOKE_FIXTURE_DIR 'windows-tmux-profile-fixture.json')
```

- The fixture uses production command builders with a unique `svi_profile_smoke_*`
  server. Never point this at a production server or replace its UUID safety checks.
- Verify the initial LLM pane loads PS5.1 profiles, resolves Codex as a Function, and
  dispatches to the substituted harmless function. Real LLM execution is deliberately absent.
- Verify existing-session prepare preserves settings. New commandless `new-window` and
  `split-window` must inherit PS5.1 and profile Function lookup. Only the test server is killed.
- IDE session defaults are scoped to newly created sessions, with `default-command` empty.
  No global shell option, user .tmux.conf or existing running pane is rewritten. Attach's
  ExternalScript control -NoProfile is unrelated and intentionally remains.
- Passed on native tmux 3.6a-win32 / PS5.1. Other Windows tmux script wrappers need their
  own runtime check; the empty value uses tmux-side format expansion to avoid PS5 argv loss.

### Workspace Ports and restart restoration

- Run `node scripts/workspace-ports-smoke.mjs` for bounded detection, persistence,
  restart, deduplication, cancellation and background-discovery helper fixtures.
- With Web hidden, open toolbar **Ports**, register a test remote/local port, and verify
  forwarding without Browser activation. The Browser's Ports button opens this same manager.
- Test split `Local: http://localhost:3000/` output and standalone local URLs in WSL/SSH.
  While viewing another workspace, start a server in a live background shell, return,
  and verify discovery/restoration occurs for its owning workspace only.
- Exit/relaunch the IDE and activate the workspace: saved enabled mappings should restore
  without opening Browser tabs or changing focus. Stop disables restoration; Enable/Retry
  starts it again. Disable then Forget during startup must never resurrect the late tunnel.
- Each workspace stores at most 32 rules. Stop then Forget removes an obsolete rule.
  Local-port conflicts stay visible for Retry rather than silently changing saved URLs.
- Only rules detected/registered with this version can restore. This does not restart the
  server process itself or discover arbitrary listeners without terminal hints. IDE-owned
  tunnels are cleaned up on exit; OS-managed WSL localhost exposure may remain available
  for independently running servers. Validate SSH shutdown separately from that direct path.

### Windows project shell working directory

Run `node scripts/windows-shell-cwd-smoke.mjs` for frontend helper regressions.
These fixtures and Rust command-generation tests do not execute Windows PowerShell.

- Enter a drive-relative project path such as `D:#Projects\Example`: Open / Connect,
  new shell startup and cold restore should check whether `D:\#Projects\Example` exists
  and ask before repairing the matching stored paths. Cancel or a missing directory must
  leave paths unchanged, without opening the app directory or a restore fallback. The distinction is
  [Windows path syntax](https://learn.microsoft.com/en-us/dotnet/standard/io/file-path-formats),
  not a hash-character restriction. After approval through **+ Shell**, verify Root,
  Explorer and the new shell use the corrected directory, also after restarting the app.
  Existing running shells must stay in their original directory; no files should move or
  disappear. Open / Connect still follows the normal workspace-open lifecycle. Reject
  stale repairs if switching workspaces while the directory check is pending. Backend
  calls without an approved frontend repair still reject drive-relative paths.
- For a valid absolute path containing `#`, verify startup, new tabs and restored sessions.
  Other relative project inputs must resolve to one absolute path before both the directory
  probe and PTY spawn, not append their suffix again in PowerShell.
- Open a Windows project on a different drive, including a disposable path with spaces,
  Hangul, brackets and an apostrophe. Click **+ Shell** and verify `(Get-Location).Path`
  equals the project root, not the Explorer's selected child or the application's directory.
  The bootstrap now sets the PowerShell location explicitly after module/history setup;
  the process cwd remains set too. These locations are distinct concepts in
  [PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_locations).
- Repeat with an accessible UNC project, including a WSL UNC path opened using the Windows
  profile. `cd` into a child and open a new tab/restart: retain the UNC server/share prefix.
  Test `cd ..` at the share root and `cd \child`; do not lose or escape the share root.
- Switch workspaces immediately after clicking **+ Shell**. The shell must keep the
  originally requested folder/profile. If that directory is missing or inaccessible,
  display a startup error rather than silently launch in another project or home folder.
- Restore a snapshot whose old child directory was removed. Only this recovery flow may
  try its captured project/profile fallbacks; a later workspace switch must not replace them.
- The separate **Win Shell** button intentionally retains its safe temporary-directory
  behavior, even from WSL/SSH projects. **+ Shell** still follows the project's profile.

### Optional Windows SSH authentication agent

- On a setup where the Windows SSH agent is already unavailable, open an SSH workspace.
  The repeated agent-fallback banner should be absent. IDE passphrase/password prompts,
  successful authentication and real SSH errors must remain functional. Do not disable a
  working service or remove keys just to exercise this case.
- Repeat with an available agent and verify existing key-loading/reuse behavior. Local
  WSL tabs must still use their separate WSL bootstrap; the removed message originated
  from Windows-side SSH startup, not a Linux shell failure.

### Browser navigation and proxy follow-up

Run `npm run check:regressions` first; see [Browser performance](BROWSER_PERFORMANCE.md)
for the bounded-injection tradeoff and known limits.
The default stage now includes untracked `src-tauri/src/preview_body.rs` automatically.
The additional `windows-stage-manifest-smoke.mjs` fixture guards this E0583 regression.

- With capture protection on and off, load a disposable page and test Reload, Hard refresh
  and Clear cache; verify an actual request occurs. Switch tabs repeatedly while loading:
  the same pending iframe navigation should not restart, but explicit reload must work.
- Resize/move the Browser, cover/uncover it, toggle suggestions and switch back while a
  hidden native child is being closed. Verify bounds, subpixel positioning and recreation.
- Change URL/workspace while a proxy start, stale probe or asset retry is pending. Verify
  no old-page reload/error reaches the new tab and obsolete created forwards are closed.
- Open Console, reload the iframe and confirm detailed mode survives. Read older logs while
  new entries arrive: no forced jump; check native scroll anchoring as the row cap evicts.
- Test disposable local HTML servers with Content-Length, chunked trailers, HEAD, slow
  streamed HTML and a body larger than 2 MiB. Large/slow pages must still display fully,
  but may lack injected Console/bridge integrations. Confirm WebSocket/SSE and binary
  resources still function; compare final content bytes where applicable.
- Observe WebView2/native child counts, open connections and memory across repeated tab/
  workspace close. Inactive iframe tabs within an active workspace intentionally remain
  live to preserve state; do not report them as suspended or as a confirmed leak by count alone.

### Whole-app allocation and scheduling follow-up

See [the performance audit](PERFORMANCE_AUDIT.md) for source-level coverage and known
unfixed lifecycle risks. Run `npm run check:regressions` first.

- Open a large disposable text file, type, undo, save and switch workspaces repeatedly.
  Verify content, dirty state, selection and scroll position; compare typing latency with
  the prior build rather than treating helper timings as Windows measurements.
- On disposable Notes, overlap autosave/manual save with rapid editing and workspace
  switches, then reopen files to confirm newest saved contents. Test a failed write and
  retry. Avoid interpreting this as proof that permanent deletion races are fixed.
- In a disposable preview page, log large strings, large objects, cycles and BigInts with
  Console open/closed, then switch workspaces during queued output. Logs should be bounded
  summaries; old work must not consume new-workspace logs or port candidates.
- Compare ASCII and mixed Hangul/Latin Explorer ordering and signatures. Transfer a
  binary attachment over WSL/SSH, open an image, and compare bytes/content after transfer.
- Export a large disposable local/remote file and verify final bytes plus completed/error
  status despite fewer progress updates. Stalled remote export cancellation remains a
  known separate issue, not a passed test from this patch.
- Observe WebView2 heap, backend/thread/handle counts and input latency under long output,
  repeated workspace switches and glass on/off. Record runtime measurements with private
  paths/content redacted; do not commit screenshots/logs containing workspace data.

### Long-session performance and lifecycle regressions

Run `npm run check:regressions` first (requires installed development dependencies).
These deterministic helper fixtures do not launch WSL/SSH or replace the following
Windows/WebView2 runtime checks:

- Fill a test shell's history beyond its configured limit using disposable generated
  text. Repeat with low visible scrollback and balanced/deep Hist, both open and closed.
  Keep typing in a second shell, moving the Explorer, and switching workspaces. Check
  that latency and process memory settle rather than rising with conversation length.
- Stream output in an inactive tab and a hidden workspace, then show them again. Check
  that xterm catches up without corrupted ANSI output or a live-output skip marker;
  an optional **Hist** skipped-output marker under a parser flood is distinct from
  dropping live terminal data. Background burst continuation should not pause 900 ms
  for each chunk. Repeat after minimizing/restoring the app.
- Close a noisy pane and close/reload the app while output is waiting for renderer
  credit. Confirm no shutdown hang or leftover IDE-owned PTY reader. Verify DSR-based
  TUIs, IME, paste, Ctrl+C interrupt and selection-copy still behave normally.
- Display more than 3,000 Explorer entries, repeatedly resize and expand/collapse,
  and toggle sizes during a slow WSL/SSH read. Confirm no duplicate helper per identical
  pending directory/size-mode key and no size-mode cache corruption.
- Start expansion, collapse before loading finishes, and switch workspaces during
  both successful and failed reads. Confirm no reopened folder or old result inserted
  in the new tree. Start New File during a slow read, then switch away/back or reload
  the root; confirm no file is created in the wrong profile or stale tree.
- Restore editor tabs containing one missing remote file followed by a valid file.
  Confirm the valid file loads and the missing file is not read in an endless idle loop.
  Switch away/back during a read and confirm no permanently stuck loading tab.
- Put Editor behind another widget, then open both a new file and an already-open file
  from Explorer. Both should bring Editor to the front. Select a child folder, then
  primary-click empty Explorer space; New File and New Folder must target the displayed
  current directory, not the previously selected child. Repeat after multi-selection;
  rename inputs, loading rows, modified clicks and trailing drag clicks must not clear it.
- Open an HTTP stream/WebSocket through a preview proxy or local forward, then stop
  the corresponding forward. Check accepted sockets and copy workers terminate, and
  repeat open/stop cycles while watching IDE threads, handles and memory. Also verify
  a client that sends EOF before reading still receives its server response, and a server
  that sends EOF before reading can still receive the client's remaining upload.
- Compare WSL/SSH client counts with live panes and in-flight helpers during repeated
  open/close and workspace changes. Detached user tmux sessions are intentional state,
  not leaked IDE clients; never use distro shutdown or tmux kill-all for this check.

### Korean IME commit and load checks

- Use Microsoft Korean IME directly in a disposable plain shell and a Codex/Claude prompt,
  with Type pad closed. Test repeated syllables, moving final consonants, punctuation,
  Space/Enter, candidate choice/cancel, and rapid mixed Korean/ASCII input.
- End a composition and immediately click Editor/another window; also click away during
  composition and return before the deferred blur runs. Confirm final text arrives once,
  focus stays with the selected control, and Ctrl+C selection-copy/interrupt plus Ctrl+V
  remain unchanged. Do not record actual user input in diagnostic logs.
- Repeat while a second terminal streams output, Hist is open and Explorer has thousands
  of entries. Compare missing input with idle typing. The known xterm timer-backlog bug
  remains separate from the IDE's patched blur race; do not report it as fully fixed.
- `node scripts/terminal-ime-smoke.mjs --upstream-probe` demonstrates the installed helper's
  backlog limitation synthetically. See xterm issue #6089 / PR #6090 before upgrading or
  maintaining a fork. Synthetic tests cannot certify native Windows TSF behavior.

### 1. First paint and workspace switching

- Launch the built Windows app.
- Confirm first paint appears quickly and no long blank/frozen state is visible.
- Open a Windows-local workspace, then switch between at least three workspaces.
- Confirm workspace tabs activate without visible stutter.
- Confirm panel positions and tab state persist after switching away/back.

### 2. Explorer performance

- Open a large directory with hundreds or thousands of entries.
- Scroll quickly up/down for at least 30 seconds.
- Confirm there are no repeated pauses or visible scroll stalls.
- Expand/collapse nested directories while scrolling.
- Toggle file sizes on/off.
- Test selection, keyboard navigation, typeahead, rename, delete, refresh, and
  open-file behavior.
- Switch away from the workspace and back; confirm Explorer restores quickly.

### 3. Terminal widgets and tabs

- Create several terminal widgets and multiple tabs per widget.
- In a Windows-local workspace, launch Codex and Claude from their buttons.
- Confirm the Codex launch line includes exactly one
  `--dangerously-bypass-approvals-and-sandbox`, with no `--enable goals` or
  approval/sandbox config overrides.
- Confirm the Claude launch line includes exactly one
  `--dangerously-skip-permissions`, with no extra `--permission-mode` argument.
- Confirm both CLIs enter their bypass/no-approval mode and do not ask for an
  approval on a harmless read-only action. Do not use a destructive action for
  this smoke.
- Put a standard tmux-compatible executable, `.cmd`, or `.ps1` on the app's
  inherited Windows `PATH` (not only in a PowerShell profile), then launch the
  Windows Codex and Claude buttons twice, including rapid repeated clicks.
  Confirm `#1` and `#2` are separate, `Tmux` lists them, exact-session
  attach/Kill works, and each bypass flag still appears exactly once. Repeat
  from a workspace path containing spaces and an apostrophe.
- Confirm every Windows tmux client invocation begins with
  `-L simple-vibe-ide` (the compound command queue carries it once before
  `new-session`). Start an unrelated default tmux server first, then verify the
  button sessions use only the dedicated namespace and survive independently.
  From an external client, confirm `tmux -L simple-vibe-ide list-sessions` sees
  the IDE sessions.
- Confirm the shim writes no banner/debug text to stdout for `list-sessions`
  and `show-options`; those outputs are parsed as machine-readable data.
- For the `.ps1` form, test a wrapper that ends with `exit $LASTEXITCODE`.
  Confirm list/create/attach/Kill still work, detaching returns to the existing
  IDE PowerShell instead of exiting the terminal tab, and the agent command
  actually starts inside the pane.
- Close a Windows tmux-backed tab and attach its same session again. Then close
  and relaunch the app and repeat the attach. Confirm the detached tmux server
  and agent survived both cleanup paths, and inspect the process tree to verify
  the server is not a descendant of the closed IDE terminal PowerShell.
- Set the tmux server default `destroy-unattached` to `on`, then repeat create,
  tab-close, app-close, and attach. Confirm the IDE session itself reports
  `destroy-unattached off` and survives without changing the global default.
- Switch workspaces immediately after a button launch and simulate one terminal
  attach/start failure. Confirm the already-created session remains available in
  `Tmux` and is not auto-killed; terminate it only with the explicit Kill action.
- Temporarily remove the Windows tmux command from `PATH`. Confirm the Codex and
  Claude buttons use their unchanged direct launcher instead. Make tmux session
  creation fail after discovery and confirm the IDE reports the error without
  also launching a second direct agent.
- With a v9 managed session saved, hide the shim from `PATH` and relaunch.
  Confirm restore starts no direct Codex/Claude process; restore again after the
  shim returns and confirm it reattaches. Also kill a cached menu session outside
  the IDE, choose that menu entry, and confirm attach fails without recreating it
  or launching direct.
- Restore a pre-v9 layout containing multiple speculative Windows `#1` panes.
  Confirm they migrate to distinct stable numbers instead of sharing one agent;
  confirm a current v9 layout keeps its already-managed session names.
- In WSL and one SSH profile with tmux installed, confirm the typed launcher line
  starts with `__svi_launch_v=9` and Codex/Claude remains usable for a normal turn.
- From another client attached to the IDE-created session, confirm
  `tmux show-options -v -t "$TMUX_PANE" destroy-unattached` reports `off` without
  changing the server-wide default.
- Exit one agent normally, then test a harmless wrapper that returns a nonzero
  status and another wrapper function that uses `exec` or `exit`. Confirm every
  case retains the tmux session as a dead pane with `remain-on-exit on`, showing
  the last output and actual status instead of only `[exited]`.
- Leave a visible tmux-backed agent running long enough for stale probes, then
  switch/focus panes. Confirm diagnostics may report `autoReconnect=off` but the
  IDE never replaces or terminates the current PTY automatically.
- With `Terminal renderer` set to `Auto`, open a normal shell whose badge has
  reached `GL`, type `opencode`, and press Enter. Confirm the badge changes to
  `DOM` before the TUI starts drawing. Exercise Korean/mixed-width streaming
  output, scroll, resize, and workspace switching; confirm old glyph fragments
  do not remain at the left edge. This is a runtime check for the scoped
  OpenTUI compatibility path, not an OpenCode launcher/status integration.
- Switch an existing `GL` shell to `DOM compatibility` in Settings and save.
  Confirm that live pane changes to `DOM` without reopening the shell.
- Switch active shell tabs rapidly.
- Close active and inactive tabs.
- Close a whole terminal widget.
- Resize terminal widgets; confirm fit scheduling works and active pane remains
  correct.
- Generate noisy output in a hidden/inactive terminal, then reveal it; confirm
  buffered output does not freeze the UI.
- Switch workspaces while terminals are alive; confirm hidden/restored terminal
  widgets behave correctly.
- Close/relaunch after saving a workspace; confirm UI/work context restores but
  ordinary shell processes start fresh. Runtime keep-alive is intentionally not
  part of the current product; externally detached tmux sessions are the explicit
  exception and should reattach through their recreated client panes.

### 4. Browser widget used/unused states

- With Browser panel hidden, run terminal commands that print local URLs and
  noisy logs. Confirm the rest of the app remains responsive.
- Show Browser and open a local dev-server URL.
- Open many Browser tabs; switch, close active/inactive tabs, and restore after
  workspace switch.
- Toggle desktop/device modes, rotate device mode, and reload/hard reload.
- Confirm inactive Browser frames do not keep visible UI heavy.

### 5. Browser console and forwards

- In a preview page, log small objects, very large strings, large arrays, nested
  objects, and repeated/circular-like structures if possible.
- Confirm Browser console remains responsive and still shows useful summaries.
- Toggle console visible/hidden; confirm hidden replay and trimming still work.
- Emit local URLs such as `http://127.0.0.1:3000`; confirm detected-port rows,
  manual forwards, auto-forwards, stop, ignore, and proxy-local-port filtering.

### 6. Simple Vibe Terminal automatic ports

- Launch the built `simple-vibe-terminal.exe` and open a WSL workspace.
- Start a normal local development server whose output includes a positive URL,
  for example `Local: http://localhost:8123`. Confirm the `Ports` badge appears
  and the row becomes active without opening a hidden IDE Browser panel.
- Confirm `Open` launches `http://127.0.0.1:[PORT]` in the default Windows
  browser, `Copy` copies the same local URL, and `Stop` removes the row.
- Print an error-like line such as `ECONNREFUSED http://localhost:8124` without
  starting a server. Confirm it stays pending rather than auto-forwarding, then
  confirm `Ignore` removes it.
- Start a forward and immediately load another saved terminal layout or switch
  profile/root. Confirm no stale row appears in the new layout and a late start
  is stopped.
- If an SSH profile is available, repeat once and confirm the automatically
  allocated local port shown in `Ports` opens the remote server.

### 7. Editor, Image, Notes, Calculator, Export

- Open many editor tabs; activate existing tabs and close active/inactive tabs.
- Open image files and paste clipboard images; confirm history rows update and
  paste-tag-to-terminal works.
- Open notes tabs, change themes/opacities, type enough text to trigger saves,
  then switch workspaces and return.
- Use calculator history repeatedly; confirm rows update without lag.
- Run export actions if available; confirm progress/cancel/completed actions
  work and do not rebuild the UI unnecessarily.

## Pass/Fail Report Template

Return a short report in this shape:

```text
Windows runtime smoke result: pass/fail

Environment:
- node:
- npm:
- rustc:
- cargo:
- link.exe:
- repo root: [placeholder path]

Build gates:
- npm run check:
- npm run build:
- cargo check:
- npm run tauri -- build --no-bundle:
- launched built exe:

Manual smoke:
- first paint/workspace switching:
- explorer large-scroll:
- terminal widgets/tabs:
- browser hidden/visible/tabs:
- browser console/forwards:
- Simple Vibe Terminal automatic ports:
- editor/image/notes/calculator/export:

Regressions found:
- ...

Performance notes:
- ...
```

If any item was not tested, mark it `not run` instead of implying success.
