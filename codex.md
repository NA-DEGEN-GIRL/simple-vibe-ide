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

## Patch Notes


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
- Workspace snapshots remember open note tabs, the active note tab, and whether
  the Notes panel was visible.

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
