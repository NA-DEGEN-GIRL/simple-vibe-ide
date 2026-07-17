import { invoke } from '@tauri-apps/api/core';
import type { AgentAlertPayload, AgentAlertResult, AgentBridgeInfo, AttachmentResult, ConnectionProfile, DeletedPathItem, DirectoryListingResult, DirectorySignatureResult, EdgeDevtoolsPage, EdgeDevtoolsSession, ExportStartResult, FileEntry, LlmTmuxPaneProbeResult, LlmTmuxPaneTitleResult, LlmTmuxSessionListResult, PortForwardResult, PreviewProxyResult, RegisterAgentBridgeSessionPayload, RendererHeartbeatResponse } from './types';

// Each WebView generation receives a backend-issued token during init. Keeping
// it inside this module means every persistent runtime start is automatically
// tied to the renderer that requested it, including promises dispatched late
// after a WebView reload.
let rendererRuntimeEpoch = 0;

export interface MainWebviewBoundsRefreshResult {
  applied: boolean;
  mismatched: boolean;
}

export const api = {
  listProfiles: () => invoke<ConnectionProfile[]>('list_profiles'),
  listWslProfiles: () => invoke<ConnectionProfile[]>('list_wsl_profiles'),
  windowsShellRoot: () => invoke<string>('windows_shell_root'),
  answerSshAuthPrompt: (id: string, secret: string | null) =>
    invoke<void>('answer_ssh_auth_prompt', { id, secret }),
  setCaptureProtection: (enabled: boolean) =>
    invoke<void>('set_capture_protection', { enabled }),
  refreshMainWebviewBounds: (force = false) =>
    invoke<MainWebviewBoundsRefreshResult>('refresh_main_webview_bounds', { force }),
  rendererHeartbeat: () => invoke<RendererHeartbeatResponse>('renderer_heartbeat'),
  readSnippetsStore: () => invoke<string>('read_snippets_store'),
  writeSnippetsStore: (payload: string) => invoke<void>('write_snippets_store', { payload }),
  forceQuitApp: () => invoke<void>('force_quit_app'),
  sendAgentAlert: (payload: AgentAlertPayload) => invoke<AgentAlertResult>('send_agent_alert', { payload }),
  agentBridgeInfo: () => invoke<AgentBridgeInfo>('agent_bridge_info'),
  registerAgentBridgeSession: (payload: RegisterAgentBridgeSessionPayload) =>
    invoke<void>('register_agent_bridge_session', { payload }),
  listLlmTmuxSessions: (profileId: string, cwd: string, workspaceId: string, agentId: string) =>
    invoke<LlmTmuxSessionListResult>('list_llm_tmux_sessions', { profileId, cwd, workspaceId, agentId }),
  nextLlmTmuxSession: (profileId: string, cwd: string, workspaceId: string, agentId: string) =>
    invoke<string>('next_llm_tmux_session', { profileId, cwd, workspaceId, agentId }),
  killLlmTmuxSession: (profileId: string, cwd: string, sessionName: string) =>
    invoke<void>('kill_llm_tmux_session', { profileId, cwd, sessionName }),
  llmTmuxPaneTitle: (profileId: string, cwd: string, sessionName: string) =>
    invoke<LlmTmuxPaneTitleResult>('llm_tmux_pane_title', { profileId, cwd, sessionName }),
  llmTmuxPaneProbe: (profileId: string, cwd: string, sessionName: string) =>
    invoke<LlmTmuxPaneProbeResult>('llm_tmux_pane_probe', { profileId, cwd, sessionName }),
  resolveProfilePath: (profileId: string, path: string, operationId: string = crypto.randomUUID()) =>
    invoke<string>('resolve_profile_path', { profileId, path, operationId, rendererRuntimeEpoch }),
  profileDirectoryIsDir: (profileId: string, path: string) =>
    invoke<boolean>('profile_directory_is_dir', { profileId, path }),
  listDirectory: (
    profileId: string,
    path: string,
    includeSizes = true,
    operationId: string = crypto.randomUUID()
  ) => invoke<FileEntry[]>('list_directory', { profileId, path, includeSizes, operationId, rendererRuntimeEpoch }),
  listDirectories: (
    profileId: string,
    paths: string[],
    includeSizes = true,
    operationId: string = crypto.randomUUID()
  ) => invoke<DirectoryListingResult[]>('list_directories', {
    profileId,
    paths,
    includeSizes,
    operationId,
    rendererRuntimeEpoch
  }),
  directorySignatures: (
    profileId: string,
    paths: string[],
    includeSizes = true,
    operationId: string = crypto.randomUUID()
  ) => invoke<DirectorySignatureResult[]>('directory_signatures', {
    profileId,
    paths,
    includeSizes,
    operationId,
    rendererRuntimeEpoch
  }),
  readTextFile: (profileId: string, path: string) =>
    invoke<string>('read_text_file', { profileId, path }),
  fileSignature: (profileId: string, path: string) =>
    invoke<string>('file_signature', { profileId, path }),
  readFileDataUrl: (profileId: string, path: string) =>
    invoke<string>('read_file_data_url', { profileId, path }),
  writeTextFile: (profileId: string, path: string, content: string) =>
    invoke<void>('write_text_file', { profileId, path, content }),
  createDirectory: (profileId: string, path: string) =>
    invoke<void>('create_directory', { profileId, path }),
  createFile: (profileId: string, path: string) =>
    invoke<void>('create_file', { profileId, path }),
  renamePath: (profileId: string, oldPath: string, newPath: string) =>
    invoke<void>('rename_path', { profileId, oldPath, newPath }),
  deletePaths: (profileId: string, paths: string[]) =>
    invoke<DeletedPathItem[]>('delete_paths', { profileId, paths }),
  restoreDeletedPaths: (profileId: string, items: DeletedPathItem[]) =>
    invoke<void>('restore_deleted_paths', { profileId, items }),
  deleteNoteFilePermanently: (profileId: string, path: string) =>
    invoke<void>('delete_note_file_permanently', { profileId, path }),
  openPath: (profileId: string, path: string) =>
    invoke<void>('open_path', { profileId, path }),
  openLocalhostPort: (port: number) => invoke<void>('open_localhost_port', { port }),
  runPowerShellScriptAsAdmin: (profileId: string, path: string) =>
    invoke<void>('run_powershell_script_as_admin', { profileId, path }),
  readClipboardFilePaths: () => invoke<string[]>('read_clipboard_file_paths'),
  saveClipboardImageFile: (profileId: string, targetDir: string, fileName: string, base64Data: string) =>
    invoke<string>('save_clipboard_image_file', { profileId, targetDir, fileName, base64Data }),
  copyDroppedFiles: (profileId: string, targetDir: string, sourcePaths: string[]) =>
    invoke<number>('copy_dropped_files', { profileId, targetDir, sourcePaths }),
  copyProfilePaths: (profileId: string, sourcePaths: string[], targetDir: string) =>
    invoke<string[]>('copy_profile_paths', { profileId, sourcePaths, targetDir }),
  startExportPath: (profileId: string, path: string) =>
    invoke<ExportStartResult>('start_export_path', { profileId, path, rendererRuntimeEpoch }),
  cancelExportPath: (id: string) => invoke<void>('cancel_export_path', { id }),
  openExportPath: (path: string) => invoke<void>('open_export_path', { path }),
  saveAttachment: (
    profileId: string,
    currentDir: string,
    sessionId: string,
    fileName: string,
    base64Data: string
  ) =>
    invoke<AttachmentResult>('save_attachment', {
      profileId,
      currentDir,
      sessionId,
      fileName,
      base64Data
    }),
  spawnTerminal: (
    profileId: string,
    cwd: string,
    command: string | null,
    rows: number,
    cols: number,
    workspaceId = '',
    title = 'shell',
    shellHistoryId = '',
    operationId: string = crypto.randomUUID()
  ) =>
    invoke<string>('spawn_terminal', {
      profileId,
      cwd,
      command,
      rows,
      cols,
      workspaceId,
      title,
      shellHistoryId,
      operationId,
      rendererRuntimeEpoch
    }),
  writeTerminal: (id: string, data: string) => invoke<void>('write_terminal', { id, data }),
  flushTerminalInput: (id: string) => invoke<void>('flush_terminal_input', { id }),
  resizeTerminal: (id: string, rows: number, cols: number) =>
    invoke<void>('resize_terminal', { id, rows, cols }),
  killTerminal: (id: string) => invoke<void>('kill_terminal', { id }),
  cancelRuntimeOperation: (operationId: string) =>
    invoke<void>('cancel_runtime_operation', { operationId, rendererRuntimeEpoch }),
  prepareRendererRuntime: async () => {
    rendererRuntimeEpoch = await invoke<number>('prepare_renderer_runtime');
  },
  startPortForward: (profileId: string, remotePort: number, localPort: number) =>
    invoke<PortForwardResult>('start_port_forward', {
      profileId,
      remotePort,
      localPort,
      rendererRuntimeEpoch
    }),
  probeLocalHttpUrl: (targetUrl: string) =>
    invoke<boolean>('probe_local_http_url', { targetUrl }),
  startPreviewProxy: (targetUrl: string) =>
    invoke<PreviewProxyResult>('start_preview_proxy', { targetUrl, rendererRuntimeEpoch }),
  showBrowserWebview: (
    label: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    navigate = true
  ) =>
    invoke<void>('show_browser_webview', {
      label,
      url,
      x,
      y,
      width,
      height,
      navigate,
      rendererRuntimeEpoch
    }),
  hideBrowserWebview: (label?: string) =>
    invoke<void>('hide_browser_webview', { label, rendererRuntimeEpoch }),
  closeBrowserWebview: (label?: string) =>
    invoke<void>('close_browser_webview', { label, rendererRuntimeEpoch }),
  reloadBrowserWebview: (label?: string) =>
    invoke<void>('reload_browser_webview', { label, rendererRuntimeEpoch }),
  navigateBrowserWebviewHistory: (label: string, delta: -1 | 1) =>
    invoke<void>('navigate_browser_webview_history', { label, delta, rendererRuntimeEpoch }),
  startEdgeDevtoolsSession: (workspaceId: string) =>
    invoke<EdgeDevtoolsSession>('start_edge_devtools_session', { workspaceId, rendererRuntimeEpoch }),
  edgeDevtoolsNewPage: (sessionId: string, url: string) =>
    invoke<EdgeDevtoolsPage>('edge_devtools_new_page', { sessionId, url, rendererRuntimeEpoch }),
  edgeDevtoolsActivatePage: (sessionId: string, targetId: string) =>
    invoke<void>('edge_devtools_activate_page', { sessionId, targetId, rendererRuntimeEpoch }),
  edgeDevtoolsClosePage: (sessionId: string, targetId: string) =>
    invoke<void>('edge_devtools_close_page', { sessionId, targetId, rendererRuntimeEpoch }),
  stopEdgeDevtoolsSession: (sessionId: string) =>
    invoke<void>('stop_edge_devtools_session', { sessionId, rendererRuntimeEpoch }),
  stopPortForward: (id: string) => invoke<void>('stop_port_forward', { id })
};
