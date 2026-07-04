use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child as ProcessChild, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, AtomicU32};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
#[cfg(windows)]
use std::sync::Condvar;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    State, WebviewBuilder, WebviewUrl, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
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
use windows::Win32::System::Diagnostics::Debug::MessageBeep;

#[cfg(windows)]
use windows::Win32::UI::Shell::{
    DragQueryFileW, Shell_NotifyIconW, HDROP, NIF_ICON, NIF_INFO, NIF_MESSAGE, NIF_TIP, NIIF_INFO,
    NIIF_NOSOUND, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
};

#[cfg(windows)]
use windows::core::BOOL;

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetAncestor, GetClassLongPtrW, GetClassNameW, GetWindowDisplayAffinity,
    LoadIconW, SendMessageW, SetWindowDisplayAffinity, GA_ROOT, GCLP_HICON, GCLP_HICONSM, HICON,
    ICON_BIG, ICON_SMALL, ICON_SMALL2, IDI_APPLICATION, MB_ICONASTERISK, WDA_EXCLUDEFROMCAPTURE,
    WDA_MONITOR, WDA_NONE, WINDOW_DISPLAY_AFFINITY, WM_GETICON,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Process-wide Windows Job Object that owns every child process the IDE
/// spawns (terminals, ssh/wsl, port forwards, Edge devtools). It is configured
/// with `KILL_ON_JOB_CLOSE`, so when the IDE process dies for ANY reason -
/// graceful exit, a Rust panic (the release profile uses `panic = "abort"`),
/// or an external force-kill - Windows tears down the whole tree. This is the
/// crash-safety net behind the explicit teardown in `shutdown_runtime_sessions`.
#[cfg(windows)]
mod cleanup_job {
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    struct SendHandle(HANDLE);
    // The job handle lives for the whole process and is only touched behind a
    // OnceLock; it is safe to share across threads.
    unsafe impl Send for SendHandle {}
    unsafe impl Sync for SendHandle {}

    static JOB: OnceLock<Option<SendHandle>> = OnceLock::new();

    fn init_job() -> Option<SendHandle> {
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let result = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if result.is_err() {
                let _ = CloseHandle(handle);
                return None;
            }
            Some(SendHandle(handle))
        }
    }

    fn job_handle() -> Option<HANDLE> {
        JOB.get_or_init(init_job).as_ref().map(|h| h.0)
    }

    /// Assign a spawned child PID to the cleanup job. Best-effort: any failure
    /// (e.g. the child already exited, or it lives in an incompatible job) is
    /// ignored because the explicit `taskkill /T` teardown is the primary path.
    pub fn assign(pid: u32) {
        if pid == 0 {
            return;
        }
        let Some(job) = job_handle() else {
            return;
        };
        unsafe {
            if let Ok(process) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                let _ = AssignProcessToJobObject(job, process);
                let _ = CloseHandle(process);
            }
        }
    }
}

const LOCAL_DIRECTORY_BATCH_PARALLELISM: usize = 4;
const WSL_DIRECTORY_BATCH_PARALLELISM: usize = 2;
const TERMINAL_DIRECT_OUTPUT_EVENT_BATCH_MS: u64 = 4;
const TERMINAL_OUTPUT_EVENT_FORCE_CHARS: usize = 16 * 1024;
const TERMINAL_INPUT_QUEUE_CAPACITY: usize = 256;
const TERMINAL_DSR_CURSOR_QUERY: &str = "\x1b[6n";
const BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX: &str = "browser-preview-webview";
const WSL_HOME_DETECT_TIMEOUT: Duration = Duration::from_secs(8);
const WSL_FAST_HOME_DETECT_TIMEOUT: Duration = Duration::from_secs(4);
const WSL_WARMUP_TIMEOUT: Duration = Duration::from_secs(8);
const WSL_WARMUP_CACHE_TTL: Duration = Duration::from_secs(30);
const WSL_DISTRO_LIST_TIMEOUT: Duration = Duration::from_secs(4);
const WSL_DISTRO_LIST_CACHE_TTL: Duration = Duration::from_secs(30);
const WSL_TRANSIENT_RETRY_ATTEMPTS: usize = 3;
const WSL_TRANSIENT_RETRY_DELAY: Duration = Duration::from_millis(450);
const REMOTE_SHELL_COMMAND_TIMEOUT: Duration = Duration::from_secs(90);
const REMOTE_DIRECTORY_COMMAND_TIMEOUT: Duration = Duration::from_secs(18);
const LLM_TMUX_COMMAND_TIMEOUT: Duration = Duration::from_secs(12);
const LLM_TMUX_TITLE_TIMEOUT: Duration = Duration::from_secs(3);
const RENDERER_HEARTBEAT_STARTUP_GRACE: Duration = Duration::from_secs(30);
const RENDERER_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);
const RENDERER_HEARTBEAT_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const RENDERER_RECOVERY_RELOAD_COOLDOWN: Duration = Duration::from_secs(120);
const RENDERER_RECOVERY_STABLE_AFTER: Duration = Duration::from_secs(35);
const RENDERER_RECOVERY_WARN_ATTEMPTS: u32 = 3;
const AGENT_BRIDGE_IO_TIMEOUT: Duration = Duration::from_secs(5);
const SNIPPETS_STORE_FILE: &str = "snippets.v1.json";
const SNIPPETS_STORE_MAX_BYTES: usize = 1024 * 1024;
const DEFAULT_SNIPPETS_STORE: &str = r#"{"version":1,"activeTabId":"general","tabs":[{"id":"general","title":"General","items":[]}]}"#;
const LLM_TMUX_SESSION_MAX_LEN: usize = 48;

type EdgeSessionStore = Arc<Mutex<HashMap<String, EdgeDevtoolsSessionState>>>;

static WSL_HOME_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static WSL_WARMUP_CACHE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static WSL_WARMUP_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static WSL_DISTRO_LIST_CACHE: OnceLock<Mutex<Option<(Instant, Vec<String>)>>> = OnceLock::new();

struct IdeState {
    terminals: Mutex<HashMap<String, TerminalSession>>,
    forwards: Mutex<HashMap<String, ForwardSession>>,
    exports: Mutex<HashMap<String, ExportSession>>,
    edge_sessions: EdgeSessionStore,
    agent_bridge: AgentBridgeStore,
    renderer_health: Mutex<RendererHealthState>,
}

impl IdeState {
    fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            forwards: Mutex::new(HashMap::new()),
            exports: Mutex::new(HashMap::new()),
            edge_sessions: Arc::new(Mutex::new(HashMap::new())),
            agent_bridge: AgentBridgeStore::new(),
            renderer_health: Mutex::new(RendererHealthState::new()),
        }
    }
}

impl Default for IdeState {
    fn default() -> Self {
        Self::new()
    }
}

struct TerminalSession {
    input_tx: SyncSender<Vec<u8>>,
    child: Box<dyn portable_pty::Child + Send>,
    master: Box<dyn MasterPty + Send>,
    rows: u16,
    cols: u16,
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

#[derive(Clone)]
struct AgentBridgeRuntime {
    port: u16,
    token: String,
}

struct AgentBridgeStore {
    runtime: Mutex<Option<AgentBridgeRuntime>>,
    sessions: Arc<Mutex<HashMap<String, AgentBridgeSession>>>,
}

impl AgentBridgeStore {
    fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Debug)]
struct AgentBridgeSession {
    agent_id: String,
    pane_id: String,
    workspace_id: String,
    cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentBridgeInfo {
    port: u16,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterAgentBridgeSessionPayload {
    session_id: String,
    agent_id: String,
    pane_id: String,
    workspace_id: String,
    cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentBridgeEvent {
    agent_id: String,
    session_id: String,
    pane_id: Option<String>,
    workspace_id: Option<String>,
    cwd: Option<String>,
    raw_event_name: String,
    status: Option<String>,
    activity: Option<String>,
    transcript_path: Option<String>,
    source: String,
}

struct RendererHealthState {
    last_heartbeat: Instant,
    last_reload: Option<Instant>,
    reload_attempts: u32,
    pending_notice: Option<RendererRecoveryNotice>,
}

impl RendererHealthState {
    fn new() -> Self {
        Self {
            last_heartbeat: Instant::now(),
            last_reload: None,
            reload_attempts: 0,
            pending_notice: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RendererRecoveryNotice {
    kind: String,
    attempts: u32,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RendererHeartbeatResponse {
    recovery: Option<RendererRecoveryNotice>,
}

#[cfg(not(windows))]
#[derive(Clone)]
struct SshAgentSession {
    vars: Vec<(String, String)>,
}

#[cfg(windows)]
struct SshAskpassServer {
    #[cfg(windows)]
    port: u16,
    token: String,
    app: AppHandle,
    pending: Mutex<HashMap<String, Arc<SshAskpassPending>>>,
    cache: Mutex<HashMap<String, String>>,
}

#[cfg(windows)]
struct SshAskpassPending {
    answer: Mutex<Option<Option<String>>>,
    ready: Condvar,
}

#[cfg(windows)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAuthPromptEvent {
    id: String,
    prompt: String,
    profile_id: String,
    alias: String,
    cacheable: bool,
}

#[cfg(windows)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshAskpassHttpRequest {
    token: String,
    prompt: String,
    profile_id: String,
    alias: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAskpassHttpRequestOut {
    token: String,
    prompt: String,
    profile_id: String,
    alias: String,
}

struct RuntimeShutdownBatch {
    terminals: Vec<TerminalSession>,
    forwards: Vec<ForwardSession>,
    edge_sessions: Vec<EdgeDevtoolsSessionState>,
}

impl RuntimeShutdownBatch {
    fn is_empty(&self) -> bool {
        self.terminals.is_empty() && self.forwards.is_empty() && self.edge_sessions.is_empty()
    }
}

struct AppOutputBatcher {
    id: String,
    app: tauri::AppHandle,
    buffer: Mutex<String>,
    scheduled: AtomicBool,
}

impl AppOutputBatcher {
    fn new(id: String, app: tauri::AppHandle) -> Arc<Self> {
        Arc::new(Self {
            id,
            app,
            buffer: Mutex::new(String::new()),
            scheduled: AtomicBool::new(false),
        })
    }

    fn push(self: &Arc<Self>, data: &str) {
        let should_flush_now = {
            let Ok(mut buffer) = self.buffer.lock() else {
                return;
            };
            buffer.push_str(data);
            buffer.len() >= TERMINAL_OUTPUT_EVENT_FORCE_CHARS
        };
        if should_flush_now {
            self.flush();
            return;
        }
        if self
            .scheduled
            .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            let batcher = self.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(TERMINAL_DIRECT_OUTPUT_EVENT_BATCH_MS));
                batcher.flush();
            });
        }
    }

    fn flush(&self) {
        self.scheduled.store(false, Ordering::Relaxed);
        let data = {
            let Ok(mut buffer) = self.buffer.lock() else {
                return;
            };
            if buffer.is_empty() {
                return;
            }
            std::mem::take(&mut *buffer)
        };
        let _ = self.app.emit(
            "terminal-data",
            TerminalDataEvent {
                id: self.id.clone(),
                data,
            },
        );
    }
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
    let cache = WSL_HOME_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(root) = guard.get(distro) {
            return root.clone();
        }
    }
    let root = detect_wsl_home(distro).unwrap_or_else(|| "/home".to_string());
    if let Ok(mut guard) = cache.lock() {
        guard.insert(distro.to_string(), root.clone());
    }
    root
}

fn wsl_start_directory_arg(cwd: &str, fallback_cwd: &str) -> String {
    for candidate in [cwd.trim(), fallback_cwd.trim(), "~"] {
        if !candidate.is_empty() {
            return candidate.to_string();
        }
    }
    "~".to_string()
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
    None
}

fn hide_command_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Register a freshly spawned child with the process-wide cleanup job so it is
/// guaranteed to die with the IDE even on a crash. No-op off Windows.
fn assign_child_to_cleanup_job(pid: u32) {
    #[cfg(windows)]
    cleanup_job::assign(pid);
    #[cfg(not(windows))]
    let _ = pid;
}

#[cfg(windows)]
static SSH_ASKPASS_SERVER: OnceLock<Arc<SshAskpassServer>> = OnceLock::new();
#[cfg(not(windows))]
static SSH_AGENT_SESSION: OnceLock<Mutex<Option<SshAgentSession>>> = OnceLock::new();
#[cfg(not(windows))]
static SSH_AGENT_START_ATTEMPTED: AtomicBool = AtomicBool::new(false);

#[cfg(not(windows))]
fn ssh_agent_store() -> &'static Mutex<Option<SshAgentSession>> {
    SSH_AGENT_SESSION.get_or_init(|| Mutex::new(None))
}

#[cfg(not(windows))]
fn start_ssh_askpass_server(_app: AppHandle) {}

#[cfg(windows)]
fn start_ssh_askpass_server(app: AppHandle) {
    let _ = SSH_ASKPASS_SERVER.get_or_init(|| {
        let listener = match TcpListener::bind(("127.0.0.1", 0)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("failed to bind local SSH askpass broker: {error}");
                return Arc::new(SshAskpassServer {
                    port: 0,
                    token: String::new(),
                    app,
                    pending: Mutex::new(HashMap::new()),
                    cache: Mutex::new(HashMap::new()),
                });
            }
        };
        let port = match listener.local_addr() {
            Ok(addr) => addr.port(),
            Err(error) => {
                eprintln!("failed to read local SSH askpass broker address: {error}");
                0
            }
        };
        let server = Arc::new(SshAskpassServer {
            port,
            token: Uuid::new_v4().to_string(),
            app,
            pending: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
        });
        let server_for_thread = server.clone();
        let _ = thread::Builder::new()
            .name("simple-vibe-ssh-askpass".to_string())
            .spawn(move || {
                for incoming in listener.incoming() {
                    let Ok(stream) = incoming else {
                        continue;
                    };
                    let server = server_for_thread.clone();
                    let _ = thread::Builder::new()
                        .name("simple-vibe-ssh-askpass-request".to_string())
                        .spawn(move || {
                            let _ = handle_ssh_askpass_http_request(server, stream);
                        });
                }
            });
        server
    });
}

fn ssh_askpass_env_vars(profile: &ConnectionProfile) -> Vec<(String, String)> {
    #[cfg(not(windows))]
    {
        let _ = profile;
        Vec::new()
    }
    #[cfg(windows)]
    {
        let Some(server) = SSH_ASKPASS_SERVER.get() else {
            return Vec::new();
        };
        let Ok(exe) = std::env::current_exe() else {
            return Vec::new();
        };
        vec![
            ("SSH_ASKPASS".to_string(), exe.to_string_lossy().to_string()),
            ("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string()),
            ("DISPLAY".to_string(), "simple-vibe-ide".to_string()),
            ("SVIDE_ASKPASS_HELPER".to_string(), "1".to_string()),
            ("SVIDE_ASKPASS_PORT".to_string(), server.port.to_string()),
            ("SVIDE_ASKPASS_TOKEN".to_string(), server.token.clone()),
            ("SVIDE_ASKPASS_PROFILE".to_string(), profile.id.clone()),
            (
                "SVIDE_ASKPASS_ALIAS".to_string(),
                profile.ssh_alias.clone().unwrap_or_default(),
            ),
        ]
    }
}

fn apply_ssh_askpass_to_command(command: &mut Command, profile: &ConnectionProfile) {
    for (key, value) in ssh_askpass_env_vars(profile) {
        Command::env(command, key, value);
    }
}

fn apply_ssh_askpass_to_pty(command: &mut CommandBuilder, profile: &ConnectionProfile) {
    for (key, value) in ssh_askpass_env_vars(profile) {
        CommandBuilder::env(command, key, value);
    }
}

#[cfg(windows)]
fn handle_ssh_askpass_http_request(
    server: Arc<SshAskpassServer>,
    mut stream: TcpStream,
) -> std::io::Result<()> {
    let buffer = read_http_headers(&mut stream, 64 * 1024)?;
    let Some(header_end) = find_http_header_end(&buffer) else {
        return write_plain_http_response(&mut stream, 400, "Bad Request", "missing headers\n");
    };
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    if let Some(length) = http_content_length(&header_text) {
        if body.len() < length {
            let mut rest = vec![0_u8; length - body.len()];
            stream.read_exact(&mut rest)?;
            body.extend(rest);
        }
        body.truncate(length);
    }
    let request = match serde_json::from_slice::<SshAskpassHttpRequest>(&body) {
        Ok(request) => request,
        Err(_) => {
            return write_plain_http_response(&mut stream, 400, "Bad Request", "invalid request\n")
        }
    };
    if request.token != server.token {
        return write_plain_http_response(&mut stream, 403, "Forbidden", "bad token\n");
    }
    let Some(secret) = server.request_secret(&request.prompt, &request.profile_id, &request.alias)
    else {
        return write_plain_http_response(&mut stream, 403, "Forbidden", "cancelled\n");
    };
    write_plain_http_response(&mut stream, 200, "OK", &format!("{secret}\n"))
}

fn write_plain_http_response(
    stream: &mut TcpStream,
    code: u16,
    reason: &str,
    body: &str,
) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    stream.write_all(response.as_bytes())
}

#[cfg(windows)]
impl SshAskpassServer {
    fn request_secret(&self, prompt: &str, profile_id: &str, alias: &str) -> Option<String> {
        let cacheable = ssh_auth_prompt_cacheable(prompt);
        let cache_key = ssh_auth_cache_key(prompt, profile_id, alias);
        if cacheable {
            if let Ok(cache) = self.cache.lock() {
                if let Some(secret) = cache.get(&cache_key) {
                    return Some(secret.clone());
                }
            }
        }

        let id = Uuid::new_v4().to_string();
        let pending = Arc::new(SshAskpassPending {
            answer: Mutex::new(None),
            ready: Condvar::new(),
        });
        if let Ok(mut pending_map) = self.pending.lock() {
            pending_map.insert(id.clone(), pending.clone());
        }

        let event = SshAuthPromptEvent {
            id: id.clone(),
            prompt: prompt.to_string(),
            profile_id: profile_id.to_string(),
            alias: alias.to_string(),
            cacheable,
        };
        let _ = self.app.emit("ssh-auth-request", event);
        let answer = pending.wait_for_answer(Duration::from_secs(300));
        if let Ok(mut pending_map) = self.pending.lock() {
            pending_map.remove(&id);
        }
        if let Some(secret) = answer.as_ref() {
            if cacheable && !secret.is_empty() {
                if let Ok(mut cache) = self.cache.lock() {
                    cache.insert(cache_key, secret.clone());
                }
            }
        }
        answer
    }

    fn answer_prompt(&self, id: &str, secret: Option<String>) -> bool {
        let pending = self
            .pending
            .lock()
            .ok()
            .and_then(|pending_map| pending_map.get(id).cloned());
        let Some(pending) = pending else {
            return false;
        };
        let answered = if let Ok(mut answer) = pending.answer.lock() {
            *answer = Some(secret);
            pending.ready.notify_all();
            true
        } else {
            false
        };
        answered
    }

    fn clear_cache_for_profile(&self, profile_id: &str, alias: &str) {
        let profile_prefix = format!("profile:{profile_id}:");
        let alias_prefix = format!("alias:{alias}:");
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|key, _| {
                !key.starts_with(&profile_prefix)
                    && (alias.is_empty() || !key.starts_with(&alias_prefix))
            });
        }
    }
}

#[cfg(windows)]
impl SshAskpassPending {
    fn wait_for_answer(&self, timeout: Duration) -> Option<String> {
        let deadline = Instant::now() + timeout;
        let mut answer = self.answer.lock().ok()?;
        loop {
            if let Some(value) = answer.take() {
                return value;
            }
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next_answer, wait_result) = self.ready.wait_timeout(answer, remaining).ok()?;
            answer = next_answer;
            if wait_result.timed_out() {
                return answer.take().flatten();
            }
        }
    }
}

#[cfg(windows)]
fn answer_ssh_askpass_prompt(id: &str, secret: Option<String>) -> bool {
    SSH_ASKPASS_SERVER
        .get()
        .map(|server| server.answer_prompt(id, secret))
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn answer_ssh_askpass_prompt(_id: &str, _secret: Option<String>) -> bool {
    false
}

#[cfg(windows)]
fn clear_ssh_askpass_cache_for_profile(profile: &ConnectionProfile) {
    let alias = profile.ssh_alias.as_deref().unwrap_or("");
    if let Some(server) = SSH_ASKPASS_SERVER.get() {
        server.clear_cache_for_profile(&profile.id, alias);
    }
}

#[cfg(not(windows))]
fn clear_ssh_askpass_cache_for_profile(_profile: &ConnectionProfile) {}

#[cfg(windows)]
fn ssh_auth_prompt_cacheable(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    lower.contains("passphrase") && lower.contains("key")
}

#[cfg(windows)]
fn ssh_auth_cache_key(prompt: &str, profile_id: &str, alias: &str) -> String {
    if let Some(key) = ssh_auth_prompt_key_path(prompt) {
        return format!("key:{key}");
    }
    if !alias.is_empty() {
        return format!("alias:{alias}:{}", ssh_auth_prompt_shape(prompt));
    }
    format!("profile:{profile_id}:{}", ssh_auth_prompt_shape(prompt))
}

#[cfg(windows)]
fn ssh_auth_prompt_key_path(prompt: &str) -> Option<String> {
    let lower = prompt.to_ascii_lowercase();
    let key_index = lower.find("key")?;
    let after_key = prompt.get(key_index + 3..)?.trim_start();
    for quote in ['\'', '"'] {
        if let Some(rest) = after_key.strip_prefix(quote) {
            if let Some(end) = rest.find(quote) {
                let value = rest[..end].trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn ssh_auth_prompt_shape(prompt: &str) -> String {
    prompt
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace() {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn ensure_session_ssh_agent_vars() -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        return Vec::new();
    }
    #[cfg(not(windows))]
    {
        if let Ok(guard) = ssh_agent_store().lock() {
            if let Some(session) = guard.as_ref() {
                return session.vars.clone();
            }
        }
        if SSH_AGENT_START_ATTEMPTED.swap(true, Ordering::Relaxed) {
            return Vec::new();
        }
        let Some(session) = start_session_ssh_agent() else {
            return Vec::new();
        };
        let vars = session.vars.clone();
        if let Ok(mut guard) = ssh_agent_store().lock() {
            *guard = Some(session);
        }
        vars
    }
}

#[cfg(not(windows))]
fn start_session_ssh_agent() -> Option<SshAgentSession> {
    let mut command = Command::new(ssh_agent_executable());
    command
        .arg("-s")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let output = hide_command_window(&mut command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let vars = parse_ssh_agent_shell_vars(&text);
    if vars
        .iter()
        .any(|(key, value)| key == "SSH_AUTH_SOCK" && !value.is_empty())
    {
        if let Some(pid) = vars
            .iter()
            .find(|(key, _)| key == "SSH_AGENT_PID")
            .and_then(|(_, value)| value.parse::<u32>().ok())
        {
            assign_child_to_cleanup_job(pid);
        }
        let session = SshAgentSession { vars };
        if session_ssh_agent_is_usable(&session) {
            Some(session)
        } else {
            shutdown_ssh_agent_session(session);
            None
        }
    } else {
        None
    }
}

#[cfg(not(windows))]
fn session_ssh_agent_is_usable(session: &SshAgentSession) -> bool {
    let mut command = Command::new(ssh_add_executable());
    command
        .arg("-l")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (key, value) in &session.vars {
        Command::env(&mut command, key, value);
    }
    hide_command_window(&mut command)
        .status()
        .map(|status| {
            let code = status.code().unwrap_or(-1);
            code == 0 || code == 1
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn shutdown_ssh_agent_session(session: SshAgentSession) {
    let mut command = Command::new(ssh_agent_executable());
    command
        .arg("-k")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (key, value) in &session.vars {
        Command::env(&mut command, key, value);
    }
    let _ = hide_command_window(&mut command).status();
    if let Some(pid) = session
        .vars
        .iter()
        .find(|(key, _)| key == "SSH_AGENT_PID")
        .and_then(|(_, value)| value.parse::<u32>().ok())
    {
        kill_process_tree(pid);
    }
}

#[cfg(not(windows))]
fn parse_ssh_agent_shell_vars(output: &str) -> Vec<(String, String)> {
    let mut vars = Vec::new();
    for key in ["SSH_AUTH_SOCK", "SSH_AGENT_PID"] {
        let Some(value) = parse_shell_assignment(output, key) else {
            continue;
        };
        if !value.is_empty() {
            vars.push((key.to_string(), value));
        }
    }
    vars
}

#[cfg(not(windows))]
fn parse_shell_assignment(output: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix(&prefix) else {
            continue;
        };
        let value = rest
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        return Some(value);
    }
    None
}

fn apply_session_ssh_auth_to_command(command: &mut Command, profile: &ConnectionProfile) {
    apply_ssh_askpass_to_command(command, profile);
    #[cfg(windows)]
    {
        if windows_ssh_agent_service_running() {
            command.env_remove("SSH_AUTH_SOCK");
            command.env_remove("SSH_AGENT_PID");
            return;
        }
    }
    for (key, value) in ensure_session_ssh_agent_vars() {
        Command::env(command, key, value);
    }
}

fn apply_session_ssh_auth_to_pty(command: &mut CommandBuilder, profile: &ConnectionProfile) {
    apply_ssh_askpass_to_pty(command, profile);
    for (key, value) in ensure_session_ssh_agent_vars() {
        CommandBuilder::env(command, key, value);
    }
}

fn shutdown_session_ssh_agent() {
    #[cfg(windows)]
    {
        return;
    }
    #[cfg(not(windows))]
    {
        let session = ssh_agent_store()
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        let Some(session) = session else {
            return;
        };
        shutdown_ssh_agent_session(session);
    }
}

#[cfg(windows)]
fn windows_openssh_executable(name: &str) -> Option<PathBuf> {
    let windir = std::env::var("WINDIR")
        .or_else(|_| std::env::var("SystemRoot"))
        .unwrap_or_else(|_| "C:\\Windows".to_string());
    let path = PathBuf::from(windir)
        .join("System32")
        .join("OpenSSH")
        .join(name);
    path.exists().then_some(path)
}

fn ssh_executable() -> PathBuf {
    #[cfg(not(windows))]
    {
        PathBuf::from("ssh")
    }
    #[cfg(windows)]
    {
        windows_openssh_executable("ssh.exe").unwrap_or_else(|| PathBuf::from("ssh.exe"))
    }
}

fn ssh_executable_string() -> String {
    ssh_executable().to_string_lossy().to_string()
}

fn ssh_add_executable() -> PathBuf {
    #[cfg(not(windows))]
    {
        PathBuf::from("ssh-add")
    }
    #[cfg(windows)]
    {
        windows_openssh_executable("ssh-add.exe").unwrap_or_else(|| PathBuf::from("ssh-add.exe"))
    }
}

fn ssh_add_executable_string() -> String {
    ssh_add_executable().to_string_lossy().to_string()
}

#[cfg(not(windows))]
fn ssh_agent_executable() -> PathBuf {
    PathBuf::from("ssh-agent")
}

#[cfg(windows)]
fn query_windows_ssh_agent_service_running() -> bool {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(
            "try { $svc = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue; \
             if ($svc -and $svc.Status -eq 'Running') { exit 0 } else { exit 1 } } catch { exit 1 }",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_command_window(&mut command)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn windows_ssh_agent_service_running() -> bool {
    #[cfg(not(windows))]
    {
        false
    }
    #[cfg(windows)]
    {
        query_windows_ssh_agent_service_running()
    }
}

fn ssh_common_options(interactive: bool, batch_mode: bool) -> Vec<String> {
    let mut args = Vec::new();
    if batch_mode {
        args.extend(["-o".to_string(), "BatchMode=yes".to_string()]);
    }
    if interactive {
        args.extend(["-o".to_string(), "AddKeysToAgent=yes".to_string()]);
    }
    if windows_ssh_agent_service_running() {
        args.extend([
            "-o".to_string(),
            "IdentityAgent=\\\\.\\pipe\\openssh-ssh-agent".to_string(),
        ]);
    }
    args
}

fn push_ssh_background_options(command: &mut Command) {
    for arg in ssh_common_options(false, false) {
        command.arg(arg);
    }
    command
        .arg("-o")
        .arg("PreferredAuthentications=publickey")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=1");
}

fn ssh_remote_bash_command(script: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
    let loader = format!(". <(printf %s {encoded} | base64 -d)");
    format!("bash -lc {}", shell_quote(&loader))
}

fn ssh_terminal_bootstrap_script(alias: &str, remote_command: &str) -> String {
    let ssh_path = powershell_single_quote(&ssh_executable_string());
    let ssh_add_path = powershell_single_quote(&ssh_add_executable_string());
    let alias_quoted = powershell_single_quote(alias);
    let remote_quoted = powershell_single_quote(remote_command);
    let clear_agent_env = if windows_ssh_agent_service_running() {
        "Remove-Item Env:SSH_AUTH_SOCK -ErrorAction SilentlyContinue\nRemove-Item Env:SSH_AGENT_PID -ErrorAction SilentlyContinue"
    } else {
        ""
    };
    let common_options = ssh_common_options(true, false)
        .into_iter()
        .map(|arg| powershell_single_quote(&arg))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r#"$ErrorActionPreference = 'Continue'
$ssh = {ssh_path}
$sshAdd = {ssh_add_path}
$aliasName = {alias_quoted}
$remoteCommand = {remote_quoted}
{clear_agent_env}
& $sshAdd -l *> $null
$agentStatus = $LASTEXITCODE
if ($agentStatus -eq 1) {{
  $identityFiles = @()
  try {{
    $identityFiles = & $ssh -G $aliasName 2>$null | ForEach-Object {{
      if ($_ -match '^identityfile\s+(.+)$') {{ $Matches[1] }}
    }}
  }} catch {{}}
  $addedIdentity = $false
  foreach ($identityFile in $identityFiles) {{
    if ([string]::IsNullOrWhiteSpace($identityFile)) {{ continue }}
    if ($identityFile.Contains('%')) {{ continue }}
    $expandedIdentity = $identityFile
    if ($expandedIdentity -eq '~') {{
      $expandedIdentity = $env:USERPROFILE
    }} elseif ($expandedIdentity.StartsWith('~/') -or $expandedIdentity.StartsWith('~\')) {{
      $expandedIdentity = Join-Path $env:USERPROFILE $expandedIdentity.Substring(2)
    }}
    if (Test-Path -LiteralPath $expandedIdentity) {{
      & $sshAdd -- $expandedIdentity
      & $sshAdd -l *> $null
      if ($LASTEXITCODE -eq 0) {{
        $addedIdentity = $true
        break
      }}
    }}
  }}
  if (-not $addedIdentity) {{
    & $sshAdd
  }}
}} elseif ($agentStatus -ne 0) {{
  Write-Host '[simple-vibe-ide] Windows OpenSSH agent is unavailable; using the IDE SSH askpass prompt instead.'
}}
$sshArgs = @({common_options})
# Keep the native argv quote escape as a defensive layer, but the terminal bootstrap is
# primarily passed as a quote-free base64 loader now. Windows PowerShell 5.1 -> ssh.exe
# can still strip embedded double quotes from native args on some hosts, which corrupts
# the remote bash rcfile (`case ;...;`). Avoiding those quotes in the ssh argv is the
# robust path; this replacement protects any future quoted launcher suffix.
$remoteCommandArg = $remoteCommand -replace '(\\*)"', '$1$1\"'
$sshArgs += @('-tt', $aliasName, $remoteCommandArg)
& $ssh @sshArgs
exit $LASTEXITCODE
"#
    )
}

/// Forcefully terminate a process *and its entire child tree* by PID.
///
/// On Windows, killing only the directly spawned process (e.g. `wsl.exe` or
/// `ssh.exe`) leaves grandchildren (wslhost, ssh ControlMaster, PTY helpers)
/// behind as orphans, because Windows does not propagate termination down the
/// tree. `taskkill /T` walks the tree and `/F` forces termination.
fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        if pid == 0 {
            return;
        }
        let mut command = Command::new("taskkill");
        command
            .arg("/T")
            .arg("/F")
            .arg("/PID")
            .arg(pid.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = hide_command_window(&mut command).status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
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
    kind: &'static str,
    size: u64,
    hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListingResult {
    path: String,
    entries: Vec<FileEntry>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectorySignatureResult {
    path: String,
    signature: String,
    error: Option<String>,
}

struct DirectorySignatureEntry {
    name: String,
    kind: &'static str,
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
struct TerminalCursorQueryEvent {
    id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserWebviewPageLoadEvent {
    label: String,
    url: String,
    event: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeletedPathItem {
    original_path: String,
    trash_path: String,
    name: String,
    directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAlertPayload {
    title: String,
    body: String,
    show_banner: bool,
    play_sound: bool,
    delay_ms: Option<u64>,
    debug_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAlertResult {
    notification_plugin_ok: bool,
    tray_balloon_ok: bool,
    banner_error: Option<String>,
    scheduled_delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAlertDelayedResultEvent {
    debug_id: Option<String>,
    result: Option<AgentAlertResult>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmTmuxSession {
    name: String,
    attached: bool,
    windows: u32,
    created_at: Option<u64>,
    activity_at: Option<u64>,
    legacy: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmTmuxSessionListResult {
    available: bool,
    base_name: String,
    sessions: Vec<LlmTmuxSession>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmTmuxPaneTitleResult {
    available: bool,
    session_name: String,
    pane_title: Option<String>,
    window_name: Option<String>,
    pane_in_mode: bool,
    pane_dead: bool,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmTmuxPaneProbeResult {
    available: bool,
    session_name: String,
    pane_in_mode: bool,
    pane_dead: bool,
    current_command: Option<String>,
    pane_pid: Option<u32>,
    alternate_on: bool,
    history_size: Option<u32>,
    session_activity: Option<u64>,
    pane_active: bool,
    title_checksum: Option<String>,
    title_bytes: Option<u32>,
    window_checksum: Option<String>,
    window_bytes: Option<u32>,
    capture_checksum: Option<String>,
    capture_bytes: Option<u32>,
    meta_seen: bool,
    title_seen: bool,
    window_seen: bool,
    capture_seen: bool,
    title_parse: Option<String>,
    window_parse: Option<String>,
    capture_parse: Option<String>,
    probe_stdout_lines: u32,
    probe_stdout_bytes: u32,
    message: Option<String>,
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
async fn list_wsl_profiles() -> Vec<ConnectionProfile> {
    run_blocking_command("list wsl profiles", list_wsl_profiles_blocking)
        .await
        .unwrap_or_else(|_| wsl_profiles_from_distros(Vec::new()))
}

fn list_wsl_profiles_blocking() -> Result<Vec<ConnectionProfile>, String> {
    Ok(wsl_profiles_from_distros(detect_wsl_distros()))
}

fn wsl_profiles_from_distros(detected_wsl: Vec<String>) -> Vec<ConnectionProfile> {
    let mut profiles = Vec::new();
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
fn answer_ssh_auth_prompt(id: String, secret: Option<String>) -> Result<(), String> {
    if answer_ssh_askpass_prompt(&id, secret) {
        Ok(())
    } else {
        Err("SSH auth prompt is no longer active".to_string())
    }
}

#[tauri::command]
fn renderer_heartbeat(state: State<'_, IdeState>) -> RendererHeartbeatResponse {
    let Ok(mut health) = state.renderer_health.lock() else {
        return RendererHeartbeatResponse { recovery: None };
    };
    let now = Instant::now();
    health.last_heartbeat = now;
    if let Some(reload) = health.last_reload {
        let elapsed = reload.elapsed();
        if elapsed >= RENDERER_RECOVERY_RELOAD_COOLDOWN {
            health.reload_attempts = 0;
            health.last_reload = None;
            health.pending_notice = None;
        } else if elapsed >= RENDERER_RECOVERY_STABLE_AFTER {
            health.pending_notice = None;
        }
    }
    let recovery = health.pending_notice.clone();
    RendererHeartbeatResponse { recovery }
}

#[tauri::command]
fn send_agent_alert(
    app: AppHandle,
    payload: AgentAlertPayload,
) -> Result<AgentAlertResult, String> {
    let title = normalize_agent_alert_text(&payload.title, 96);
    let body = normalize_agent_alert_text(&payload.body, 180);
    let delay_ms = payload.delay_ms.unwrap_or(0).min(60_000);
    if delay_ms > 0 {
        let app_for_delay = app.clone();
        let debug_id = payload.debug_id.clone();
        let delayed_title = title.clone();
        let delayed_body = body.clone();
        let show_banner = payload.show_banner;
        let play_sound = payload.play_sound;
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay_ms));
            let result = send_agent_alert_now(
                &app_for_delay,
                &delayed_title,
                &delayed_body,
                show_banner,
                play_sound,
            );
            let event = match result {
                Ok(result) => AgentAlertDelayedResultEvent {
                    debug_id,
                    result: Some(result),
                    error: None,
                },
                Err(error) => AgentAlertDelayedResultEvent {
                    debug_id,
                    result: None,
                    error: Some(error),
                },
            };
            let _ = app_for_delay.emit("agent-alert-delayed-result", event);
        });
        return Ok(AgentAlertResult {
            notification_plugin_ok: false,
            tray_balloon_ok: false,
            banner_error: None,
            scheduled_delay_ms: Some(delay_ms),
        });
    }
    send_agent_alert_now(&app, &title, &body, payload.show_banner, payload.play_sound)
}

fn send_agent_alert_now(
    app: &AppHandle,
    title: &str,
    body: &str,
    show_banner: bool,
    play_sound: bool,
) -> Result<AgentAlertResult, String> {
    let mut banner_errors = Vec::new();
    let mut notification_plugin_ok = false;
    #[cfg(windows)]
    let mut tray_balloon_ok = false;
    #[cfg(not(windows))]
    let tray_balloon_ok = false;

    if show_banner {
        if let Err(error) = app
            .notification()
            .builder()
            .title(if title.is_empty() {
                "Simple Vibe IDE".to_string()
            } else {
                title.to_string()
            })
            .body(body.to_string())
            .show()
        {
            banner_errors.push(format!("notification plugin failed: {error}"));
        } else {
            notification_plugin_ok = true;
        }

        #[cfg(windows)]
        match show_windows_agent_alert_balloon(&title, &body) {
            Ok(()) => {
                tray_balloon_ok = true;
            }
            Err(error) => {
                banner_errors.push(format!("tray balloon failed: {error}"));
            }
        }
    }

    if play_sound {
        play_native_agent_alert_sound();
    }

    if show_banner && !notification_plugin_ok && !tray_balloon_ok {
        Err(format!(
            "notification banner failed: {}",
            banner_errors.join("; ")
        ))
    } else {
        Ok(AgentAlertResult {
            notification_plugin_ok,
            tray_balloon_ok,
            banner_error: if banner_errors.is_empty() {
                None
            } else {
                Some(banner_errors.join("; "))
            },
            scheduled_delay_ms: None,
        })
    }
}

fn normalize_agent_alert_text(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    for ch in value.chars() {
        if count >= max_chars {
            out.push('…');
            break;
        }
        if ch == '\r' || ch == '\n' || ch == '\t' {
            out.push(' ');
            count += 1;
        } else if !ch.is_control() {
            out.push(ch);
            count += 1;
        }
    }
    out.trim().to_string()
}

#[tauri::command]
fn agent_bridge_info(
    app: AppHandle,
    state: State<'_, IdeState>,
) -> Result<AgentBridgeInfo, String> {
    let runtime = start_agent_bridge_if_needed(app, state.inner())?;
    Ok(AgentBridgeInfo {
        port: runtime.port,
        token: runtime.token,
    })
}

#[tauri::command]
fn register_agent_bridge_session(
    state: State<'_, IdeState>,
    payload: RegisterAgentBridgeSessionPayload,
) -> Result<(), String> {
    if !agent_bridge_safe_id(&payload.session_id)
        || !agent_bridge_safe_id(&payload.pane_id)
        || !agent_bridge_safe_id(&payload.workspace_id)
        || !agent_bridge_safe_agent(&payload.agent_id)
    {
        return Err("invalid agent bridge session".to_string());
    }
    let mut sessions = state
        .agent_bridge
        .sessions
        .lock()
        .map_err(|_| "agent bridge sessions are unavailable".to_string())?;
    sessions.insert(
        payload.session_id.clone(),
        AgentBridgeSession {
            agent_id: payload.agent_id,
            pane_id: payload.pane_id,
            workspace_id: payload.workspace_id,
            cwd: payload.cwd,
        },
    );
    if sessions.len() > 256 {
        let keys: Vec<String> = sessions
            .keys()
            .take(sessions.len().saturating_sub(256))
            .cloned()
            .collect();
        for key in keys {
            sessions.remove(&key);
        }
    }
    Ok(())
}

fn start_agent_bridge_if_needed(
    app: AppHandle,
    state: &IdeState,
) -> Result<AgentBridgeRuntime, String> {
    let mut runtime_guard = state
        .agent_bridge
        .runtime
        .lock()
        .map_err(|_| "agent bridge is unavailable".to_string())?;
    if let Some(runtime) = runtime_guard.clone() {
        return Ok(runtime);
    }

    let listener = TcpListener::bind(("0.0.0.0", 0))
        .map_err(|error| format!("failed to bind agent bridge: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("failed to read agent bridge port: {error}"))?
        .port();
    let runtime = AgentBridgeRuntime {
        port,
        token: Uuid::new_v4().to_string(),
    };
    let token = runtime.token.clone();
    let sessions = state.agent_bridge.sessions.clone();
    let app_for_thread = app.clone();
    thread::Builder::new()
        .name("simple-vibe-agent-bridge".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let app_for_request = app_for_thread.clone();
                        let token_for_request = token.clone();
                        let sessions_for_request = sessions.clone();
                        let _ = thread::Builder::new()
                            .name("simple-vibe-agent-bridge-request".to_string())
                            .spawn(move || {
                                let _ = handle_agent_bridge_http_request(
                                    &app_for_request,
                                    &token_for_request,
                                    &sessions_for_request,
                                    stream,
                                );
                            });
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| format!("failed to start agent bridge: {error}"))?;
    *runtime_guard = Some(runtime.clone());
    Ok(runtime)
}

fn handle_agent_bridge_http_request(
    app: &AppHandle,
    token: &str,
    sessions: &Arc<Mutex<HashMap<String, AgentBridgeSession>>>,
    mut stream: TcpStream,
) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(AGENT_BRIDGE_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(AGENT_BRIDGE_IO_TIMEOUT));
    let buffer = match read_http_headers(&mut stream, 128 * 1024) {
        Ok(buffer) => buffer,
        Err(_) => {
            return write_plain_http_response(&mut stream, 400, "Bad Request", "bad headers\n")
        }
    };
    let Some(header_end) = find_http_header_end(&buffer) else {
        return write_plain_http_response(&mut stream, 400, "Bad Request", "missing headers\n");
    };
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let Some(request_line) = header_text.lines().next() else {
        return write_plain_http_response(&mut stream, 400, "Bad Request", "bad request\n");
    };
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let uri = request_parts.next().unwrap_or_default();
    if method != "POST" {
        return write_plain_http_response(&mut stream, 405, "Method Not Allowed", "POST only\n");
    }
    if !uri.starts_with("/agent-event") {
        return write_plain_http_response(&mut stream, 404, "Not Found", "not found\n");
    }
    if http_header_value(&header_text, "x-svi-agent-token").as_deref() != Some(token) {
        return write_plain_http_response(&mut stream, 403, "Forbidden", "bad token\n");
    }
    let length = http_content_length(&header_text)
        .unwrap_or(0)
        .min(2 * 1024 * 1024);
    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    if body.len() < length {
        let mut rest = vec![0_u8; length - body.len()];
        stream.read_exact(&mut rest)?;
        body.extend(rest);
    }
    body.truncate(length);
    let value = match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(value) => value,
        Err(_) => return write_plain_http_response(&mut stream, 400, "Bad Request", "bad json\n"),
    };
    let query = agent_bridge_query_pairs(uri);
    let session_id = query
        .get("session")
        .cloned()
        .filter(|value| agent_bridge_safe_id(value));
    let Some(session_id) = session_id else {
        return write_plain_http_response(&mut stream, 400, "Bad Request", "missing session\n");
    };
    let registered = sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&session_id).cloned());
    let agent_id = query
        .get("agent")
        .cloned()
        .filter(|value| agent_bridge_safe_agent(value))
        .or_else(|| registered.as_ref().map(|session| session.agent_id.clone()))
        .unwrap_or_else(|| "agent".to_string());
    let raw_event_name = agent_bridge_event_name(&value);
    let status = agent_bridge_status_for_event(&raw_event_name).map(str::to_string);
    let activity = agent_bridge_activity_for_event(&raw_event_name, &value);
    let event = AgentBridgeEvent {
        agent_id,
        session_id,
        pane_id: registered.as_ref().map(|session| session.pane_id.clone()),
        workspace_id: registered
            .as_ref()
            .map(|session| session.workspace_id.clone()),
        cwd: registered.as_ref().map(|session| session.cwd.clone()),
        raw_event_name,
        status,
        activity,
        transcript_path: value
            .get("transcript_path")
            .or_else(|| value.get("transcriptPath"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        source: "hook".to_string(),
    };
    let _ = app.emit("agent-bridge-event", event);
    write_plain_http_response(&mut stream, 200, "OK", "ok\n")
}

fn agent_bridge_safe_id(value: &str) -> bool {
    let len = value.len();
    len > 0
        && len <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn agent_bridge_safe_agent(value: &str) -> bool {
    let len = value.len();
    len > 0
        && len <= 48
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn agent_bridge_query_pairs(uri: &str) -> HashMap<String, String> {
    let mut pairs = HashMap::new();
    let Some((_, query)) = uri.split_once('?') else {
        return pairs;
    };
    for item in query.split('&') {
        let Some((key, value)) = item.split_once('=') else {
            continue;
        };
        if key.is_empty() || value.is_empty() {
            continue;
        }
        pairs.insert(key.to_string(), value.to_string());
    }
    pairs
}

fn agent_bridge_event_name(value: &serde_json::Value) -> String {
    let raw = value
        .get("hook_event_name")
        .or_else(|| value.get("hookEventName"))
        .or_else(|| value.get("event"))
        .or_else(|| value.get("event_name"))
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();
    agent_bridge_canonical_event_name(&raw)
}

fn agent_bridge_canonical_event_name(value: &str) -> String {
    match value {
        "session_start" | "SessionStart" => "SessionStart",
        "user_prompt_submit" | "UserPromptSubmit" => "UserPromptSubmit",
        "pre_tool_use" | "PreToolUse" => "PreToolUse",
        "post_tool_use" | "PostToolUse" => "PostToolUse",
        "post_tool_use_failure" | "PostToolUseFailure" => "PostToolUseFailure",
        "permission_request" | "PermissionRequest" => "PermissionRequest",
        "permission_denied" | "PermissionDenied" => "PermissionDenied",
        "notification" | "Notification" => "Notification",
        "subagent_start" | "SubagentStart" => "SubagentStart",
        "subagent_stop" | "SubagentStop" | "subagent_end" | "SubagentEnd" => "SubagentStop",
        "pre_compact" | "PreCompact" => "PreCompact",
        "post_compact" | "PostCompact" => "PostCompact",
        "stop" | "Stop" => "Stop",
        "stop_failure" | "StopFailure" => "StopFailure",
        "session_end" | "SessionEnd" => "SessionEnd",
        other => other,
    }
    .to_string()
}

fn agent_bridge_status_for_event(event_name: &str) -> Option<&'static str> {
    match event_name {
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "SubagentStart" | "PreCompact" => {
            Some("working")
        }
        "Notification" | "PermissionRequest" => Some("waiting"),
        "Stop" | "SubagentStop" | "PostCompact" | "SessionStart" => Some("idle"),
        "StopFailure" | "PostToolUseFailure" | "PermissionDenied" => Some("error"),
        "SessionEnd" => Some("exited"),
        _ => None,
    }
}

fn agent_bridge_activity_for_event(event_name: &str, value: &serde_json::Value) -> Option<String> {
    let activity = match event_name {
        "UserPromptSubmit" => "Prompt submitted".to_string(),
        "PreToolUse" => {
            let tool_name = value
                .get("tool_name")
                .or_else(|| value.get("toolName"))
                .or_else(|| value.pointer("/tool/name"))
                .and_then(|value| value.as_str())
                .unwrap_or("tool");
            format!("Running {tool_name}")
        }
        "PostToolUse" => "Tool finished".to_string(),
        "PostToolUseFailure" => "Tool failed".to_string(),
        "SubagentStart" => "Subagent started".to_string(),
        "Notification" | "PermissionRequest" => value
            .get("message")
            .or_else(|| value.get("notification"))
            .and_then(|value| value.as_str())
            .unwrap_or("Waiting for your response")
            .to_string(),
        "PermissionDenied" => "Permission denied".to_string(),
        "Stop" | "SubagentStop" => "Finished".to_string(),
        "StopFailure" => "Stop hook failed".to_string(),
        "PreCompact" => "Compacting conversation".to_string(),
        "PostCompact" => "Compaction finished".to_string(),
        "SessionEnd" => "Session ended".to_string(),
        "SessionStart" => "Session started".to_string(),
        _ => return None,
    };
    Some(normalize_agent_alert_text(&activity, 160))
}

#[cfg(windows)]
fn show_windows_agent_alert_balloon(title: &str, body: &str) -> Result<(), String> {
    let hwnd = cached_main_hwnd().ok_or_else(|| "main window hwnd is not available".to_string())?;
    let icon_id = AGENT_ALERT_TRAY_ICON_ID.fetch_add(1, Ordering::Relaxed);
    let mut data = NOTIFYICONDATAW::default();
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd;
    data.uID = icon_id;
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    data.uCallbackMessage = 0;
    data.hIcon = windows_agent_alert_icon(hwnd);
    fill_wide_fixed(&mut data.szTip, "Simple Vibe IDE");

    if !unsafe { Shell_NotifyIconW(NIM_ADD, &data) }.as_bool() {
        return Err(windows::core::Error::from_win32().to_string());
    }

    data.uFlags = NIF_INFO;
    fill_wide_fixed(
        &mut data.szInfoTitle,
        if title.is_empty() {
            "Simple Vibe IDE"
        } else {
            title
        },
    );
    fill_wide_fixed(&mut data.szInfo, body);
    data.dwInfoFlags = NIIF_INFO | NIIF_NOSOUND;

    if !unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) }.as_bool() {
        let error = windows::core::Error::from_win32().to_string();
        let _ = unsafe { Shell_NotifyIconW(NIM_DELETE, &data) };
        return Err(error);
    }

    let delete_hwnd = hwnd.0 as isize;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(10));
        let mut delete_data = NOTIFYICONDATAW::default();
        delete_data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        delete_data.hWnd = HWND(delete_hwnd as *mut core::ffi::c_void);
        delete_data.uID = icon_id;
        let _ = unsafe { Shell_NotifyIconW(NIM_DELETE, &delete_data) };
    });

    Ok(())
}

#[cfg(windows)]
fn windows_agent_alert_icon(hwnd: HWND) -> HICON {
    unsafe {
        for icon_kind in [ICON_SMALL2, ICON_SMALL, ICON_BIG] {
            let icon = SendMessageW(hwnd, WM_GETICON, Some(WPARAM(icon_kind as usize)), None);
            if icon.0 != 0 {
                return HICON(icon.0 as *mut core::ffi::c_void);
            }
        }
        for class_index in [GCLP_HICONSM, GCLP_HICON] {
            let icon = GetClassLongPtrW(hwnd, class_index);
            if icon != 0 {
                return HICON(icon as *mut core::ffi::c_void);
            }
        }
        LoadIconW(None, IDI_APPLICATION).unwrap_or_default()
    }
}

#[cfg(windows)]
fn fill_wide_fixed<const N: usize>(target: &mut [u16; N], value: &str) {
    target.fill(0);
    for (index, unit) in value.encode_utf16().take(N.saturating_sub(1)).enumerate() {
        target[index] = unit;
    }
}

#[cfg(windows)]
fn play_native_agent_alert_sound() {
    let _ = unsafe { MessageBeep(MB_ICONASTERISK) };
}

#[cfg(not(windows))]
fn play_native_agent_alert_sound() {}

#[tauri::command]
async fn list_llm_tmux_sessions(
    profile_id: String,
    cwd: String,
    workspace_id: String,
    agent_id: String,
) -> Result<LlmTmuxSessionListResult, String> {
    run_blocking_command("list llm tmux sessions", move || {
        let profile = profile_from_id(&profile_id);
        let cwd = normalize_profile_path(&profile, &cwd);
        list_llm_tmux_sessions_direct(&profile, &cwd, &workspace_id, &agent_id)
    })
    .await
}

#[tauri::command]
async fn next_llm_tmux_session(
    profile_id: String,
    cwd: String,
    workspace_id: String,
    agent_id: String,
) -> Result<String, String> {
    run_blocking_command("next llm tmux session", move || {
        let profile = profile_from_id(&profile_id);
        let cwd = normalize_profile_path(&profile, &cwd);
        next_llm_tmux_session_direct(&profile, &cwd, &workspace_id, &agent_id)
    })
    .await
}

#[tauri::command]
async fn kill_llm_tmux_session(
    profile_id: String,
    cwd: String,
    session_name: String,
) -> Result<(), String> {
    run_blocking_command("kill llm tmux session", move || {
        if !is_safe_llm_tmux_session_name(&session_name) {
            return Err("invalid tmux session name".to_string());
        }
        let profile = profile_from_id(&profile_id);
        let cwd = normalize_profile_path(&profile, &cwd);
        kill_llm_tmux_session_direct(&profile, &cwd, &session_name)
    })
    .await
}

#[tauri::command]
async fn llm_tmux_pane_title(
    profile_id: String,
    cwd: String,
    session_name: String,
) -> Result<LlmTmuxPaneTitleResult, String> {
    run_blocking_command("llm tmux pane title", move || {
        if !is_safe_llm_tmux_session_name(&session_name) {
            return Err("invalid tmux session name".to_string());
        }
        let profile = profile_from_id(&profile_id);
        let cwd = normalize_profile_path(&profile, &cwd);
        llm_tmux_pane_title_direct(&profile, &cwd, &session_name)
    })
    .await
}

#[tauri::command]
async fn llm_tmux_pane_probe(
    profile_id: String,
    cwd: String,
    session_name: String,
) -> Result<LlmTmuxPaneProbeResult, String> {
    run_blocking_command("llm tmux pane probe", move || {
        if !is_safe_llm_tmux_session_name(&session_name) {
            return Err("invalid tmux session name".to_string());
        }
        let profile = profile_from_id(&profile_id);
        let cwd = normalize_profile_path(&profile, &cwd);
        llm_tmux_pane_probe_direct(&profile, &cwd, &session_name)
    })
    .await
}

fn list_llm_tmux_sessions_direct(
    profile: &ConnectionProfile,
    _cwd: &str,
    workspace_id: &str,
    agent_id: &str,
) -> Result<LlmTmuxSessionListResult, String> {
    let base_name = llm_tmux_session_base_name(workspace_id, agent_id);
    if profile.kind == "windows" {
        return Ok(LlmTmuxSessionListResult {
            available: false,
            base_name,
            sessions: Vec::new(),
            message: Some("tmux is only used for WSL/SSH profiles".to_string()),
        });
    }
    let output = run_profile_shell_with_timeout(
        profile,
        "if ! command -v tmux >/dev/null 2>&1; then printf '__SVI_TMUX_MISSING__\\n'; exit 0; fi; tmux list-sessions -F '#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_created}\t#{session_activity}' 2>/dev/null || true",
        None,
        LLM_TMUX_COMMAND_TIMEOUT,
    )?;
    let text = String::from_utf8_lossy(&output);
    if text
        .lines()
        .any(|line| line.trim() == "__SVI_TMUX_MISSING__")
    {
        return Ok(LlmTmuxSessionListResult {
            available: false,
            base_name,
            sessions: Vec::new(),
            message: Some("tmux is not installed on this profile".to_string()),
        });
    }
    let mut sessions = Vec::new();
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let Some(name) = parts.next() else {
            continue;
        };
        if !is_llm_tmux_session_for_base(name, &base_name) || !is_safe_llm_tmux_session_name(name) {
            continue;
        }
        let attached = parts.next().unwrap_or("0") == "1";
        let windows = parts
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let created_at = parts.next().and_then(|value| value.parse().ok());
        let activity_at = parts.next().and_then(|value| value.parse().ok());
        sessions.push(LlmTmuxSession {
            name: name.to_string(),
            attached,
            windows,
            created_at,
            activity_at,
            legacy: name == base_name,
        });
    }
    sessions.sort_by(|left, right| {
        llm_tmux_session_sort_key(&left.name, &base_name)
            .cmp(&llm_tmux_session_sort_key(&right.name, &base_name))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(LlmTmuxSessionListResult {
        available: true,
        base_name,
        sessions,
        message: None,
    })
}

fn next_llm_tmux_session_direct(
    profile: &ConnectionProfile,
    cwd: &str,
    workspace_id: &str,
    agent_id: &str,
) -> Result<String, String> {
    let list = list_llm_tmux_sessions_direct(profile, cwd, workspace_id, agent_id)?;
    let base = list.base_name;
    let used = list
        .sessions
        .iter()
        .filter_map(|session| llm_tmux_session_index(&session.name, &base))
        .collect::<HashSet<_>>();
    for index in 1..1000 {
        if !used.contains(&index) {
            return Ok(numbered_llm_tmux_session_name(&base, index));
        }
    }
    Ok(numbered_llm_tmux_session_name(&base, 1000))
}

fn kill_llm_tmux_session_direct(
    profile: &ConnectionProfile,
    _cwd: &str,
    session_name: &str,
) -> Result<(), String> {
    if profile.kind == "windows" {
        return Err("tmux is only used for WSL/SSH profiles".to_string());
    }
    let script = format!(
        "if ! command -v tmux >/dev/null 2>&1; then echo 'tmux is not installed' >&2; exit 127; fi; tmux kill-session -t {}",
        shell_quote(session_name)
    );
    run_profile_shell_with_timeout(profile, &script, None, LLM_TMUX_COMMAND_TIMEOUT).map(|_| ())
}

fn llm_tmux_pane_title_direct(
    profile: &ConnectionProfile,
    _cwd: &str,
    session_name: &str,
) -> Result<LlmTmuxPaneTitleResult, String> {
    if profile.kind == "windows" {
        return Ok(LlmTmuxPaneTitleResult {
            available: false,
            session_name: session_name.to_string(),
            pane_title: None,
            window_name: None,
            pane_in_mode: false,
            pane_dead: false,
            message: Some("tmux is only used for WSL/SSH profiles".to_string()),
        });
    }
    let script = format!(
        concat!(
            "if ! command -v tmux >/dev/null 2>&1; then printf '__SVI_TMUX_MISSING__\\n'; exit 0; fi; ",
            "if ! tmux has-session -t {session} 2>/dev/null; then printf '__SVI_TMUX_NOT_FOUND__\\n'; exit 0; fi; ",
            "tmux display-message -p -t {session}: '#{{pane_title}}\t#{{window_name}}\t#{{pane_in_mode}}\t#{{pane_dead}}' 2>/dev/null || printf '__SVI_TMUX_NOT_FOUND__\\n'"
        ),
        session = shell_quote(session_name)
    );
    let output = run_profile_shell_with_timeout(profile, &script, None, LLM_TMUX_TITLE_TIMEOUT)?;
    let text = String::from_utf8_lossy(&output);
    if text
        .lines()
        .any(|line| line.trim() == "__SVI_TMUX_MISSING__")
    {
        return Ok(LlmTmuxPaneTitleResult {
            available: false,
            session_name: session_name.to_string(),
            pane_title: None,
            window_name: None,
            pane_in_mode: false,
            pane_dead: false,
            message: Some("tmux is not installed on this profile".to_string()),
        });
    }
    if text
        .lines()
        .any(|line| line.trim() == "__SVI_TMUX_NOT_FOUND__")
    {
        return Ok(LlmTmuxPaneTitleResult {
            available: false,
            session_name: session_name.to_string(),
            pane_title: None,
            window_name: None,
            pane_in_mode: false,
            pane_dead: false,
            message: Some("tmux session was not found".to_string()),
        });
    }
    let Some(line) = text.lines().find(|line| !line.trim().is_empty()) else {
        return Ok(LlmTmuxPaneTitleResult {
            available: false,
            session_name: session_name.to_string(),
            pane_title: None,
            window_name: None,
            pane_in_mode: false,
            pane_dead: false,
            message: Some("tmux did not return pane title".to_string()),
        });
    };
    let mut parts = line.split('\t');
    let pane_title = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let window_name = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let pane_in_mode = parts.next().unwrap_or("0").trim() == "1";
    let pane_dead = parts.next().unwrap_or("0").trim() == "1";
    Ok(LlmTmuxPaneTitleResult {
        available: true,
        session_name: session_name.to_string(),
        pane_title,
        window_name,
        pane_in_mode,
        pane_dead,
        message: None,
    })
}

fn llm_tmux_empty_probe_result(
    session_name: &str,
    available: bool,
    message: Option<String>,
) -> LlmTmuxPaneProbeResult {
    LlmTmuxPaneProbeResult {
        available,
        session_name: session_name.to_string(),
        pane_in_mode: false,
        pane_dead: false,
        current_command: None,
        pane_pid: None,
        alternate_on: false,
        history_size: None,
        session_activity: None,
        pane_active: false,
        title_checksum: None,
        title_bytes: None,
        window_checksum: None,
        window_bytes: None,
        capture_checksum: None,
        capture_bytes: None,
        meta_seen: false,
        title_seen: false,
        window_seen: false,
        capture_seen: false,
        title_parse: None,
        window_parse: None,
        capture_parse: None,
        probe_stdout_lines: 0,
        probe_stdout_bytes: 0,
        message,
    }
}

fn parse_cksum_line(line: &str) -> (Option<String>, Option<u32>, String) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return (None, None, "empty".to_string());
    }
    let mut parts = trimmed.split_whitespace();
    let checksum = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let bytes_text = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let bytes = bytes_text.and_then(|value| value.parse().ok());
    let state = match (checksum, bytes_text, bytes) {
        (Some(_), Some(_), Some(0)) => "ok-empty",
        (Some(_), Some(_), Some(_)) => "ok",
        (Some(_), Some(_), None) => "bad-bytes",
        (Some(_), None, _) => "missing-bytes",
        _ => "missing-checksum",
    };
    (checksum.map(ToOwned::to_owned), bytes, state.to_string())
}

fn llm_tmux_pane_probe_direct(
    profile: &ConnectionProfile,
    _cwd: &str,
    session_name: &str,
) -> Result<LlmTmuxPaneProbeResult, String> {
    if profile.kind == "windows" {
        return Ok(llm_tmux_empty_probe_result(
            session_name,
            false,
            Some("tmux is only used for WSL/SSH profiles".to_string()),
        ));
    }
    let target = format!("{}:", session_name);
    let script = format!(
        concat!(
            "if ! command -v tmux >/dev/null 2>&1; then printf '__SVI_TMUX_MISSING__\\n'; exit 0; fi; ",
            "__svi_target={target}; ",
            "if ! tmux has-session -t \"$__svi_target\" 2>/dev/null; then printf '__SVI_TMUX_NOT_FOUND__\\n'; exit 0; fi; ",
            "__svi_cksum() {{ cksum | {{ read __svi_sum __svi_bytes __svi_rest; printf '%s\\t%s\\n' \"$__svi_sum\" \"$__svi_bytes\"; }}; }}; ",
            "__svi_title=$(tmux display-message -p -t \"$__svi_target\" '#{{pane_title}}' 2>/dev/null || true); ",
            "__svi_window=$(tmux display-message -p -t \"$__svi_target\" '#{{window_name}}' 2>/dev/null || true); ",
            "printf '__SVI_TMUX_META__\\t'; ",
            "tmux display-message -p -t \"$__svi_target\" '#{{pane_in_mode}}\t#{{pane_dead}}\t#{{pane_current_command}}\t#{{pane_pid}}\t#{{alternate_on}}\t#{{history_size}}\t#{{session_activity}}\t#{{pane_active}}' 2>/dev/null || printf '0\\t1\\t\\t\\t0\\t0\\t\\t0'; ",
            "printf '__SVI_TMUX_TITLE__\\t'; printf '%s' \"$__svi_title\" | __svi_cksum; ",
            "printf '__SVI_TMUX_WINDOW__\\t'; printf '%s' \"$__svi_window\" | __svi_cksum; ",
            "printf '__SVI_TMUX_CAPTURE__\\t'; tmux capture-pane -p -e -t \"$__svi_target\" -S -200 2>/dev/null | __svi_cksum"
        ),
        target = shell_quote(&target)
    );
    let output = run_profile_shell_with_timeout(profile, &script, None, LLM_TMUX_TITLE_TIMEOUT)?;
    let text = String::from_utf8_lossy(&output);
    if text
        .lines()
        .any(|line| line.trim() == "__SVI_TMUX_MISSING__")
    {
        return Ok(llm_tmux_empty_probe_result(
            session_name,
            false,
            Some("tmux is not installed on this profile".to_string()),
        ));
    }
    if text
        .lines()
        .any(|line| line.trim() == "__SVI_TMUX_NOT_FOUND__")
    {
        return Ok(llm_tmux_empty_probe_result(
            session_name,
            false,
            Some("tmux session was not found".to_string()),
        ));
    }

    let mut result = llm_tmux_empty_probe_result(session_name, true, None);
    result.probe_stdout_bytes = u32::try_from(output.len()).unwrap_or(u32::MAX);
    result.probe_stdout_lines = u32::try_from(text.lines().count()).unwrap_or(u32::MAX);
    for line in text.lines() {
        let line = line.trim_end();
        if let Some(meta) = line.strip_prefix("__SVI_TMUX_META__\t") {
            result.meta_seen = true;
            let mut parts = meta.split('\t');
            result.pane_in_mode = parts.next().unwrap_or("0").trim() == "1";
            result.pane_dead = parts.next().unwrap_or("0").trim() == "1";
            result.current_command = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            result.pane_pid = parts.next().and_then(|value| value.trim().parse().ok());
            result.alternate_on = parts.next().unwrap_or("0").trim() == "1";
            result.history_size = parts.next().and_then(|value| value.trim().parse().ok());
            result.session_activity = parts.next().and_then(|value| value.trim().parse().ok());
            result.pane_active = parts.next().unwrap_or("0").trim() == "1";
        } else if let Some(value) = line.strip_prefix("__SVI_TMUX_TITLE__\t") {
            result.title_seen = true;
            let (checksum, bytes, parse_state) = parse_cksum_line(value);
            result.title_checksum = checksum;
            result.title_bytes = bytes;
            result.title_parse = Some(parse_state);
        } else if let Some(value) = line.strip_prefix("__SVI_TMUX_WINDOW__\t") {
            result.window_seen = true;
            let (checksum, bytes, parse_state) = parse_cksum_line(value);
            result.window_checksum = checksum;
            result.window_bytes = bytes;
            result.window_parse = Some(parse_state);
        } else if let Some(value) = line.strip_prefix("__SVI_TMUX_CAPTURE__\t") {
            result.capture_seen = true;
            let (checksum, bytes, parse_state) = parse_cksum_line(value);
            result.capture_checksum = checksum;
            result.capture_bytes = bytes;
            result.capture_parse = Some(parse_state);
        }
    }
    Ok(result)
}

fn llm_tmux_session_base_name(workspace_id: &str, agent_id: &str) -> String {
    let workspace_part = sanitize_llm_tmux_part(workspace_id, "workspace", 14);
    let agent_part = sanitize_llm_tmux_part(agent_id, "agent", LLM_TMUX_SESSION_MAX_LEN);
    trim_llm_tmux_session_name(&format!("svi_{workspace_part}_{agent_part}"))
}

fn sanitize_llm_tmux_part(value: &str, fallback: &str, max_len: usize) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            ch
        } else {
            '_'
        };
        out.push(next);
        if out.len() >= max_len {
            break;
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn trim_llm_tmux_session_name(value: &str) -> String {
    value.chars().take(LLM_TMUX_SESSION_MAX_LEN).collect()
}

fn numbered_llm_tmux_session_name(base: &str, index: u32) -> String {
    let suffix = format!("_{index}");
    let base_len = LLM_TMUX_SESSION_MAX_LEN.saturating_sub(suffix.len());
    let mut name: String = base.chars().take(base_len).collect();
    name.push_str(&suffix);
    name
}

fn is_safe_llm_tmux_session_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= LLM_TMUX_SESSION_MAX_LEN
        && name.starts_with("svi_")
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn is_llm_tmux_session_for_base(name: &str, base: &str) -> bool {
    if name == base {
        return true;
    }
    llm_tmux_session_index(name, base).is_some()
}

fn llm_tmux_session_index(name: &str, base: &str) -> Option<u32> {
    let suffix = name.strip_prefix(base)?.strip_prefix('_')?;
    if suffix.is_empty() || !suffix.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    suffix.parse().ok()
}

fn llm_tmux_session_sort_key(name: &str, base: &str) -> u32 {
    if name == base {
        0
    } else {
        llm_tmux_session_index(name, base).unwrap_or(u32::MAX)
    }
}

#[tauri::command]
fn read_snippets_store(app: AppHandle) -> Result<String, String> {
    let path = snippets_store_path(&app)?;
    if !path.exists() {
        return Ok(DEFAULT_SNIPPETS_STORE.to_string());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() as usize > SNIPPETS_STORE_MAX_BYTES {
        return Err("Snippets store is too large".to_string());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_snippets_store(app: AppHandle, payload: String) -> Result<(), String> {
    if payload.len() > SNIPPETS_STORE_MAX_BYTES {
        return Err("Snippets store is too large".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&payload).map_err(|error| error.to_string())?;
    let path = snippets_store_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn snippets_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(SNIPPETS_STORE_FILE))
}

fn main_webview_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window("main").or_else(|| {
        app.webview_windows()
            .into_iter()
            .find(|(label, _)| !is_auxiliary_webview_label(label))
            .map(|(_, window)| window)
    })
}

fn main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Window<R>> {
    app.get_window("main").or_else(|| {
        app.windows()
            .into_iter()
            .find(|(label, _)| !is_auxiliary_webview_label(label))
            .map(|(_, window)| window)
    })
}

fn is_auxiliary_webview_label(label: &str) -> bool {
    label == "capture-cover" || is_browser_webview_label(label)
}

#[tauri::command]
fn set_capture_protection(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        close_capture_cover(&app);
        if let Err(error) = set_app_capture_protection(&app, true) {
            CAPTURE_PROTECTION_ACTIVE.store(false, Ordering::Relaxed);
            return Err(format!("failed to enable capture protection: {error}"));
        }
        CAPTURE_PROTECTION_ACTIVE.store(true, Ordering::Relaxed);
    } else {
        CAPTURE_PROTECTION_ACTIVE.store(false, Ordering::Relaxed);
        if let Err(error) = set_app_capture_protection(&app, false) {
            close_capture_cover(&app);
            return Err(format!("failed to disable capture protection: {error}"));
        }
        close_capture_cover(&app);
    }
    Ok(())
}

fn set_app_capture_protection<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Some(hwnd) = cached_main_hwnd() {
            match set_hwnd_capture_protection(hwnd, enabled) {
                Ok(()) => return Ok(()),
                Err(cached_error) => {
                    forget_main_hwnd();
                    let window = main_webview_window(app).ok_or_else(|| {
                        let labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
                        format!(
                            "cached main window handle failed: {cached_error}; main window handle is not available; open webview windows: {labels:?}"
                        )
                    })?;
                    return set_window_capture_protection(&window, enabled).map_err(|error| {
                        format!(
                            "cached main window handle failed: {cached_error}; refreshed main window handle also failed: {error}"
                        )
                    });
                }
            }
        }
        let window = main_webview_window(app).ok_or_else(|| {
            let labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
            format!("main window handle is not available; open webview windows: {labels:?}")
        })?;
        set_window_capture_protection(&window, enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        if enabled {
            Err("capture protection is only available on Windows".to_string())
        } else {
            Ok(())
        }
    }
}

fn refresh_active_capture_protection<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if !CAPTURE_PROTECTION_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let _ = set_app_capture_protection(app, true);
}

// Do not create a separate top-level protection window. OBS Window Capture can
// bind to that decoy and keep showing its startup white frame even when
// protection is off. This cleanup hook only closes stale cover windows from
// older builds/processes.
fn close_capture_cover<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(cover) = app.get_webview_window("capture-cover") {
        let _ = cover.close();
    }
}

// Set true only while capture protection is enabled. The window move/resize/focus
// handlers check this first so unprotected workspaces pay just one atomic load
// per event instead of a window-registry lookup.
static CAPTURE_PROTECTION_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static MAIN_WINDOW_HWND: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static AGENT_ALERT_TRAY_ICON_ID: AtomicU32 = AtomicU32::new(0x5349_0000);
static APP_EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn set_window_capture_protection<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    let hwnd = main_capture_hwnd(window)?;
    set_hwnd_capture_protection(hwnd, enabled)
}

#[cfg(windows)]
fn set_hwnd_capture_protection(hwnd: HWND, enabled: bool) -> Result<(), String> {
    // WDA_EXCLUDEFROMCAPTURE (not WDA_MONITOR): it is the framework-aligned value
    // used by Tao/Tauri, but we call the native API directly instead of
    // WebviewWindow::set_content_protected. In the active workspace toggle path
    // the Tauri wrapper can leave the IPC promise unresolved; a direct user32
    // call keeps this command synchronous and observable.
    let affinity = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    let root_hwnd = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root_hwnd = if root_hwnd.0.is_null() {
        hwnd
    } else {
        root_hwnd
    };

    let applied_affinity = set_display_affinity_strict(root_hwnd, affinity, enabled)?;

    let root_affinity = query_display_affinity(root_hwnd)
        .map(|value| affinity_label(value).to_string())
        .unwrap_or_else(|error| format!("query failed: {error}"));
    let mut child_successes = 0usize;
    let mut child_failures = 0usize;
    let mut child_warnings = Vec::new();

    for child in descendant_hwnds(root_hwnd) {
        match unsafe { SetWindowDisplayAffinity(child, applied_affinity) } {
            Ok(()) => {
                child_successes += 1;
                match query_display_affinity(child) {
                    Ok(value) if !affinity_is_expected(enabled, value) => {
                        child_warnings.push(format!(
                            "{} reported {} after setting {}",
                            hwnd_description(child),
                            affinity_label(value),
                            affinity_label(applied_affinity.0)
                        ));
                    }
                    Err(error) => {
                        child_warnings.push(format!(
                            "{} affinity query failed after setting {}: {error}",
                            hwnd_description(child),
                            affinity_label(applied_affinity.0)
                        ));
                    }
                    _ => {}
                }
            }
            Err(error) => {
                child_failures += 1;
                if is_likely_capture_child(child) {
                    child_warnings.push(format!(
                        "{} failed to set {}: {error}",
                        hwnd_description(child),
                        affinity_label(applied_affinity.0)
                    ));
                }
            }
        }
    }

    eprintln!(
        "capture protection {}: root={} observed={} child_set={} child_failed={}",
        if enabled { "enabled" } else { "disabled" },
        hwnd_description(root_hwnd),
        root_affinity,
        child_successes,
        child_failures
    );
    for warning in child_warnings.into_iter().take(8) {
        eprintln!("capture protection warning: {warning}");
    }

    Ok(())
}

#[cfg(windows)]
fn main_capture_hwnd<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<HWND, String> {
    if let Some(hwnd) = cached_main_hwnd() {
        return Ok(hwnd);
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    remember_main_hwnd(hwnd);
    Ok(hwnd)
}

#[cfg(windows)]
fn remember_main_hwnd(hwnd: HWND) {
    if !hwnd.0.is_null() {
        MAIN_WINDOW_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
    }
}

#[cfg(windows)]
fn forget_main_hwnd() {
    MAIN_WINDOW_HWND.store(0, Ordering::Relaxed);
}

#[cfg(windows)]
fn cached_main_hwnd() -> Option<HWND> {
    let raw = MAIN_WINDOW_HWND.load(Ordering::Relaxed);
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut core::ffi::c_void))
    }
}

#[cfg(windows)]
fn set_display_affinity_strict(
    hwnd: HWND,
    affinity: WINDOW_DISPLAY_AFFINITY,
    enabled: bool,
) -> Result<WINDOW_DISPLAY_AFFINITY, String> {
    let mut applied_affinity = affinity;
    if let Err(error) = unsafe { SetWindowDisplayAffinity(hwnd, affinity) } {
        if enabled && affinity.0 == WDA_EXCLUDEFROMCAPTURE.0 {
            let first_error = format_display_affinity_error(hwnd, error, true);
            unsafe { SetWindowDisplayAffinity(hwnd, WDA_MONITOR) }.map_err(|fallback_error| {
                format!(
                    "{first_error}; WDA_MONITOR fallback also failed: {}",
                    format_display_affinity_error(hwnd, fallback_error, true)
                )
            })?;
            applied_affinity = WDA_MONITOR;
            eprintln!(
                "capture protection fallback: {} rejected WDA_EXCLUDEFROMCAPTURE; using WDA_MONITOR",
                hwnd_description(hwnd)
            );
        } else {
            return Err(format_display_affinity_error(hwnd, error, enabled));
        }
    }

    match query_display_affinity(hwnd) {
        Ok(value) if !affinity_is_expected(enabled, value) => Err(format!(
            "{} reported {} after setting {}",
            hwnd_description(hwnd),
            affinity_label(value),
            affinity_label(applied_affinity.0)
        )),
        _ => Ok(applied_affinity),
    }
}

#[cfg(windows)]
fn format_display_affinity_error(hwnd: HWND, error: windows::core::Error, enabled: bool) -> String {
    if enabled {
        format!(
            "{} on {} (WDA_EXCLUDEFROMCAPTURE requires DWM and Windows 10 version 2004 / build 19041 or newer)",
            error,
            hwnd_description(hwnd)
        )
    } else {
        format!("{} on {}", error, hwnd_description(hwnd))
    }
}

#[cfg(windows)]
fn descendant_hwnds(root_hwnd: HWND) -> Vec<HWND> {
    let mut children = Vec::new();
    unsafe extern "system" fn collect_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let children = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        children.push(hwnd);
        true.into()
    }

    let lparam = LPARAM(&mut children as *mut Vec<HWND> as isize);
    let _ = unsafe { EnumChildWindows(Some(root_hwnd), Some(collect_child), lparam) };
    children
}

#[cfg(windows)]
fn query_display_affinity(hwnd: HWND) -> Result<u32, String> {
    let mut value = 0u32;
    unsafe { GetWindowDisplayAffinity(hwnd, &mut value) }.map_err(|error| error.to_string())?;
    Ok(value)
}

#[cfg(windows)]
fn affinity_is_expected(enabled: bool, value: u32) -> bool {
    if enabled {
        value == WDA_EXCLUDEFROMCAPTURE.0 || value == WDA_MONITOR.0
    } else {
        value == WDA_NONE.0
    }
}

#[cfg(windows)]
fn affinity_label(value: u32) -> &'static str {
    match value {
        value if value == WDA_NONE.0 => "WDA_NONE",
        value if value == WDA_MONITOR.0 => "WDA_MONITOR",
        value if value == WDA_EXCLUDEFROMCAPTURE.0 => "WDA_EXCLUDEFROMCAPTURE",
        _ => "UNKNOWN",
    }
}

#[cfg(windows)]
fn hwnd_description(hwnd: HWND) -> String {
    match window_class_name(hwnd) {
        Some(class_name) => format!("{} class={class_name}", hwnd_hex(hwnd)),
        None => hwnd_hex(hwnd),
    }
}

#[cfg(windows)]
fn hwnd_hex(hwnd: HWND) -> String {
    format!("0x{:X}", hwnd.0 as usize)
}

#[cfg(windows)]
fn window_class_name(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

#[cfg(windows)]
fn is_likely_capture_child(hwnd: HWND) -> bool {
    window_class_name(hwnd)
        .map(|class_name| {
            class_name.contains("Chrome")
                || class_name.contains("WebView")
                || class_name.contains("Widget")
        })
        .unwrap_or(false)
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

async fn run_blocking_command<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{label} worker failed: {error}"))?
}

#[tauri::command]
async fn resolve_profile_path(profile_id: String, path: String) -> Result<String, String> {
    run_blocking_command("resolve profile path", move || {
        resolve_profile_path_blocking(profile_id, path)
    })
    .await
}

fn resolve_profile_path_blocking(profile_id: String, path: String) -> Result<String, String> {
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
async fn list_directory(
    profile_id: String,
    path: String,
    include_sizes: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    run_blocking_command("list directory", move || {
        list_directory_blocking(profile_id, path, include_sizes)
    })
    .await
}

fn list_directory_blocking(
    profile_id: String,
    path: String,
    include_sizes: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    let include_sizes = include_sizes.unwrap_or(true);
    match profile.kind.as_str() {
        "windows" => list_local_directory(Path::new(&path), include_sizes),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                list_wsl_directory(&windows_path, &path, include_sizes)
            } else {
                list_remote_directory(&profile, &path, include_sizes)
            }
        }
        "ssh" => list_remote_directory(&profile, &path, include_sizes),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
async fn list_directories(
    profile_id: String,
    paths: Vec<String>,
    include_sizes: Option<bool>,
) -> Result<Vec<DirectoryListingResult>, String> {
    run_blocking_command("list directories", move || {
        list_directories_blocking(profile_id, paths, include_sizes)
    })
    .await
}

fn list_directories_blocking(
    profile_id: String,
    paths: Vec<String>,
    include_sizes: Option<bool>,
) -> Result<Vec<DirectoryListingResult>, String> {
    let profile = profile_from_id(&profile_id);
    let include_sizes = include_sizes.unwrap_or(true);
    let paths: Vec<String> = paths
        .into_iter()
        .map(|path| normalize_profile_path(&profile, &path))
        .filter(|path| !path.trim().is_empty())
        .collect();

    match profile.kind.as_str() {
        "windows" => Ok(list_local_directories(paths, include_sizes)),
        "wsl" => list_wsl_directories(&profile, &paths, include_sizes),
        "ssh" => list_remote_directories(&profile, &paths, include_sizes),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
async fn directory_signatures(
    profile_id: String,
    paths: Vec<String>,
    include_sizes: Option<bool>,
) -> Result<Vec<DirectorySignatureResult>, String> {
    run_blocking_command("directory signatures", move || {
        directory_signatures_blocking(profile_id, paths, include_sizes)
    })
    .await
}

fn directory_signatures_blocking(
    profile_id: String,
    paths: Vec<String>,
    include_sizes: Option<bool>,
) -> Result<Vec<DirectorySignatureResult>, String> {
    let profile = profile_from_id(&profile_id);
    let include_sizes = include_sizes.unwrap_or(true);
    let paths: Vec<String> = paths
        .into_iter()
        .map(|path| normalize_profile_path(&profile, &path))
        .filter(|path| !path.trim().is_empty())
        .collect();

    match profile.kind.as_str() {
        "windows" => Ok(list_local_directory_signatures(paths, include_sizes)),
        "wsl" => list_wsl_directory_signatures(&profile, &paths, include_sizes),
        "ssh" => Ok(directory_signatures_from_listings(list_remote_directories(
            &profile,
            &paths,
            include_sizes,
        )?)),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

#[tauri::command]
async fn read_text_file(profile_id: String, path: String) -> Result<String, String> {
    run_blocking_command("read text file", move || {
        read_text_file_blocking(profile_id, path)
    })
    .await
}

fn read_text_file_blocking(profile_id: String, path: String) -> Result<String, String> {
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

/// Cheap freshness probe (mtime:size) used to validate the frontend text-file cache so
/// externally modified files (terminal/LLM edits, vim, other processes) are never served
/// as stale editor content. Much lighter than re-reading the whole file on every open.
#[tauri::command]
async fn file_signature(profile_id: String, path: String) -> Result<String, String> {
    run_blocking_command("file signature", move || {
        file_signature_blocking(profile_id, path)
    })
    .await
}

fn file_signature_blocking(profile_id: String, path: String) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    match profile.kind.as_str() {
        "windows" => local_file_signature(Path::new(&path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                local_file_signature(&windows_path)
            } else {
                remote_file_signature(&profile, &path)
            }
        }
        "ssh" => remote_file_signature(&profile, &path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

fn local_file_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let size = metadata.len();
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis())
        .unwrap_or(0);
    Ok(format!("{mtime}:{size}"))
}

fn remote_file_signature(profile: &ConnectionProfile, path: &str) -> Result<String, String> {
    // GNU stat (Linux/WSL) first, then BSD stat (macOS) as a fallback. Both emit mtime:size.
    let script = format!(
        "stat -c '%Y:%s' -- {0} 2>/dev/null || stat -f '%m:%z' -- {0}",
        shell_quote(path)
    );
    let bytes =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
    let signature = String::from_utf8_lossy(&bytes).trim().to_string();
    if signature.is_empty() {
        return Err("could not stat remote file".to_string());
    }
    Ok(signature)
}

#[tauri::command]
async fn read_file_data_url(profile_id: String, path: String) -> Result<String, String> {
    run_blocking_command("read file data url", move || {
        read_file_data_url_blocking(profile_id, path)
    })
    .await
}

fn read_file_data_url_blocking(profile_id: String, path: String) -> Result<String, String> {
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
async fn write_text_file(profile_id: String, path: String, content: String) -> Result<(), String> {
    run_blocking_command("write text file", move || {
        write_text_file_blocking(profile_id, path, content)
    })
    .await
}

fn write_text_file_blocking(
    profile_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
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
async fn create_directory(profile_id: String, path: String) -> Result<(), String> {
    run_blocking_command("create directory", move || {
        create_directory_blocking(profile_id, path)
    })
    .await
}

fn create_directory_blocking(profile_id: String, path: String) -> Result<(), String> {
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
async fn create_file(profile_id: String, path: String) -> Result<(), String> {
    run_blocking_command("create file", move || {
        create_file_blocking(profile_id, path)
    })
    .await
}

fn create_file_blocking(profile_id: String, path: String) -> Result<(), String> {
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
async fn rename_path(profile_id: String, old_path: String, new_path: String) -> Result<(), String> {
    run_blocking_command("rename path", move || {
        rename_path_blocking(profile_id, old_path, new_path)
    })
    .await
}

fn rename_path_blocking(
    profile_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
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
async fn delete_paths(
    profile_id: String,
    paths: Vec<String>,
) -> Result<Vec<DeletedPathItem>, String> {
    run_blocking_command("delete paths", move || {
        delete_paths_blocking(profile_id, paths)
    })
    .await
}

fn delete_paths_blocking(
    profile_id: String,
    paths: Vec<String>,
) -> Result<Vec<DeletedPathItem>, String> {
    let profile = profile_from_id(&profile_id);
    let mut deleted = Vec::new();
    let delete_id = Uuid::new_v4().to_string();
    for (index, raw_path) in paths.iter().enumerate() {
        let path = normalize_profile_path(&profile, raw_path);
        match move_path_to_delete_trash(&profile, &path, &delete_id, index) {
            Ok(item) => deleted.push(item),
            Err(error) => {
                for item in deleted.iter().rev() {
                    let _ = restore_deleted_path(&profile, &item.trash_path, &item.original_path);
                }
                return Err(error);
            }
        }
    }
    Ok(deleted)
}

#[tauri::command]
async fn restore_deleted_paths(
    profile_id: String,
    items: Vec<DeletedPathItem>,
) -> Result<(), String> {
    run_blocking_command("restore deleted paths", move || {
        restore_deleted_paths_blocking(profile_id, items)
    })
    .await
}

fn restore_deleted_paths_blocking(
    profile_id: String,
    items: Vec<DeletedPathItem>,
) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    for item in items {
        let original_path = normalize_profile_path(&profile, &item.original_path);
        let trash_path = normalize_profile_path(&profile, &item.trash_path);
        restore_deleted_path(&profile, &trash_path, &original_path)?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_note_file_permanently(profile_id: String, path: String) -> Result<(), String> {
    run_blocking_command("delete note file permanently", move || {
        delete_note_file_permanently_blocking(profile_id, path)
    })
    .await
}

fn delete_note_file_permanently_blocking(profile_id: String, path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    if !is_note_file_path(&path) {
        return Err("only files under .vibe-ide-temp/notes can be deleted permanently".to_string());
    }
    match profile.kind.as_str() {
        "windows" => delete_local_note_file_permanently(Path::new(&path)),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(&profile, &path) {
                delete_local_note_file_permanently(&windows_path)
            } else {
                delete_remote_note_file_permanently(&profile, &path)
            }
        }
        "ssh" => delete_remote_note_file_permanently(&profile, &path),
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
fn run_powershell_script_as_admin(profile_id: String, path: String) -> Result<(), String> {
    let profile = profile_from_id(&profile_id);
    let path = normalize_profile_path(&profile, &path);
    let target = match profile.kind.as_str() {
        "windows" => PathBuf::from(&path),
        "wsl" => wsl_posix_path_to_windows_path(&profile, &path)
            .ok_or_else(|| "cannot translate WSL path to a Windows path".to_string())?,
        "ssh" => {
            return Err(
                "running remote SSH PowerShell scripts as Windows admin is not supported"
                    .to_string(),
            )
        }
        _ => return Err(format!("unsupported profile kind: {}", profile.kind)),
    };

    if !target.exists() {
        return Err(format!("path does not exist: {}", target.to_string_lossy()));
    }
    if target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("ps1"))
        .unwrap_or(true)
    {
        return Err("admin PowerShell launch only supports .ps1 files".to_string());
    }

    let target_text = target.to_string_lossy().to_string();
    let working_dir = target
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| windows_spawn_cwd().to_string_lossy().to_string());
    let elevated_script = format!("& {}", powershell_single_quote(&target_text));
    let encoded_script = powershell_encoded_command(&elevated_script);
    let launcher_script = format!(
        "$dir = {}; Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{}') -WorkingDirectory $dir -Verb RunAs",
        powershell_single_quote(&working_dir),
        encoded_script
    );

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(launcher_script)
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
async fn save_clipboard_image_file(
    profile_id: String,
    target_dir: String,
    file_name: String,
    base64_data: String,
) -> Result<String, String> {
    run_blocking_command("save clipboard image", move || {
        save_clipboard_image_file_blocking(profile_id, target_dir, file_name, base64_data)
    })
    .await
}

fn save_clipboard_image_file_blocking(
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
async fn copy_dropped_files(
    profile_id: String,
    target_dir: String,
    source_paths: Vec<String>,
) -> Result<usize, String> {
    run_blocking_command("copy dropped files", move || {
        copy_dropped_files_blocking(profile_id, target_dir, source_paths)
    })
    .await
}

fn copy_dropped_files_blocking(
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
async fn copy_profile_paths(
    profile_id: String,
    source_paths: Vec<String>,
    target_dir: String,
) -> Result<Vec<String>, String> {
    run_blocking_command("copy profile paths", move || {
        copy_profile_paths_blocking(profile_id, source_paths, target_dir)
    })
    .await
}

fn copy_profile_paths_blocking(
    profile_id: String,
    source_paths: Vec<String>,
    target_dir: String,
) -> Result<Vec<String>, String> {
    if source_paths.is_empty() {
        return Ok(Vec::new());
    }

    let profile = profile_from_id(&profile_id);
    let target_dir = normalize_profile_path(&profile, &target_dir);
    let source_paths: Vec<String> = source_paths
        .iter()
        .map(|path| normalize_profile_path(&profile, path))
        .collect();

    match profile.kind.as_str() {
        "windows" => {
            let local_sources: Vec<PathBuf> = source_paths
                .iter()
                .map(|path| PathBuf::from(path.as_str()))
                .collect();
            copy_profile_paths_to_local(Path::new(&target_dir), &local_sources).map(|paths| {
                paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect()
            })
        }
        "wsl" => {
            let target_windows = wsl_posix_path_to_windows_path(&profile, &target_dir);
            let source_windows: Vec<PathBuf> = source_paths
                .iter()
                .filter_map(|path| wsl_posix_path_to_windows_path(&profile, path))
                .collect();
            if let Some(windows_dir) = target_windows {
                if source_windows.len() == source_paths.len() {
                    let created = copy_profile_paths_to_local(&windows_dir, &source_windows)?;
                    return created
                        .into_iter()
                        .map(|path| {
                            local_file_name(&path).map(|name| join_posix(&target_dir, &name))
                        })
                        .collect();
                }
            }
            copy_profile_paths_to_remote(&profile, &target_dir, &source_paths)
        }
        "ssh" => copy_profile_paths_to_remote(&profile, &target_dir, &source_paths),
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
async fn save_attachment(
    profile_id: String,
    current_dir: String,
    session_id: String,
    file_name: String,
    base64_data: String,
) -> Result<AttachmentResult, String> {
    run_blocking_command("save attachment", move || {
        save_attachment_blocking(profile_id, current_dir, session_id, file_name, base64_data)
    })
    .await
}

fn save_attachment_blocking(
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

fn spawn_terminal_direct(
    app: tauri::AppHandle,
    state: &IdeState,
    profile_id: String,
    cwd: String,
    command: Option<String>,
    rows: u16,
    cols: u16,
    _workspace_id: Option<String>,
    _title: Option<String>,
) -> Result<String, String> {
    let profile = profile_from_id(&profile_id);
    let cwd = normalize_profile_path(&profile, &cwd);
    warm_wsl_profile(&profile)?;
    let (program, args) = terminal_command(&profile, &cwd, command.clone());
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
    if profile.kind == "ssh" {
        apply_session_ssh_auth_to_pty(&mut cmd, &profile);
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
    if let Some(pid) = child.process_id() {
        assign_child_to_cleanup_job(pid);
    }
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| err.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|err| err.to_string())?;
    let (input_tx, input_rx) = sync_channel::<Vec<u8>>(TERMINAL_INPUT_QUEUE_CAPACITY);
    thread::Builder::new()
        .name("simple-vibe-terminal-input".to_string())
        .spawn(move || {
            for data in input_rx {
                if writer.write_all(&data).is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        })
        .map_err(|err| format!("failed to start terminal input writer: {err}"))?;
    let terminal_id = Uuid::new_v4().to_string();

    let read_id = terminal_id.clone();
    let read_batcher = AppOutputBatcher::new(read_id.clone(), app.clone());
    thread::spawn(move || {
        let mut buf = [0_u8; 8192];
        let mut leftover: Vec<u8> = Vec::with_capacity(8);
        let mut dsr_leftover = String::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    leftover.extend_from_slice(&buf[..n]);
                    let mut data = drain_complete_utf8(&mut leftover);
                    if !dsr_leftover.is_empty() {
                        data.insert_str(0, &dsr_leftover);
                        dsr_leftover.clear();
                    }
                    let trailing_dsr_prefix_len = trailing_terminal_dsr_prefix_len(&data);
                    if trailing_dsr_prefix_len > 0 {
                        let keep_at = data.len() - trailing_dsr_prefix_len;
                        dsr_leftover = data[keep_at..].to_string();
                        data.truncate(keep_at);
                    }
                    if data.is_empty() {
                        continue;
                    }
                    push_terminal_output_without_dsr_queries(&read_batcher, &app, &read_id, &data);
                }
                Err(_) => break,
            }
        }
        if !dsr_leftover.is_empty() {
            read_batcher.push(&dsr_leftover);
        }
        if !leftover.is_empty() {
            let trailing = String::from_utf8_lossy(&leftover).to_string();
            if !trailing.is_empty() {
                push_terminal_output_without_dsr_queries(&read_batcher, &app, &read_id, &trailing);
            }
        }
        read_batcher.flush();
        let _ = app.emit(
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
                input_tx,
                child,
                master: pair.master,
                rows,
                cols,
            },
        );

    Ok(terminal_id)
}

fn write_terminal_host(state: &IdeState, id: String, data: String) -> Result<(), String> {
    let input_tx = terminal_input_sender(state, &id)?;
    write_terminal_bytes(&input_tx, data.as_bytes())
}

fn terminal_input_sender(state: &IdeState, id: &str) -> Result<SyncSender<Vec<u8>>, String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?;
    terminals
        .get(id)
        .map(|session| session.input_tx.clone())
        .ok_or_else(|| format!("terminal not found: {id}"))
}

fn write_terminal_bytes(input_tx: &SyncSender<Vec<u8>>, data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Ok(());
    }
    match input_tx.try_send(data.to_vec()) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => Err("terminal input queue is full; try again".to_string()),
        Err(TrySendError::Disconnected(_)) => Err("terminal input writer is closed".to_string()),
    }
}

fn push_terminal_output_without_dsr_queries(
    batcher: &Arc<AppOutputBatcher>,
    app: &AppHandle,
    terminal_id: &str,
    data: &str,
) {
    let mut rest = data;
    while let Some(index) = rest.find(TERMINAL_DSR_CURSOR_QUERY) {
        let before = &rest[..index];
        if !before.is_empty() {
            batcher.push(before);
            batcher.flush();
        }
        let _ = app.emit(
            "terminal-cursor-query",
            TerminalCursorQueryEvent {
                id: terminal_id.to_string(),
            },
        );
        rest = &rest[index + TERMINAL_DSR_CURSOR_QUERY.len()..];
    }
    if !rest.is_empty() {
        batcher.push(rest);
    }
}

fn trailing_terminal_dsr_prefix_len(data: &str) -> usize {
    let data = data.as_bytes();
    let query = TERMINAL_DSR_CURSOR_QUERY.as_bytes();
    let max = data.len().min(query.len().saturating_sub(1));
    for len in (1..=max).rev() {
        if data[data.len() - len..] == query[..len] {
            return len;
        }
    }
    0
}

fn resize_terminal_host(state: &IdeState, id: String, rows: u16, cols: u16) -> Result<(), String> {
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
        .map_err(|err| err.to_string())?;
    session.rows = rows;
    session.cols = cols;
    Ok(())
}

fn kill_terminal_host(state: &IdeState, id: String) -> Result<(), String> {
    let session = state
        .terminals
        .lock()
        .map_err(|_| "terminal state poisoned".to_string())?
        .remove(&id);
    if let Some(session) = session {
        terminate_terminal_session_background(session);
    }
    Ok(())
}

fn terminate_terminal_session_background(session: TerminalSession) {
    let _ = thread::Builder::new()
        .name("simple-vibe-terminal-kill".to_string())
        .spawn(move || terminate_terminal_session(session));
}

fn terminate_terminal_session(mut session: TerminalSession) {
    if let Some(pid) = session.child.process_id() {
        kill_process_tree(pid);
    }
    let _ = session.child.kill();
    let _ = session.child.wait();
}

fn drain_runtime_sessions(state: &IdeState) -> RuntimeShutdownBatch {
    let terminals = state
        .terminals
        .lock()
        .map(|mut sessions| sessions.drain().map(|(_, session)| session).collect())
        .unwrap_or_default();
    let forwards = state
        .forwards
        .lock()
        .map(|mut sessions| sessions.drain().map(|(_, session)| session).collect())
        .unwrap_or_default();
    let edge_sessions = state
        .edge_sessions
        .lock()
        .map(|mut sessions| sessions.drain().map(|(_, session)| session).collect())
        .unwrap_or_default();
    RuntimeShutdownBatch {
        terminals,
        forwards,
        edge_sessions,
    }
}

fn terminate_runtime_sessions(batch: RuntimeShutdownBatch) {
    for session in batch.terminals {
        terminate_terminal_session(session);
    }

    for mut forward in batch.forwards {
        if let Some(stop) = forward.stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(mut child) = forward.child.take() {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    for mut session in batch.edge_sessions {
        if let Some(mut child) = session.child.take() {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn shutdown_runtime_sessions_background(state: &IdeState) {
    let batch = drain_runtime_sessions(state);
    if batch.is_empty() {
        return;
    }
    // Drain the session maps synchronously so future frontend/backend calls see
    // the runtime as closed, but run process-tree termination and waits off the
    // Tauri close path. On Windows the cleanup Job Object remains the hard
    // guarantee if the app process exits before this worker finishes.
    let _ = thread::Builder::new()
        .name("simple-vibe-runtime-shutdown".to_string())
        .spawn(move || terminate_runtime_sessions(batch));
}

fn shutdown_app_runtime(app: &AppHandle) {
    close_capture_cover(app);
    let _ = close_browser_webview(app.clone(), None);
    shutdown_runtime_sessions_background(app.state::<IdeState>().inner());
    shutdown_session_ssh_agent();
}

fn request_app_exit(app: AppHandle) {
    if APP_EXIT_REQUESTED.swap(true, Ordering::SeqCst) {
        return;
    }
    shutdown_app_runtime(&app);
    let _ = thread::Builder::new()
        .name("simple-vibe-app-exit".to_string())
        .spawn(move || {
            thread::sleep(Duration::from_millis(60));
            app.exit(0);
            thread::sleep(Duration::from_millis(900));
            std::process::exit(0);
        });
}

fn start_renderer_watchdog(app: AppHandle) {
    let _ = thread::Builder::new()
        .name("simple-vibe-renderer-watchdog".to_string())
        .spawn(move || {
            if !sleep_renderer_watchdog(RENDERER_HEARTBEAT_STARTUP_GRACE) {
                return;
            }
            if let Ok(mut health) = app.state::<IdeState>().renderer_health.lock() {
                health.last_heartbeat = Instant::now();
            }

            loop {
                if !sleep_renderer_watchdog(RENDERER_HEARTBEAT_CHECK_INTERVAL) {
                    return;
                }

                let Some(notice) = renderer_watchdog_recovery_notice(&app) else {
                    continue;
                };
                let _ = app.emit("renderer-recovery", notice);

                let reload_app = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if APP_EXIT_REQUESTED.load(Ordering::SeqCst) {
                        return;
                    }
                    // A renderer reload cannot reattach the current JS objects to
                    // in-process PTYs or child WebViews. Drain them deliberately
                    // so recovery does not leave orphaned shells/WebView2
                    // processes behind. Workspace snapshots recreate fresh
                    // shells after reload.
                    let _ = close_browser_webview(reload_app.clone(), None);
                    shutdown_runtime_sessions_background(reload_app.state::<IdeState>().inner());
                    if let Some(window) = main_webview_window(&reload_app) {
                        let _ = window.reload();
                    }
                });
            }
        });
}

fn sleep_renderer_watchdog(duration: Duration) -> bool {
    let started = Instant::now();
    loop {
        if APP_EXIT_REQUESTED.load(Ordering::SeqCst) {
            return false;
        }
        let elapsed = started.elapsed();
        if elapsed >= duration {
            return true;
        }
        let remaining = duration.saturating_sub(elapsed);
        thread::sleep(remaining.min(Duration::from_secs(1)));
    }
}

fn renderer_watchdog_recovery_notice(app: &AppHandle) -> Option<RendererRecoveryNotice> {
    let now = Instant::now();
    let state = app.state::<IdeState>();
    let Ok(mut health) = state.renderer_health.lock() else {
        return None;
    };
    if health.last_heartbeat.elapsed() < RENDERER_HEARTBEAT_TIMEOUT {
        return None;
    }
    if health
        .last_reload
        .map(|last| last.elapsed() < RENDERER_RECOVERY_RELOAD_COOLDOWN)
        .unwrap_or(false)
    {
        return None;
    }

    health.reload_attempts = health.reload_attempts.saturating_add(1);
    health.last_reload = Some(now);
    // Reset the timestamp before scheduling the reload so the watchdog does
    // not immediately trigger again while WebView2 is recreating the renderer.
    health.last_heartbeat = now;
    let attempts = health.reload_attempts;
    let message = if attempts > RENDERER_RECOVERY_WARN_ATTEMPTS {
        format!(
            "Renderer stopped responding repeatedly (attempt {attempts}); reloading the UI and restarting runtime sessions"
        )
    } else {
        format!("Renderer stopped responding; recovering the UI (attempt {attempts})")
    };
    let notice = RendererRecoveryNotice {
        kind: if attempts > RENDERER_RECOVERY_WARN_ATTEMPTS {
            "repeated-reload".to_string()
        } else {
            "reload".to_string()
        },
        attempts,
        message,
    };
    health.pending_notice = Some(notice.clone());
    Some(notice)
}

#[tauri::command]
fn force_quit_app(app: tauri::AppHandle) {
    request_app_exit(app);
}

fn start_port_forward_host(
    state: &IdeState,
    profile_id: String,
    remote_port: u16,
    local_port: u16,
) -> Result<PortForwardResult, String> {
    let profile = profile_from_id(&profile_id);
    let id = Uuid::new_v4().to_string();
    let requested_local = local_port;

    if profile.kind == "ssh" {
        let actual_local = if requested_local == 0 {
            allocate_local_port()?
        } else {
            requested_local
        };
        let alias = profile
            .ssh_alias
            .clone()
            .unwrap_or_else(|| "default".to_string());
        let mut command = Command::new(ssh_executable());
        push_ssh_background_options(&mut command);
        command
            .arg("-N")
            .arg("-L")
            .arg(format!("127.0.0.1:{actual_local}:127.0.0.1:{remote_port}"))
            .arg(alias)
            .current_dir(windows_spawn_cwd())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_session_ssh_auth_to_command(&mut command, &profile);
        let child = hide_command_window(&mut command)
            .spawn()
            .map_err(|err| format!("failed to start ssh forward: {err}"))?;
        assign_child_to_cleanup_job(child.id());
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
            local_port: actual_local,
            target_host: "127.0.0.1".to_string(),
            remote_port,
            url: format!("http://127.0.0.1:{actual_local}"),
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

fn start_preview_proxy_host(
    state: &IdeState,
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
async fn probe_local_http_url(target_url: String) -> Result<bool, String> {
    run_blocking_command("probe local http url", move || {
        probe_local_http_url_blocking(target_url)
    })
    .await
}

fn probe_local_http_url_blocking(target_url: String) -> Result<bool, String> {
    let target = parse_http_preview_target(&target_url)?;
    let addr = SocketAddr::from(([127, 0, 0, 1], target.port));
    Ok(TcpStream::connect_timeout(&addr, Duration::from_millis(450)).is_ok())
}

fn stop_port_forward_host(state: &IdeState, id: String) -> Result<(), String> {
    let mut forwards = state
        .forwards
        .lock()
        .map_err(|_| "forward state poisoned".to_string())?;
    if let Some(mut forward) = forwards.remove(&id) {
        if let Some(stop) = forward.stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(mut child) = forward.child.take() {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
async fn spawn_terminal(
    app: tauri::AppHandle,
    profile_id: String,
    cwd: String,
    command: Option<String>,
    rows: u16,
    cols: u16,
    workspace_id: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    run_blocking_command("spawn terminal", move || {
        let state = app.state::<IdeState>();
        spawn_terminal_direct(
            app.clone(),
            state.inner(),
            profile_id,
            cwd,
            command,
            rows,
            cols,
            workspace_id,
            title,
        )
    })
    .await
}

#[tauri::command]
fn write_terminal(state: State<'_, IdeState>, id: String, data: String) -> Result<(), String> {
    write_terminal_host(&state, id, data)
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, IdeState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    resize_terminal_host(&state, id, rows, cols)
}

#[tauri::command]
async fn kill_terminal(app: tauri::AppHandle, id: String) -> Result<(), String> {
    run_blocking_command("kill terminal", move || {
        let state = app.state::<IdeState>();
        kill_terminal_host(state.inner(), id)
    })
    .await
}

#[tauri::command]
async fn start_port_forward(
    app: tauri::AppHandle,
    profile_id: String,
    remote_port: u16,
    local_port: u16,
) -> Result<PortForwardResult, String> {
    run_blocking_command("start port forward", move || {
        let state = app.state::<IdeState>();
        start_port_forward_host(state.inner(), profile_id, remote_port, local_port)
    })
    .await
}

#[tauri::command]
async fn start_preview_proxy(
    app: tauri::AppHandle,
    target_url: String,
) -> Result<PortForwardResult, String> {
    run_blocking_command("start preview proxy", move || {
        let state = app.state::<IdeState>();
        start_preview_proxy_host(state.inner(), target_url)
    })
    .await
}

#[tauri::command]
async fn stop_port_forward(app: tauri::AppHandle, id: String) -> Result<(), String> {
    run_blocking_command("stop port forward", move || {
        let state = app.state::<IdeState>();
        stop_port_forward_host(state.inner(), id)
    })
    .await
}

#[tauri::command]
fn shutdown_runtime_sessions_command(state: State<'_, IdeState>) -> Result<(), String> {
    shutdown_runtime_sessions_background(&state);
    Ok(())
}

fn normalize_browser_webview_label(label: Option<String>) -> Result<String, String> {
    let label = label.unwrap_or_else(|| BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX.to_string());
    let has_valid_prefix = label == BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX
        || label
            .strip_prefix(BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX)
            .is_some_and(|suffix| suffix.starts_with('-') && suffix.len() > 1);
    let has_valid_chars = label
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_');
    if has_valid_prefix && has_valid_chars && label.len() <= 220 {
        Ok(label)
    } else {
        Err("invalid browser preview label".to_string())
    }
}

fn is_browser_webview_label(label: &str) -> bool {
    label == BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX
        || label
            .strip_prefix(BROWSER_NATIVE_WEBVIEW_LABEL_PREFIX)
            .is_some_and(|suffix| suffix.starts_with('-') && suffix.len() > 1)
}

#[tauri::command]
async fn show_browser_webview(
    app: AppHandle,
    label: Option<String>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    navigate: Option<bool>,
) -> Result<(), String> {
    let label = normalize_browser_webview_label(label)?;
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|err| format!("invalid browser preview URL: {err}"))?;
    let position = LogicalPosition::new(x.max(0.0), y.max(0.0));
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));

    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(position)
            .map_err(|error| error.to_string())?;
        webview.set_size(size).map_err(|error| error.to_string())?;
        let should_navigate = navigate.unwrap_or(true)
            && webview
                .url()
                .map(|current| current.as_str() != parsed_url.as_str())
                .unwrap_or(true);
        if should_navigate {
            webview
                .navigate(parsed_url)
                .map_err(|error| error.to_string())?;
        }
        webview.show().map_err(|error| error.to_string())?;
        refresh_active_capture_protection(&app);
        return Ok(());
    }

    let main = main_window(&app).ok_or_else(|| {
        let labels = app.windows().keys().cloned().collect::<Vec<_>>();
        format!("main window is not available; open windows: {labels:?}")
    })?;
    let app_for_load = app.clone();
    let label_for_load = label.clone();
    let webview_builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed_url))
        .on_page_load(move |_webview, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            let _ = app_for_load.emit(
                "browser-webview-page-load",
                BrowserWebviewPageLoadEvent {
                    label: label_for_load.clone(),
                    url: payload.url().to_string(),
                    event: event.to_string(),
                },
            );
            refresh_active_capture_protection(&app_for_load);
        });
    let webview = main
        .add_child(webview_builder, position, size)
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    refresh_active_capture_protection(&app);
    Ok(())
}

#[tauri::command]
fn hide_browser_webview(app: AppHandle, label: Option<String>) -> Result<(), String> {
    if let Some(label) = label {
        let label = normalize_browser_webview_label(Some(label))?;
        if let Some(webview) = app.get_webview(&label) {
            webview.hide().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    for (label, webview) in app.webviews() {
        if !is_browser_webview_label(&label) {
            continue;
        }
        webview.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_browser_webview(app: AppHandle, label: Option<String>) -> Result<(), String> {
    // Child WebViews keep running media after `hide()`. Use close() only at true
    // destroy boundaries (panel/workspace close), while workspace switching can
    // still hide and later re-show a preserved preview without reloading.
    if let Some(label) = label {
        let label = normalize_browser_webview_label(Some(label))?;
        if let Some(webview) = app.get_webview(&label) {
            webview.close().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    for (label, webview) in app.webviews() {
        if !is_browser_webview_label(&label) {
            continue;
        }
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reload_browser_webview(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let label = normalize_browser_webview_label(label)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.reload().map_err(|error| error.to_string())?;
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
        let mut remove_existing = false;
        if let Some(session) = sessions.get_mut(&id) {
            let endpoint_ready = edge_devtools_endpoint_ready(session.port);
            if let Some(child) = session.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) if status.success() && endpoint_ready => {
                        session.child = None;
                    }
                    Ok(Some(_)) | Err(_) => remove_existing = true,
                    Ok(None) => {}
                }
            }
            if !remove_existing && endpoint_ready {
                return Ok(edge_session_result(&id, session.port));
            }
            remove_existing = true;
        }
        if remove_existing {
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
        .arg("--remote-debugging-address=127.0.0.1")
        .arg("--remote-allow-origins=*")
        .arg(format!(
            "--user-data-dir={}",
            user_data_dir.to_string_lossy()
        ))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-background-networking")
        .arg("--disable-component-update")
        .arg("--disable-extensions")
        .arg("--disable-gpu")
        .arg("--disable-sync")
        .arg("--disable-features=Translate,MediaRouter,OptimizationHints")
        .arg("--headless")
        .arg("--window-size=1280,900")
        .arg("about:blank")
        .current_dir(windows_spawn_cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = hide_command_window(&mut command)
        .spawn()
        .map_err(|err| format!("failed to start Edge: {err}"))?;
    assign_child_to_cleanup_job(child.id());

    let launcher_alive = match wait_for_edge_devtools(&mut child, port) {
        Ok(alive) => alive,
        Err(err) => {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }
    };

    edge_sessions
        .lock()
        .map_err(|_| "edge session state poisoned".to_string())?
        .insert(
            id.clone(),
            EdgeDevtoolsSessionState {
                child: if launcher_alive { Some(child) } else { None },
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
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
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

fn edge_devtools_endpoint_ready(port: u16) -> bool {
    devtools_http_request_with_timeout(port, "GET", "/json/version", Duration::from_millis(700))
        .is_ok()
}

fn wait_for_edge_devtools(child: &mut ProcessChild, port: u16) -> Result<bool, String> {
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut last_error = String::new();
    let mut launcher_exited = false;
    while Instant::now() < deadline {
        if !launcher_exited {
            if let Some(status) = child
                .try_wait()
                .map_err(|err| format!("failed to query Edge process status: {err}"))?
            {
                if status.success() {
                    launcher_exited = true;
                } else {
                    let suffix = if last_error.is_empty() {
                        String::new()
                    } else {
                        format!("; last DevTools probe: {last_error}")
                    };
                    return Err(format!(
                        "Edge exited before DevTools became ready ({status}{suffix})"
                    ));
                }
            }
        }
        match devtools_http_request_with_timeout(
            port,
            "GET",
            "/json/version",
            Duration::from_millis(700),
        ) {
            Ok(_) => return Ok(!launcher_exited),
            Err(err) => last_error = err,
        }
        thread::sleep(Duration::from_millis(150));
    }
    let suffix = if last_error.is_empty() {
        String::new()
    } else {
        format!(" Last DevTools probe: {last_error}.")
    };
    Err(format!(
        "Edge DevTools endpoint did not become ready after 45.0s on 127.0.0.1:{port}.{suffix}"
    ))
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
    if let Some(cached) = cached_wsl_distros(false) {
        return cached;
    }
    let mut command = Command::new("wsl.exe");
    command.current_dir(windows_spawn_cwd()).arg("-l").arg("-q");
    let output = command_output_with_timeout(&mut command, WSL_DISTRO_LIST_TIMEOUT);
    let Ok(output) = output else {
        return cached_wsl_distros(true).unwrap_or_default();
    };
    if !output.status.success() {
        return cached_wsl_distros(true).unwrap_or_default();
    }
    let raw = String::from_utf8_lossy(&output.stdout).replace('\0', "");
    let distros: Vec<String> = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    store_wsl_distros(&distros);
    distros
}

fn cached_wsl_distros(allow_stale: bool) -> Option<Vec<String>> {
    let cache = WSL_DISTRO_LIST_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache.lock().ok()?;
    let (instant, distros) = guard.as_ref()?;
    if allow_stale || instant.elapsed() <= WSL_DISTRO_LIST_CACHE_TTL {
        return Some(distros.clone());
    }
    None
}

fn store_wsl_distros(distros: &[String]) {
    let cache = WSL_DISTRO_LIST_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((Instant::now(), distros.to_vec()));
    }
}

fn detect_wsl_home(distro: &str) -> Option<String> {
    if let Some(user) = detect_wsl_user(distro) {
        if user == "root" {
            return Some("/root".to_string());
        }
        if let Some(home) = detect_wsl_home_for_user(distro, &user) {
            return Some(home);
        }
        return Some(format!("/{}/{}", "home", user));
    }

    let mut direct = Command::new("wsl.exe");
    direct
        .current_dir(windows_spawn_cwd())
        .arg("-d")
        .arg(distro)
        .arg("--cd")
        .arg("~")
        .arg("--exec")
        .arg("pwd");
    if let Ok(output) = command_output_with_timeout(&mut direct, WSL_HOME_DETECT_TIMEOUT) {
        if let Some(home) = detect_wsl_home_from_output(output) {
            return Some(home);
        }
    }

    let mut command = Command::new("wsl.exe");
    command
        .current_dir(windows_spawn_cwd())
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-lc")
        .arg("printf %s \"$HOME\"");
    if let Ok(output) = command_output_with_timeout(&mut command, WSL_HOME_DETECT_TIMEOUT) {
        if let Some(home) = detect_wsl_home_from_output(output) {
            return Some(home);
        }
    }

    None
}

fn detect_wsl_home_from_output(output: std::process::Output) -> Option<String> {
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).replace('\0', "");
    for line in text.lines() {
        let home = line.trim();
        if home.starts_with('/') && home.len() > 1 {
            return Some(home.to_string());
        }
    }
    None
}

fn detect_wsl_user(distro: &str) -> Option<String> {
    let mut command = Command::new("wsl.exe");
    command
        .current_dir(windows_spawn_cwd())
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("id")
        .arg("-un");
    let output = command_output_with_timeout(&mut command, WSL_FAST_HOME_DETECT_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).replace('\0', "");
    let user = text.trim();
    (!user.is_empty()
        && !user.contains('/')
        && !user.contains('\\')
        && !user.contains(char::is_whitespace))
    .then(|| user.to_string())
}

fn detect_wsl_home_for_user(distro: &str, user: &str) -> Option<String> {
    let script = format!(
        "h=$(/usr/bin/getent passwd {} 2>/dev/null | /usr/bin/cut -d: -f6); [ -n \"$h\" ] && printf %s \"$h\"",
        shell_quote(user)
    );
    let mut command = Command::new("wsl.exe");
    command
        .current_dir(windows_spawn_cwd())
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-lc")
        .arg(script);
    let output = command_output_with_timeout(&mut command, WSL_FAST_HOME_DETECT_TIMEOUT).ok()?;
    detect_wsl_home_from_output(output)
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
            let mut args = vec![
                "-d".to_string(),
                distro,
                "--cd".to_string(),
                wsl_start_directory_arg(cwd, &profile.root),
                "--".to_string(),
            ];
            if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                args.extend([
                    "bash".to_string(),
                    "-lc".to_string(),
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
            let remote_script = if let Some(command) = command.filter(|s| !s.trim().is_empty()) {
                bash_bootstrap_script(Some(cwd), Some(&profile.root), Some(&command))
            } else {
                bash_bootstrap_script(Some(cwd), Some(&profile.root), None)
            };
            let remote_command = ssh_remote_bash_command(&remote_script);
            (
                "powershell.exe".to_string(),
                vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-EncodedCommand".to_string(),
                    powershell_encoded_command(&ssh_terminal_bootstrap_script(
                        &alias,
                        &remote_command,
                    )),
                ],
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

fn bash_bootstrap_script(
    cwd: Option<&str>,
    fallback_cwd: Option<&str>,
    command: Option<&str>,
) -> String {
    let mut script = String::new();
    script.push_str(&format!(
        "__svide_start_cwd={}\n\
	__svide_fallback_cwd={}\n\
	case \"$__svide_start_cwd\" in \"~/\"*) __svide_start_cwd=\"$HOME/${{__svide_start_cwd#~/}}\" ;; esac\n\
	case \"$__svide_fallback_cwd\" in \"~/\"*) __svide_fallback_cwd=\"$HOME/${{__svide_fallback_cwd#~/}}\" ;; esac\n\
	__svide_cd_failed() {{ printf '\\n[simple-vibe-ide] failed to cd: %s\\n' \"$1\" >&2; }}\n\
	if [ -n \"$__svide_start_cwd\" ] && [ \"$__svide_start_cwd\" != \"~\" ]; then\n\
	  if ! cd \"$__svide_start_cwd\" 2>/dev/null; then\n\
	    __svide_cd_failed \"$__svide_start_cwd\"\n\
	    if [ -n \"$__svide_fallback_cwd\" ] && [ \"$__svide_fallback_cwd\" != \"~\" ] && [ \"$__svide_fallback_cwd\" != \"$__svide_start_cwd\" ]; then\n\
	      cd \"$__svide_fallback_cwd\" 2>/dev/null || __svide_cd_failed \"$__svide_fallback_cwd\"\n\
	    fi\n\
	  fi\n\
	elif [ -n \"$__svide_fallback_cwd\" ] && [ \"$__svide_fallback_cwd\" != \"~\" ]; then\n\
	  cd \"$__svide_fallback_cwd\" 2>/dev/null || __svide_cd_failed \"$__svide_fallback_cwd\"\n\
	fi\n",
        shell_quote(cwd.unwrap_or("")),
        shell_quote(fallback_cwd.unwrap_or(""))
    ));
    script.push_str(
        "exec bash --rcfile <(cat <<'__SVIDE_RC__'\n\
__simple_vibe_ide_prompt_command() { local __sv_status=$?; printf '\\033]7;file://simple-vibe-ide%s\\033\\\\' \"$PWD\"; return $__sv_status; }\n\
case \";${PROMPT_COMMAND:-};\" in *__simple_vibe_ide_prompt_command*) ;; *) PROMPT_COMMAND=\"__simple_vibe_ide_prompt_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}\" ;; esac\n\
export PROMPT_COMMAND\n\
__simple_vibe_ide_prompt_command\n\
[ -f ~/.bashrc ] && . ~/.bashrc\n\
case \";${PROMPT_COMMAND:-};\" in *__simple_vibe_ide_prompt_command*) ;; *) PROMPT_COMMAND=\"__simple_vibe_ide_prompt_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}\" ;; esac\n\
export PROMPT_COMMAND\n\
__simple_vibe_ide_prompt_command\n\
",
    );
    if let Some(command) = command {
        script.push_str(command);
        if !command.ends_with('\n') {
            script.push('\n');
        }
        script.push_str(
            "__svide_status=$?\n\
if [ \"${__svide_status:-0}\" -ne 0 ]; then\n\
  printf '\\n[simple-vibe-ide] command exited with status %s\\n' \"$__svide_status\"\n\
fi\n\
unset __svide_status\n",
        );
    }
    script.push_str(
        "\
__SVIDE_RC__\n\
) -i",
    );
    script
}

fn list_local_directory(path: &Path, include_sizes: bool) -> Result<Vec<FileEntry>, String> {
    let read_dir = fs::read_dir(path).map_err(|err| err.to_string())?;
    let mut entries = Vec::with_capacity(read_dir.size_hint().0);
    for item in read_dir {
        let item = item.map_err(|err| err.to_string())?;
        let file_type = item.file_type().map_err(|err| err.to_string())?;
        let file_name = item.file_name().to_string_lossy().to_string();
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let size = if include_sizes && file_type.is_file() {
            item.metadata().map(|meta| meta.len()).unwrap_or(0)
        } else {
            0
        };
        entries.push(FileEntry {
            hidden: file_name.starts_with('.'),
            name: file_name,
            path: item.path().to_string_lossy().to_string(),
            kind,
            size,
        });
    }
    sort_entries(entries)
}

fn list_local_directories(paths: Vec<String>, include_sizes: bool) -> Vec<DirectoryListingResult> {
    if paths.len() <= 1 {
        return paths
            .into_iter()
            .map(|path| {
                directory_listing_from_result(
                    path.clone(),
                    list_local_directory(Path::new(&path), include_sizes),
                )
            })
            .collect();
    }

    let worker_count = paths.len().min(LOCAL_DIRECTORY_BATCH_PARALLELISM);
    let chunk_size = (paths.len() + worker_count - 1) / worker_count;
    let mut results: Vec<Option<DirectoryListingResult>> = (0..paths.len()).map(|_| None).collect();

    let mut handles = Vec::new();
    for (chunk_index, chunk) in paths.chunks(chunk_size).enumerate() {
        let start_index = chunk_index * chunk_size;
        let chunk_paths = chunk
            .iter()
            .enumerate()
            .map(|(offset, path)| (start_index + offset, path.clone()))
            .collect::<Vec<_>>();
        handles.push(thread::spawn(move || {
            chunk_paths
                .into_iter()
                .map(|(index, path)| {
                    (
                        index,
                        directory_listing_from_result(
                            path.clone(),
                            list_local_directory(Path::new(&path), include_sizes),
                        ),
                    )
                })
                .collect::<Vec<_>>()
        }));
    }

    for handle in handles {
        if let Ok(listings) = handle.join() {
            for (index, listing) in listings {
                if let Some(slot) = results.get_mut(index) {
                    *slot = Some(listing);
                }
            }
        }
    }

    results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| DirectoryListingResult {
                path: paths.get(index).cloned().unwrap_or_default(),
                entries: Vec::new(),
                error: Some("directory listing worker failed".to_string()),
            })
        })
        .collect()
}

fn list_local_directory_signatures(
    paths: Vec<String>,
    include_sizes: bool,
) -> Vec<DirectorySignatureResult> {
    if paths.len() <= 1 {
        return paths
            .into_iter()
            .map(|path| {
                directory_signature_from_result(
                    path.clone(),
                    local_directory_signature(Path::new(&path), include_sizes),
                )
            })
            .collect();
    }

    let worker_count = paths.len().min(LOCAL_DIRECTORY_BATCH_PARALLELISM);
    let chunk_size = (paths.len() + worker_count - 1) / worker_count;
    let mut results: Vec<Option<DirectorySignatureResult>> =
        (0..paths.len()).map(|_| None).collect();

    let mut handles = Vec::new();
    for (chunk_index, chunk) in paths.chunks(chunk_size).enumerate() {
        let start_index = chunk_index * chunk_size;
        let chunk_paths = chunk
            .iter()
            .enumerate()
            .map(|(offset, path)| (start_index + offset, path.clone()))
            .collect::<Vec<_>>();
        handles.push(thread::spawn(move || {
            chunk_paths
                .into_iter()
                .map(|(index, path)| {
                    (
                        index,
                        directory_signature_from_result(
                            path.clone(),
                            local_directory_signature(Path::new(&path), include_sizes),
                        ),
                    )
                })
                .collect::<Vec<_>>()
        }));
    }

    for handle in handles {
        if let Ok(signatures) = handle.join() {
            for (index, signature) in signatures {
                if let Some(slot) = results.get_mut(index) {
                    *slot = Some(signature);
                }
            }
        }
    }

    results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| DirectorySignatureResult {
                path: paths.get(index).cloned().unwrap_or_default(),
                signature: String::new(),
                error: Some("directory signature worker failed".to_string()),
            })
        })
        .collect()
}

fn local_directory_signature(path: &Path, include_sizes: bool) -> Result<String, String> {
    let read_dir = fs::read_dir(path).map_err(|err| err.to_string())?;
    let mut entries = Vec::with_capacity(read_dir.size_hint().0);
    for item in read_dir {
        let item = item.map_err(|err| err.to_string())?;
        let file_type = item.file_type().map_err(|err| err.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let size = if include_sizes && file_type.is_file() {
            item.metadata().map(|meta| meta.len()).unwrap_or(0)
        } else {
            0
        };
        entries.push(DirectorySignatureEntry {
            hidden: name.starts_with('.'),
            name,
            kind,
            size,
        });
    }
    entries.sort_by(|left, right| {
        directory_kind_order(left.kind)
            .cmp(&directory_kind_order(right.kind))
            .then_with(|| compare_entry_names(&left.name, &right.name))
    });
    Ok(directory_signature_from_signature_entries(&entries))
}

fn list_wsl_directory(
    windows_path: &Path,
    posix_path: &str,
    include_sizes: bool,
) -> Result<Vec<FileEntry>, String> {
    let read_dir = fs::read_dir(windows_path).map_err(|err| err.to_string())?;
    let mut entries = Vec::with_capacity(read_dir.size_hint().0);
    for item in read_dir {
        let item = item.map_err(|err| err.to_string())?;
        let file_type = item.file_type().map_err(|err| err.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let size = if include_sizes && file_type.is_file() {
            item.metadata().map(|meta| meta.len()).unwrap_or(0)
        } else {
            0
        };
        entries.push(FileEntry {
            path: join_posix(posix_path, &name),
            hidden: name.starts_with('.'),
            name,
            kind,
            size,
        });
    }
    sort_entries(entries)
}

fn list_wsl_directories(
    profile: &ConnectionProfile,
    paths: &[String],
    include_sizes: bool,
) -> Result<Vec<DirectoryListingResult>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut results: Vec<Option<DirectoryListingResult>> = (0..paths.len()).map(|_| None).collect();
    let mut local_jobs = Vec::new();
    let mut remote_indexes = Vec::new();
    let mut remote_paths = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        if let Some(windows_path) = wsl_posix_path_to_windows_path(profile, path) {
            local_jobs.push((index, path.clone(), windows_path));
        } else {
            remote_indexes.push(index);
            remote_paths.push(path.clone());
        }
    }

    let local_worker_count = local_jobs.len().min(WSL_DIRECTORY_BATCH_PARALLELISM);
    if local_worker_count <= 1 {
        for (index, path, windows_path) in local_jobs {
            match list_wsl_directory(&windows_path, &path, include_sizes) {
                Ok(entries) => {
                    results[index] = Some(DirectoryListingResult {
                        path,
                        entries,
                        error: None,
                    });
                }
                Err(error) if should_skip_wsl_shell_fallback(&error) => {
                    results[index] = Some(DirectoryListingResult {
                        path,
                        entries: Vec::new(),
                        error: Some(error),
                    });
                }
                Err(_) => {
                    remote_indexes.push(index);
                    remote_paths.push(path);
                }
            }
        }
    } else {
        let chunk_size = (local_jobs.len() + local_worker_count - 1) / local_worker_count;
        let mut handles = Vec::new();
        for chunk in local_jobs.chunks(chunk_size) {
            let chunk_jobs = chunk.to_vec();
            handles.push(thread::spawn(move || {
                chunk_jobs
                    .into_iter()
                    .map(|(index, path, windows_path)| {
                        let result = match list_wsl_directory(&windows_path, &path, include_sizes) {
                            Ok(entries) => Some(DirectoryListingResult {
                                path: path.clone(),
                                entries,
                                error: None,
                            }),
                            Err(error) if should_skip_wsl_shell_fallback(&error) => {
                                Some(DirectoryListingResult {
                                    path: path.clone(),
                                    entries: Vec::new(),
                                    error: Some(error),
                                })
                            }
                            Err(_) => None,
                        };
                        (index, path, result)
                    })
                    .collect::<Vec<_>>()
            }));
        }

        for handle in handles {
            if let Ok(listings) = handle.join() {
                for (index, path, listing) in listings {
                    if let Some(listing) = listing {
                        results[index] = Some(listing);
                    } else {
                        remote_indexes.push(index);
                        remote_paths.push(path);
                    }
                }
            }
        }
    }

    if !remote_paths.is_empty() {
        for (index, result) in remote_indexes.into_iter().zip(list_remote_directories(
            profile,
            &remote_paths,
            include_sizes,
        )?) {
            results[index] = Some(result);
        }
    }

    Ok(results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| DirectoryListingResult {
                path: paths[index].clone(),
                entries: Vec::new(),
                error: Some("directory listing was unavailable".to_string()),
            })
        })
        .collect())
}

fn list_wsl_directory_signatures(
    profile: &ConnectionProfile,
    paths: &[String],
    include_sizes: bool,
) -> Result<Vec<DirectorySignatureResult>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut results: Vec<Option<DirectorySignatureResult>> =
        (0..paths.len()).map(|_| None).collect();
    let mut local_jobs = Vec::new();
    let mut remote_indexes = Vec::new();
    let mut remote_paths = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        if let Some(windows_path) = wsl_posix_path_to_windows_path(profile, path) {
            local_jobs.push((index, path.clone(), windows_path));
        } else {
            remote_indexes.push(index);
            remote_paths.push(path.clone());
        }
    }

    let local_worker_count = local_jobs.len().min(WSL_DIRECTORY_BATCH_PARALLELISM);
    if local_worker_count <= 1 {
        for (index, path, windows_path) in local_jobs {
            match local_directory_signature(&windows_path, include_sizes) {
                Ok(signature) => {
                    results[index] = Some(DirectorySignatureResult {
                        path,
                        signature,
                        error: None,
                    });
                }
                Err(error) if should_skip_wsl_shell_fallback(&error) => {
                    results[index] = Some(DirectorySignatureResult {
                        path,
                        signature: String::new(),
                        error: Some(error),
                    });
                }
                Err(_) => {
                    remote_indexes.push(index);
                    remote_paths.push(path);
                }
            }
        }
    } else {
        let chunk_size = (local_jobs.len() + local_worker_count - 1) / local_worker_count;
        let mut handles = Vec::new();
        for chunk in local_jobs.chunks(chunk_size) {
            let chunk_jobs = chunk.to_vec();
            handles.push(thread::spawn(move || {
                chunk_jobs
                    .into_iter()
                    .map(|(index, path, windows_path)| {
                        let result = match local_directory_signature(&windows_path, include_sizes) {
                            Ok(signature) => Some(DirectorySignatureResult {
                                path: path.clone(),
                                signature,
                                error: None,
                            }),
                            Err(error) if should_skip_wsl_shell_fallback(&error) => {
                                Some(DirectorySignatureResult {
                                    path: path.clone(),
                                    signature: String::new(),
                                    error: Some(error),
                                })
                            }
                            Err(_) => None,
                        };
                        (index, path, result)
                    })
                    .collect::<Vec<_>>()
            }));
        }

        for handle in handles {
            if let Ok(signatures) = handle.join() {
                for (index, path, signature) in signatures {
                    if let Some(signature) = signature {
                        results[index] = Some(signature);
                    } else {
                        remote_indexes.push(index);
                        remote_paths.push(path);
                    }
                }
            }
        }
    }

    if !remote_paths.is_empty() {
        let remote_signatures = directory_signatures_from_listings(list_remote_directories(
            profile,
            &remote_paths,
            include_sizes,
        )?);
        for (index, result) in remote_indexes.into_iter().zip(remote_signatures) {
            results[index] = Some(result);
        }
    }

    Ok(results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| DirectorySignatureResult {
                path: paths[index].clone(),
                signature: String::new(),
                error: Some("directory signature was unavailable".to_string()),
            })
        })
        .collect())
}

fn should_skip_wsl_shell_fallback(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("cannot find")
        || lower.contains("no such file")
        || lower.contains("not a directory")
        || lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("os error 2")
        || lower.contains("os error 3")
        || lower.contains("os error 5")
        || lower.contains("os error 20")
}

fn list_remote_directory(
    profile: &ConnectionProfile,
    path: &str,
    include_sizes: bool,
) -> Result<Vec<FileEntry>, String> {
    let quoted_path = shell_quote(path);
    let size_format = if include_sizes { "%s" } else { "0" };
    let script = format!(
        r#"if [ ! -d {quoted_path} ]; then echo "not a directory" >&2; exit 2; fi
find {quoted_path} -mindepth 1 -maxdepth 1 -printf '%y\t{size_format}\t%f\n' 2>/dev/null || exit 3
"#,
    );
    let bytes =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut entries = Vec::new();
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(kind_text) = parts.next() else {
            continue;
        };
        let Some(size_text) = parts.next() else {
            continue;
        };
        let Some(name_text) = parts.next() else {
            continue;
        };
        let kind = match kind_text {
            "d" => "dir",
            "f" => "file",
            _ => "other",
        };
        let name = name_text.to_string();
        entries.push(FileEntry {
            path: join_posix(path, &name),
            hidden: name.starts_with('.'),
            name,
            kind,
            size: if include_sizes {
                size_text.parse().unwrap_or(0)
            } else {
                0
            },
        });
    }
    sort_entries(entries)
}

fn list_remote_directories(
    profile: &ConnectionProfile,
    paths: &[String],
    include_sizes: bool,
) -> Result<Vec<DirectoryListingResult>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let size_format = if include_sizes { "%s" } else { "0" };
    let mut script = String::new();
    for (index, path) in paths.iter().enumerate() {
        let quoted_path = shell_quote(path);
        script.push_str(&format!(
            "printf '__SVIDE_DIR_BEGIN__\\t{index}\\n'\n\
if [ -d {quoted_path} ]; then\n\
  find {quoted_path} -mindepth 1 -maxdepth 1 -printf '%y\\t{size_format}\\t%f\\n' 2>/dev/null || printf '__SVIDE_DIR_ERROR__\\t{index}\\tfind failed\\n'\n\
else\n\
  printf '__SVIDE_DIR_ERROR__\\t{index}\\tnot a directory\\n'\n\
fi\n\
printf '__SVIDE_DIR_END__\\t{index}\\n'\n"
        ));
    }

    let bytes =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
    Ok(parse_remote_directory_batch(
        paths,
        &String::from_utf8_lossy(&bytes),
        include_sizes,
    ))
}

fn parse_remote_directory_batch(
    paths: &[String],
    text: &str,
    include_sizes: bool,
) -> Vec<DirectoryListingResult> {
    let mut results: Vec<DirectoryListingResult> = paths
        .iter()
        .map(|path| DirectoryListingResult {
            path: path.clone(),
            entries: Vec::new(),
            error: None,
        })
        .collect();
    let mut current: Option<usize> = None;

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("__SVIDE_DIR_BEGIN__\t") {
            current = rest
                .parse::<usize>()
                .ok()
                .filter(|index| *index < results.len());
            continue;
        }
        if let Some(rest) = line.strip_prefix("__SVIDE_DIR_END__\t") {
            if current == rest.parse::<usize>().ok() {
                current = None;
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("__SVIDE_DIR_ERROR__\t") {
            let mut parts = rest.splitn(2, '\t');
            let Some(index_text) = parts.next() else {
                continue;
            };
            if let Ok(index) = index_text.parse::<usize>() {
                if let Some(result) = results.get_mut(index) {
                    result.error = Some(
                        parts
                            .next()
                            .unwrap_or("directory listing failed")
                            .to_string(),
                    );
                }
            }
            continue;
        }

        let Some(index) = current else {
            continue;
        };
        let Some(result) = results.get_mut(index) else {
            continue;
        };
        if result.error.is_some() {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let Some(kind_text) = parts.next() else {
            continue;
        };
        let Some(size_text) = parts.next() else {
            continue;
        };
        let Some(name_text) = parts.next() else {
            continue;
        };
        let kind = match kind_text {
            "d" => "dir",
            "f" => "file",
            _ => "other",
        };
        let name = name_text.to_string();
        result.entries.push(FileEntry {
            path: join_posix(&result.path, &name),
            hidden: name.starts_with('.'),
            name,
            kind,
            size: if include_sizes {
                size_text.parse().unwrap_or(0)
            } else {
                0
            },
        });
    }

    for result in &mut results {
        if result.error.is_none() {
            result.entries = sort_entries(std::mem::take(&mut result.entries)).unwrap_or_default();
        }
    }
    results
}

fn directory_listing_from_result(
    path: String,
    result: Result<Vec<FileEntry>, String>,
) -> DirectoryListingResult {
    match result {
        Ok(entries) => DirectoryListingResult {
            path,
            entries,
            error: None,
        },
        Err(error) => DirectoryListingResult {
            path,
            entries: Vec::new(),
            error: Some(error),
        },
    }
}

fn directory_signature_from_result(
    path: String,
    result: Result<String, String>,
) -> DirectorySignatureResult {
    match result {
        Ok(signature) => DirectorySignatureResult {
            path,
            signature,
            error: None,
        },
        Err(error) => DirectorySignatureResult {
            path,
            signature: String::new(),
            error: Some(error),
        },
    }
}

fn directory_signatures_from_listings(
    listings: Vec<DirectoryListingResult>,
) -> Vec<DirectorySignatureResult> {
    listings
        .into_iter()
        .map(|listing| {
            if let Some(error) = listing.error {
                DirectorySignatureResult {
                    path: listing.path,
                    signature: String::new(),
                    error: Some(error),
                }
            } else {
                DirectorySignatureResult {
                    signature: directory_signature_from_entries(&listing.entries),
                    path: listing.path,
                    error: None,
                }
            }
        })
        .collect()
}

fn directory_signature_from_signature_entries(entries: &[DirectorySignatureEntry]) -> String {
    let mut hash = 2166136261_u32;
    let mut total_name_length: usize = 0;
    let mut total_size: u64 = 0;
    for entry in entries {
        total_name_length += utf16_len(&entry.name);
        total_size = total_size.saturating_add(entry.size);
        hash = hash_directory_signature_string(hash, &entry.name);
        hash = hash_directory_signature_string(hash, entry.kind);
        hash = hash_directory_signature_number(hash, entry.size);
        hash = hash_directory_signature_number(hash, if entry.hidden { 1 } else { 0 });
    }
    format!(
        "{}:{}:{}:{}",
        entries.len(),
        total_name_length,
        total_size,
        base36_u32(hash)
    )
}

fn directory_signature_from_entries(entries: &[FileEntry]) -> String {
    let mut hash = 2166136261_u32;
    let mut total_name_length: usize = 0;
    let mut total_size: u64 = 0;
    for entry in entries {
        total_name_length += utf16_len(&entry.name);
        total_size = total_size.saturating_add(entry.size);
        hash = hash_directory_signature_string(hash, &entry.name);
        hash = hash_directory_signature_string(hash, entry.kind);
        hash = hash_directory_signature_number(hash, entry.size);
        hash = hash_directory_signature_number(hash, if entry.hidden { 1 } else { 0 });
    }
    format!(
        "{}:{}:{}:{}",
        entries.len(),
        total_name_length,
        total_size,
        base36_u32(hash)
    )
}

fn hash_directory_signature_string(mut hash: u32, value: &str) -> u32 {
    if value.is_ascii() {
        for unit in value.bytes() {
            hash ^= u32::from(unit);
            hash = hash.wrapping_mul(16777619);
        }
        hash ^= 31;
        return hash.wrapping_mul(16777619);
    }
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16777619);
    }
    hash ^= 31;
    hash.wrapping_mul(16777619)
}

fn utf16_len(value: &str) -> usize {
    if value.is_ascii() {
        value.len()
    } else {
        value.encode_utf16().count()
    }
}

fn hash_directory_signature_number(mut hash: u32, value: u64) -> u32 {
    let normalized = value as u32;
    hash ^= normalized & 0xffff;
    hash = hash.wrapping_mul(16777619);
    hash ^= (normalized >> 16) & 0xffff;
    hash.wrapping_mul(16777619)
}

fn base36_u32(mut value: u32) -> String {
    if value == 0 {
        return "0".to_string();
    }
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut encoded = Vec::new();
    while value > 0 {
        encoded.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    encoded.reverse();
    String::from_utf8(encoded).unwrap_or_else(|_| "0".to_string())
}

fn directory_kind_order(kind: &str) -> u8 {
    if kind == "dir" {
        0
    } else {
        1
    }
}

fn sort_entries(mut entries: Vec<FileEntry>) -> Result<Vec<FileEntry>, String> {
    entries.sort_by(|left, right| {
        directory_kind_order(left.kind)
            .cmp(&directory_kind_order(right.kind))
            .then_with(|| compare_entry_names(&left.name, &right.name))
    });
    Ok(entries)
}

fn compare_entry_names(left: &str, right: &str) -> std::cmp::Ordering {
    if left.is_ascii() && right.is_ascii() {
        return compare_ascii_names_case_insensitive(left.as_bytes(), right.as_bytes());
    }
    entry_sort_name_key(left).cmp(&entry_sort_name_key(right))
}

fn compare_ascii_names_case_insensitive(left: &[u8], right: &[u8]) -> std::cmp::Ordering {
    let common = left.len().min(right.len());
    for index in 0..common {
        let ordering = left[index]
            .to_ascii_lowercase()
            .cmp(&right[index].to_ascii_lowercase());
        if !ordering.is_eq() {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

fn entry_sort_name_key(name: &str) -> String {
    if name.is_ascii() {
        name.to_ascii_lowercase()
    } else {
        name.to_lowercase()
    }
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

fn move_path_to_delete_trash(
    profile: &ConnectionProfile,
    path: &str,
    delete_id: &str,
    index: usize,
) -> Result<DeletedPathItem, String> {
    let name = deleted_path_display_name(profile, path)?;
    let directory = deleted_path_is_directory(profile, path)?;
    let trash_path = deleted_trash_path(profile, path, delete_id, index, &name);
    match profile.kind.as_str() {
        "windows" => move_local_path_to_trash(Path::new(path), Path::new(&trash_path))?,
        "wsl" => {
            let source_windows = wsl_posix_path_to_windows_path(profile, path);
            let trash_windows = wsl_posix_path_to_windows_path(profile, &trash_path);
            if let (Some(source_windows), Some(trash_windows)) = (source_windows, trash_windows) {
                move_local_path_to_trash(&source_windows, &trash_windows)?;
            } else {
                move_remote_path_to_trash(profile, path, &trash_path)?;
            }
        }
        "ssh" => move_remote_path_to_trash(profile, path, &trash_path)?,
        _ => return Err(format!("unsupported profile kind: {}", profile.kind)),
    }
    Ok(DeletedPathItem {
        original_path: path.to_string(),
        trash_path,
        name,
        directory,
    })
}

fn restore_deleted_path(
    profile: &ConnectionProfile,
    trash_path: &str,
    original_path: &str,
) -> Result<(), String> {
    match profile.kind.as_str() {
        "windows" => restore_local_deleted_path(Path::new(trash_path), Path::new(original_path)),
        "wsl" => {
            let trash_windows = wsl_posix_path_to_windows_path(profile, trash_path);
            let original_windows = wsl_posix_path_to_windows_path(profile, original_path);
            if let (Some(trash_windows), Some(original_windows)) = (trash_windows, original_windows)
            {
                restore_local_deleted_path(&trash_windows, &original_windows)
            } else {
                restore_remote_deleted_path(profile, trash_path, original_path)
            }
        }
        "ssh" => restore_remote_deleted_path(profile, trash_path, original_path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

fn move_local_path_to_trash(source: &Path, trash: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("path does not exist".to_string());
    }
    if let Some(parent) = trash.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::rename(source, trash).map_err(|err| err.to_string())
}

fn restore_local_deleted_path(trash: &Path, original: &Path) -> Result<(), String> {
    if original.exists() {
        return Err("restore target already exists".to_string());
    }
    if let Some(parent) = original.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::rename(trash, original).map_err(|err| err.to_string())
}

fn move_remote_path_to_trash(
    profile: &ConnectionProfile,
    source: &str,
    trash: &str,
) -> Result<(), String> {
    let trash_parent = parent_posix(trash);
    let script = format!(
        "if [ ! -e {source} ]; then echo 'path does not exist' >&2; exit 1; fi\n\
mkdir -p {trash_parent}\n\
mv -- {source} {trash}",
        source = shell_quote(source),
        trash_parent = shell_quote(&trash_parent),
        trash = shell_quote(trash)
    );
    run_profile_shell(profile, &script, None).map(|_| ())
}

fn restore_remote_deleted_path(
    profile: &ConnectionProfile,
    trash: &str,
    original: &str,
) -> Result<(), String> {
    let original_parent = parent_posix(original);
    let script = format!(
        "if [ -e {original} ]; then echo 'restore target already exists' >&2; exit 1; fi\n\
mkdir -p {original_parent}\n\
mv -- {trash} {original}",
        original = shell_quote(original),
        original_parent = shell_quote(&original_parent),
        trash = shell_quote(trash)
    );
    run_profile_shell(profile, &script, None).map(|_| ())
}

fn is_note_file_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.iter().any(|part| *part == "..") {
        return false;
    }
    parts.windows(3).any(|window| {
        window[0] == ".vibe-ide-temp" && window[1] == "notes" && !window[2].is_empty()
    })
}

fn delete_local_note_file_permanently(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        return Err("note delete target is a directory".to_string());
    }
    fs::remove_file(path).map_err(|err| err.to_string())
}

fn delete_remote_note_file_permanently(
    profile: &ConnectionProfile,
    path: &str,
) -> Result<(), String> {
    let script = format!(
        "if [ ! -e {path} ]; then exit 0; fi\n\
if [ -d {path} ]; then echo 'note delete target is a directory' >&2; exit 1; fi\n\
rm -f -- {path}",
        path = shell_quote(path)
    );
    run_profile_shell(profile, &script, None).map(|_| ())
}

fn deleted_path_display_name(profile: &ConnectionProfile, path: &str) -> Result<String, String> {
    match profile.kind.as_str() {
        "windows" => local_file_name(Path::new(path)),
        "wsl" => wsl_posix_path_to_windows_path(profile, path)
            .and_then(|windows_path| local_file_name(&windows_path).ok())
            .map_or_else(|| Ok(remote_file_name(path)), Ok),
        "ssh" => Ok(remote_file_name(path)),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

fn deleted_path_is_directory(profile: &ConnectionProfile, path: &str) -> Result<bool, String> {
    match profile.kind.as_str() {
        "windows" => Ok(Path::new(path).is_dir()),
        "wsl" => {
            if let Some(windows_path) = wsl_posix_path_to_windows_path(profile, path) {
                Ok(windows_path.is_dir())
            } else {
                remote_path_is_directory(profile, path)
            }
        }
        "ssh" => remote_path_is_directory(profile, path),
        _ => Err(format!("unsupported profile kind: {}", profile.kind)),
    }
}

fn remote_path_is_directory(profile: &ConnectionProfile, path: &str) -> Result<bool, String> {
    let script = format!(
        "if [ -d {path} ]; then printf dir; elif [ -e {path} ]; then printf file; else exit 1; fi",
        path = shell_quote(path)
    );
    let output =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
    Ok(String::from_utf8_lossy(&output).trim() == "dir")
}

fn deleted_trash_path(
    profile: &ConnectionProfile,
    original_path: &str,
    delete_id: &str,
    index: usize,
    name: &str,
) -> String {
    match profile.kind.as_str() {
        "windows" => {
            let parent = Path::new(original_path)
                .parent()
                .unwrap_or_else(|| Path::new("."));
            parent
                .join(".vibe-ide-temp")
                .join("deleted")
                .join(delete_id)
                .join(format!("{index}-{name}"))
                .to_string_lossy()
                .to_string()
        }
        _ => join_posix(
            &join_posix(
                &join_posix(
                    &join_posix(&parent_posix(original_path), ".vibe-ide-temp"),
                    "deleted",
                ),
                delete_id,
            ),
            &format!("{index}-{name}"),
        ),
    }
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
    let output =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
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
        if profile.kind == "ssh" {
            clear_ssh_askpass_cache_for_profile(profile);
        }
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
            let mut command = Command::new(ssh_executable());
            push_ssh_background_options(&mut command);
            command
                .current_dir(windows_spawn_cwd())
                .arg("-T")
                .arg(alias)
                .arg(remote);
            apply_session_ssh_auth_to_command(&mut command, profile);
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

fn copy_profile_paths_to_local(
    target_dir: &Path,
    source_paths: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    if !target_dir.is_dir() {
        return Err("paste target is not a directory".to_string());
    }

    let mut created = Vec::new();
    for source in source_paths {
        if !source.exists() {
            return Err("copied source does not exist".to_string());
        }
        let name = local_file_name(source)?;
        let target = unique_local_copy_child_path(target_dir, &name);
        copy_local_path_recursive(source, &target)?;
        created.push(target);
    }
    Ok(created)
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

fn copy_profile_paths_to_remote(
    profile: &ConnectionProfile,
    target_dir: &str,
    source_paths: &[String],
) -> Result<Vec<String>, String> {
    create_remote_directory(profile, target_dir)?;
    let mut created = Vec::new();
    for source in source_paths {
        if !remote_path_exists(profile, source)? {
            return Err("copied source does not exist".to_string());
        }
        let name = remote_path_basename(source);
        let target = unique_remote_copy_child_path(profile, target_dir, &name)?;
        copy_remote_path(profile, source, &target)?;
        created.push(target);
    }
    Ok(created)
}

fn copy_remote_path(profile: &ConnectionProfile, source: &str, target: &str) -> Result<(), String> {
    let script = format!(
        r#"set -e
src={src}
dst={dst}
if [ ! -e "$src" ]; then
  echo "copied source does not exist" >&2
  exit 1
fi
if [ -d "$src" ]; then
  src_real="$(cd "$src" && pwd -P)"
  dst_parent="$(dirname -- "$dst")"
  mkdir -p -- "$dst_parent"
  dst_parent_real="$(cd "$dst_parent" && pwd -P)"
  dst_base="$(basename -- "$dst")"
  dst_real="$dst_parent_real/$dst_base"
  case "$dst_real/" in
    "$src_real"/*)
      echo "cannot copy a folder into itself" >&2
      exit 1
      ;;
  esac
fi
cp -a -- "$src" "$dst"
"#,
        src = shell_quote(source),
        dst = shell_quote(target)
    );
    run_profile_shell(profile, &script, None)?;
    Ok(())
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
    let output =
        run_profile_shell_with_timeout(profile, &script, None, REMOTE_DIRECTORY_COMMAND_TIMEOUT)?;
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

fn copy_suffix_name(name: &str, index: usize) -> String {
    let (stem, extension) = split_name_extension(name);
    format!("{stem}_copy_{index:03}{extension}")
}

fn unique_local_copy_child_path(parent: &Path, name: &str) -> PathBuf {
    let candidate = parent.join(name);
    if !candidate.exists() {
        return candidate;
    }

    for index in 0..10000 {
        let candidate = parent.join(copy_suffix_name(name, index));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(copy_suffix_name(name, 10000))
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

fn unique_remote_copy_child_path(
    profile: &ConnectionProfile,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    let candidate = join_posix(parent, name);
    if !remote_path_exists(profile, &candidate)? {
        return Ok(candidate);
    }

    for index in 0..10000 {
        let candidate = join_posix(parent, &copy_suffix_name(name, index));
        if !remote_path_exists(profile, &candidate)? {
            return Ok(candidate);
        }
    }
    Ok(join_posix(parent, &copy_suffix_name(name, 10000)))
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
    run_profile_shell_with_timeout(profile, script, stdin_data, REMOTE_SHELL_COMMAND_TIMEOUT)
}

fn run_profile_shell_with_timeout(
    profile: &ConnectionProfile,
    script: &str,
    stdin_data: Option<Vec<u8>>,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let attempts = if profile.kind == "wsl" {
        WSL_TRANSIENT_RETRY_ATTEMPTS
    } else {
        1
    };
    let mut last_error = None;
    for attempt in 0..attempts {
        match run_profile_shell_once(profile, script, stdin_data.clone(), timeout) {
            Ok(stdout) => return Ok(stdout),
            Err(error)
                if profile.kind == "wsl"
                    && is_wsl_transient_error(&error)
                    && attempt + 1 < attempts =>
            {
                last_error = Some(error);
                thread::sleep(WSL_TRANSIENT_RETRY_DELAY);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "WSL command failed".to_string()))
}

fn run_profile_shell_once(
    profile: &ConnectionProfile,
    script: &str,
    stdin_data: Option<Vec<u8>>,
    timeout: Duration,
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
            let mut command = Command::new(ssh_executable());
            push_ssh_background_options(&mut command);
            command
                .current_dir(windows_spawn_cwd())
                .arg("-T")
                .arg(alias)
                .arg(remote);
            apply_session_ssh_auth_to_command(&mut command, profile);
            command
        }
        _ => return Err(format!("profile is not remote: {}", profile.kind)),
    };
    if stdin_data.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hide_command_window(&mut command)
        .spawn()
        .map_err(|err| format!("failed to run remote shell: {err}"))?;
    let pid = child.id();
    assign_child_to_cleanup_job(pid);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader =
        stdout.map(|mut stdout| thread::spawn(move || read_process_output(&mut stdout)));
    let stderr_reader =
        stderr.map(|mut stderr| thread::spawn(move || read_process_output(&mut stderr)));
    let stdin_writer = stdin_data.and_then(|data| {
        child.stdin.take().map(|mut stdin| {
            thread::spawn(move || {
                stdin
                    .write_all(&data)
                    .and_then(|_| stdin.flush())
                    .map_err(|err| err.to_string())
            })
        })
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_process_tree(pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_stdin_writer(stdin_writer);
                    let _ = join_process_output(stdout_reader);
                    let _ = join_process_output(stderr_reader);
                    if profile.kind == "ssh" {
                        clear_ssh_askpass_cache_for_profile(profile);
                    }
                    return Err(format!(
                        "remote shell timed out after {}s",
                        timeout.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("failed to wait for remote shell: {err}")),
        }
    };
    let stdin_result = join_stdin_writer(stdin_writer);
    let stdout = join_process_output(stdout_reader)?;
    let stderr = join_process_output(stderr_reader)?;
    if !status.success() {
        if profile.kind == "ssh" {
            clear_ssh_askpass_cache_for_profile(profile);
        }
        return Err(String::from_utf8_lossy(&stderr).trim().to_string());
    }
    stdin_result?;
    Ok(stdout)
}

fn warm_wsl_profile(profile: &ConnectionProfile) -> Result<(), String> {
    if profile.kind != "wsl" {
        return Ok(());
    }

    let distro = profile.distro.as_deref().unwrap_or("Ubuntu");
    if wsl_warmup_recent(distro) || !begin_wsl_warmup(distro) {
        return Ok(());
    }

    let result = warm_wsl_distro(distro);
    finish_wsl_warmup(distro, result.is_ok());
    result
}

fn warm_wsl_distro(distro: &str) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..WSL_TRANSIENT_RETRY_ATTEMPTS {
        let mut command = Command::new("wsl.exe");
        command
            .current_dir(windows_spawn_cwd())
            .arg("-d")
            .arg(distro)
            .arg("--exec")
            .arg("sh")
            .arg("-lc")
            .arg("true");
        match command_output_with_timeout(&mut command, WSL_WARMUP_TIMEOUT) {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let error = command_output_error_message(&output);
                if is_wsl_transient_error(&error) && attempt + 1 < WSL_TRANSIENT_RETRY_ATTEMPTS {
                    last_error = Some(error);
                    thread::sleep(WSL_TRANSIENT_RETRY_DELAY);
                    continue;
                }
                return Err(format!("WSL warmup failed: {error}"));
            }
            Err(error)
                if is_wsl_transient_error(&error) && attempt + 1 < WSL_TRANSIENT_RETRY_ATTEMPTS =>
            {
                last_error = Some(error);
                thread::sleep(WSL_TRANSIENT_RETRY_DELAY);
            }
            Err(error) => return Err(format!("WSL warmup failed: {error}")),
        }
    }
    Err(format!(
        "WSL warmup failed: {}",
        last_error.unwrap_or_else(|| "unexpected WSL failure".to_string())
    ))
}

fn wsl_warmup_recent(distro: &str) -> bool {
    let cache = WSL_WARMUP_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    cache
        .lock()
        .ok()
        .and_then(|guard| guard.get(distro).copied())
        .is_some_and(|instant| instant.elapsed() < WSL_WARMUP_CACHE_TTL)
}

fn begin_wsl_warmup(distro: &str) -> bool {
    let in_flight = WSL_WARMUP_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut guard) = in_flight.lock() else {
        return true;
    };
    guard.insert(distro.to_string())
}

fn finish_wsl_warmup(distro: &str, succeeded: bool) {
    if let Some(in_flight) = WSL_WARMUP_IN_FLIGHT.get() {
        if let Ok(mut guard) = in_flight.lock() {
            guard.remove(distro);
        }
    }
    if !succeeded {
        return;
    }
    let cache = WSL_WARMUP_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        guard.insert(distro.to_string(), Instant::now());
    }
}

fn is_wsl_transient_error(message: &str) -> bool {
    message.contains("Wsl/Service/E_UNEXPECTED") || message.contains("E_UNEXPECTED")
}

fn command_output_error_message(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("{stderr}\n{stdout}"),
        (false, true) => stderr,
        (true, false) => stdout,
        (true, true) => format!("process exited with status {}", output.status),
    }
}

fn command_output_with_timeout(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hide_command_window(command)
        .spawn()
        .map_err(|err| format!("failed to start process: {err}"))?;
    let pid = child.id();
    assign_child_to_cleanup_job(pid);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader =
        stdout.map(|mut stdout| thread::spawn(move || read_process_output(&mut stdout)));
    let stderr_reader =
        stderr.map(|mut stderr| thread::spawn(move || read_process_output(&mut stderr)));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_process_tree(pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_process_output(stdout_reader);
                    let _ = join_process_output(stderr_reader);
                    return Err(format!("process timed out after {}s", timeout.as_secs()));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("failed to wait for process: {err}")),
        }
    };
    Ok(Output {
        status,
        stdout: join_process_output(stdout_reader)?,
        stderr: join_process_output(stderr_reader)?,
    })
}

fn read_process_output(reader: &mut dyn Read) -> Vec<u8> {
    let mut output = Vec::new();
    let _ = reader.read_to_end(&mut output);
    output
}

fn join_process_output(handle: Option<thread::JoinHandle<Vec<u8>>>) -> Result<Vec<u8>, String> {
    let Some(handle) = handle else {
        return Ok(Vec::new());
    };
    handle
        .join()
        .map_err(|_| "remote shell output reader failed".to_string())
}

fn join_stdin_writer(handle: Option<thread::JoinHandle<Result<(), String>>>) -> Result<(), String> {
    let Some(handle) = handle else {
        return Ok(());
    };
    handle
        .join()
        .map_err(|_| "remote shell stdin writer failed".to_string())?
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
    incoming.set_nodelay(true)?;
    incoming.set_read_timeout(Some(Duration::from_secs(15)))?;
    let request = read_http_headers(&mut incoming, 128 * 1024)?;
    let Some(header_end) = find_http_header_end(&request) else {
        return Ok(());
    };
    let (request_headers, request_body) = request.split_at(header_end + 4);
    let request_text = String::from_utf8_lossy(request_headers);
    let content_length = http_content_length(&request_text).unwrap_or(0);
    let proxy_host =
        http_header_value(&request_text, "host").unwrap_or_else(|| "127.0.0.1".to_string());
    let proxy_origin = format!("http://{}", proxy_host.trim());
    if is_websocket_upgrade(&request_text) {
        return proxy_websocket_upgrade(
            incoming,
            target_host,
            target_port,
            &request_text,
            request_body,
            &proxy_origin,
        );
    }
    let rewritten_request =
        rewrite_preview_request_headers(&request_text, &target_host, target_port, &proxy_origin);

    let mut remote = TcpStream::connect((target_host.as_str(), target_port))?;
    remote.set_nodelay(true)?;
    remote.set_read_timeout(Some(Duration::from_secs(75)))?;
    remote.write_all(rewritten_request.as_bytes())?;
    if !request_body.is_empty() {
        remote.write_all(request_body)?;
    }
    if content_length > request_body.len() {
        copy_exact_bytes(
            &mut incoming,
            &mut remote,
            content_length - request_body.len(),
        )?;
    }

    let response = read_http_headers(&mut remote, 256 * 1024)?;
    let Some(response_header_end) = find_http_header_end(&response) else {
        return Ok(());
    };
    let (response_headers, response_body) = response.split_at(response_header_end + 4);
    let response_text = String::from_utf8_lossy(response_headers);
    let target_origin = format!("http://{target_host}:{target_port}");
    if should_inject_preview_console_bridge(&response_text) {
        let body = read_http_response_body(&mut remote, response_body, &response_text)?;
        let injected = inject_preview_console_bridge(&body, &target_host, target_port);
        let rewritten_response = rewrite_preview_response_headers(
            &response_text,
            Some(injected.len()),
            &target_origin,
            &proxy_origin,
            &target_host,
        );
        incoming.write_all(rewritten_response.as_bytes())?;
        incoming.write_all(&injected)?;
    } else {
        let rewritten_response = rewrite_preview_response_headers(
            &response_text,
            None,
            &target_origin,
            &proxy_origin,
            &target_host,
        );
        remote.set_read_timeout(None)?;
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
    proxy_origin: &str,
) -> std::io::Result<()> {
    let rewritten_request =
        rewrite_preview_upgrade_headers(request_headers, &target_host, target_port, proxy_origin);
    let mut remote = TcpStream::connect((target_host.as_str(), target_port))?;
    remote.set_nodelay(true)?;
    incoming.set_nodelay(true)?;
    incoming.set_read_timeout(None)?;
    incoming.set_write_timeout(None)?;
    remote.set_read_timeout(None)?;
    remote.set_write_timeout(None)?;
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

fn http_header_value(headers: &str, header_name: &str) -> Option<String> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case(header_name) {
            Some(value.trim().to_string())
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

fn rewrite_preview_request_headers(
    headers: &str,
    target_host: &str,
    target_port: u16,
    proxy_origin: &str,
) -> String {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("GET / HTTP/1.1").trim_end();
    let target_origin = format!("http://{target_host}:{target_port}");
    let mut rewritten = String::with_capacity(headers.len() + 128);
    rewritten.push_str(&rewrite_preview_request_line(
        request_line,
        &target_origin,
        proxy_origin,
    ));
    rewritten.push_str("\r\n");
    let mut saw_host = false;
    let mut saw_forwarded_host = false;
    let proxy_host = proxy_origin.trim_start_matches("http://");
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if header_name_is(name, "host") {
            saw_host = true;
            push_preview_host_header(&mut rewritten, target_host, target_port);
        } else if header_name_is(name, "origin") {
            push_preview_header(&mut rewritten, "Origin", &target_origin);
        } else if header_name_is(name, "referer") {
            rewritten.push_str("Referer: ");
            rewritten.push_str(&rewrite_preview_header_url(
                value.trim(),
                &target_origin,
                proxy_origin,
            ));
            rewritten.push_str("\r\n");
        } else if header_name_is(name, "x-forwarded-host") {
            saw_forwarded_host = true;
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
        } else if header_name_in(
            name,
            &[
                "if-none-match",
                "if-modified-since",
                "if-match",
                "if-unmodified-since",
                "if-range",
                "cache-control",
                "pragma",
            ],
        ) {
            continue;
        } else if header_name_in(name, &["connection", "proxy-connection", "accept-encoding"]) {
            continue;
        } else {
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
        }
    }
    if !saw_host {
        push_preview_host_header(&mut rewritten, target_host, target_port);
    }
    if !saw_forwarded_host && !proxy_host.is_empty() {
        push_preview_header(&mut rewritten, "X-Forwarded-Host", proxy_host);
        rewritten.push_str("X-Forwarded-Proto: http\r\n");
    }
    rewritten.push_str("Cache-Control: no-cache\r\n");
    rewritten.push_str("Pragma: no-cache\r\n");
    rewritten.push_str("Accept-Encoding: identity\r\n");
    rewritten.push_str("Connection: close\r\n\r\n");
    rewritten
}

fn rewrite_preview_upgrade_headers(
    headers: &str,
    target_host: &str,
    target_port: u16,
    proxy_origin: &str,
) -> String {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("GET / HTTP/1.1").trim_end();
    let target_origin = format!("http://{target_host}:{target_port}");
    let mut rewritten = String::with_capacity(headers.len() + 96);
    rewritten.push_str(&rewrite_preview_request_line(
        request_line,
        &target_origin,
        proxy_origin,
    ));
    rewritten.push_str("\r\n");
    let mut saw_host = false;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if header_name_is(name, "host") {
            saw_host = true;
            push_preview_host_header(&mut rewritten, target_host, target_port);
        } else if header_name_is(name, "origin") {
            push_preview_header(&mut rewritten, "Origin", &target_origin);
        } else if header_name_is(name, "referer") {
            rewritten.push_str("Referer: ");
            rewritten.push_str(&rewrite_preview_header_url(
                value.trim(),
                &target_origin,
                proxy_origin,
            ));
            rewritten.push_str("\r\n");
        } else if header_name_is(name, "proxy-connection") {
            continue;
        } else {
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
        }
    }
    if !saw_host {
        push_preview_host_header(&mut rewritten, target_host, target_port);
    }
    rewritten.push_str("\r\n");
    rewritten
}

fn rewrite_preview_request_line(
    request_line: &str,
    target_origin: &str,
    proxy_origin: &str,
) -> String {
    let mut parts = request_line.split_whitespace();
    let Some(method) = parts.next() else {
        return request_line.to_string();
    };
    let Some(uri_text) = parts.next() else {
        return request_line.to_string();
    };
    let Some(version) = parts.next() else {
        return request_line.to_string();
    };
    if parts.next().is_some() {
        return request_line.to_string();
    }
    let uri = if uri_text.starts_with(proxy_origin) {
        let path = uri_text.trim_start_matches(proxy_origin);
        if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        }
    } else if uri_text.starts_with(target_origin) {
        let path = uri_text.trim_start_matches(target_origin);
        if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        }
    } else {
        uri_text.to_string()
    };
    format!("{method} {uri} {version}")
}

fn rewrite_preview_header_url(value: &str, target_origin: &str, proxy_origin: &str) -> String {
    if let Some(path) = value.strip_prefix(proxy_origin) {
        let mut rewritten = String::with_capacity(target_origin.len() + path.len());
        rewritten.push_str(target_origin);
        rewritten.push_str(path);
        rewritten
    } else {
        value.to_string()
    }
}

fn rewrite_preview_location_url(value: &str, target_origin: &str, proxy_origin: &str) -> String {
    if let Some(path) = value.strip_prefix(target_origin) {
        let mut rewritten = String::with_capacity(proxy_origin.len() + path.len());
        rewritten.push_str(proxy_origin);
        rewritten.push_str(path);
        rewritten
    } else {
        value.to_string()
    }
}

fn rewrite_preview_response_headers(
    headers: &str,
    content_length: Option<usize>,
    target_origin: &str,
    proxy_origin: &str,
    target_host: &str,
) -> String {
    let mut lines = headers.lines();
    let status_line = lines
        .next()
        .unwrap_or("HTTP/1.1 502 Bad Gateway")
        .trim_end();
    let mut rewritten = String::with_capacity(headers.len() + 96);
    rewritten.push_str(status_line);
    rewritten.push_str("\r\n");
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            rewritten.push_str(line.trim_end());
            rewritten.push_str("\r\n");
            continue;
        };
        let name_trimmed = name.trim();
        if header_name_in(
            name_trimmed,
            &[
                "x-frame-options",
                "content-security-policy",
                "content-security-policy-report-only",
                "cross-origin-embedder-policy",
                "cross-origin-opener-policy",
                "cross-origin-resource-policy",
                "permissions-policy",
            ],
        ) {
            continue;
        }
        if header_name_in(
            name_trimmed,
            &[
                "cache-control",
                "etag",
                "expires",
                "pragma",
                "last-modified",
            ],
        ) {
            continue;
        }
        if content_length.is_some()
            && header_name_in(name_trimmed, &["content-length", "transfer-encoding"])
        {
            continue;
        }
        if header_name_is(name_trimmed, "location") {
            rewritten.push_str(name.trim_end());
            rewritten.push_str(": ");
            rewritten.push_str(&rewrite_preview_location_url(
                value.trim(),
                target_origin,
                proxy_origin,
            ));
            rewritten.push_str("\r\n");
            continue;
        }
        if header_name_is(name_trimmed, "access-control-allow-origin") {
            rewritten.push_str("Access-Control-Allow-Origin: ");
            rewritten.push_str(proxy_origin);
            rewritten.push_str("\r\n");
            continue;
        }
        if header_name_is(name_trimmed, "set-cookie") {
            rewritten.push_str(name.trim_end());
            rewritten.push_str(": ");
            rewritten.push_str(&strip_preview_cookie_domain(value.trim(), target_host));
            rewritten.push_str("\r\n");
            continue;
        }
        rewritten.push_str(line.trim_end());
        rewritten.push_str("\r\n");
    }
    rewritten.push_str("Cache-Control: no-store, no-cache, max-age=0, must-revalidate\r\n");
    rewritten.push_str("Pragma: no-cache\r\n");
    rewritten.push_str("Expires: 0\r\n");
    if let Some(length) = content_length {
        push_usize_header(&mut rewritten, "Content-Length", length);
    }
    rewritten.push_str("\r\n");
    rewritten
}

fn push_preview_host_header(output: &mut String, target_host: &str, target_port: u16) {
    output.push_str("Host: ");
    output.push_str(target_host);
    output.push(':');
    let _ = write!(output, "{target_port}");
    output.push_str("\r\n");
}

fn push_preview_header(output: &mut String, name: &str, value: &str) {
    output.push_str(name);
    output.push_str(": ");
    output.push_str(value);
    output.push_str("\r\n");
}

fn push_usize_header(output: &mut String, name: &str, value: usize) {
    output.push_str(name);
    output.push_str(": ");
    let _ = write!(output, "{value}");
    output.push_str("\r\n");
}

fn header_name_is(name: &str, expected: &str) -> bool {
    name.trim().eq_ignore_ascii_case(expected)
}

fn header_name_in(name: &str, expected: &[&str]) -> bool {
    expected.iter().any(|item| header_name_is(name, item))
}

fn strip_preview_cookie_domain(value: &str, target_host: &str) -> String {
    let mut rewritten = String::with_capacity(value.len());
    for part in value.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty()
            || header_name_is(trimmed, "secure")
            || should_strip_preview_cookie_domain(trimmed, target_host)
        {
            continue;
        }
        if !rewritten.is_empty() {
            rewritten.push_str("; ");
        }
        if cookie_attribute_is(trimmed, "samesite", "none") {
            rewritten.push_str("SameSite=Lax");
        } else {
            rewritten.push_str(trimmed);
        }
    }
    rewritten
}

fn should_strip_preview_cookie_domain(attribute: &str, target_host: &str) -> bool {
    let Some((name, value)) = attribute.split_once('=') else {
        return false;
    };
    if !name.trim().eq_ignore_ascii_case("domain") {
        return false;
    }
    let domain = value.trim();
    domain.eq_ignore_ascii_case(target_host) || domain.eq_ignore_ascii_case("localhost")
}

fn cookie_attribute_is(attribute: &str, expected_name: &str, expected_value: &str) -> bool {
    let Some((name, value)) = attribute.split_once('=') else {
        return false;
    };
    name.trim().eq_ignore_ascii_case(expected_name)
        && value.trim().eq_ignore_ascii_case(expected_value)
}

#[cfg(test)]
mod preview_proxy_tests {
    use super::*;
    use std::sync::mpsc;

    fn spawn_one_request_target() -> (u16, mpsc::Receiver<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("target listener");
        let port = listener.local_addr().expect("target addr").port();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("target accept");
            let request = read_http_headers(&mut stream, 64 * 1024).expect("target read");
            let text = String::from_utf8_lossy(&request).to_string();
            sender.send(text).expect("target send");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .expect("target write");
        });
        (port, receiver)
    }

    fn spawn_one_request_proxy(target_port: u16) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("proxy listener");
        let port = listener.local_addr().expect("proxy addr").port();
        thread::spawn(move || {
            let (stream, _) = listener.accept().expect("proxy accept");
            match proxy_http_preview(stream, "127.0.0.1".to_string(), target_port) {
                Ok(()) => {}
                Err(err)
                    if matches!(
                        err.kind(),
                        std::io::ErrorKind::BrokenPipe
                            | std::io::ErrorKind::ConnectionReset
                            | std::io::ErrorKind::UnexpectedEof
                    ) => {}
                Err(err) => panic!("proxy: {err}"),
            }
        });
        port
    }

    #[test]
    fn preview_proxy_rewrites_socket_io_polling_origin_to_target() {
        let (target_port, target_request) = spawn_one_request_target();
        let proxy_port = spawn_one_request_proxy(target_port);
        let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).expect("client connect");
        let request = format!(
            "GET /socket.io/?EIO=4&transport=polling HTTP/1.1\r\n\
Host: 127.0.0.1:{proxy_port}\r\n\
Origin: http://127.0.0.1:{proxy_port}\r\n\
Referer: http://127.0.0.1:{proxy_port}/test.html\r\n\
Connection: close\r\n\r\n"
        );
        client.write_all(request.as_bytes()).expect("client write");
        let received = target_request
            .recv_timeout(Duration::from_secs(3))
            .expect("target received request");

        assert!(received.contains(&format!("Host: 127.0.0.1:{target_port}")));
        assert!(received.contains(&format!("Origin: http://127.0.0.1:{target_port}")));
        assert!(received.contains(&format!(
            "Referer: http://127.0.0.1:{target_port}/test.html"
        )));
        assert!(!received.contains(&format!("Origin: http://127.0.0.1:{proxy_port}")));
    }

    #[test]
    fn preview_cookie_rewrite_keeps_loopback_auth_cookies_usable() {
        let rewritten = strip_preview_cookie_domain(
            "sid=abc; Domain=127.0.0.1; Path=/; SameSite=None; Secure; HttpOnly",
            "127.0.0.1",
        );

        assert_eq!(rewritten, "sid=abc; Path=/; SameSite=Lax; HttpOnly");
    }

    #[test]
    fn preview_html_injection_skips_partial_content() {
        assert!(!should_inject_preview_console_bridge(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: text/html\r\nContent-Range: bytes 0-9/100\r\n\r\n"
        ));
        assert!(should_inject_preview_console_bridge(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
        ));
    }

    #[test]
    fn preview_proxy_request_strips_cache_validators() {
        let rewritten = rewrite_preview_request_headers(
            "GET /main.dart.js HTTP/1.1\r\n\
Host: 127.0.0.1:12547\r\n\
If-None-Match: \"abc\"\r\n\
If-Modified-Since: Mon, 01 Jan 2024 00:00:00 GMT\r\n\
Cache-Control: max-age=0\r\n\
Pragma: no-cache\r\n\
Connection: keep-alive\r\n\r\n",
            "127.0.0.1",
            8080,
            "http://127.0.0.1:12547",
        );

        assert!(rewritten.contains("Host: 127.0.0.1:8080\r\n"));
        assert!(!rewritten.to_ascii_lowercase().contains("if-none-match"));
        assert!(!rewritten.to_ascii_lowercase().contains("if-modified-since"));
        assert!(rewritten.contains("Cache-Control: no-cache\r\n"));
        assert!(rewritten.contains("Accept-Encoding: identity\r\n"));
        assert!(rewritten.contains("Connection: close\r\n"));
    }

    #[test]
    fn preview_proxy_response_disables_asset_cache_validators() {
        let rewritten = rewrite_preview_response_headers(
            "HTTP/1.1 200 OK\r\n\
Content-Type: application/javascript\r\n\
Content-Length: 42\r\n\
Cache-Control: public, max-age=3600\r\n\
ETag: \"abc\"\r\n\
Last-Modified: Mon, 01 Jan 2024 00:00:00 GMT\r\n\
Expires: Tue, 02 Jan 2024 00:00:00 GMT\r\n\r\n",
            None,
            "http://127.0.0.1:8080",
            "http://127.0.0.1:12547",
            "127.0.0.1",
        );

        let lower = rewritten.to_ascii_lowercase();
        assert!(rewritten.contains("Content-Length: 42\r\n"));
        assert!(!lower.contains("etag:"));
        assert!(!lower.contains("last-modified:"));
        assert!(!lower.contains("cache-control: public"));
        assert!(
            rewritten.contains("Cache-Control: no-store, no-cache, max-age=0, must-revalidate\r\n")
        );
        assert!(rewritten.contains("Pragma: no-cache\r\n"));
        assert!(rewritten.contains("Expires: 0\r\n"));
    }
}

fn should_inject_preview_console_bridge(headers: &str) -> bool {
    let mut html = false;
    let mut encoded = false;
    let mut cacheable_success = false;
    let mut partial = false;
    if let Some(status) = headers.lines().next() {
        let code = status.split_whitespace().nth(1).unwrap_or_default();
        cacheable_success = code.starts_with('2') && code != "206";
    }
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-type")
            && find_ascii_case_insensitive(value.as_bytes(), b"text/html").is_some()
        {
            html = true;
        }
        if name.trim().eq_ignore_ascii_case("content-encoding")
            && !value.trim().eq_ignore_ascii_case("identity")
        {
            encoded = true;
        }
        if name.trim().eq_ignore_ascii_case("content-range") {
            partial = true;
        }
    }
    cacheable_success && html && !encoded && !partial
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

fn inject_preview_console_bridge(body: &[u8], target_host: &str, target_port: u16) -> Vec<u8> {
    let script = preview_console_bridge_script(target_host, target_port);
    let insert_at = html_injection_index(body).unwrap_or(0);
    inject_bytes_at(body, insert_at, script.as_bytes())
}

fn html_injection_index(body: &[u8]) -> Option<usize> {
    html_tag_close_index(body, b"<head").or_else(|| html_tag_close_index(body, b"<body"))
}

fn html_tag_close_index(body: &[u8], tag: &[u8]) -> Option<usize> {
    let start = find_ascii_case_insensitive(body, tag)?;
    let close = body[start..].iter().position(|byte| *byte == b'>')?;
    Some(start + close + 1)
}

fn find_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    if needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| {
        window
            .iter()
            .zip(needle.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}

fn inject_bytes_at(body: &[u8], index: usize, insert: &[u8]) -> Vec<u8> {
    let insert_at = index.min(body.len());
    let mut output = Vec::with_capacity(body.len() + insert.len());
    output.extend_from_slice(&body[..insert_at]);
    output.extend_from_slice(insert);
    output.extend_from_slice(&body[insert_at..]);
    output
}

fn preview_console_bridge_script(target_host: &str, target_port: u16) -> String {
    let target_origin = format!("http://{target_host}:{target_port}");
    let mut script =
        format!("<script>\nwindow.__simpleVibePreviewTargetOrigin = {target_origin:?};\n");
    script.push_str(r#"
(function () {
  if (window.__simpleVibeConsoleBridge) return;
  window.__simpleVibeConsoleBridge = true;
  window.__simpleVibeConsoleDetailed = false;
  window.addEventListener('message', function (event) {
    try {
      var data = event && event.data;
      if (!data || typeof data !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(data, '__simpleVibeConsoleDetailed')) {
        window.__simpleVibeConsoleDetailed = !!data.__simpleVibeConsoleDetailed;
      }
    } catch (_) {}
  });
  function compact(value) {
    if (typeof value === 'string') return value;
    if (value == null) return String(value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return '[Array(' + value.length + ')]';
    if (typeof value === 'object') {
      try {
        var keys = [];
        for (var key in value) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
          keys.push(key);
          if (keys.length >= 6) break;
        }
        return keys.length ? '{' + keys.join(',') + '}' : '{}';
      } catch (_) {
        return '[Object]';
      }
    }
    return String(value);
  }
  function format(value, compactMode) {
    try {
      if (typeof value === 'string') return value;
      if (value instanceof Error) {
        if (compactMode || !window.__simpleVibeConsoleDetailed) return value.message || String(value);
        return value.stack || value.message || String(value);
      }
      if (compactMode || !window.__simpleVibeConsoleDetailed) return compact(value);
      return JSON.stringify(value) || String(value);
    } catch (_) {
      return String(value);
    }
  }
  var consoleQueue = [];
  var consoleFlushTimer = 0;
  function consoleFlushDelay() {
    return window.__simpleVibeConsoleDetailed ? 16 : 220;
  }
  function consoleFlushLimit() {
    return window.__simpleVibeConsoleDetailed ? 64 : 80;
  }
  function flushConsoleQueue() {
    try {
      if (consoleFlushTimer) {
        clearTimeout(consoleFlushTimer);
        consoleFlushTimer = 0;
      }
      if (!consoleQueue.length) return;
      var batch = [];
      for (var index = 0; index < consoleQueue.length; index++) {
        var item = consoleQueue[index];
        if (item && item.rawArgs) {
          var payload = formatConsoleArgs(item.rawArgs, true, item.argCount);
          batch.push({ level: item.level, args: payload.args, argCount: payload.argCount });
        } else {
          batch.push(item);
        }
      }
      consoleQueue = [];
      window.parent.postMessage({ __simpleVibeConsoleBatch: batch }, '*');
    } catch (_) {
      consoleQueue = [];
      consoleFlushTimer = 0;
    }
  }
  function scheduleConsoleFlush() {
    if (consoleFlushTimer) return;
    consoleFlushTimer = setTimeout(flushConsoleQueue, consoleFlushDelay());
  }
  function formatConsoleArgs(args, compactMode, explicitTotal) {
    var total = explicitTotal === undefined ? args.length || 0 : explicitTotal;
    var limit = Math.min(total, 8);
    var formatted = [];
    for (var index = 0; index < limit; index++) {
      formatted.push(format(args[index], !!compactMode));
    }
    return { args: formatted, argCount: total };
  }
  function queueRawConsoleArgs(level, args) {
    var total = args.length || 0;
    var limit = Math.min(total, 8);
    var raw = [];
    for (var index = 0; index < limit; index++) raw.push(args[index]);
    consoleQueue.push({ level: level, rawArgs: raw, argCount: total });
    var keep = consoleFlushLimit();
    if (consoleQueue.length > keep) consoleQueue.splice(0, consoleQueue.length - keep);
  }
  function send(level, args) {
    try {
      if (window.__simpleVibeConsoleDetailed) {
        var payload = formatConsoleArgs(args, false);
        consoleQueue.push({ level: level, args: payload.args, argCount: payload.argCount });
        if (consoleQueue.length >= consoleFlushLimit()) flushConsoleQueue();
        else scheduleConsoleFlush();
      } else {
        queueRawConsoleArgs(level, args);
        scheduleConsoleFlush();
      }
    } catch (_) {}
  }
  window.addEventListener('contextmenu', function (event) {
    try {
      event.preventDefault();
      window.parent.postMessage({ __simpleVibeContextMenu: { x: event.clientX, y: event.clientY } }, '*');
    } catch (_) {}
  });
  function previewZoomShortcutAction(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return 0;
    if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') return 1;
    if (event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') return -1;
    if (event.code === 'Digit0' || event.code === 'Numpad0' || event.key === '0') return 'reset';
    return 0;
  }
  window.addEventListener('keydown', function (event) {
    var zoomAction = previewZoomShortcutAction(event);
    if (zoomAction) {
      try {
        event.preventDefault();
        window.parent.postMessage({
          __simpleVibeZoom: zoomAction === 'reset'
            ? { reset: true }
            : { direction: zoomAction }
        }, '*');
      } catch (_) {}
      return;
    }
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
  function makePopupProxy(initialUrl) {
    var closed = false;
    var currentUrl = initialUrl ? String(initialUrl) : 'about:blank';
    function navigate(url) {
      if (!url) return;
      currentUrl = String(url);
      sendOpenUrl(currentUrl);
    }
    var locationProxy = {
      assign: navigate,
      replace: navigate,
      reload: function () { sendOpenUrl(currentUrl); },
      toString: function () { return currentUrl; }
    };
    try {
      Object.defineProperty(locationProxy, 'href', {
        get: function () { return currentUrl; },
        set: function (value) { navigate(value); }
      });
    } catch (_) {}
    var popup = {
      focus: function () {},
      blur: function () {},
      close: function () { closed = true; },
      postMessage: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      document: { write: function () {}, close: function () {} }
    };
    try {
      Object.defineProperty(popup, 'closed', { get: function () { return closed; } });
      Object.defineProperty(popup, 'location', {
        get: function () { return locationProxy; },
        set: function (value) { navigate(value); }
      });
    } catch (_) {
      popup.closed = false;
      popup.location = locationProxy;
    }
    return popup;
  }
  window.open = function (url, target, features) {
    if (url) sendOpenUrl(url);
    return makePopupProxy(url);
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
  var reportedPreviewAssetFailures = {};
  function reportPreviewAssetFailure(kind, target) {
    try {
      if (!target) return false;
      var tag = String(target.tagName || 'resource').toLowerCase();
      var url = target.href || target.src || target.currentSrc || '';
      if (!url) return false;
      var key = kind + ':' + tag + ':' + url;
      if (reportedPreviewAssetFailures[key]) return true;
      reportedPreviewAssetFailures[key] = true;
      send('warn', ['Resource failed', tag, url]);
      window.parent.postMessage({
        __simpleVibePreviewAssetFailure: { kind: kind, tag: tag, url: url }
      }, '*');
      return true;
    } catch (_) {
      return false;
    }
  }
  function targetLooksLikePreviewAsset(target) {
    if (!target || !target.tagName) return false;
    var tag = String(target.tagName).toLowerCase();
    if (tag === 'script' || tag === 'img' || tag === 'source' || tag === 'video' || tag === 'audio') return true;
    if (tag === 'link') {
      var rel = String(target.rel || '').toLowerCase();
      return rel.indexOf('stylesheet') >= 0 || rel.indexOf('preload') >= 0 || rel.indexOf('modulepreload') >= 0;
    }
    return false;
  }
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (targetLooksLikePreviewAsset(target) && reportPreviewAssetFailure('error', target)) return;
    send('error', [event.message || 'Script error']);
  }, true);
  function checkStylesheetHealth() {
    try {
      var links = Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"]'))
        .filter(function (link) { return !link.disabled && link.href; });
      if (!links.length) return;
      var loaded = 0;
      for (var index = 0; index < links.length; index++) {
        if (links[index].sheet) loaded += 1;
      }
      if (loaded === 0) reportPreviewAssetFailure('missing-stylesheet', links[0]);
    } catch (_) {}
  }
  if (document.readyState === 'complete') {
    setTimeout(checkStylesheetHealth, 700);
  } else {
    window.addEventListener('load', function () { setTimeout(checkStylesheetHealth, 700); }, { once: true });
  }
  window.addEventListener('unhandledrejection', function (event) {
    send('error', ['Unhandled promise rejection', event.reason]);
  });
  function installRuntimeDiagnostics() {
    if (window.fetch && !window.fetch.__simpleVibePreviewPatched) {
      var nativeFetch = window.fetch;
      window.fetch = function () {
        var args = arguments;
        return nativeFetch.apply(this, args).catch(function (error) {
          send('error', ['Fetch failed', args[0], error]);
          throw error;
        });
      };
      window.fetch.__simpleVibePreviewPatched = true;
    }
    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype && !window.XMLHttpRequest.prototype.__simpleVibePreviewPatched) {
      var nativeXhrOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function (method, url) {
        this.__simpleVibePreviewUrl = url;
        if (!this.__simpleVibePreviewBound) {
          this.__simpleVibePreviewBound = true;
          this.addEventListener('error', function () { send('error', ['XHR failed', this.__simpleVibePreviewUrl]); });
          this.addEventListener('timeout', function () { send('error', ['XHR timed out', this.__simpleVibePreviewUrl]); });
          this.addEventListener('abort', function () { send('warn', ['XHR aborted', this.__simpleVibePreviewUrl]); });
        }
        return nativeXhrOpen.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.__simpleVibePreviewPatched = true;
    }
    if (window.EventSource && !window.EventSource.__simpleVibePreviewPatched) {
      var NativeEventSource = window.EventSource;
      window.EventSource = function (url, config) {
        var source = config === undefined ? new NativeEventSource(url) : new NativeEventSource(url, config);
        source.addEventListener('error', function () {
          send('warn', ['EventSource connection issue', url]);
        });
        return source;
      };
      window.EventSource.prototype = NativeEventSource.prototype;
      Object.setPrototypeOf(window.EventSource, NativeEventSource);
      ['CONNECTING', 'OPEN', 'CLOSED'].forEach(function (key) { window.EventSource[key] = NativeEventSource[key]; });
      window.EventSource.__simpleVibePreviewPatched = true;
    }
    if (window.WebSocket && !window.WebSocket.__simpleVibePreviewPatched) {
      var NativeWebSocket = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        var socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        socket.addEventListener('error', function () {
          send('error', ["WebSocket connection to '" + String(url) + "' failed."]);
        });
        socket.addEventListener('close', function (event) {
          if (!event.wasClean && event.code !== 1000) {
            send('warn', ["WebSocket connection to '" + String(url) + "' closed (" + event.code + ")."]);
          }
        });
        return socket;
      };
      window.WebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(window.WebSocket, NativeWebSocket);
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) { window.WebSocket[key] = NativeWebSocket[key]; });
      window.WebSocket.__simpleVibePreviewPatched = true;
    }
  }
  installRuntimeDiagnostics();
  var previewTargetOrigin = window.__simpleVibePreviewTargetOrigin || '';
  function simpleVibeSocketIoUrl(url) {
    try {
      if (!previewTargetOrigin) return url;
      if (url === undefined || url === null || url === '') return previewTargetOrigin;
      if (typeof url !== 'string' && !(url instanceof URL)) return url;
      var parsed = new URL(String(url), window.location.href);
      if (parsed.origin !== window.location.origin) return url;
      var target = new URL(previewTargetOrigin);
      parsed.protocol = target.protocol;
      parsed.host = target.host;
      return parsed.href;
    } catch (_) {
      return url;
    }
  }
  function copySocketIoStatics(source, target) {
    try {
      Object.getOwnPropertyNames(source).forEach(function (key) {
        if (key === 'length' || key === 'name' || key === 'prototype') return;
        try {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        } catch (_) {
          try { target[key] = source[key]; } catch (_) {}
        }
      });
    } catch (_) {}
  }
  function patchSocketIoFactory(factory) {
    if (typeof factory !== 'function' || factory.__simpleVibePreviewPatched) return factory;
    function wrappedSocketIo(url, options) {
      if (arguments.length === 1 && url && typeof url === 'object' && !(url instanceof URL)) {
        send('info', ['Socket.IO preview target ' + String(previewTargetOrigin || window.location.origin)]);
        return factory.call(this, previewTargetOrigin || undefined, url);
      }
      var mappedUrl = simpleVibeSocketIoUrl(url);
      if (arguments.length === 0) return factory.call(this, mappedUrl);
      if (mappedUrl !== url) send('info', ['Socket.IO preview target ' + String(mappedUrl)]);
      return factory.call(this, mappedUrl, options);
    }
    copySocketIoStatics(factory, wrappedSocketIo);
    wrappedSocketIo.__simpleVibePreviewPatched = true;
    wrappedSocketIo.io = wrappedSocketIo;
    wrappedSocketIo.connect = wrappedSocketIo;
    return wrappedSocketIo;
  }
  function installSocketIoPatch() {
    var current;
    try { current = window.io; } catch (_) {}
    try {
      Object.defineProperty(window, 'io', {
        configurable: true,
        get: function () { return current; },
        set: function (value) { current = patchSocketIoFactory(value); }
      });
      if (current) window.io = current;
    } catch (_) {
      if (current) window.io = patchSocketIoFactory(current);
    }
  }
  installSocketIoPatch();
})();
</script>"#);
    script
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

fn drain_complete_utf8(buffer: &mut Vec<u8>) -> String {
    if buffer.is_empty() {
        return String::new();
    }
    let split = match std::str::from_utf8(buffer) {
        Ok(_) => buffer.len(),
        Err(err) if err.error_len().is_none() => err.valid_up_to(),
        Err(_) => buffer.len(),
    };
    if split == 0 {
        return String::new();
    }
    let decoded = String::from_utf8_lossy(&buffer[..split]).to_string();
    buffer.drain(..split);
    decoded
}

fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn powershell_encoded_command(script: &str) -> String {
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn join_posix(base: &str, child: &str) -> String {
    if child.starts_with('/') || child.starts_with('~') {
        child.to_string()
    } else if base.ends_with('/') {
        let mut joined = String::with_capacity(base.len() + child.len());
        joined.push_str(base);
        joined.push_str(child);
        joined
    } else {
        let mut joined = String::with_capacity(base.len() + child.len() + 1);
        joined.push_str(base);
        joined.push('/');
        joined.push_str(child);
        joined
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

pub fn run_ssh_askpass_helper() -> i32 {
    let prompt = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let port = match std::env::var("SVIDE_ASKPASS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
    {
        Some(port) => port,
        None => return 1,
    };
    let token = match std::env::var("SVIDE_ASKPASS_TOKEN") {
        Ok(token) if !token.is_empty() => token,
        _ => return 1,
    };
    let profile_id = std::env::var("SVIDE_ASKPASS_PROFILE").unwrap_or_default();
    let alias = std::env::var("SVIDE_ASKPASS_ALIAS").unwrap_or_default();
    match run_ssh_askpass_helper_request(port, token, prompt, profile_id, alias) {
        Ok(secret) => {
            print!("{secret}");
            if !secret.ends_with('\n') {
                println!();
            }
            let _ = std::io::stdout().flush();
            0
        }
        Err(_) => 1,
    }
}

fn run_ssh_askpass_helper_request(
    port: u16,
    token: String,
    prompt: String,
    profile_id: String,
    alias: String,
) -> std::io::Result<String> {
    let request = SshAskpassHttpRequestOut {
        token,
        prompt,
        profile_id,
        alias,
    };
    let body = serde_json::to_string(&request)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string()))?;
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    let http_request = format!(
        "POST /ssh-askpass HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    stream.write_all(http_request.as_bytes())?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let Some(header_end) = find_http_header_end(&response) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "missing askpass response headers",
        ));
    };
    let headers = String::from_utf8_lossy(&response[..header_end]);
    let status_ok = headers
        .lines()
        .next()
        .map(|line| line.contains(" 200 "))
        .unwrap_or(false);
    if !status_ok {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "askpass request rejected",
        ));
    }
    Ok(String::from_utf8_lossy(&response[header_end + 4..]).to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(IdeState::default())
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            list_wsl_profiles,
            windows_shell_root,
            answer_ssh_auth_prompt,
            renderer_heartbeat,
            send_agent_alert,
            agent_bridge_info,
            register_agent_bridge_session,
            list_llm_tmux_sessions,
            next_llm_tmux_session,
            kill_llm_tmux_session,
            llm_tmux_pane_title,
            llm_tmux_pane_probe,
            read_snippets_store,
            write_snippets_store,
            set_capture_protection,
            force_quit_app,
            resolve_profile_path,
            list_directory,
            list_directories,
            directory_signatures,
            read_text_file,
            file_signature,
            read_file_data_url,
            write_text_file,
            create_directory,
            create_file,
            rename_path,
            delete_paths,
            restore_deleted_paths,
            delete_note_file_permanently,
            open_path,
            run_powershell_script_as_admin,
            read_clipboard_file_paths,
            save_clipboard_image_file,
            copy_dropped_files,
            copy_profile_paths,
            start_export_path,
            cancel_export_path,
            open_export_path,
            save_attachment,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            start_port_forward,
            probe_local_http_url,
            start_preview_proxy,
            show_browser_webview,
            hide_browser_webview,
            close_browser_webview,
            reload_browser_webview,
            start_edge_devtools_session,
            edge_devtools_new_page,
            edge_devtools_activate_page,
            edge_devtools_close_page,
            stop_edge_devtools_session,
            stop_port_forward,
            shutdown_runtime_sessions_command
        ])
        .setup(|app| {
            let Some(window) = main_webview_window(app.handle()) else {
                eprintln!("main window was not available during setup");
                return Ok(());
            };
            let app_handle = app.handle().clone();
            let product_name = app
                .config()
                .product_name
                .clone()
                .unwrap_or_else(|| "Simple Vibe IDE".to_string());
            start_ssh_askpass_server(app_handle.clone());
            start_renderer_watchdog(app_handle.clone());
            show_window_on_primary_monitor(&window);
            CAPTURE_PROTECTION_ACTIVE.store(false, Ordering::Relaxed);
            #[cfg(windows)]
            if let Ok(hwnd) = window.hwnd() {
                remember_main_hwnd(hwnd);
            }
            let _ = set_window_capture_protection(&window, false);
            close_capture_cover(&app_handle);
            let app_for_events = app_handle.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { .. } => {
                    request_app_exit(app_for_events.clone());
                }
                WindowEvent::Destroyed => {
                    shutdown_app_runtime(&app_for_events);
                }
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
            if let Err(error) = window.set_title(&product_name) {
                eprintln!("failed to set main window title: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Simple Vibe app")
        .run(|app_handle, event| {
            // Guarantee child processes (terminals, ssh/wsl, port forwards,
            // Edge devtools) are detached from app state on every exit path,
            // but do not block the window/app close path on taskkill/wait.
            // The Windows cleanup Job Object is the hard guarantee if the
            // process exits before the background worker finishes.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_app_runtime(app_handle);
            }
        });
}
