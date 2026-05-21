import { invoke } from '@tauri-apps/api/core';
import type { AttachmentResult, ConnectionProfile, FileEntry, PortForwardResult } from './types';

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
  copyDroppedFiles: (profileId: string, targetDir: string, sourcePaths: string[]) =>
    invoke<number>('copy_dropped_files', { profileId, targetDir, sourcePaths }),
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
  stopPortForward: (id: string) => invoke<void>('stop_port_forward', { id })
};
