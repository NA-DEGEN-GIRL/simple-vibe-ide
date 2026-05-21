use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
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
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, SetWindowPos, SWP_NOACTIVATE, SWP_SHOWWINDOW, WDA_EXCLUDEFROMCAPTURE,
    WDA_NONE,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
    let cover = app
        .get_webview_window("capture-cover")
        .ok_or_else(|| "capture cover window is not available".to_string())?;
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
            let mut args = vec!["-d".to_string(), distro];
            if !cwd.is_empty() {
                args.push("--cd".to_string());
                args.push(cwd.to_string());
            }
            args.push("--".to_string());
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                args.extend([
                    "bash".to_string(),
                    "-lic".to_string(),
                    keepalive_bash_script(None, &command),
                ]);
            } else {
                args.extend(["bash".to_string(), "-li".to_string()]);
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
                    shell_quote(&keepalive_bash_script(Some(cwd), &command))
                )
            } else if !cwd.is_empty() && cwd != "~" {
                format!("cd {} && exec bash -li", shell_quote(cwd))
            } else {
                "exec bash -li".to_string()
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

fn keepalive_bash_script(cwd: Option<&str>, command: &str) -> String {
    let mut script = String::new();
    if let Some(cwd) = cwd.filter(|value| !value.is_empty() && *value != "~") {
        script.push_str(&format!(
            "cd {} || {{ printf '\\n[simple-vibe-ide] failed to enter workspace\\n'; exec bash -li; }}\n",
            shell_quote(cwd)
        ));
    }
    script.push_str(command);
    script.push_str(
        "\n_status=$?\n\
if [ $_status -ne 0 ]; then\n\
  printf '\\n[simple-vibe-ide] command exited with status %s\\n' \"$_status\"\n\
fi\n\
exec bash -li",
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
            copy_dropped_files,
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
            let app_handle = app.handle().clone();
            let _ = create_capture_cover(&app_handle);
            show_window_on_primary_monitor(&window);
            let app_for_events = app_handle.clone();
            let main_for_events = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(cover) = app_for_events.get_webview_window("capture-cover") {
                        if cover.is_visible().unwrap_or(false) {
                            let _ = sync_capture_cover(&main_for_events, &cover);
                        }
                    }
                }
                WindowEvent::Destroyed => hide_capture_cover(&app_for_events),
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
