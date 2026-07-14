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

Run from PowerShell in the repo root:

```powershell
.\scripts\windows-runtime-smoke.ps1
```

If dependencies are already installed and you want to skip dependency install:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

If you only want build/link validation without launching:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

If PowerShell blocks unsigned local scripts, use an execution-policy bypass for
this process only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

The script runs:

- `node --version`
- `npm --version`
- `rustc --version`
- `cargo --version`
- `Get-Command link.exe` (reported as advisory; build result is authoritative)
- `npm.cmd run check`
- `npm.cmd run build`
- `npm.cmd run build:terminal`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm.cmd run tauri -- build --no-bundle`
- `npm.cmd run tauri:terminal:build`
- launch of the built `simple-vibe-ide.exe` and `simple-vibe-terminal.exe` unless
  `-NoLaunch` is passed

## Manual Runtime Smoke Checklist

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
- Confirm the Codex launch line includes `approval_policy="never"` and
  `sandbox_mode="danger-full-access"`, and the Claude launch line includes
  `--permission-mode bypassPermissions`.
- Confirm both CLIs enter their bypass/no-approval mode and do not ask for an
  approval on a harmless read-only action. Do not use a destructive action for
  this smoke.
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
  shell processes start fresh. Runtime keep-alive/reattach is intentionally not
  part of the current product.

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
