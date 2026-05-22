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
