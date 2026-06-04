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

export interface DeletedPathItem {
  originalPath: string;
  trashPath: string;
  name: string;
  directory: boolean;
}

export interface DirectoryListingResult {
  path: string;
  entries: FileEntry[];
  error?: string | null;
}

export interface DirectorySignatureResult {
  path: string;
  signature: string;
  error?: string | null;
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

export type PreviewProxyResult = PortForwardResult;

export interface EdgeDevtoolsSession {
  id: string;
  port: number;
  browserUrl: string;
}

export interface EdgeDevtoolsPage {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export interface BrowserWebviewPageLoadEvent {
  url: string;
  event: 'started' | 'finished';
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalCursorQueryEvent {
  id: string;
}

export interface TerminalExitEvent {
  id: string;
  code?: number | null;
}

export type ExportJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExportStartResult {
  id: string;
  name: string;
}

export interface ExportProgressEvent {
  id: string;
  name: string;
  status: ExportJobStatus;
  progress?: number | null;
  outputPath?: string | null;
  message?: string | null;
  directory: boolean;
}
