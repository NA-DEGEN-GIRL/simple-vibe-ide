use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child as ProcessChild, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

#[derive(Default)]
struct IdeState {
    terminals: Mutex<HashMap<String, TerminalSession>>,
    forwards: Mutex<HashMap<String, ForwardSession>>,
}

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    master: Box<dyn MasterPty + Send>,
}

struct ForwardSession {
    stop: Option<Arc<AtomicBool>>,
    child: Option<ProcessChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfile {
    id: String,
    label: String,
    kind: String,
    root: String,
    shell: String,
    distro: Option<String>,
    ssh_alias: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    kind: String,
    size: u64,
    hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    id: String,
    data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    id: String,
    code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentResult {
    path: String,
    tag: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortForwardResult {
    id: String,
    local_port: u16,
    target_host: String,
    remote_port: u16,
    url: String,
}

#[tauri::command]
fn list_profiles() -> Vec<ConnectionProfile> {
    let mut profiles = vec![ConnectionProfile {
        id: "windows-local".to_string(),
        label: "Windows Local".to_string(),
        kind: "windows".to_string(),
        root: std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("C:\\\\"))
            .to_string_lossy()
            .to_string(),
        shell: "powershell.exe -NoLogo".to_string(),
        distro: None,
        ssh_alias: None,
    }];

    let detected_wsl = detect_wsl_distros();
    if detected_wsl.is_empty() {
        profiles.push(ConnectionProfile {
            id: "wsl:Ubuntu".to_string(),
            label: "WSL: Ubuntu".to_string(),
            kind: "wsl".to_string(),
            root: "/home".to_string(),
            shell: "bash -l".to_string(),
            distro: Some("Ubuntu".to_string()),
            ssh_alias: None,
        });
    } else {
        for distro in detected_wsl {
            profiles.push(ConnectionProfile {
                id: format!("wsl:{distro}"),
                label: format!("WSL: {distro}"),
                kind: "wsl".to_string(),
                root: "/home".to_string(),
                shell: "bash -l".to_string(),
                distro: Some(distro),
                ssh_alias: None,
            });
        }
    }

    profiles.push(ConnectionProfile {
        id: "ssh:default".to_string(),
        label: "SSH: default".to_string(),
        kind: "ssh".to_string(),
        root: ".".to_string(),
        shell: "ssh -tt default".to_string(),
        distro: None,
        ssh_alias: Some("default".to_string()),
    });

    profiles
}

#[tauri::command]
fn list_directory(profile_id: String, path: String) -> Result<Vec<FileEntry>, String> {
    let profile = profile_from_id(&profile_id);
    match profile.kind.as_str() {
        "windows" => list_local_directory(Path::new(&path)),
        "wsl" | "ssh" => list_remote_directory(&profile, &path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn read_text_file(profile_id: String, path: String) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    match profile.kind.as_str() {
        "windows" => fs::read_to_string(&path).map_err(|err| err.to_string()),
        "wsl" | "ssh" => {
            let script = format!("cat -- {}", shell_quote(&path));
            let bytes = run_profile_shell(&profile, &script, None)?;
            Ok(String::from_utf8_lossy(&bytes).to_string())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn write_text_file(profile_id: String, path: String, content: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    match profile.kind.as_str() {
        "windows" => {
            if let Some(parent) = Path::new(&path).parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(&path, content).map_err(|err| err.to_string())
        }
        "wsl" | "ssh" => {
            let dir = parent_posix(&path);
            let script = format!(
                "mkdir -p {} && cat > {}",
                shell_quote(&dir),
                shell_quote(&path)
            );
            run_profile_shell(&profile, &script, Some(content.into_bytes()))?;
            Ok(())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn save_attachment(
    profile_id: String,
    workspace_root: String,
    session_id: String,
    file_name: String,
    base64_data: String,
) -> Result<AttachmentResult, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url_prefix(&base64_data))
        .map_err(|err| format!("invalid base64 image data: {err}"))?;
    let safe_session = sanitize_segment(&session_id);
    let safe_file = sanitize_file_name(&file_name);
    let relative = format!(".vibe-ide/attachments/{safe_session}/{safe_file}");
    let profile = profile_from_id(&profile_id);

    match profile.kind.as_str() {
        "windows" => {
            let target = Path::new(&workspace_root).join(relative.replace('/', "\\"));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(&target, data).map_err(|err| err.to_string())?;
        }
        "wsl" | "ssh" => {
            let target = join_posix(&workspace_root, &relative);
            let dir = parent_posix(&target);
            let encoded = base64::engine::general_purpose::STANDARD.encode(data);
            let script = format!(
                "mkdir -p {} && base64 -d > {}",
                shell_quote(&dir),
                shell_quote(&target)
            );
            run_profile_shell(&profile, &script, Some(encoded.into_bytes()))?;
        }
        _ => return Err(format!("unsupported profile kind: {}", profile.kind)),
    }

    let tag = format!("@{relative}");
    Ok(AttachmentResult { path: relative, tag })
}

#[tauri::command]
fn spawn_terminal(
    app: tauri::AppHandle,
    state: State<IdeState>,
    profile_id: String,
    cwd: String,
    command: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let (program, args) = terminal_command(&profile, &cwd, command);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new(program);
    for arg in args {
        cmd.arg(arg);
    }
    if profile.kind == "windows" && !cwd.is_empty() {
        cmd.cwd(PathBuf::from(&cwd));
    }

    let child = pair.slave.spawn_command(cmd).map_err(|err| err.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|err| err.to_string())?;
    let writer = pair.master.take_writer().map_err(|err| err.to_string())?;
    let terminal_id = Uuid::new_v4().to_string();

    let read_id = terminal_id.clone();
    let read_app = app.clone();
    thread::spawn(move || {
        let mut buf = [0_u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = read_app.emit("terminal-data", TerminalDataEvent {
                        id: read_id.clone(),
                        data,
                    });
                }
                Err(_) => break,
            }
        }
        let _ = read_app.emit("terminal-exit", TerminalExitEvent {
            id: read_id,
            code: None,
        });
    });

    state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?
        .insert(
            terminal_id.clone(),
            TerminalSession {
                writer,
                child,
                master: pair.master,
            },
        );

    Ok(terminal_id)
}

#[tauri::command]
fn write_terminal(state: State<IdeState>, id: String, data: String) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?;
    let session = terminals
        .get_mut(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|err| err.to_string())?;
    session.writer.flush().map_err(|err| err.to_string())
}

#[tauri::command]
fn resize_terminal(state: State<IdeState>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?;
    let session = terminals
        .get_mut(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn kill_terminal(state: State<IdeState>, id: String) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?;
    if let Some(mut session) = terminals.remove(&id) {
        session.child.kill().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_port_forward(
    state: State<IdeState>,
    profile_id: String,
    remote_port: u16,
    local_port: u16,
) -> Result<PortForwardResult, String> {
    let profile = profile_from_id(&profile_id);
    let id = Uuid::new_v4().to_string();
    let requested_local = if local_port == 0 { remote_port } else { local_port };

    if profile.kind == "ssh" {
        let alias = profile.ssh_alias.unwrap_or_else(|| "default".to_string());
        let child = Command::new("ssh.exe")
            .arg("-N")
            .arg("-L")
            .arg(format!("127.0.0.1:{requested_local}:127.0.0.1:{remote_port}"))
            .arg(alias)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("failed to start ssh forward: {err}"))?;
        state
            .forwards
            .lock()
            .map_err(|_| "forward state poisoned".to_string())?
            .insert(
                id.clone(),
                ForwardSession {
                    stop: None,
                    child: Some(child),
                },
            );
        return Ok(PortForwardResult {
            id,
            local_port: requested_local,
            target_host: "127.0.0.1".to_string(),
            remote_port,
            url: format!("http://127.0.0.1:{requested_local}"),
        });
    }

    let target_host = if profile.kind == "wsl" {
        detect_wsl_ip(profile.distro.as_deref().unwrap_or("Ubuntu"))
            .unwrap_or_else(|| "127.0.0.1".to_string())
    } else {
        "127.0.0.1".to_string()
    };

    let listener = TcpListener::bind(("127.0.0.1", requested_local))
        .map_err(|err| format!("failed to bind local port {requested_local}: {err}"))?;
    let actual_local = listener
        .local_addr()
        .map_err(|err| err.to_string())?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_target = target_host.clone();

    thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((incoming, _)) => {
                    let target = thread_target.clone();
                    thread::spawn(move || {
                        let _ = proxy_stream(incoming, target, remote_port);
                    });
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => break,
            }
        }
    });

    state
        .forwards
        .lock()
        .map_err(|_| "forward state poisoned".to_string())?
        .insert(
            id.clone(),
            ForwardSession {
                stop: Some(stop),
                child: None,
            },
        );

    Ok(PortForwardResult {
        id,
        local_port: actual_local,
        target_host,
        remote_port,
        url: format!("http://127.0.0.1:{actual_local}"),
    })
}

#[tauri::command]
fn stop_port_forward(state: State<IdeState>, id: String) -> Result<(), String> {
    let mut forwards = state
        .forwards
        .lock()
        .map_err(|_| "forward state poisoned".to_string())?;
    if let Some(mut forward) = forwards.remove(&id) {
        if let Some(stop) = forward.stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(mut child) = forward.child.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

fn detect_wsl_distros() -> Vec<String> {
    let output = Command::new("wsl.exe").arg("-l").arg("-q").output();
    let Ok(output) = output else { return Vec::new(); };
    if !output.status.success() {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(&output.stdout).replace('\0', "");
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect()
}

fn detect_wsl_ip(distro: &str) -> Option<String> {
    let output = Command::new("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--")
        .arg("hostname")
        .arg("-I")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace().next().map(|ip| ip.to_string())
}

fn profile_from_id(profile_id: &str) -> ConnectionProfile {
    if let Some(distro) = profile_id.strip_prefix("wsl:") {
        return ConnectionProfile {
            id: profile_id.to_string(),
            label: format!("WSL: {distro}"),
            kind: "wsl".to_string(),
            root: "/home".to_string(),
            shell: "bash -l".to_string(),
            distro: Some(distro.to_string()),
            ssh_alias: None,
        };
    }
    if let Some(alias) = profile_id.strip_prefix("ssh:") {
        return ConnectionProfile {
            id: profile_id.to_string(),
            label: format!("SSH: {alias}"),
            kind: "ssh".to_string(),
            root: ".".to_string(),
            shell: format!("ssh -tt {alias}"),
            distro: None,
            ssh_alias: Some(alias.to_string()),
        };
    }
    ConnectionProfile {
        id: "windows-local".to_string(),
        label: "Windows Local".to_string(),
        kind: "windows".to_string(),
        root: std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("C:\\\\"))
            .to_string_lossy()
            .to_string(),
        shell: "powershell.exe -NoLogo".to_string(),
        distro: None,
        ssh_alias: None,
    }
}

fn terminal_command(
    profile: &ConnectionProfile,
    cwd: &str,
    command: Option<String>,
) -> (String, Vec<String>) {
    match profile.kind.as_str() {
        "wsl" => {
            let distro = profile.distro.clone().unwrap_or_else(|| "Ubuntu".to_string());
            let mut args = vec!["-d".to_string(), distro];
            if !cwd.is_empty() {
                args.push("--cd".to_string());
                args.push(cwd.to_string());
            }
            args.push("--".to_string());
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                args.extend(["bash".to_string(), "-lc".to_string(), command]);
            } else {
                args.extend(["bash".to_string(), "-l".to_string()]);
            }
            ("wsl.exe".to_string(), args)
        }
        "ssh" => {
            let alias = profile.ssh_alias.clone().unwrap_or_else(|| "default".to_string());
            let remote_command = if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                command
            } else if !cwd.is_empty() && cwd != "~" {
                format!("cd {} && exec bash -l", shell_quote(cwd))
            } else {
                "exec bash -l".to_string()
            };
            ("ssh.exe".to_string(), vec!["-tt".to_string(), alias, remote_command])
        }
        _ => {
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                (
                    "powershell.exe".to_string(),
                    vec!["-NoLogo".to_string(), "-Command".to_string(), command],
                )
            } else {
                ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
            }
        }
    }
}

fn list_local_directory(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    for item in fs::read_dir(path).map_err(|err| err.to_string())? {
        let item = item.map_err(|err| err.to_string())?;
        let meta = item.metadata().map_err(|err| err.to_string())?;
        let file_name = item.file_name().to_string_lossy().to_string();
        let kind = if meta.is_dir() {
            "dir"
        } else if meta.is_file() {
            "file"
        } else {
            "other"
        };
        entries.push(FileEntry {
            hidden: file_name.starts_with('.'),
            name: file_name,
            path: item.path().to_string_lossy().to_string(),
            kind: kind.to_string(),
            size: meta.len(),
        });
    }
    sort_entries(entries)
}

fn list_remote_directory(profile: &ConnectionProfile, path: &str) -> Result<Vec<FileEntry>, String> {
    let script = format!(
        r#"dir={}
if [ ! -d "$dir" ]; then echo "not a directory: $dir" >&2; exit 2; fi
find "$dir" -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\n' 2>/dev/null || exit 3
"#,
        shell_quote(path)
    );
    let bytes = run_profile_shell(profile, &script, None)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut entries = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 {
            continue;
        }
        let kind = match parts[0] {
            "d" => "dir",
            "f" => "file",
            _ => "other",
        };
        let name = parts[2].to_string();
        entries.push(FileEntry {
            path: join_posix(path, &name),
            hidden: name.starts_with('.'),
            name,
            kind: kind.to_string(),
            size: parts[1].parse().unwrap_or(0),
        });
    }
    sort_entries(entries)
}

fn sort_entries(mut entries: Vec<FileEntry>) -> Result<Vec<FileEntry>, String> {
    entries.sort_by(|a, b| match (a.kind == "dir", b.kind == "dir") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

fn run_profile_shell(
    profile: &ConnectionProfile,
    script: &str,
    stdin_data: Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let mut command = match profile.kind.as_str() {
        "wsl" => {
            let distro = profile.distro.as_deref().unwrap_or("Ubuntu");
            let mut command = Command::new("wsl.exe");
            command.arg("-d").arg(distro).arg("--").arg("sh").arg("-lc").arg(script);
            command
        }
        "ssh" => {
            let alias = profile.ssh_alias.as_deref().unwrap_or("default");
            let remote = format!("sh -lc {}", shell_quote(script));
            let mut command = Command::new("ssh.exe");
            command.arg("-T").arg(alias).arg(remote);
            command
        }
        _ => return Err(format!("profile is not remote: {}", profile.kind)),
    };
    if stdin_data.is_some() {
        command.stdin(Stdio::piped());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("failed to run remote shell: {err}"))?;
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&data).map_err(|err| err.to_string())?;
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for remote shell: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

fn proxy_stream(mut incoming: TcpStream, target_host: String, target_port: u16) -> std::io::Result<()> {
    let mut remote = TcpStream::connect((target_host.as_str(), target_port))?;
    let mut incoming_to_remote = incoming.try_clone()?;
    let mut remote_from_incoming = remote.try_clone()?;
    let writer = thread::spawn(move || {
        let _ = std::io::copy(&mut incoming_to_remote, &mut remote_from_incoming);
    });
    let _ = std::io::copy(&mut remote, &mut incoming);
    let _ = writer.join();
    Ok(())
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn join_posix(base: &str, child: &str) -> String {
    if child.starts_with('/') || child.starts_with('~') {
        child.to_string()
    } else if base.ends_with('/') {
        format!("{base}{child}")
    } else {
        format!("{base}/{child}")
    }
}

fn parent_posix(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => ".".to_string(),
    }
}

fn sanitize_segment(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
        .collect();
    if cleaned.is_empty() {
        "default".to_string()
    } else {
        cleaned
    }
}

fn sanitize_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "image.png".to_string()
    } else {
        cleaned
    }
}

fn strip_data_url_prefix(value: &str) -> &str {
    value.split_once(',').map(|(_, data)| data).unwrap_or(value)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(IdeState::default())
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            list_directory,
            read_text_file,
            write_text_file,
            save_attachment,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            start_port_forward,
            stop_port_forward
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            window
                .set_title("Simple Vibe IDE — Windows / WSL / SSH")
                .expect("set title");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Simple Vibe IDE");
}
