import { invoke } from '@tauri-apps/api/core';
import type { AttachmentResult, ConnectionProfile, EdgeDevtoolsPage, EdgeDevtoolsSession, ExportStartResult, FileEntry, PortForwardResult, PreviewProxyResult } from './types';

export const api = {
  listProfiles: () => invoke<ConnectionProfile[]>('list_profiles'),
  listWslProfiles: () => invoke<ConnectionProfile[]>('list_wsl_profiles'),
  windowsShellRoot: () => invoke<string>('windows_shell_root'),
  setCaptureProtection: (enabled: boolean) =>
    invoke<void>('set_capture_protection', { enabled }),
  resolveProfilePath: (profileId: string, path: string) =>
    invoke<string>('resolve_profile_path', { profileId, path }),
  listDirectory: (profileId: string, path: string) =>
    invoke<FileEntry[]>('list_directory', { profileId, path }),
  readTextFile: (profileId: string, path: string) =>
    invoke<string>('read_text_file', { profileId, path }),
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
  openPath: (profileId: string, path: string) =>
    invoke<void>('open_path', { profileId, path }),
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
    cols: number
  ) =>
    invoke<string>('spawn_terminal', {
      profileId,
      cwd,
      command,
      rows,
      cols
    }),
  writeTerminal: (id: string, data: string) => invoke<void>('write_terminal', { id, data }),
  resizeTerminal: (id: string, rows: number, cols: number) =>
    invoke<void>('resize_terminal', { id, rows, cols }),
  killTerminal: (id: string) => invoke<void>('kill_terminal', { id }),
  startPortForward: (profileId: string, remotePort: number, localPort: number) =>
    invoke<PortForwardResult>('start_port_forward', { profileId, remotePort, localPort }),
  probeLocalHttpUrl: (targetUrl: string) =>
    invoke<boolean>('probe_local_http_url', { targetUrl }),
  startPreviewProxy: (targetUrl: string) =>
    invoke<PreviewProxyResult>('start_preview_proxy', { targetUrl }),
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
