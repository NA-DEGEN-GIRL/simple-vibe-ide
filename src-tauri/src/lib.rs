use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child as ProcessChild, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use uuid::Uuid;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
};

#[cfg(windows)]
use windows::Win32::System::Ole::CF_HDROP;

#[cfg(windows)]
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, SetWindowPos, SWP_NOACTIVATE, SWP_SHOWWINDOW, WDA_EXCLUDEFROMCAPTURE,
    WDA_NONE,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

type EdgeSessionStore = Arc<Mutex<HashMap<String, EdgeDevtoolsSessionState>>>;

#[derive(Default)]
struct IdeState {
    terminals: Mutex<HashMap<String, TerminalSession>>,
    forwards: Mutex<HashMap<String, ForwardSession>>,
    exports: Mutex<HashMap<String, ExportSession>>,
    edge_sessions: EdgeSessionStore,
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

struct ExportSession {
    cancel: Arc<AtomicBool>,
}

struct EdgeDevtoolsSessionState {
    child: Option<ProcessChild>,
    port: u16,
}

fn default_windows_root() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|root| root.trim().trim_end_matches(['\\', '/']).to_string())
        .filter(|root| !root.is_empty())
        .unwrap_or_else(|| "C:\\\\".to_string())
}

fn default_wsl_root(distro: &str) -> String {
    detect_wsl_home(distro).unwrap_or_else(|| "/home".to_string())
}

fn windows_spawn_cwd() -> PathBuf {
    let drive = std::env::var("SystemDrive")
        .ok()
        .map(|value| {
            value
                .trim_end_matches(|c| c == '\\' || c == '/')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "C:".to_string());
    let root = PathBuf::from(format!("{drive}\\"));
    if root.exists() {
        root
    } else {
        std::env::temp_dir()
    }
}

fn windows_shell_cwd() -> PathBuf {
    let app_dir = "simple-vibe-ide-shell";
    let mut candidates = Vec::new();

    if let Ok(windir) = std::env::var("WINDIR") {
        candidates.push(PathBuf::from(windir).join("Temp").join(app_dir));
    }

    let drive = std::env::var("SystemDrive")
        .ok()
        .map(|value| {
            value
                .trim_end_matches(|c| c == '\\' || c == '/')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "C:".to_string());
    candidates.push(PathBuf::from(format!("{drive}\\Temp")).join(app_dir));
    candidates.push(windows_spawn_cwd().join(app_dir));
    candidates.push(std::env::temp_dir().join(app_dir));

    for candidate in candidates {
        if fs::create_dir_all(&candidate).is_ok() {
            return candidate;
        }
    }

    windows_spawn_cwd()
}

fn wsl_windows_path_to_posix(path: &str, distro: &str) -> Option<String> {
    let normalized = path.replace('/', "\\");
    let normalized_lower = normalized.to_lowercase();
    let distro_lower = distro.to_lowercase();
    let prefixes = [
        format!("\\\\wsl.localhost\\{distro_lower}\\"),
        format!("\\\\wsl$\\{distro_lower}\\"),
    ];

    for prefix in prefixes {
        if normalized_lower.starts_with(&prefix) {
            let tail = &normalized[prefix.len()..];
            return Some(windows_tail_to_posix(tail));
        }
    }

    None
}

fn windows_tail_to_posix(tail: &str) -> String {
    let parts: Vec<&str> = tail.split('\\').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

fn normalize_profile_path(profile: &ConnectionProfile, path: &str) -> String {
    if profile.kind == "wsl" {
        if let Some(distro) = profile.distro.as_deref() {
            if let Some(converted) = wsl_windows_path_to_posix(path, distro) {
                return converted;
            }
        }
    }
    path.to_string()
}

fn wsl_posix_path_to_windows_path(profile: &ConnectionProfile, path: &str) -> Option<PathBuf> {
    if profile.kind != "wsl" {
        return None;
    }
    let normalized = path.replace('\\', "/");
    if let Some(rest) = normalized.strip_prefix("/mnt/") {
        let mut parts = rest.splitn(2, '/');
        let drive = parts.next()?.chars().next()?.to_ascii_uppercase();
        if !drive.is_ascii_alphabetic() {
            return None;
        }
        let tail = parts.next().unwrap_or("").replace('/', "\\");
        return Some(if tail.is_empty() {
            PathBuf::from(format!("{drive}:\\"))
        } else {
            PathBuf::from(format!("{drive}:\\{tail}"))
        });
    }

    if !normalized.starts_with('/') {
        return None;
    }
    let distro = profile.distro.as_deref()?;
    let tail = normalized.trim_start_matches('/').replace('/', "\\");
    Some(PathBuf::from(format!(
        "\\\\wsl.localhost\\{distro}\\{tail}"
    )))
}

fn hide_command_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    id: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeDevtoolsSession {
    id: String,
    port: u16,
    browser_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EdgeDevtoolsPage {
    id: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    web_socket_debugger_url: String,
}

struct HttpTarget {
    host: String,
    port: u16,
    origin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportStartResult {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgressEvent {
    id: String,
    name: String,
    status: String,
    progress: Option<f64>,
    output_path: Option<String>,
    message: Option<String>,
    directory: bool,
}

#[tauri::command]
fn list_profiles() -> Vec<ConnectionProfile> {
    let mut profiles = vec![ConnectionProfile {
        id: "windows-local".to_string(),
        label: "Windows Local".to_string(),
        kind: "windows".to_string(),
        root: default_windows_root(),
        shell: "powershell.exe -NoLogo".to_string(),
        distro: None,
        ssh_alias: None,
    }];

    profiles.extend(ssh_profiles());
    profiles
}

#[tauri::command]
fn list_wsl_profiles() -> Vec<ConnectionProfile> {
    let mut profiles = Vec::new();
    let detected_wsl = detect_wsl_distros();
    if detected_wsl.is_empty() {
        profiles.push(ConnectionProfile {
            id: "wsl:Ubuntu".to_string(),
            label: "WSL: Ubuntu".to_string(),
            kind: "wsl".to_string(),
            root: "~".to_string(),
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
                root: "~".to_string(),
                shell: "bash -l".to_string(),
                distro: Some(distro),
                ssh_alias: None,
            });
        }
    }
    profiles
}

#[tauri::command]
fn windows_shell_root() -> String {
    windows_shell_cwd().to_string_lossy().to_string()
}

#[tauri::command]
fn set_capture_protection(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    if enabled {
        show_capture_cover(&app, &window)?;
    } else {
        hide_capture_cover(&app);
    }
    set_window_capture_protection(&window, enabled)
}

fn show_capture_cover<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    main: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let cover = create_capture_cover(app)?;
    sync_capture_cover(main, &cover)?;
    Ok(())
}

fn create_capture_cover<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window("capture-cover") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        "capture-cover",
        WebviewUrl::App("capture-cover.html".into()),
    )
    .title("Protected Workspace")
    .decorations(false)
    .resizable(false)
    .visible(false)
    .skip_taskbar(true)
    .shadow(false)
    .build()
    .map_err(|error| error.to_string())
}

fn hide_capture_cover<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(cover) = app.get_webview_window("capture-cover") {
        let _ = cover.hide();
    }
}

fn close_capture_cover<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(cover) = app.get_webview_window("capture-cover") {
        let _ = cover.close();
    }
}

fn sync_capture_cover<R: tauri::Runtime>(
    main: &tauri::WebviewWindow<R>,
    cover: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let position = main.outer_position().map_err(|error| error.to_string())?;
    let size = main.outer_size().map_err(|error| error.to_string())?;
    cover
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| error.to_string())?;
    cover
        .set_size(PhysicalSize::new(size.width, size.height))
        .map_err(|error| error.to_string())?;
    position_capture_cover_behind_main(main, cover, position, size)?;
    bring_window_to_front(main);
    Ok(())
}

#[cfg(windows)]
fn position_capture_cover_behind_main<R: tauri::Runtime>(
    main: &tauri::WebviewWindow<R>,
    cover: &tauri::WebviewWindow<R>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    let main_hwnd = main.hwnd().map_err(|error| error.to_string())?;
    let cover_hwnd = cover.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            cover_hwnd,
            Some(main_hwnd),
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    }
    .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn position_capture_cover_behind_main<R: tauri::Runtime>(
    _main: &tauri::WebviewWindow<R>,
    cover: &tauri::WebviewWindow<R>,
    _position: PhysicalPosition<i32>,
    _size: PhysicalSize<u32>,
) -> Result<(), String> {
    cover.show().map_err(|error| error.to_string())
}

#[cfg(windows)]
fn set_window_capture_protection<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let affinity = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn set_window_capture_protection<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        Err("capture protection is only available on Windows".to_string())
    } else {
        Ok(())
    }
}

fn ssh_profiles() -> Vec<ConnectionProfile> {
    let mut profiles = Vec::new();

    let mut ssh_aliases = detect_ssh_aliases();
    if ssh_aliases.is_empty() {
        ssh_aliases.push("default".to_string());
    }
    for alias in ssh_aliases {
        profiles.push(ConnectionProfile {
            id: format!("ssh:{alias}"),
            label: format!("SSH: {alias}"),
            kind: "ssh".to_string(),
            root: ".".to_string(),
            shell: format!("ssh -tt {alias}"),
            distro: None,
            ssh_alias: Some(alias),
        });
    }

    profiles
}

#[tauri::command]
fn resolve_profile_path(profile_id: String, path: String) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let trimmed = path.trim();
    if profile.kind == "wsl" && (trimmed.is_empty() || trimmed == "~") {
        let distro = profile.distro.as_deref().unwrap_or("Ubuntu");
        return Ok(default_wsl_root(distro));
    }
    if profile.kind == "wsl" {
        if let Some(rest) = trimmed.strip_prefix("~/") {
            let distro = profile.distro.as_deref().unwrap_or("Ubuntu");
            return Ok(join_posix(&default_wsl_root(distro), rest));
        }
    }
    if profile.kind == "windows" && trimmed.is_empty() {
        return Ok(default_windows_root());
    }
    if profile.kind == "ssh" && trimmed.is_empty() {
        return Ok(".".to_string());
    }
    Ok(normalize_profile_path(&profile, trimmed))
}

#[tauri::command]
fn list_directory(profile_id: String, path: String) -> Result<Vec<FileEntry>, String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => list_local_directory(Path::new(&path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                list_wsl_directory(&windows_path, &path)
            } else {
                list_remote_directory(&profile, &path)
            }
        }
        "ssh" => list_remote_directory(&profile, &path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn read_text_file(profile_id: String, path: String) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => fs::read_to_string(&path).map_err(|err| err.to_string()),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                fs::read_to_string(windows_path).map_err(|err| err.to_string())
            } else {
                let script = format!("cat -- {}", shell_quote(&path));
                let bytes = run_profile_shell(&profile, &script, None)?;
                Ok(String::from_utf8_lossy(&bytes).to_string())
            }
        }
        "ssh" => {
            let script = format!("cat -- {}", shell_quote(&path));
            let bytes = run_profile_shell(&profile, &script, None)?;
            Ok(String::from_utf8_lossy(&bytes).to_string())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn read_file_data_url(profile_id: String, path: String) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    let bytes = match profile.kind.as_str() {
        "windows" => fs::read(&path).map_err(|err| err.to_string())?,
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                fs::read(windows_path).map_err(|err| err.to_string())?
            } else {
                let script = format!("cat -- {}", shell_quote(&path));
                run_profile_shell(&profile, &script, None)?
            }
        }
        "ssh" => {
            let script = format!("cat -- {}", shell_quote(&path));
            run_profile_shell(&profile, &script, None)?
        }
        _ => return Err(format!("unsupported profile kind: {}", profile.kind)),
    };
    let mime = mime_type_for_path(&path);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn write_text_file(profile_id: String, path: String, content: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => {
            if let Some(parent) = Path::new(&path).parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(&path, content).map_err(|err| err.to_string())
        }
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                if let Some(parent) = windows_path.parent() {
                    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
                }
                fs::write(windows_path, content).map_err(|err| err.to_string())
            } else {
                let dir = parent_posix(&path);
                let script = format!(
                    "mkdir -p {} && cat > {}",
                    shell_quote(&dir),
                    shell_quote(&path)
                );
                run_profile_shell(&profile, &script, Some(content.into_bytes()))?;
                Ok(())
            }
        }
        "ssh" => {
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
fn create_directory(profile_id: String, path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => create_local_directory(Path::new(&path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                create_local_directory(&windows_path)
            } else {
                let script = format!("mkdir -- {}", shell_quote(&path));
                run_profile_shell(&profile, &script, None)?;
                Ok(())
            }
        }
        "ssh" => {
            let script = format!("mkdir -- {}", shell_quote(&path));
            run_profile_shell(&profile, &script, None)?;
            Ok(())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn create_file(profile_id: String, path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => create_local_file(Path::new(&path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                create_local_file(&windows_path)
            } else {
                let script = format!(
                    "if [ -e {} ]; then echo 'target already exists' >&2; exit 1; fi; : > {}",
                    shell_quote(&path),
                    shell_quote(&path)
                );
                run_profile_shell(&profile, &script, None)?;
                Ok(())
            }
        }
        "ssh" => {
            let script = format!(
                "if [ -e {} ]; then echo 'target already exists' >&2; exit 1; fi; : > {}",
                shell_quote(&path),
                shell_quote(&path)
            );
            run_profile_shell(&profile, &script, None)?;
            Ok(())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn rename_path(profile_id: String, old_path: String, new_path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let old_path = normalize_profile_path(&profile, &old_path);
    let new_path = normalize_profile_path(&profile, &new_path);
    match profile.kind.as_str() {
        "windows" => rename_local_path(Path::new(&old_path), Path::new(&new_path)),
        "wsl" => {
            let old_windows = wsl_posix_path_to_windows_path(&profile, &old_path);
            let new_windows = wsl_posix_path_to_windows_path(&profile, &new_path);
            if let (Some(old_windows), Some(new_windows)) = (old_windows, new_windows) {
                rename_local_path(&old_windows, &new_windows)
            } else {
                let script = format!(
                    "if [ -e {} ]; then echo 'target already exists' >&2; exit 1; fi; mv -- {} {}",
                    shell_quote(&new_path),
                    shell_quote(&old_path),
                    shell_quote(&new_path)
                );
                run_profile_shell(&profile, &script, None)?;
                Ok(())
            }
        }
        "ssh" => {
            let script = format!(
                "if [ -e {} ]; then echo 'target already exists' >&2; exit 1; fi; mv -- {} {}",
                shell_quote(&new_path),
                shell_quote(&old_path),
                shell_quote(&new_path)
            );
            run_profile_shell(&profile, &script, None)?;
            Ok(())
        }
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn open_path(profile_id: String, path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    let target = match profile.kind.as_str() {
        "windows" => PathBuf::from(&path),
        "wsl" => wsl_posix_path_to_windows_path(&profile, &path)
            .ok_or_else(|| "cannot translate WSL path to a Windows path".to_string())?,
        "ssh" => return Err("opening remote SSH files in Windows is not supported".to_string()),
        _ => return Err(format!("unsupported profile kind: {}", profile.kind)),
    };

    if !target.exists() {
        return Err(format!("path does not exist: {}", target.to_string_lossy()));
    }

    let mut command = Command::new("cmd.exe");
    command
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(target.to_string_lossy().to_string())
        .current_dir(windows_spawn_cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_command_window(&mut command)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    clipboard_file_paths()
}

#[tauri::command]
fn save_clipboard_image_file(
    profile_id: String,
    target_dir: String,
    file_name: String,
    base64_data: String,
) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url_prefix(&base64_data))
        .map_err(|err| format!("invalid base64 image data: {err}"))?;
    let safe_file = sanitize_file_name(&file_name);
    let profile = profile_from_id(&profile_id);
    let target_dir = normalize_profile_path(&profile, &target_dir);

    match profile.kind.as_str() {
        "windows" => save_clipboard_image_to_local(Path::new(&target_dir), &safe_file, data)
            .map(|path| path.to_string_lossy().to_string()),
        "wsl" => {
            if let Some(windows_dir) = wsl_posix_path_to_windows_path(&profile, &target_dir) {
                let target = save_clipboard_image_to_local(&windows_dir, &safe_file, data)?;
                let name = local_file_name(&target)?;
                Ok(join_posix(&target_dir, &name))
            } else {
                save_clipboard_image_to_remote(&profile, &target_dir, &safe_file, data)
            }
        }
        "ssh" => save_clipboard_image_to_remote(&profile, &target_dir, &safe_file, data),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn copy_dropped_files(
    profile_id: String,
    target_dir: String,
    source_paths: Vec<String>,
) -> Result<usize, String> {
    if source_paths.is_empty() {
        return Ok(0);
    }

    let profile = profile_from_id(&profile_id);
    let target_dir = normalize_profile_path(&profile, &target_dir);
    match profile.kind.as_str() {
        "windows" => copy_dropped_files_to_local(Path::new(&target_dir), &source_paths),
        "wsl" => {
            if let Some(windows_dir) = wsl_posix_path_to_windows_path(&profile, &target_dir) {
                copy_dropped_files_to_local(&windows_dir, &source_paths)
            } else {
                copy_dropped_files_to_remote(&profile, &target_dir, &source_paths)
            }
        }
        "ssh" => copy_dropped_files_to_remote(&profile, &target_dir, &source_paths),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
fn start_export_path(
    app: tauri::AppHandle,
    state: State<IdeState>,
    profile_id: String,
    path: String,
) -> Result<ExportStartResult, String> {
    let profile = profile_from_id(&profile_id);
    let source_path = normalize_profile_path(&profile, &path);
    let display_name = export_display_name(&profile, &source_path);
    let id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .exports
        .lock()
        .map_err(|_| "export lock poisoned".to_string())?
        .insert(
            id.clone(),
            ExportSession {
                cancel: cancel.clone(),
            },
        );

    let app_handle = app.clone();
    let id_for_thread = id.clone();
    let name_for_thread = display_name.clone();
    let name_for_result = display_name.clone();
    thread::spawn(move || {
        let result = export_source_info(&profile, &source_path).and_then(|info| {
            run_export_job(
                &app_handle,
                &id_for_thread,
                &profile,
                &source_path,
                info,
                cancel.clone(),
            )
        });
        if let Err(error) = result {
            emit_export_event(
                &app_handle,
                ExportProgressEvent {
                    id: id_for_thread.clone(),
                    name: name_for_thread.clone(),
                    status: if cancel.load(Ordering::Relaxed) {
                        "cancelled".to_string()
                    } else {
                        "failed".to_string()
                    },
                    progress: None,
                    output_path: None,
                    message: Some(error),
                    directory: false,
                },
            );
        }
        if let Ok(mut exports) = app_handle.state::<IdeState>().exports.lock() {
            exports.remove(&id_for_thread);
        }
    });

    Ok(ExportStartResult {
        id,
        name: name_for_result,
    })
}

#[tauri::command]
fn cancel_export_path(state: State<IdeState>, id: String) -> Result<(), String> {
    if let Some(session) = state
        .exports
        .lock()
        .map_err(|_| "export lock poisoned".to_string())?
        .get(&id)
    {
        session.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn open_export_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("export path does not exist".to_string());
    }

    let mut command = Command::new("explorer.exe");
    if target.is_dir() {
        command.arg(target.to_string_lossy().to_string());
    } else {
        command.arg(format!("/select,{}", target.to_string_lossy()));
    }
    command
        .current_dir(windows_spawn_cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_command_window(&mut command)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_attachment(
    profile_id: String,
    current_dir: String,
    session_id: String,
    file_name: String,
    base64_data: String,
) -> Result<AttachmentResult, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url_prefix(&base64_data))
        .map_err(|err| format!("invalid base64 image data: {err}"))?;
    let safe_session = sanitize_segment(&session_id);
    let safe_file = sanitize_file_name(&file_name);
    let relative = format!(".vibe-ide-temp/attachments/{safe_session}/{safe_file}");
    let profile = profile_from_id(&profile_id);
    let current_dir = normalize_profile_path(&profile, &current_dir);

    match profile.kind.as_str() {
        "windows" => {
            let target = Path::new(&current_dir).join(relative.replace('/', "\\"));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(&target, data).map_err(|err| err.to_string())?;
        }
        "wsl" => {
            if let Some(windows_dir) = wsl_posix_path_to_windows_path(&profile, &current_dir) {
                let target = windows_dir.join(relative.replace('/', "\\"));
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
                }
                fs::write(&target, data).map_err(|err| err.to_string())?;
            } else {
                let target = join_posix(&current_dir, &relative);
                let dir = parent_posix(&target);
                let encoded = base64::engine::general_purpose::STANDARD.encode(data);
                let script = format!(
                    "mkdir -p {} && base64 -d > {}",
                    shell_quote(&dir),
                    shell_quote(&target)
                );
                run_profile_shell(&profile, &script, Some(encoded.into_bytes()))?;
            }
        }
        "ssh" => {
            let target = join_posix(&current_dir, &relative);
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
    Ok(AttachmentResult {
        path: relative,
        tag,
    })
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
    let cwd = normalize_profile_path(&profile, &cwd);
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
    } else if profile.kind == "wsl" || profile.kind == "ssh" {
        cmd.cwd(windows_spawn_cwd());
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| err.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| err.to_string())?;
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
                    let _ = read_app.emit(
                        "terminal-data",
                        TerminalDataEvent {
                            id: read_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = read_app.emit(
            "terminal-exit",
            TerminalExitEvent {
                id: read_id,
                code: None,
            },
        );
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
    let requested_local = local_port;

    if profile.kind == "ssh" {
        if requested_local == 0 {
            return Err(
                "automatic local port allocation is not supported for SSH forwards yet".to_string(),
            );
        }
        let alias = profile.ssh_alias.unwrap_or_else(|| "default".to_string());
        let mut command = Command::new("ssh.exe");
        command
            .arg("-N")
            .arg("-L")
            .arg(format!(
                "127.0.0.1:{requested_local}:127.0.0.1:{remote_port}"
            ))
            .arg(alias)
            .current_dir(windows_spawn_cwd())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = hide_command_window(&mut command)
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

    let target_host = "127.0.0.1".to_string();

    // WSL localhost forwarding already exposes many dev servers on Windows localhost.
    // Binding the same local port again would proxy 127.0.0.1:port back to itself.
    if requested_local == remote_port {
        state
            .forwards
            .lock()
            .map_err(|_| "forward state poisoned".to_string())?
            .insert(
                id.clone(),
                ForwardSession {
                    stop: None,
                    child: None,
                },
            );

        return Ok(PortForwardResult {
            id,
            local_port: remote_port,
            target_host,
            remote_port,
            url: format!("http://127.0.0.1:{remote_port}"),
        });
    }

    let listener = TcpListener::bind(("127.0.0.1", requested_local))
        .map_err(|err| format!("failed to bind local port {requested_local}: {err}"))?;
    let actual_local = listener.local_addr().map_err(|err| err.to_string())?.port();
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
fn start_preview_proxy(
    state: State<IdeState>,
    target_url: String,
) -> Result<PortForwardResult, String> {
    let target = parse_http_preview_target(&target_url)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| format!("failed to bind preview proxy: {err}"))?;
    let actual_local = listener.local_addr().map_err(|err| err.to_string())?.port();
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let id = Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_host = target.host.clone();
    let thread_port = target.port;

    thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((incoming, _)) => {
                    let host = thread_host.clone();
                    thread::spawn(move || {
                        let _ = proxy_http_preview(incoming, host, thread_port);
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
        target_host: target.origin,
        remote_port: target.port,
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

#[tauri::command]
async fn start_edge_devtools_session(
    state: State<'_, IdeState>,
    workspace_id: String,
) -> Result<EdgeDevtoolsSession, String> {
    let edge_sessions = Arc::clone(&state.edge_sessions);
    tauri::async_runtime::spawn_blocking(move || {
        start_edge_devtools_session_blocking(edge_sessions, workspace_id)
    })
    .await
    .map_err(|err| format!("Edge startup task failed: {err}"))?
}

fn start_edge_devtools_session_blocking(
    edge_sessions: EdgeSessionStore,
    workspace_id: String,
) -> Result<EdgeDevtoolsSession, String> {
    let id = normalized_edge_session_id(&workspace_id);
    {
        let mut sessions = edge_sessions
            .lock()
            .map_err(|_| "edge session state poisoned".to_string())?;
        if let Some(session) = sessions.get_mut(&id) {
            let alive = match session.child.as_mut() {
                Some(child) => matches!(child.try_wait(), Ok(None)),
                None => true,
            };
            if alive {
                return Ok(edge_session_result(&id, session.port));
            }
            sessions.remove(&id);
        }
    }

    let port = allocate_local_port()?;
    let user_data_dir = std::env::temp_dir()
        .join("simple-vibe-ide-edge")
        .join(format!("{}-{port}", safe_edge_session_path(&id)));
    fs::create_dir_all(&user_data_dir)
        .map_err(|err| format!("failed to prepare Edge profile: {err}"))?;

    let mut command = Command::new(resolve_edge_executable());
    command
        .arg(format!("--remote-debugging-port={port}"))
        .arg("--remote-allow-origins=*")
        .arg(format!(
            "--user-data-dir={}",
            user_data_dir.to_string_lossy()
        ))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-background-networking")
        .arg("--headless=new")
        .arg("--window-size=1280,900")
        .arg("about:blank")
        .current_dir(windows_spawn_cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = hide_command_window(&mut command)
        .spawn()
        .map_err(|err| format!("failed to start Edge: {err}"))?;

    if let Err(err) = wait_for_edge_devtools(port) {
        let _ = child.kill();
        return Err(err);
    }

    edge_sessions
        .lock()
        .map_err(|_| "edge session state poisoned".to_string())?
        .insert(
            id.clone(),
            EdgeDevtoolsSessionState {
                child: Some(child),
                port,
            },
        );

    Ok(edge_session_result(&id, port))
}

#[tauri::command]
async fn edge_devtools_new_page(
    state: State<'_, IdeState>,
    session_id: String,
    url: String,
) -> Result<EdgeDevtoolsPage, String> {
    let edge_sessions = Arc::clone(&state.edge_sessions);
    tauri::async_runtime::spawn_blocking(move || {
        let port = edge_session_port(&edge_sessions, &session_id)?;
        let path = format!("/json/new?{}", percent_encode_component(&url));
        let body = devtools_http_request(port, "PUT", &path)
            .or_else(|_| devtools_http_request(port, "GET", &path))?;
        let page: EdgeDevtoolsPage = serde_json::from_str(&body)
            .map_err(|err| format!("failed to parse Edge target: {err}"))?;
        if page.web_socket_debugger_url.trim().is_empty() {
            return Err("Edge target did not expose a debugger websocket".to_string());
        }
        Ok(page)
    })
    .await
    .map_err(|err| format!("Edge page task failed: {err}"))?
}

#[tauri::command]
async fn edge_devtools_activate_page(
    state: State<'_, IdeState>,
    session_id: String,
    target_id: String,
) -> Result<(), String> {
    let edge_sessions = Arc::clone(&state.edge_sessions);
    tauri::async_runtime::spawn_blocking(move || {
        let port = edge_session_port(&edge_sessions, &session_id)?;
        let path = format!("/json/activate/{}", percent_encode_component(&target_id));
        devtools_http_request(port, "GET", &path).map(|_| ())
    })
    .await
    .map_err(|err| format!("Edge activate task failed: {err}"))?
}

#[tauri::command]
async fn edge_devtools_close_page(
    state: State<'_, IdeState>,
    session_id: String,
    target_id: String,
) -> Result<(), String> {
    let edge_sessions = Arc::clone(&state.edge_sessions);
    tauri::async_runtime::spawn_blocking(move || {
        let port = edge_session_port(&edge_sessions, &session_id)?;
        let path = format!("/json/close/{}", percent_encode_component(&target_id));
        devtools_http_request(port, "GET", &path).map(|_| ())
    })
    .await
    .map_err(|err| format!("Edge close task failed: {err}"))?
}

#[tauri::command]
fn stop_edge_devtools_session(state: State<IdeState>, session_id: String) -> Result<(), String> {
    let id = normalized_edge_session_id(&session_id);
    let mut sessions = state
        .edge_sessions
        .lock()
        .map_err(|_| "edge session state poisoned".to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        if let Some(mut child) = session.child.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

fn normalized_edge_session_id(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed.to_string()
    }
}

fn edge_session_result(id: &str, port: u16) -> EdgeDevtoolsSession {
    EdgeDevtoolsSession {
        id: id.to_string(),
        port,
        browser_url: format!("http://127.0.0.1:{port}"),
    }
}

fn edge_session_port(edge_sessions: &EdgeSessionStore, session_id: &str) -> Result<u16, String> {
    let id = normalized_edge_session_id(session_id);
    edge_sessions
        .lock()
        .map_err(|_| "edge session state poisoned".to_string())?
        .get(&id)
        .map(|session| session.port)
        .ok_or_else(|| format!("Edge session not found: {id}"))
}

fn allocate_local_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| format!("failed to allocate local port: {err}"))?
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|err| err.to_string())
}

fn wait_for_edge_devtools(port: u16) -> Result<(), String> {
    for _ in 0..36 {
        if devtools_http_request_with_timeout(port, "GET", "/json/version", Duration::from_millis(350)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(120));
    }
    Err("Edge DevTools endpoint did not become ready".to_string())
}

fn resolve_edge_executable() -> PathBuf {
    let mut candidates = Vec::new();
    push_env_candidate(
        &mut candidates,
        "ProgramFiles",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    push_env_candidate(
        &mut candidates,
        "ProgramFiles(x86)",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    push_env_candidate(
        &mut candidates,
        "LOCALAPPDATA",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    push_env_candidate(
        &mut candidates,
        "ProgramFiles",
        r"Google\Chrome\Application\chrome.exe",
    );
    push_env_candidate(
        &mut candidates,
        "LOCALAPPDATA",
        r"Google\Chrome\Application\chrome.exe",
    );

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| PathBuf::from("msedge.exe"))
}

fn push_env_candidate(candidates: &mut Vec<PathBuf>, env_key: &str, tail: &str) {
    if let Ok(root) = std::env::var(env_key) {
        candidates.push(PathBuf::from(root).join(tail));
    }
}

fn safe_edge_session_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "workspace".to_string()
    } else {
        output
    }
}

fn percent_encode_component(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn devtools_http_request(port: u16, method: &str, path: &str) -> Result<String, String> {
    devtools_http_request_with_timeout(port, method, path, Duration::from_secs(4))
}

fn devtools_http_request_with_timeout(
    port: u16,
    method: &str,
    path: &str,
    timeout: Duration,
) -> Result<String, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|err| format!("failed to connect to Edge DevTools: {err}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|err| err.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|err| err.to_string())?;
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| err.to_string())?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|err| err.to_string())?;
    let status_end = response
        .windows(2)
        .position(|window| window == b"\r\n")
        .ok_or_else(|| "invalid DevTools HTTP response".to_string())?;
    let status_line = String::from_utf8_lossy(&response[..status_end]);
    if !status_line.contains(" 200 ") && !status_line.contains(" 201 ") {
        return Err(format!("DevTools request failed: {status_line}"));
    }
    http_response_body(response)
}

fn http_response_body(response: Vec<u8>) -> Result<String, String> {
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "invalid DevTools HTTP response body".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]).to_ascii_lowercase();
    let body = &response[header_end + 4..];
    let bytes = if headers.contains("transfer-encoding: chunked") {
        decode_devtools_chunked_body(body)?
    } else {
        body.to_vec()
    };
    String::from_utf8(bytes).map_err(|err| err.to_string())
}

fn decode_devtools_chunked_body(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    loop {
        let line_end = body
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "invalid chunked DevTools response".to_string())?;
        let size_line = String::from_utf8_lossy(&body[..line_end]);
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|err| format!("invalid chunk size: {err}"))?;
        body = &body[line_end + 2..];
        if size == 0 {
            break;
        }
        if body.len() < size + 2 {
            return Err("truncated chunked DevTools response".to_string());
        }
        output.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
    Ok(output)
}

fn detect_wsl_distros() -> Vec<String> {
    let mut command = Command::new("wsl.exe");
    command.current_dir(windows_spawn_cwd()).arg("-l").arg("-q");
    let output = hide_command_window(&mut command).output();
    let Ok(output) = output else {
        return Vec::new();
    };
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

fn detect_wsl_home(distro: &str) -> Option<String> {
    let mut command = Command::new("wsl.exe");
    command
        .current_dir(windows_spawn_cwd())
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-lc")
        .arg("printf %s \"$HOME\"");
    let output = hide_command_window(&mut command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if home.starts_with('/') && home.len() > 1 {
        Some(home)
    } else {
        None
    }
}

fn detect_ssh_aliases() -> Vec<String> {
    let mut aliases = Vec::new();
    let mut seen = HashSet::new();
    for path in ssh_config_paths() {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let mut parts = trimmed.split_whitespace();
            let Some(keyword) = parts.next() else {
                continue;
            };
            if !keyword.eq_ignore_ascii_case("host") {
                continue;
            }
            for alias in parts.filter(|value| is_ssh_alias_candidate(value)) {
                if seen.insert(alias.to_string()) {
                    aliases.push(alias.to_string());
                }
            }
        }
    }
    aliases
}

fn ssh_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        paths.push(PathBuf::from(user_profile).join(".ssh").join("config"));
    }
    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(home).join(".ssh").join("config");
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    paths
}

fn is_ssh_alias_candidate(value: &&str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && !value.starts_with('!')
        && !value.contains('*')
        && !value.contains('?')
        && !value.contains('%')
}

fn profile_from_id(profile_id: &str) -> ConnectionProfile {
    if let Some(distro) = profile_id.strip_prefix("wsl:") {
        return ConnectionProfile {
            id: profile_id.to_string(),
            label: format!("WSL: {distro}"),
            kind: "wsl".to_string(),
            root: default_wsl_root(distro),
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
        root: default_windows_root(),
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
            let distro = profile
                .distro
                .clone()
                .unwrap_or_else(|| "Ubuntu".to_string());
            let mut args = vec!["-d".to_string(), distro, "--".to_string()];
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                args.extend([
                    "bash".to_string(),
                    "-lic".to_string(),
                    bash_bootstrap_script(Some(cwd), Some(&profile.root), Some(&command)),
                ]);
            } else {
                args.extend([
                    "bash".to_string(),
                    "-lc".to_string(),
                    bash_bootstrap_script(Some(cwd), Some(&profile.root), None),
                ]);
            }
            ("wsl.exe".to_string(), args)
        }
        "ssh" => {
            let alias = profile
                .ssh_alias
                .clone()
                .unwrap_or_else(|| "default".to_string());
            let remote_command = if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                format!(
                    "bash -lic {}",
                    shell_quote(&bash_bootstrap_script(Some(cwd), Some(&profile.root), Some(&command)))
                )
            } else {
                format!("bash -lc {}", shell_quote(&bash_bootstrap_script(Some(cwd), Some(&profile.root), None)))
            };
            (
                "ssh.exe".to_string(),
                vec!["-tt".to_string(), alias, remote_command],
            )
        }
        _ => {
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                (
                    "powershell.exe".to_string(),
                    vec![
                        "-NoLogo".to_string(),
                        "-NoProfile".to_string(),
                        "-NoExit".to_string(),
                        "-Command".to_string(),
                        command,
                    ],
                )
            } else {
                (
                    "powershell.exe".to_string(),
                    vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
                )
            }
        }
    }
}

fn bash_bootstrap_script(cwd: Option<&str>, fallback_cwd: Option<&str>, command: Option<&str>) -> String {
    let mut script = String::new();
    script.push_str(&format!(
        "__svide_start_cwd={}\n\
__svide_fallback_cwd={}\n\
case \"$__svide_start_cwd\" in \"~/\"*) __svide_start_cwd=\"$HOME/${{__svide_start_cwd#~/}}\" ;; esac\n\
case \"$__svide_fallback_cwd\" in \"~/\"*) __svide_fallback_cwd=\"$HOME/${{__svide_fallback_cwd#~/}}\" ;; esac\n\
if [ -n \"$__svide_start_cwd\" ] && [ \"$__svide_start_cwd\" != \"~\" ]; then\n\
  cd \"$__svide_start_cwd\" 2>/dev/null || {{\n\
    if [ -n \"$__svide_fallback_cwd\" ] && [ \"$__svide_fallback_cwd\" != \"~\" ] && [ \"$__svide_fallback_cwd\" != \"$__svide_start_cwd\" ]; then\n\
      cd \"$__svide_fallback_cwd\" 2>/dev/null || cd ~ 2>/dev/null || true\n\
    else\n\
      cd ~ 2>/dev/null || true\n\
    fi\n\
  }}\n\
fi\n",
        shell_quote(cwd.unwrap_or("")),
        shell_quote(fallback_cwd.unwrap_or(""))
    ));
    if let Some(command) = command {
        script.push_str(command);
        script.push_str(
        "\n_status=$?\n\
if [ $_status -ne 0 ]; then\n\
  printf '\\n[simple-vibe-ide] command exited with status %s\\n' \"$_status\"\n\
fi\n",
        );
    }
    script.push_str(
        "exec bash --rcfile <(cat <<'__SVIDE_RC__'\n\
[ -f ~/.bashrc ] && . ~/.bashrc\n\
__simple_vibe_ide_prompt_command() { local __sv_status=$?; printf '\\033]7;file://simple-vibe-ide%s\\033\\\\' \"$PWD\"; return $__sv_status; }\n\
case \";${PROMPT_COMMAND:-};\" in *__simple_vibe_ide_prompt_command*) ;; *) PROMPT_COMMAND=\"__simple_vibe_ide_prompt_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}\" ;; esac\n\
export PROMPT_COMMAND\n\
__simple_vibe_ide_prompt_command\n\
__SVIDE_RC__\n\
) -i",
    );
    script
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

fn list_wsl_directory(windows_path: &Path, posix_path: &str) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    for item in fs::read_dir(windows_path).map_err(|err| err.to_string())? {
        let item = item.map_err(|err| err.to_string())?;
        let meta = item.metadata().map_err(|err| err.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let kind = if meta.is_dir() {
            "dir"
        } else if meta.is_file() {
            "file"
        } else {
            "other"
        };
        entries.push(FileEntry {
            path: join_posix(posix_path, &name),
            hidden: name.starts_with('.'),
            name,
            kind: kind.to_string(),
            size: meta.len(),
        });
    }
    sort_entries(entries)
}

fn list_remote_directory(
    profile: &ConnectionProfile,
    path: &str,
) -> Result<Vec<FileEntry>, String> {
    let quoted_path = shell_quote(path);
    let script = format!(
        r#"if [ ! -d {quoted_path} ]; then echo "not a directory" >&2; exit 2; fi
find {quoted_path} -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\n' 2>/dev/null || exit 3
"#,
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

fn create_local_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err("target already exists".to_string());
    }
    fs::create_dir(path).map_err(|err| err.to_string())
}

fn create_local_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn rename_local_path(old_path: &Path, new_path: &Path) -> Result<(), String> {
    if new_path.exists() {
        return Err("target already exists".to_string());
    }
    fs::rename(old_path, new_path).map_err(|err| err.to_string())
}

#[derive(Clone)]
struct ExportSourceInfo {
    name: String,
    kind: String,
    size: Option<u64>,
    direct_windows_path: Option<PathBuf>,
}

fn export_display_name(profile: &ConnectionProfile, path: &str) -> String {
    match profile.kind.as_str() {
        "windows" => local_file_name(Path::new(path)).unwrap_or_else(|_| "export".to_string()),
        "wsl" => wsl_posix_path_to_windows_path(profile, path)
            .and_then(|windows_path| local_file_name(&windows_path).ok())
            .unwrap_or_else(|| remote_file_name(path)),
        "ssh" => remote_file_name(path),
        _ => "export".to_string(),
    }
}

fn export_source_info(profile: &ConnectionProfile, path: &str) -> Result<ExportSourceInfo, String> {
    match profile.kind.as_str() {
        "windows" => export_local_source_info(Path::new(path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(profile, path) {
                let mut info = export_local_source_info(&windows_path)?;
                info.direct_windows_path = Some(windows_path);
                Ok(info)
            } else {
                export_remote_source_info(profile, path)
            }
        }
        "ssh" => export_remote_source_info(profile, path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

fn export_local_source_info(path: &Path) -> Result<ExportSourceInfo, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let kind = if metadata.is_dir() {
        "dir"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    if kind == "other" {
        return Err("unsupported export item type".to_string());
    }
    Ok(ExportSourceInfo {
        name: local_file_name(path)?,
        kind: kind.to_string(),
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        direct_windows_path: Some(path.to_path_buf()),
    })
}

fn export_remote_source_info(
    profile: &ConnectionProfile,
    path: &str,
) -> Result<ExportSourceInfo, String> {
    let script = format!(
        "if [ -d {0} ]; then printf 'dir\\t0'; elif [ -f {0} ]; then printf 'file\\t'; wc -c < {0}; else printf 'other\\t0'; fi",
        shell_quote(path)
    );
    let output = run_profile_shell(profile, &script, None)?;
    let text = String::from_utf8_lossy(&output);
    let mut parts = text.trim().splitn(2, '\t');
    let kind = parts.next().unwrap_or("other").to_string();
    let size = parts
        .next()
        .and_then(|value| value.trim().parse::<u64>().ok());
    if kind == "other" {
        return Err("unsupported export item type".to_string());
    }
    Ok(ExportSourceInfo {
        name: remote_file_name(path),
        kind,
        size,
        direct_windows_path: None,
    })
}

fn run_export_job(
    app: &tauri::AppHandle,
    id: &str,
    profile: &ConnectionProfile,
    source_path: &str,
    info: ExportSourceInfo,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let root = export_root()?;
    let job_dir = root.join(sanitize_segment(id));
    fs::create_dir_all(&job_dir).map_err(|err| err.to_string())?;
    let output_name = if info.kind == "dir" && info.direct_windows_path.is_none() {
        format!("{}.tar", info.name)
    } else {
        info.name.clone()
    };
    let output_path = unique_local_child_path(&job_dir, &output_name);
    let directory = info.kind == "dir" && info.direct_windows_path.is_some();

    emit_export_event(
        app,
        ExportProgressEvent {
            id: id.to_string(),
            name: output_name.clone(),
            status: "running".to_string(),
            progress: Some(0.0),
            output_path: None,
            message: Some("Preparing export".to_string()),
            directory,
        },
    );

    if let Some(source) = info.direct_windows_path.as_deref() {
        if info.kind == "dir" {
            let total = directory_total_size(source, &cancel)?;
            copy_local_path_recursive_with_progress(
                source,
                &output_path,
                &cancel,
                total,
                &mut |done, total| {
                    emit_export_progress(app, id, &output_name, done, total, directory);
                },
            )?;
        } else {
            copy_file_streaming(
                source,
                &output_path,
                &cancel,
                info.size.unwrap_or(0),
                &mut |done, total| {
                    emit_export_progress(app, id, &output_name, done, total, false);
                },
            )?;
        }
    } else if info.kind == "dir" {
        stream_remote_directory_tar(
            profile,
            source_path,
            &output_path,
            &cancel,
            app,
            id,
            &output_name,
        )?;
    } else {
        stream_remote_file(
            profile,
            source_path,
            &output_path,
            &cancel,
            info.size.unwrap_or(0),
            app,
            id,
            &output_name,
        )?;
    }

    if cancel.load(Ordering::Relaxed) {
        let _ = remove_export_output(&output_path);
        emit_export_event(
            app,
            ExportProgressEvent {
                id: id.to_string(),
                name: output_name,
                status: "cancelled".to_string(),
                progress: None,
                output_path: None,
                message: Some("Export cancelled".to_string()),
                directory,
            },
        );
        return Ok(());
    }

    emit_export_event(
        app,
        ExportProgressEvent {
            id: id.to_string(),
            name: output_name,
            status: "completed".to_string(),
            progress: Some(1.0),
            output_path: Some(output_path.to_string_lossy().to_string()),
            message: Some("Ready to drag out".to_string()),
            directory,
        },
    );
    Ok(())
}

fn export_root() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join("simple-vibe-ide-exports");
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    Ok(root)
}

fn emit_export_progress(
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
    done: u64,
    total: u64,
    directory: bool,
) {
    let progress = if total > 0 {
        Some((done as f64 / total as f64).clamp(0.0, 0.995))
    } else {
        None
    };
    emit_export_event(
        app,
        ExportProgressEvent {
            id: id.to_string(),
            name: name.to_string(),
            status: "running".to_string(),
            progress,
            output_path: None,
            message: Some(format!("{} / {}", format_bytes(done), format_bytes(total))),
            directory,
        },
    );
}

fn emit_export_event(app: &tauri::AppHandle, event: ExportProgressEvent) {
    let _ = app.emit("export-progress", event);
}

fn directory_total_size(path: &Path, cancel: &Arc<AtomicBool>) -> Result<u64, String> {
    check_export_cancelled(cancel)?;
    let mut total = 0;
    for child in fs::read_dir(path).map_err(|err| err.to_string())? {
        check_export_cancelled(cancel)?;
        let child = child.map_err(|err| err.to_string())?;
        let metadata = child.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            total += directory_total_size(&child.path(), cancel)?;
        } else if metadata.is_file() {
            total += metadata.len();
        }
    }
    Ok(total)
}

fn copy_local_path_recursive_with_progress<F>(
    source: &Path,
    target: &Path,
    cancel: &Arc<AtomicBool>,
    total: u64,
    progress: &mut F,
) -> Result<u64, String>
where
    F: FnMut(u64, u64),
{
    check_export_cancelled(cancel)?;
    let metadata = fs::metadata(source).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        reject_copy_directory_into_itself(source, target)?;
        fs::create_dir(target).map_err(|err| err.to_string())?;
        let mut done = 0;
        for child in fs::read_dir(source).map_err(|err| err.to_string())? {
            check_export_cancelled(cancel)?;
            let child = child.map_err(|err| err.to_string())?;
            let child_name = local_file_name(&child.path())?;
            done += copy_local_path_recursive_with_progress(
                &child.path(),
                &target.join(child_name),
                cancel,
                total,
                progress,
            )?;
            progress(done.min(total), total);
        }
        Ok(done)
    } else if metadata.is_file() {
        copy_file_streaming(source, target, cancel, total, progress)
    } else {
        Err("unsupported export item type".to_string())
    }
}

fn copy_file_streaming<F>(
    source: &Path,
    target: &Path,
    cancel: &Arc<AtomicBool>,
    total: u64,
    progress: &mut F,
) -> Result<u64, String>
where
    F: FnMut(u64, u64),
{
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut input = fs::File::open(source).map_err(|err| err.to_string())?;
    let mut output = fs::File::create(target).map_err(|err| err.to_string())?;
    copy_reader_to_writer(&mut input, &mut output, cancel, total, progress)
}

fn copy_reader_to_writer<R, W, F>(
    reader: &mut R,
    writer: &mut W,
    cancel: &Arc<AtomicBool>,
    total: u64,
    progress: &mut F,
) -> Result<u64, String>
where
    R: Read,
    W: Write,
    F: FnMut(u64, u64),
{
    let mut buffer = vec![0_u8; 1024 * 256];
    let mut done = 0;
    loop {
        check_export_cancelled(cancel)?;
        let read = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|err| err.to_string())?;
        done += read as u64;
        progress(done, total);
    }
    Ok(done)
}

fn stream_remote_file(
    profile: &ConnectionProfile,
    source_path: &str,
    output_path: &Path,
    cancel: &Arc<AtomicBool>,
    total: u64,
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
) -> Result<(), String> {
    let script = format!("cat -- {}", shell_quote(source_path));
    stream_profile_shell_to_file(profile, &script, output_path, cancel, total, app, id, name)
}

fn stream_remote_directory_tar(
    profile: &ConnectionProfile,
    source_path: &str,
    output_path: &Path,
    cancel: &Arc<AtomicBool>,
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
) -> Result<(), String> {
    let parent = parent_posix(source_path);
    let name_in_parent = remote_path_basename(source_path);
    let script = format!(
        "tar -C {} -cf - -- {}",
        shell_quote(&parent),
        shell_quote(&name_in_parent)
    );
    stream_profile_shell_to_file(profile, &script, output_path, cancel, 0, app, id, name)
}

fn stream_profile_shell_to_file(
    profile: &ConnectionProfile,
    script: &str,
    output_path: &Path,
    cancel: &Arc<AtomicBool>,
    total: u64,
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut command = profile_shell_command(profile, script)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hide_command_window(&mut command)
        .spawn()
        .map_err(|err| format!("failed to start export: {err}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture export stream".to_string())?;
    let mut output = fs::File::create(output_path).map_err(|err| err.to_string())?;
    let copy_result = copy_reader_to_writer(
        &mut stdout,
        &mut output,
        cancel,
        total,
        &mut |done, total| {
            emit_export_progress(app, id, name, done, total, false);
        },
    );
    if copy_result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return copy_result.map(|_| ());
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for export: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn profile_shell_command(profile: &ConnectionProfile, script: &str) -> Result<Command, String> {
    match profile.kind.as_str() {
        "wsl" => {
            let distro = profile.distro.as_deref().unwrap_or("Ubuntu");
            let mut command = Command::new("wsl.exe");
            command
                .current_dir(windows_spawn_cwd())
                .arg("-d")
                .arg(distro)
                .arg("--")
                .arg("bash")
                .arg("-lc")
                .arg(script);
            Ok(command)
        }
        "ssh" => {
            let alias = profile.ssh_alias.as_deref().unwrap_or("default");
            let remote = format!("sh -lc {}", shell_quote(script));
            let mut command = Command::new("ssh.exe");
            command
                .current_dir(windows_spawn_cwd())
                .arg("-T")
                .arg(alias)
                .arg(remote);
            Ok(command)
        }
        _ => Err(format!("profile is not remote: {}", profile.kind)),
    }
}

fn check_export_cancelled(cancel: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Export cancelled".to_string())
    } else {
        Ok(())
    }
}

fn remove_export_output(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|err| err.to_string())
    } else if path.exists() {
        fs::remove_file(path).map_err(|err| err.to_string())
    } else {
        Ok(())
    }
}

fn remote_path_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .find(|part| !part.is_empty())
        .filter(|part| !part.is_empty())
        .unwrap_or("export")
        .to_string()
}

fn remote_file_name(path: &str) -> String {
    sanitize_file_name(&remote_path_basename(path))
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else {
        format!("{:.1} GB", bytes as f64 / 1024.0 / 1024.0 / 1024.0)
    }
}

#[cfg(windows)]
struct ClipboardGuard;

#[cfg(windows)]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

#[cfg(windows)]
fn clipboard_file_paths() -> Result<Vec<String>, String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err() {
            return Ok(Vec::new());
        }
        OpenClipboard(None).map_err(|err| err.to_string())?;
        let _guard = ClipboardGuard;
        let handle = GetClipboardData(CF_HDROP.0 as u32).map_err(|err| err.to_string())?;
        let hdrop = HDROP(handle.0);
        let count = DragQueryFileW(hdrop, u32::MAX, None);
        let mut paths = Vec::new();
        for index in 0..count {
            let len = DragQueryFileW(hdrop, index, None);
            if len == 0 {
                continue;
            }
            let mut buffer = vec![0_u16; len as usize + 1];
            let written = DragQueryFileW(hdrop, index, Some(&mut buffer));
            if written == 0 {
                continue;
            }
            paths.push(String::from_utf16_lossy(&buffer[..written as usize]));
        }
        Ok(paths)
    }
}

#[cfg(not(windows))]
fn clipboard_file_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

fn save_clipboard_image_to_local(
    target_dir: &Path,
    file_name: &str,
    data: Vec<u8>,
) -> Result<PathBuf, String> {
    fs::create_dir_all(target_dir).map_err(|err| err.to_string())?;
    let target = unique_local_child_path(target_dir, file_name);
    fs::write(&target, data).map_err(|err| err.to_string())?;
    Ok(target)
}

fn save_clipboard_image_to_remote(
    profile: &ConnectionProfile,
    target_dir: &str,
    file_name: &str,
    data: Vec<u8>,
) -> Result<String, String> {
    create_remote_directory(profile, target_dir)?;
    let target = unique_remote_child_path(profile, target_dir, file_name)?;
    write_remote_file(profile, &target, data)?;
    Ok(target)
}

fn copy_dropped_files_to_local(
    target_dir: &Path,
    source_paths: &[String],
) -> Result<usize, String> {
    if !target_dir.is_dir() {
        return Err("drop target is not a directory".to_string());
    }

    let mut copied = 0;
    for source in source_paths {
        copy_local_source_to_local(Path::new(source), target_dir)?;
        copied += 1;
    }
    Ok(copied)
}

fn copy_local_source_to_local(source: &Path, target_dir: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("dropped source does not exist".to_string());
    }
    let name = local_file_name(source)?;
    let target = unique_local_child_path(target_dir, &name);
    copy_local_path_recursive(source, &target)
}

fn copy_local_path_recursive(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::metadata(source).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        reject_copy_directory_into_itself(source, target)?;
        fs::create_dir(target).map_err(|err| err.to_string())?;
        for child in fs::read_dir(source).map_err(|err| err.to_string())? {
            let child = child.map_err(|err| err.to_string())?;
            let child_name = local_file_name(&child.path())?;
            copy_local_path_recursive(&child.path(), &target.join(child_name))?;
        }
    } else if metadata.is_file() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::copy(source, target).map_err(|err| err.to_string())?;
    } else {
        return Err("unsupported dropped item type".to_string());
    }
    Ok(())
}

fn copy_dropped_files_to_remote(
    profile: &ConnectionProfile,
    target_dir: &str,
    source_paths: &[String],
) -> Result<usize, String> {
    create_remote_directory(profile, target_dir)?;
    let mut copied = 0;
    for source in source_paths {
        copy_local_source_to_remote(profile, Path::new(source), target_dir)?;
        copied += 1;
    }
    Ok(copied)
}

fn copy_local_source_to_remote(
    profile: &ConnectionProfile,
    source: &Path,
    target_dir: &str,
) -> Result<(), String> {
    if !source.exists() {
        return Err("dropped source does not exist".to_string());
    }
    let name = local_file_name(source)?;
    let target = unique_remote_child_path(profile, target_dir, &name)?;
    copy_local_path_to_remote(profile, source, &target)
}

fn copy_local_path_to_remote(
    profile: &ConnectionProfile,
    source: &Path,
    remote_target: &str,
) -> Result<(), String> {
    let metadata = fs::metadata(source).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        create_remote_directory(profile, remote_target)?;
        for child in fs::read_dir(source).map_err(|err| err.to_string())? {
            let child = child.map_err(|err| err.to_string())?;
            let child_name = local_file_name(&child.path())?;
            let child_target = join_posix(remote_target, &child_name);
            copy_local_path_to_remote(profile, &child.path(), &child_target)?;
        }
    } else if metadata.is_file() {
        let bytes = fs::read(source).map_err(|err| err.to_string())?;
        write_remote_file(profile, remote_target, bytes)?;
    } else {
        return Err("unsupported dropped item type".to_string());
    }
    Ok(())
}

fn write_remote_file(
    profile: &ConnectionProfile,
    target: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let dir = parent_posix(target);
    let script = format!(
        "mkdir -p -- {} && cat > {}",
        shell_quote(&dir),
        shell_quote(target)
    );
    run_profile_shell(profile, &script, Some(bytes))?;
    Ok(())
}

fn create_remote_directory(profile: &ConnectionProfile, path: &str) -> Result<(), String> {
    let script = format!("mkdir -p -- {}", shell_quote(path));
    run_profile_shell(profile, &script, None)?;
    Ok(())
}

fn remote_path_exists(profile: &ConnectionProfile, path: &str) -> Result<bool, String> {
    let script = format!("if [ -e {} ]; then printf y; fi", shell_quote(path));
    let output = run_profile_shell(profile, &script, None)?;
    Ok(output == b"y")
}

fn unique_local_child_path(parent: &Path, name: &str) -> PathBuf {
    let mut candidate = parent.join(name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, extension) = split_name_extension(name);
    for index in 2..10000 {
        candidate = parent.join(format!("{stem} {index}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem} copy{extension}"))
}

fn unique_remote_child_path(
    profile: &ConnectionProfile,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    let candidate = join_posix(parent, name);
    if !remote_path_exists(profile, &candidate)? {
        return Ok(candidate);
    }

    let (stem, extension) = split_name_extension(name);
    for index in 2..10000 {
        let candidate = join_posix(parent, &format!("{stem} {index}{extension}"));
        if !remote_path_exists(profile, &candidate)? {
            return Ok(candidate);
        }
    }
    Ok(join_posix(parent, &format!("{stem} copy{extension}")))
}

fn split_name_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    }
}

fn local_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "dropped source has no file name".to_string())
}

fn reject_copy_directory_into_itself(source: &Path, target: &Path) -> Result<(), String> {
    let source = source.canonicalize().map_err(|err| err.to_string())?;
    let target_parent = target
        .parent()
        .ok_or_else(|| "drop target has no parent directory".to_string())?
        .canonicalize()
        .map_err(|err| err.to_string())?;
    if target_parent.starts_with(&source) {
        return Err("cannot copy a folder into itself".to_string());
    }
    Ok(())
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
            command
                .current_dir(windows_spawn_cwd())
                .arg("-d")
                .arg(distro)
                .arg("--")
                .arg("bash")
                .arg("-lc")
                .arg(script);
            command
        }
        "ssh" => {
            let alias = profile.ssh_alias.as_deref().unwrap_or("default");
            let remote = format!("sh -lc {}", shell_quote(script));
            let mut command = Command::new("ssh.exe");
            command
                .current_dir(windows_spawn_cwd())
                .arg("-T")
                .arg(alias)
                .arg(remote);
            command
        }
        _ => return Err(format!("profile is not remote: {}", profile.kind)),
    };
    if stdin_data.is_some() {
        command.stdin(Stdio::piped());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hide_command_window(&mut command)
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

fn proxy_stream(
    mut incoming: TcpStream,
    target_host: String,
    target_port: u16,
) -> std::io::Result<()> {
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

fn proxy_http_preview(
    mut incoming: TcpStream,
    target_host: String,
    target_port: u16,
) -> std::io::Result<()> {
    incoming.set_read_timeout(Some(Duration::from_secs(15)))?;
    let request = read_http_headers(&mut incoming, 128 * 1024)?;
    let Some(header_end) = find_http_header_end(&request) else {
        return Ok(());
    };
    let (request_headers, request_body) = request.split_at(header_end + 4);
    let request_text = String::from_utf8_lossy(request_headers);
    let content_length = http_content_length(&request_text).unwrap_or(0);
    if is_websocket_upgrade(&request_text) {
        return proxy_websocket_upgrade(
            incoming,
            target_host,
            target_port,
            &request_text,
            request_body,
        );
    }
    let rewritten_request = rewrite_preview_request_headers(&request_text, &target_host, target_port);

    let mut remote = TcpStream::connect((target_host.as_str(), target_port))?;
    remote.set_read_timeout(Some(Duration::from_secs(20)))?;
    remote.write_all(rewritten_request.as_bytes())?;
    if !request_body.is_empty() {
        remote.write_all(request_body)?;
    }
    if content_length > request_body.len() {
        copy_exact_bytes(&mut incoming, &mut remote, content_length - request_body.len())?;
    }

    let response = read_http_headers(&mut remote, 256 * 1024)?;
    let Some(response_header_end) = find_http_header_end(&response) else {
        return Ok(());
    };
    let (response_headers, response_body) = response.split_at(response_header_end + 4);
    let response_text = String::from_utf8_lossy(response_headers);
    if should_inject_preview_console_bridge(&response_text) {
        let body = read_http_response_body(&mut remote, response_body, &response_text)?;
        let injected = inject_preview_console_bridge(&body);
        let rewritten_response =
            rewrite_preview_response_headers(&response_text, Some(injected.len()));
        incoming.write_all(rewritten_response.as_bytes())?;
        incoming.write_all(&injected)?;
    } else {
        let rewritten_response = rewrite_preview_response_headers(&response_text, None);
        incoming.write_all(rewritten_response.as_bytes())?;
        if !response_body.is_empty() {
            incoming.write_all(response_body)?;
        }
        std::io::copy(&mut remote, &mut incoming)?;
    }
    Ok(())
}

fn proxy_websocket_upgrade(
    mut incoming: TcpStream,
    target_host: String,
    target_port: u16,
    request_headers: &str,
    request_body: &[u8],
) -> std::io::Result<()> {
    let rewritten_request = rewrite_preview_upgrade_headers(request_headers, &target_host, target_port);
    let mut remote = TcpStream::connect((target_host.as_str(), target_port))?;
    remote.write_all(rewritten_request.as_bytes())?;
    if !request_body.is_empty() {
        remote.write_all(request_body)?;
    }
    let mut incoming_to_remote = incoming.try_clone()?;
    let mut remote_from_incoming = remote.try_clone()?;
    let writer = thread::spawn(move || {
        let _ = std::io::copy(&mut incoming_to_remote, &mut remote_from_incoming);
    });
    let _ = std::io::copy(&mut remote, &mut incoming);
    let _ = writer.join();
    Ok(())
}

fn parse_http_preview_target(target_url: &str) -> Result<HttpTarget, String> {
    let trimmed = target_url.trim();
    let rest = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "preview proxy only supports http:// local URLs".to_string())?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .ok_or_else(|| "invalid preview URL".to_string())?;
    let (raw_host, raw_port) = authority
        .rsplit_once(':')
        .ok_or_else(|| "preview URL must include a port".to_string())?;
    let mut host = raw_host.trim().trim_matches(['[', ']']).to_string();
    if host.eq_ignore_ascii_case("localhost") || host == "0.0.0.0" || host == "::1" {
        host = "127.0.0.1".to_string();
    }
    if host != "127.0.0.1" {
        return Err("preview proxy only supports local loopback URLs".to_string());
    }
    let port = raw_port
        .parse::<u16>()
        .map_err(|_| "invalid preview port".to_string())?;
    if port == 0 {
        return Err("invalid preview port".to_string());
    }
    Ok(HttpTarget {
        origin: format!("http://{host}:{port}"),
        host,
        port,
    })
}

fn read_http_headers(stream: &mut TcpStream, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if find_http_header_end(&buffer).is_some() {
            break;
        }
        if buffer.len() > limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HTTP headers too large",
            ));
        }
    }
    Ok(buffer)
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn http_content_length(headers: &str) -> Option<usize> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

fn is_websocket_upgrade(headers: &str) -> bool {
    let mut has_upgrade = false;
    let mut has_connection_upgrade = false;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("upgrade")
            && value.trim().eq_ignore_ascii_case("websocket")
        {
            has_upgrade = true;
        }
        if name.trim().eq_ignore_ascii_case("connection")
            && value
                .split(',')
                .any(|item| item.trim().eq_ignore_ascii_case("upgrade"))
        {
            has_connection_upgrade = true;
        }
    }
    has_upgrade && has_connection_upgrade
}

fn rewrite_preview_request_headers(headers: &str, target_host: &str, target_port: u16) -> String {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("GET / HTTP/1.1").trim_end();
    let mut rewritten = String::new();
    rewritten.push_str(request_line);
    rewritten.push_str("\r\n");
    let mut saw_host = false;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let lower = line
            .split_once(':')
            .map(|(name, _)| name.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if lower == "host" {
            saw_host = true;
            rewritten.push_str(&format!("Host: {target_host}:{target_port}\r\n"));
        } else if lower == "connection"
            || lower == "proxy-connection"
            || lower == "accept-encoding"
        {
            continue;
        } else {
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
        }
    }
    if !saw_host {
        rewritten.push_str(&format!("Host: {target_host}:{target_port}\r\n"));
    }
    rewritten.push_str("Accept-Encoding: identity\r\n");
    rewritten.push_str("Connection: close\r\n\r\n");
    rewritten
}

fn rewrite_preview_upgrade_headers(headers: &str, target_host: &str, target_port: u16) -> String {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("GET / HTTP/1.1").trim_end();
    let mut rewritten = String::new();
    rewritten.push_str(request_line);
    rewritten.push_str("\r\n");
    let mut saw_host = false;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let lower = line
            .split_once(':')
            .map(|(name, _)| name.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if lower == "host" {
            saw_host = true;
            rewritten.push_str(&format!("Host: {target_host}:{target_port}\r\n"));
        } else if lower == "proxy-connection" {
            continue;
        } else {
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
        }
    }
    if !saw_host {
        rewritten.push_str(&format!("Host: {target_host}:{target_port}\r\n"));
    }
    rewritten.push_str("\r\n");
    rewritten
}

fn rewrite_preview_response_headers(headers: &str, content_length: Option<usize>) -> String {
    let mut lines = headers.lines();
    let status_line = lines.next().unwrap_or("HTTP/1.1 502 Bad Gateway").trim_end();
    let mut rewritten = String::new();
    rewritten.push_str(status_line);
    rewritten.push_str("\r\n");
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let lower = line
            .split_once(':')
            .map(|(name, _)| name.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if matches!(
            lower.as_str(),
            "x-frame-options"
                | "content-security-policy"
                | "content-security-policy-report-only"
        ) {
            continue;
        }
        if content_length.is_some() && matches!(lower.as_str(), "content-length" | "transfer-encoding")
        {
            continue;
        }
        rewritten.push_str(line.trim_end());
        rewritten.push_str("\r\n");
    }
    if let Some(length) = content_length {
        rewritten.push_str(&format!("Content-Length: {length}\r\n"));
    }
    rewritten.push_str("\r\n");
    rewritten
}

fn should_inject_preview_console_bridge(headers: &str) -> bool {
    let mut html = false;
    let mut encoded = false;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-type")
            && value.to_ascii_lowercase().contains("text/html")
        {
            html = true;
        }
        if name.trim().eq_ignore_ascii_case("content-encoding")
            && !value.trim().eq_ignore_ascii_case("identity")
        {
            encoded = true;
        }
    }
    html && !encoded
}

fn read_http_response_body(
    remote: &mut TcpStream,
    first_body: &[u8],
    headers: &str,
) -> std::io::Result<Vec<u8>> {
    let mut body = first_body.to_vec();
    if is_chunked_response(headers) {
        remote.read_to_end(&mut body)?;
        return decode_chunked_body(&body);
    }
    if let Some(length) = http_content_length(headers) {
        if body.len() < length {
            let mut rest = vec![0_u8; length - body.len()];
            remote.read_exact(&mut rest)?;
            body.extend(rest);
        }
        body.truncate(length);
        return Ok(body);
    }
    remote.read_to_end(&mut body)?;
    Ok(body)
}

fn is_chunked_response(headers: &str) -> bool {
    headers.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|item| item.trim().eq_ignore_ascii_case("chunked"))
    })
}

fn decode_chunked_body(body: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut index = 0;
    let mut decoded = Vec::new();
    while index < body.len() {
        let Some(line_end) = find_crlf(&body[index..]) else {
            break;
        };
        let size_line = String::from_utf8_lossy(&body[index..index + line_end]);
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid chunk size")
        })?;
        index += line_end + 2;
        if size == 0 {
            break;
        }
        if index + size > body.len() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "truncated chunked response",
            ));
        }
        decoded.extend_from_slice(&body[index..index + size]);
        index += size + 2;
    }
    Ok(decoded)
}

fn find_crlf(buffer: &[u8]) -> Option<usize> {
    buffer.windows(2).position(|window| window == b"\r\n")
}

fn inject_preview_console_bridge(body: &[u8]) -> Vec<u8> {
    let mut html = String::from_utf8_lossy(body).to_string();
    let script = preview_console_bridge_script();
    let lower = html.to_ascii_lowercase();
    if let Some(index) = lower.find("<head") {
        if let Some(close) = lower[index..].find('>') {
            html.insert_str(index + close + 1, script);
            return html.into_bytes();
        }
    }
    if let Some(index) = lower.find("<body") {
        if let Some(close) = lower[index..].find('>') {
            html.insert_str(index + close + 1, script);
            return html.into_bytes();
        }
    }
    html.insert_str(0, script);
    html.into_bytes()
}

fn preview_console_bridge_script() -> &'static str {
    r#"<script>
(function () {
  if (window.__simpleVibeConsoleBridge) return;
  window.__simpleVibeConsoleBridge = true;
  function format(value) {
    try {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message || String(value);
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  function send(level, args) {
    try {
      window.parent.postMessage({ __simpleVibeConsole: { level: level, args: Array.prototype.slice.call(args).map(format) } }, '*');
    } catch (_) {}
  }
  window.addEventListener('contextmenu', function (event) {
    try {
      event.preventDefault();
      window.parent.postMessage({ __simpleVibeContextMenu: { x: event.clientX, y: event.clientY } }, '*');
    } catch (_) {}
  });
  window.addEventListener('keydown', function (event) {
    if (event.key !== 'F5') return;
    try {
      event.preventDefault();
      window.parent.postMessage({ __simpleVibeRefresh: { hard: !!(event.ctrlKey || event.shiftKey) } }, '*');
    } catch (_) {}
  }, true);
  var nativeOpen = window.open;
  function sendOpenUrl(url) {
    try {
      if (!url) return false;
      window.parent.postMessage({ __simpleVibeOpenUrl: new URL(String(url), window.location.href).href }, '*');
      return true;
    } catch (_) {
      return false;
    }
  }
  window.open = function (url, target, features) {
    if (sendOpenUrl(url)) return null;
    return nativeOpen && nativeOpen.call(window, url, target, features);
  };
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[target="_blank"], a[rel~="external"]') : null;
    if (anchor && sendOpenUrl(anchor.href)) {
      event.preventDefault();
    }
  }, true);
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send(level === 'log' ? 'info' : level, arguments);
      return original && original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    send('error', [event.message || 'Script error']);
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', ['Unhandled promise rejection', event.reason]);
  });
  if (window.WebSocket) {
    var NativeWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      var socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      var target = String(url);
      socket.addEventListener('error', function () {
        send('error', ["WebSocket connection to '" + target + "' failed."]);
      });
      socket.addEventListener('close', function (event) {
        if (!event.wasClean && event.code !== 1000) {
          send('warn', ["WebSocket connection to '" + target + "' closed (" + event.code + ")."]);
        }
      });
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(window.WebSocket, NativeWebSocket);
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) {
      window.WebSocket[key] = NativeWebSocket[key];
    });
  }
})();
</script>"#
}

fn copy_exact_bytes(
    reader: &mut TcpStream,
    writer: &mut TcpStream,
    mut remaining: usize,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 8192];
    while remaining > 0 {
        let chunk_len = remaining.min(buffer.len());
        let read = reader.read(&mut buffer[..chunk_len])?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        remaining -= read;
    }
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
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

fn mime_type_for_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn bring_window_to_front<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn show_window_on_primary_monitor<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let position = *monitor.position();
        let size = *monitor.size();
        let _ = window.unmaximize();
        let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
    }
    let _ = window.maximize();
    bring_window_to_front(window);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(IdeState::default())
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            list_wsl_profiles,
            windows_shell_root,
            set_capture_protection,
            resolve_profile_path,
            list_directory,
            read_text_file,
            read_file_data_url,
            write_text_file,
            create_directory,
            create_file,
            rename_path,
            open_path,
            read_clipboard_file_paths,
            save_clipboard_image_file,
            copy_dropped_files,
            start_export_path,
            cancel_export_path,
            open_export_path,
            save_attachment,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            start_port_forward,
            start_preview_proxy,
            start_edge_devtools_session,
            edge_devtools_new_page,
            edge_devtools_activate_page,
            edge_devtools_close_page,
            stop_edge_devtools_session,
            stop_port_forward
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            let app_handle = app.handle().clone();
            show_window_on_primary_monitor(&window);
            let app_for_events = app_handle.clone();
            let main_for_events = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { .. } => close_capture_cover(&app_for_events),
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(cover) = app_for_events.get_webview_window("capture-cover") {
                        if cover.is_visible().unwrap_or(false) {
                            let _ = sync_capture_cover(&main_for_events, &cover);
                        }
                    }
                }
                WindowEvent::Destroyed => close_capture_cover(&app_for_events),
                _ => {}
            });
            let delayed_window = window.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(250));
                let focus_window = delayed_window.clone();
                let _ = delayed_window.run_on_main_thread(move || {
                    show_window_on_primary_monitor(&focus_window);
                });
            });
            window
                .set_title("Simple Vibe IDE - Windows / WSL / SSH")
                .expect("set title");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Simple Vibe IDE");
}
