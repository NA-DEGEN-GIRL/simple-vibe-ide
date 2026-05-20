import { invoke } from '@tauri-apps/api/core';
import type { AttachmentResult, ConnectionProfile, FileEntry, PortForwardResult } from './types';

export const api = {
  listProfiles: () => invoke<ConnectionProfile[]>('list_profiles'),
  listDirectory: (profileId: string, path: string) =>
    invoke<FileEntry[]>('list_directory', { profileId, path }),
  readTextFile: (profileId: string, path: string) =>
    invoke<string>('read_text_file', { profileId, path }),
  writeTextFile: (profileId: string, path: string, content: string) =>
    invoke<void>('write_text_file', { profileId, path, content }),
  saveAttachment: (
    profileId: string,
    workspaceRoot: string,
    sessionId: string,
    fileName: string,
    base64Data: string
  ) =>
    invoke<AttachmentResult>('save_attachment', {
      profileId,
      workspaceRoot,
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
