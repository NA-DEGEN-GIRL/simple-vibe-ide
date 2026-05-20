# Simple Vibe IDE

Windows-only lightweight bash-grid IDE for LLM-heavy vibe coding over WSL and SSH.

## What is implemented

- Tauri v2 desktop shell with vanilla TypeScript UI.
- Left file explorer, bottom editor, resizable xterm.js terminal grid, image preview pane, and browser/port pane.
- Rust backend commands for:
  - Windows/WSL/SSH terminal spawning through PTY.
  - directory listing and text read/write for Windows local paths, WSL, and SSH.
  - screenshot paste attachment saving under `.vibe-ide/attachments/<session>/`.
  - WSL/local TCP forwarding and SSH `-L` forwarding.
- Masked key-value editor for private config files with per-row reveal buttons and a raw reveal toggle.
- LLM launcher buttons for `codex`, `claude`, `grok`, and `antigravity`.

## Windows setup

1. Install Node.js 22+.
2. Install Rust for Windows using rustup with the MSVC toolchain.
3. Install Visual Studio Build Tools C++ workload if Rust/Tauri asks for it.
4. From the repo root:

```powershell
npm install
npm run tauri:dev
```

For a distributable Windows build:

```powershell
npm run tauri:build
```

## Usage notes

- Pick a profile from the top bar. WSL distros are auto-detected with `wsl.exe -l -q`; an `SSH: default` placeholder is included for hosts configured in your Windows OpenSSH config.
- Set `Root`, click `Open`, then use Explorer or spawn terminals.
- Click a terminal pane to make it the active prompt target. Pasted screenshots are saved as `image.png`, then `image01.png`, `image02.png`, and so on, and the `@...` tag is typed into that active terminal.
- Port forwarding accepts a remote port and optional local port. WSL/local forwarding uses an in-app TCP proxy. SSH uses `ssh.exe -N -L`.
- Browser preview is intentionally lightweight. It is good for quick local server checks and viewport switching; use app/devtools when you need full cross-origin console inspection.

## Current limitations

- The Linux/WSL checkout used for this implementation has Node/npm but no Rust toolchain, so frontend build was verified here and Tauri/Rust compilation must be verified on Windows after Rust is installed.
- SSH file operations assume a POSIX remote with `sh`, `find`, `cat`, `base64`, and writable target paths.
- Image file preview from remote explorer is not yet streaming remote image bytes; pasted images preview immediately from the clipboard data.
