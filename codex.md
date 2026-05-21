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
- LLM launch buttons with default unsafe-approval bypass flags for Codex and
  Claude, plus equivalent bypass mode where supported by Grok.
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