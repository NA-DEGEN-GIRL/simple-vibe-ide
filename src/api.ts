import { invoke } from '@tauri-apps/api/core';
import type { AgentAlertPayload, AttachmentResult, ConnectionProfile, DeletedPathItem, DirectoryListingResult, DirectorySignatureResult, EdgeDevtoolsPage, EdgeDevtoolsSession, ExportStartResult, FileEntry, LlmTmuxSessionListResult, PortForwardResult, PreviewProxyResult, RendererHeartbeatResponse } from './types';

export const api = {
  listProfiles: () => invoke<ConnectionProfile[]>('list_profiles'),
  listWslProfiles: () => invoke<ConnectionProfile[]>('list_wsl_profiles'),
  windowsShellRoot: () => invoke<string>('windows_shell_root'),
  answerSshAuthPrompt: (id: string, secret: string | null) =>
    invoke<void>('answer_ssh_auth_prompt', { id, secret }),
  setCaptureProtection: (enabled: boolean) =>
    invoke<void>('set_capture_protection', { enabled }),
  rendererHeartbeat: () => invoke<RendererHeartbeatResponse>('renderer_heartbeat'),
  readSnippetsStore: () => invoke<string>('read_snippets_store'),
  writeSnippetsStore: (payload: string) => invoke<void>('write_snippets_store', { payload }),
  forceQuitApp: () => invoke<void>('force_quit_app'),
  sendAgentAlert: (payload: AgentAlertPayload) => invoke<void>('send_agent_alert', { payload }),
  listLlmTmuxSessions: (profileId: string, cwd: string, workspaceId: string, agentId: string) =>
    invoke<LlmTmuxSessionListResult>('list_llm_tmux_sessions', { profileId, cwd, workspaceId, agentId }),
  nextLlmTmuxSession: (profileId: string, cwd: string, workspaceId: string, agentId: string) =>
    invoke<string>('next_llm_tmux_session', { profileId, cwd, workspaceId, agentId }),
  killLlmTmuxSession: (profileId: string, cwd: string, sessionName: string) =>
    invoke<void>('kill_llm_tmux_session', { profileId, cwd, sessionName }),
  resolveProfilePath: (profileId: string, path: string) =>
    invoke<string>('resolve_profile_path', { profileId, path }),
  listDirectory: (profileId: string, path: string, includeSizes = true) =>
    invoke<FileEntry[]>('list_directory', { profileId, path, includeSizes }),
  listDirectories: (profileId: string, paths: string[], includeSizes = true) =>
    invoke<DirectoryListingResult[]>('list_directories', { profileId, paths, includeSizes }),
  directorySignatures: (profileId: string, paths: string[], includeSizes = true) =>
    invoke<DirectorySignatureResult[]>('directory_signatures', { profileId, paths, includeSizes }),
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
  openPath: (profileId: string, path: string) =>
    invoke<void>('open_path', { profileId, path }),
  runPowerShellScriptAsAdmin: (profileId: string, path: string) =>
    invoke<void>('run_powershell_script_as_admin', { profileId, path }),
  readClipboardFilePaths: () => invoke<string[]>('read_clipboard_file_paths'),
  saveClipboardImageFile: (profileId: string, targetDir: string, fileName: string, base64Data: string) =>
    invoke<string>('save_clipboard_image_file', { profileId, targetDir, fileName, base64Data }),
  copyDroppedFiles: (profileId: string, targetDir: string, sourcePaths: string[]) =>
    invoke<number>('copy_dropped_files', { profileId, targetDir, sourcePaths }),
  startExportPath: (profileId: string, path: string) =>
    invoke<ExportStartResult>('start_export_path', { profileId, path }),
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
    title = 'shell'
  ) =>
    invoke<string>('spawn_terminal', {
      profileId,
      cwd,
      command,
      rows,
      cols,
      workspaceId,
      title
    }),
  writeTerminal: (id: string, data: string) => invoke<void>('write_terminal', { id, data }),
  resizeTerminal: (id: string, rows: number, cols: number) =>
    invoke<void>('resize_terminal', { id, rows, cols }),
  killTerminal: (id: string) => invoke<void>('kill_terminal', { id }),
  shutdownRuntimeSessions: () => invoke<void>('shutdown_runtime_sessions_command'),
  startPortForward: (profileId: string, remotePort: number, localPort: number) =>
    invoke<PortForwardResult>('start_port_forward', { profileId, remotePort, localPort }),
  probeLocalHttpUrl: (targetUrl: string) =>
    invoke<boolean>('probe_local_http_url', { targetUrl }),
  startPreviewProxy: (targetUrl: string) =>
    invoke<PreviewProxyResult>('start_preview_proxy', { targetUrl }),
  showBrowserWebview: (
    label: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    navigate = true
  ) =>
    invoke<void>('show_browser_webview', { label, url, x, y, width, height, navigate }),
  hideBrowserWebview: (label?: string) => invoke<void>('hide_browser_webview', { label }),
  closeBrowserWebview: (label?: string) => invoke<void>('close_browser_webview', { label }),
  reloadBrowserWebview: (label?: string) => invoke<void>('reload_browser_webview', { label }),
  startEdgeDevtoolsSession: (workspaceId: string) =>
    invoke<EdgeDevtoolsSession>('start_edge_devtools_session', { workspaceId }),
  edgeDevtoolsNewPage: (sessionId: string, url: string) =>
    invoke<EdgeDevtoolsPage>('edge_devtools_new_page', { sessionId, url }),
  edgeDevtoolsActivatePage: (sessionId: string, targetId: string) =>
    invoke<void>('edge_devtools_activate_page', { sessionId, targetId }),
  edgeDevtoolsClosePage: (sessionId: string, targetId: string) =>
    invoke<void>('edge_devtools_close_page', { sessionId, targetId }),
  stopEdgeDevtoolsSession: (sessionId: string) =>
    invoke<void>('stop_edge_devtools_session', { sessionId }),
  stopPortForward: (id: string) => invoke<void>('stop_port_forward', { id })
};
