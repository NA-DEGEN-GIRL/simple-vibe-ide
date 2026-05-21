# Simple Vibe IDE

Simple Vibe IDE is a Windows-only, lightweight desktop IDE for LLM-heavy coding sessions over local Windows shells, WSL, and SSH.

It is built for a fast loop: open a workspace, split a few shell panes, paste screenshots/images into the active prompt, preview local servers, and jump between Codex, Claude, Grok, or Antigravity without rebuilding the same setup every time.

Status: Windows-only, Tauri v2, pre-1.0, experimental.

![Simple Vibe IDE safe demo screenshot](docs/simple-vibe-ide-demo.png)

The screenshot uses a disposable SSH demo workspace and localhost preview with no private paths, secrets, or user data.

## Highlights

- Local, WSL, and SSH workspace profiles.
- Movable terminal grid with shell tabs and Windows-style copy/paste behavior.
- File explorer, editor, secure env-file editor, image preview, and browser preview panes.
- Clipboard image paste to workspace-local attachments with an `@...` tag inserted into the active shell.
- Automatic local/WSL development-server detection and browser preview tabs.
- LLM launcher buttons for `codex`, `claude`, `grok`, and `antigravity`.
- Workspace tabs that restore layout and working context.
- Optional workspace capture protection for streaming or screen sharing.

## Requirements

Required for development:

- Windows 10/11 x64.
- Node.js 22 or newer.
- Rust for Windows via rustup using the MSVC toolchain.
- Visual Studio Build Tools with the C++ workload, if Rust or Tauri asks for it.

Optional, depending on how you work:

- WSL with one or more distros.
- Windows OpenSSH client for SSH profiles.
- The LLM CLIs you want to launch: `codex`, `claude`, `grok`, or `antigravity`.

## Quick Start

For a normal Windows-local checkout:

```powershell
npm install
npm run tauri:dev
```

For a fuller pre-flight check:

```powershell
npm install
npm run check
npm run build
cd src-tauri
cargo check
cd ..
npm run tauri:dev
```

The Tauri dev server is pinned to `127.0.0.1:15320` to avoid Windows reserved port ranges that can make the usual Tauri dev port fail with `listen EACCES`.

## WSL Checkout From Windows

If the repo lives inside WSL and you are running Windows Node/Rust tools against it through `\\wsl.localhost`, use `cmd pushd` so Windows tools get a temporary drive letter. Keep Cargo output on a Windows-local filesystem:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && npm install && npm run check && npm run build && cd src-tauri && cargo check && cd .. && npm run tauri:dev'
```

Replace `[DISTRO]` and `[USER]` with your own WSL distro and user placeholders before running the command.

Run these commands serially. Parallel `npm` commands against the same WSL UNC checkout can race on the temporary drive mapping and confuse Vite path resolution.

## Build And Launch

For a Windows release build:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
npm run tauri:build
```

After building:

- Double-click `run-built.vbs` for the normal quiet launch without an extra console window.
- Use `run-built.cmd` when you want a visible debug launcher.

Both launch the built executable from a Windows-local working directory while passing the repo root separately. That avoids `wsl.exe` translation problems when the app was built from a WSL checkout.

## First Run

1. Start the app. It opens with an empty workspace.
2. Choose a profile: local Windows, WSL, or SSH.
3. Pick or confirm the working directory.
4. Click `Open / Connect`.
5. Use Explorer, terminal panes, editor, image preview, and browser preview from that workspace.

WSL distros are loaded after the first screen is interactive. SSH profiles are auto-created from literal `Host` aliases in your Windows OpenSSH config; wildcard host patterns are ignored.

## Feature Tour

### Workspaces And Layout

- Workspace tabs save and restore the current profile, root, pane layout, open context, and UI sizing.
- Explorer, Editor, Image Preview, Browser, and terminal widgets can be moved by their title bars and resized from the bottom-right grip.
- Nearby edges snap to each other and to the terminal guide area.
- `Ctrl` + `+` and `Ctrl` + `-` change the focused editor or terminal font size. Click the top title bar first when you want to scale the whole IDE.
- New shell widgets and shell tabs are brought to the front automatically.

### Explorer

- Browse Windows, WSL, or SSH workspaces from the same explorer.
- Use `Use This Folder` to reopen the workspace from a selected folder.
- Folders expand and collapse under the selected root like a typical IDE tree.
- Create files/folders inline and rename with `F2`.
- Type letters to select matching entries, press Enter to open, or use the mouse Back button to go to the parent directory.
- Toggle file sizes on/off; narrow widths hide sizes automatically and truncate long names with ellipses.
- Image files open in Image Preview instead of being decoded as UTF-8 text.
- Windows executable files can be opened directly, including translated WSL paths where possible.

### Editor And Secure Env Files

- Text files open in a lightweight CodeMirror editor.
- `Ctrl+S` saves and standard editor undo/redo behavior is preserved.
- Private env-style files open in a masked key-value editor with per-row reveal buttons and a raw reveal toggle.
- Example and sample env files are excluded from default masking.
- New env keys can be added while existing values remain masked.

### Terminals And LLM Launchers

- Terminal panes use PTYs for Windows, WSL, and SSH shells.
- Each terminal widget has its own shell tabs with `+` and close controls.
- `Ctrl+C` copies only when terminal text is selected; otherwise it sends interrupt to the shell.
- `Ctrl+V` pastes clipboard text into the shell.
- LLM launcher buttons open new terminal sessions for `codex`, `claude`, `grok`, and `antigravity`.

By default, the LLM launchers use approval/permission bypass flags where known:

- Codex: `--dangerously-bypass-approvals-and-sandbox --enable goals`
- Claude: `--dangerously-skip-permissions`
- Grok: `--permission-mode bypassPermissions`
- Antigravity: launches with default prompts until a compatible local bypass flag is known.

### Images

- Paste screenshots or copied image files into the app to save them under the current workspace's temp attachment folder.
- The first image is saved as `image.png`, then `image01.png`, `image02.png`, and so on.
- The active terminal receives an `@...` tag for the saved attachment.
- Image Preview keeps a small history, supports clear history, and can paste a selected image tag back into the active shell.
- When Image Preview is focused, `Ctrl+C` copies the current preview image and `Ctrl+V` saves the clipboard image as a new attachment/history item.
- `Auto paste to shell` controls whether externally pasted images are automatically sent to the active shell when first imported.

### Browser And Port Forwarding

- Terminal output is scanned for local server URLs such as `http://localhost:3000`.
- Detected servers can be opened in Browser tabs, and WSL profiles get automatic local forwarding where possible.
- You can type a full URL or just a port number like `3000` in the Browser URL box and click `Load`.
- The device menu includes desktop, phone, and tablet presets.
- Hard refresh is available for stale local previews.
- Manual remote/local port forwarding remains available as a fallback. WSL/local forwarding uses an in-app TCP proxy; SSH uses `ssh.exe -N -L`.
- The browser preview is intentionally lightweight. Use a full browser/devtools when you need full debugging, extension support, or complex cross-origin inspection.

### Capture Protection

Workspace tabs include a capture-protection control for streaming or screen sharing. When enabled, the app uses Windows capture-affinity APIs and an in-app protected overlay so protected workspace content is hidden or frozen in many capture paths.

This is a privacy aid, not a guarantee. OBS and other tools have multiple capture backends, and behavior depends on the capture mode. Test your exact streaming setup before relying on it live.

## Safety And Privacy Notes

- This project is Windows-only and pre-1.0. Treat it as an experimental local tool.
- LLM launcher buttons intentionally use permission/sandbox bypass flags by default where known. That can let the launched CLI run commands without per-action approval. Launch the CLI manually in a terminal if you want its normal prompts instead.
- The secure env editor masks values in the UI, but it does not encrypt files on disk.
- Pasted images are stored inside the workspace temp attachment folder. The repo ignores that folder by default.
- Avoid committing private env files, credentials, screenshots, or workspace temp attachments to public repositories.
- Capture protection is best-effort and should be tested with your actual OBS or screen-sharing capture mode.

## Troubleshooting

### `npm run dev` or Tauri dev fails with `listen EACCES`

The app uses `127.0.0.1:15320` for development to avoid common Windows reserved-port conflicts. If another process already uses that port, change the dev server port in `vite.config.ts` and the Tauri config together.

### WSL UNC builds feel slow or path resolution breaks

Use the WSL checkout command above with `cmd pushd` and a Windows-local `CARGO_TARGET_DIR`. Running Windows tools directly from a raw UNC working directory can confuse npm, Vite, Cargo, and Tauri in different ways.

### The built app shows `wsl.exe` path translation errors

Launch through `run-built.vbs` after building. It starts the executable from a Windows-local working directory and passes the repo root separately.

### LLM buttons open a terminal but the command is not found

Install the matching CLI and make sure it is available on the PATH for the selected shell/profile. WSL, SSH, and Windows shells each have their own PATH environment.

### SSH profile is missing

Only literal `Host` aliases from your Windows OpenSSH config are auto-imported. Wildcard entries are ignored.

### Browser preview still shows a stopped local server

Use hard refresh, or open a new browser tab for that port. Static pages may remain visible from cache even after a test server is stopped.

## Current Limitations

- WSL UNC checkouts need polling file watching, `pushd`/mapped-drive command execution, and a Windows-local Cargo target directory for reliable Windows dev builds.
- SSH file operations assume a POSIX remote with `sh`, `find`, `cat`, `base64`, and writable target paths.
- Large remote image previews are loaded through the Tauri command channel, so very large files may feel slower than local WSL/Windows previews.
- Restored workspaces save UI/work context, but long-running shell processes are recreated rather than resumed from an old process snapshot.
- Capture protection depends on Windows and the capture backend used by the streaming or screen-sharing tool.
- There is no signed installer or stable release channel yet.

## Project Layout

- `src/` contains the TypeScript UI.
- `src-tauri/` contains the Rust backend and Tauri configuration.
- `public/` contains static WebView assets such as the capture cover.
- `run-built.vbs` and `run-built.cmd` are Windows launch helpers for built artifacts.
- `codex.md` contains privacy-safe implementation notes and patch notes.

## License

License is not selected yet.