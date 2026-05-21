# Simple Vibe IDE

Windows-only lightweight bash-grid IDE for LLM-heavy vibe coding over WSL and SSH.

## What is implemented

- Tauri v2 desktop shell with vanilla TypeScript UI.
- Left file explorer, bottom editor, resizable xterm.js terminal grid, image preview pane, and browser/port pane.
- Rust backend commands for:
  - Windows/WSL/SSH terminal spawning through PTY.
  - directory listing and text read/write for Windows local paths, WSL, and SSH.
  - screenshot paste attachment saving under the current folder at `.vibe-ide-temp/attachments/<session>/`.
  - WSL/local TCP forwarding and SSH `-L` forwarding.
- Masked key-value editor for private config files with per-row reveal buttons and a raw reveal toggle.
- LLM launcher buttons for `codex`, `claude`, `grok`, and `antigravity`.

## Windows setup

1. Install Node.js 22+.
2. Install Rust for Windows using rustup with the MSVC toolchain.
3. Install Visual Studio Build Tools C++ workload if Rust/Tauri asks for it.
4. From the repo root on a normal Windows path:

```powershell
npm install
npm run check
npm run build
cd src-tauri
cargo check
cd ..
npm run tauri:dev
```

If the repo is a WSL checkout opened from Windows through `\\wsl.localhost\...`,
use `cmd pushd` so Node tools get a temporary drive letter, and keep Cargo's
build output on a Windows filesystem:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
cmd /d /s /c 'pushd "\\wsl.localhost\<distro>\home\<user>\simple-vibe-ide" && npm install && npm run check && npm run build && cd src-tauri && cargo check && cd .. && npm run tauri:dev'
```

Run those commands serially. Parallel `npm` commands against the same WSL UNC
checkout can race on the temporary drive mapping and confuse Vite path
resolution.

For a distributable Windows build:

```powershell
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = "$env:TEMP\simple-vibe-ide-target"
npm run tauri:build
```

After building, double-click `run-built.vbs` for a quiet launch without a
console window. `run-built.cmd` is kept as a visible fallback/debug launcher.
Both launch the built exe from a Windows-local working directory while passing
the repo root separately. This avoids `wsl.exe` trying to translate a temporary
`pushd` drive for a WSL checkout.

The dev server uses `127.0.0.1:15320`. This avoids Windows reserved port ranges
that can make Tauri's usual `1420` dev port fail with `listen EACCES`.

## Usage notes

- The app starts with an empty workspace. Pick a profile, confirm or edit `Root`, then click `Open / Connect`.
- WSL distros are loaded after the first screen is interactive, and WSL `~` is resolved to the distro's `$HOME` only when you open that profile. SSH profiles are auto-created from literal `Host` aliases in your Windows OpenSSH config; wildcard hosts are ignored.
- Set `Root`, click `Open`, then use Explorer or spawn terminals. You can also browse in Explorer and click `Use This Folder` to reopen the workspace, Explorer, and shell from that directory.
- LLM buttons launch with reduced prompts by default: Codex uses `--dangerously-bypass-approvals-and-sandbox --enable goals`, Claude uses `--dangerously-skip-permissions`, and Grok uses `--permission-mode bypassPermissions`. Antigravity launches plain until a compatible local bypass flag is known.
- Explorer, Editor, Image Preview, Browser, and terminal panes can be moved by their title bars and resized from the bottom-right grip. Nearby edges snap to each other and to the terminal guide area.
- In Explorer, the mouse Back button goes to the parent directory. The `Size` toggle hides file sizes, and narrow Explorer widths hide sizes automatically while truncating long names with ellipses.
- `Ctrl` + `+` / `Ctrl` + `-` changes the focused Editor or terminal font size. Click the top title bar first when you want the shortcut to scale the whole IDE.
- Click a terminal pane to make it the active prompt target. Pasted screenshots are saved as `image.png`, then `image01.png`, `image02.png`, and so on, and the `@...` tag is typed into that active terminal.
- Image paste supports both browser clipboard image blobs and native Windows clipboard images, which covers screenshots as well as many existing-image copy flows.
- The Image Preview pane has an `Auto paste to shell` option. Pasted images are cached in the pane history, where you can preview them again, paste their `@...` tag back into the active shell, or clear the history.
- When Image Preview is focused, `Ctrl+C` copies the current preview image and `Ctrl+V` saves the clipboard image as a new attachment/history item.
- Terminal panes use Windows-like clipboard behavior: `Ctrl+C` copies only when terminal text is selected, otherwise it still sends interrupt to the shell; `Ctrl+V` pastes clipboard text into the shell.
- Clicking image files in Explorer opens them in Image Preview without treating them as UTF-8 text.
- Terminal output is scanned for local server URLs such as `http://localhost:3000`; when one appears, the Browser pane opens it automatically and WSL profiles get an automatic local forward.
- You can also type just a port number like `3000` in the Browser URL box and click `Load`; manual remote/local port fields remain available as a fallback. The device dropdown includes `Desktop`, phones, and tablets.
- Manual port forwarding accepts a remote port and optional local port. WSL/local forwarding uses an in-app TCP proxy. SSH uses `ssh.exe -N -L`.
- Browser preview is intentionally lightweight. It is good for quick local server checks and viewport switching; use app/devtools when you need full cross-origin console inspection.

## Current limitations

- WSL UNC checkouts need polling file watching, `pushd`/mapped-drive command execution, and a Windows-local Cargo target directory for reliable Windows dev builds.
- SSH file operations assume a POSIX remote with `sh`, `find`, `cat`, `base64`, and writable target paths.
- Large remote image previews are loaded through the Tauri command channel, so very large files may feel slower than local WSL/Windows previews.
