export type ConnectionKind = 'windows' | 'wsl' | 'ssh';

export interface ConnectionProfile {
  id: string;
  label: string;
  kind: ConnectionKind;
  root: string;
  shell: string;
  distro?: string | null;
  sshAlias?: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file' | 'other';
  size: number;
  hidden: boolean;
}

export interface AttachmentResult {
  path: string;
  tag: string;
}

export interface PortForwardResult {
  id: string;
  localPort: number;
  targetHost: string;
  remotePort: number;
  url: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code?: number | null;
}
