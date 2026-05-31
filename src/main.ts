import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image as TauriImage } from '@tauri-apps/api/image';
import type { Extension } from '@codemirror/state';
import type { EditorView as CodeMirrorView } from '@codemirror/view';
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { IBufferLine, ILink as XTermLink, Terminal as XTermTerminal } from '@xterm/xterm';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { api } from './api';
import type { ConnectionProfile, DeletedPathItem, DirectoryListingResult, EdgeDevtoolsSession, ExportJobStatus, ExportProgressEvent, FileEntry, PortForwardResult, TerminalDataEvent, TerminalExitEvent } from './types';
import { configurePrivacyPolicy, parseSecretLines, serializeSecretLines, shouldMaskFile, type SecretLine } from './privacyPolicy';

interface TerminalPane {
  paneId: string;
  widgetId: string;
  workspaceId: string;
  backendId?: string;
  title: string;
  command: string | null;
  profileId: string;
  cwd: string;
  term: XTermTerminal;
  fit: XTermFitAddon;
  element: HTMLElement;
  host: HTMLElement;
  outputBuffer: string;
  writeBuffer: string;
  backendOutputChars: number;
  cwdOutputBuffer: string;
  inputBuffer: string;
  inputWriteBuffer: string;
  inputFlushTimer?: number;
  inputWritePromise?: Promise<void>;
  imeComposing?: boolean;
  imeFallbackTimer?: number;
  imeReleaseTimer?: number;
  focusFrame?: number;
  focusRetryTimer?: number;
  lastUserInputAt?: number;
  suppressTerminalQueryResponsesUntil?: number;
  seenPorts: Set<number>;
  fitFrame?: number;
  writeFrame?: number;
  writeTimer?: number;
  portScanTimer?: number;
  cwdScanTimer?: number;
  lastRows?: number;
  lastCols?: number;
  resizeObserver?: ResizeObserver;
}

interface TerminalWidget {
  widgetId: string;
  workspaceId: string;
  element: HTMLElement;
  title: HTMLElement;
  cwd: HTMLElement;
  tabList: HTMLElement;
  hostStack: HTMLElement;
  activePaneId: string;
}

interface OpenFileState {
  path: string;
  content: string;
  draftContent?: string;
  masked: boolean;
  rawMode: boolean;
  lines: SecretLine[];
  dirty: boolean;
}

interface PastedImageItem {
  id: string;
  path: string;
  tag: string;
  dataUrl: string;
  createdAt: string;
}

interface DetectedPortItem {
  id: string;
  profileId: string;
  port: number;
  url: string;
}

interface BrowserTab {
  id: string;
  url: string;
  label: string;
  deviceId?: string;
  orientation?: BrowserOrientation;
  zoom?: number;
  frameUrl?: string;
  edge?: EdgeBrowserTarget;
}

interface BrowserPreviewAssetFailurePayload {
  kind?: unknown;
  url?: unknown;
  tag?: unknown;
}

interface EdgeBrowserTarget {
  sessionId: string;
  targetId: string;
  webSocketDebuggerUrl: string;
}

interface EdgeCdpPending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface EdgeCdpState {
  tabId: string;
  sessionId: string;
  socket: WebSocket;
  seq: number;
  pending: Map<number, EdgeCdpPending>;
  viewportWidth: number;
  viewportHeight: number;
  frameWidth: number;
  frameHeight: number;
  screencastLatest: EdgeScreencastFrame | null;
  screencastDrawPending: boolean;
  screencastLastDrawAt: number;
}

interface EdgeScreencastFrame {
  base64Data: string;
  metadata: Record<string, unknown> | null;
}

interface BrowserConsoleLog {
  id: string;
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface MarketTickerConfig {
  id: string;
  label: string;
  symbol: string;
  removable?: boolean;
}

interface MarketTickerQuote {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  updatedAt: number;
  status: 'loading' | 'live' | 'stale' | 'error';
  message?: string;
}

interface FontChoice {
  id: string;
  label: string;
  stack: string;
}

type EditorThemeId =
  | 'simple-dark'
  | 'deep-contrast'
  | 'soft-slate'
  | 'warm-terminal'
  | 'solarized-dark'
  | 'dracula'
  | 'nord'
  | 'ayu-dark'
  | 'one-dark';

interface EditorThemeChoice {
  id: EditorThemeId;
  label: string;
  vars: Record<string, string>;
}

interface IdeSettings {
  uiFont: string;
  monoFont: string;
  editorTheme: EditorThemeId;
  extraMaskPatterns: string[];
}

interface CalculatorHistoryItem {
  id: string;
  expression: string;
  result: string;
}

interface TauriDragDropPayload {
  paths?: string[];
  position?: {
    x: number;
    y: number;
  };
}

interface ExportJobState extends ExportProgressEvent {
  createdAt: number;
  batchId?: string;
  batchTotal?: number;
}

interface ExplorerDeleteUndoState {
  profileId: string;
  workspaceId: string;
  items: DeletedPathItem[];
}

interface TextFileCacheEntry {
  content: string;
  signature: string;
  cachedAt: number;
}

interface EditorTabState {
  id: string;
  file: OpenFileState | null;
  pendingPath?: string;
  pendingRawMode?: boolean;
  pendingProfileId?: string;
  loading?: boolean;
}

interface ImageTabState {
  id: string;
  sourcePath?: string;
  dataUrl: string;
  label: string;
  history: PastedImageItem[];
  historyVisible: boolean;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

interface NoteTabState {
  id: string;
  path: string;
  title: string;
  customTitle?: string;
  theme: NoteThemeId;
  content: string;
  dirty: boolean;
  saving: boolean;
  loading?: boolean;
  lastSavedAt?: number;
}

interface LayoutRatio {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WorkspacePanelSnapshot {
  visible: boolean;
  rect?: LayoutRatio;
}

interface WorkspaceTerminalSnapshot {
  title: string;
  command: string | null;
  backendId?: string;
  widgetId?: string;
  profileId?: string;
  cwd?: string;
  rect?: LayoutRatio;
}

interface EditorTabSnapshot {
  id: string;
  path: string;
  rawMode: boolean;
}

interface ImageTabSnapshot {
  id: string;
  sourcePath?: string;
  dataUrl: string;
  label: string;
  history: PastedImageItem[];
  historyVisible: boolean;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
}

interface NoteTabSnapshot {
  id: string;
  path: string;
  title: string;
  customTitle?: string;
  theme?: NoteThemeId;
}

interface WorkspaceSnapshot {
  id: string;
  label: string;
  customLabel?: string;
  profileId: string;
  root: string;
  currentDir: string;
  workspaceOpen: boolean;
  captureProtected: boolean;
  updatedAt: string;
  panels: Partial<Record<FloatingPanelId, WorkspacePanelSnapshot>>;
  terminalSpawnRect?: LayoutRatio;
  terminals: WorkspaceTerminalSnapshot[];
  activeTerminalIndex: number;
  editorTabs: EditorTabSnapshot[];
  activeEditorTabId: string;
  editorOpenInNewTab: boolean;
  editorWordWrap: boolean;
  imageTabs: ImageTabSnapshot[];
  activeImageTabId: string;
  imageOpenInNewTab: boolean;
  noteTabs: NoteTabSnapshot[];
  activeNoteTabId: string;
  notePinned: boolean;
  noteOpacity?: number;
  browserTabs: BrowserTab[];
  browserHistory: string[];
  activeBrowserTabId: string;
  browserDeviceId: string;
  browserOrientation: BrowserOrientation;
  browserConsoleVisible: boolean;
  browserConsolePosition: BrowserConsolePosition;
  browserConsoleSize?: number;
  browserZoom?: number;
  calculatorExpression?: string;
  calculatorHistory?: CalculatorHistoryItem[];
  explorerOpenMode: ExplorerOpenMode;
  showFileSizes: boolean;
  editorFontSize: number;
  terminalFontSize: number;
  noteFontSize?: number;
  calculatorFontSize?: number;
  ideScale: number;
}

interface WorkspaceStore {
  version: 1;
  activeId: string;
  workspaces: WorkspaceSnapshot[];
}

interface SavedWorkspaceEntry {
  id: string;
  name: string;
  savedAt: string;
  // Connection kind/label captured at save time so the saved entry still shows what it was even
  // if the profile is later removed. Older entries omit these and resolve live from profileId.
  profileKind?: ConnectionProfile['kind'];
  profileLabel?: string;
  snapshot: WorkspaceSnapshot;
}

interface SavedWorkspaceStore {
  version: 1;
  saved: SavedWorkspaceEntry[];
}

interface WorkspaceRuntimeCache {
  editorTabs: EditorTabState[];
  activeEditorTabId: string;
  explorer?: ExplorerRuntimeCache;
  browserTabs: BrowserTab[];
  browserHistory: string[];
  activeBrowserTabId: string;
  previewUrl: string;
  previewProxies: PortForwardResult[];
  browserConsoleLogs: BrowserConsoleLog[];
}

interface ExplorerRuntimeCache {
  currentDir: string;
  entries: FileEntry[];
  expanded: Set<string>;
  children: Map<string, FileEntry[]>;
  signatures: Map<string, string>;
  selectedPath: string;
  selectedPaths: Set<string>;
  selectionAnchorPath: string;
}

interface ExplorerVisibleRow {
  entry: FileEntry | null;
  path: string;
  pathKey: string;
  depth: number;
  loading: boolean;
  disclosureText: string;
  sizeText: string;
  staticSignature: string;
}

interface ExplorerTypeaheadCandidate {
  entry: FileEntry;
  pathKey: string;
  nameKey: string;
}

interface EditorRuntime {
  EditorState: typeof import('@codemirror/state').EditorState;
  EditorView: typeof import('@codemirror/view').EditorView;
  lineNumbers: typeof import('@codemirror/view').lineNumbers;
  highlightActiveLine: typeof import('@codemirror/view').highlightActiveLine;
  keymap: typeof import('@codemirror/view').keymap;
  defaultKeymap: typeof import('@codemirror/commands').defaultKeymap;
  history: typeof import('@codemirror/commands').history;
  historyKeymap: typeof import('@codemirror/commands').historyKeymap;
  indentWithTab: typeof import('@codemirror/commands').indentWithTab;
  highlightSelectionMatches: typeof import('@codemirror/search').highlightSelectionMatches;
  searchKeymap: typeof import('@codemirror/search').searchKeymap;
  syntaxHighlighting: typeof import('@codemirror/language').syntaxHighlighting;
  defaultHighlightStyle: typeof import('@codemirror/language').defaultHighlightStyle;
  HighlightStyle: typeof import('@codemirror/language').HighlightStyle;
  tags: typeof import('@lezer/highlight').tags;
  languageCompartment: import('@codemirror/state').Compartment;
}

interface TerminalRuntime {
  Terminal: typeof import('@xterm/xterm').Terminal;
  FitAddon: typeof import('@xterm/addon-fit').FitAddon;
  Unicode11Addon: typeof import('@xterm/addon-unicode11').Unicode11Addon;
}

type FloatingPanelId = 'explorer' | 'editor' | 'image' | 'browser' | 'notes' | 'calculator' | 'settings';
type PanelRect = { left: number; top: number; width: number; height: number };
type ExplorerOpenMode = 'single' | 'double';
type BrowserOrientation = 'portrait' | 'landscape';
type BrowserConsolePosition = 'bottom' | 'right' | 'top' | 'left';
type ForwardRenderKind = 'detected' | 'forward' | 'empty';
type WorkspaceSnapshotPersistMode = 'flush' | 'defer' | 'none';
type TerminalVisibility = 'visible' | 'inactive' | 'background';
type CloseTerminalOptions = {
  backgroundKill?: boolean;
  saveSnapshot?: boolean;
  renderShellTabs?: boolean;
};
type NoteThemeId = 'default' | 'sticky' | 'mint' | 'rose' | 'paper';
type WindowResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';
type BrowserDevicePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  kind: 'phone' | 'tablet';
};
type ResizeTarget =
  | { kind: 'ide' }
  | { kind: 'panel'; id: FloatingPanelId }
  | { kind: 'terminal'; paneId: string };
type ContextMenuItem = {
  label?: string;
  action?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
};
type WorkspaceDropTarget = { targetId: string; position: 'before' | 'after' };
type WorkspaceDragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  target: WorkspaceDropTarget | null;
};
type CreateTerminalOptions = {
  rect?: LayoutRatio;
  focus?: boolean;
  profile?: ConnectionProfile;
  cwd?: string;
  initialHeight?: number;
  skipSnapshotSave?: boolean;
};

type LlmLauncherFlag = {
  // Two questions decide whether to add the flag: is it already in the command, and is it root?
  // `bashPattern` answers the first: it matches the resolved command's source (alias/function body
  // from `type`, plus a wrapper SCRIPT's own text) so an already-injected flag is not doubled.
  bashPattern: string;
  powershellPattern: string;
  args: string[];
  // Answers the second on the bash path: skip when the effective uid is 0 (claude refuses
  // --dangerously-skip-permissions as root). Windows shells have no such gate.
  skipWhenRoot?: boolean;
};

type LlmLauncherConfig = {
  executable: string;
  flags: LlmLauncherFlag[];
};

const LLM_LAUNCHERS: Record<string, LlmLauncherConfig> = {
  codex: {
    executable: 'codex',
    flags: [
      {
        bashPattern: '*--dangerously-bypass-approvals-and-sandbox*',
        powershellPattern: '--dangerously-bypass-approvals-and-sandbox',
        args: ['--dangerously-bypass-approvals-and-sandbox']
      },
      {
        bashPattern: '*--enable[[:space:]]goals*|*--enable=goals*',
        powershellPattern: '--enable\\s+goals|--enable=goals',
        args: ['--enable', 'goals']
      }
    ]
  },
  claude: {
    executable: 'claude',
    flags: [
      {
        // claude rejects --dangerously-skip-permissions as root, so skip it when uid 0.
        skipWhenRoot: true,
        bashPattern: '*--dangerously-skip-permissions*|*--permission-mode[[:space:]]bypassPermissions*|*--permission-mode=bypassPermissions*',
        powershellPattern: '--dangerously-skip-permissions|--permission-mode\\s+bypassPermissions|--permission-mode=bypassPermissions',
        args: ['--dangerously-skip-permissions']
      }
    ]
  },
  grok: {
    executable: 'grok',
    flags: [
      {
        bashPattern: '*--permission-mode*|*bypassPermissions*',
        powershellPattern: '--permission-mode|bypassPermissions',
        args: ['--permission-mode', 'bypassPermissions']
      }
    ]
  },
  antigravity: {
    executable: 'antigravity',
    flags: []
  }
};

const FLOATING_PANELS: FloatingPanelId[] = ['explorer', 'editor', 'image', 'browser', 'notes', 'calculator', 'settings'];
const DEFAULT_PANEL_VISIBILITY: Record<FloatingPanelId, boolean> = {
  explorer: true,
  editor: true,
  image: true,
  browser: true,
  notes: false,
  calculator: false,
  settings: false
};
const WORKSPACE_STORE_KEY = 'simple-vibe-ide.workspaces.v1';
const WORKSPACE_STORE_PERSIST_LIMIT = 24;
const SAVED_WORKSPACE_STORE_KEY = 'simple-vibe-ide.savedWorkspaces.v1';
const SAVED_WORKSPACE_LIMIT = 32;
const DEFAULT_SHOW_FILE_SIZES = false;
const BROWSER_ADDRESS_HISTORY_LIMIT = 32;
const BROWSER_ADDRESS_SUGGESTION_LIMIT = 8;
const WORKSPACE_IMAGE_STORE_KEY = 'simple-vibe-ide.workspaceImages.v1';
const WORKSPACE_IMAGE_REF_PREFIX = 'simple-vibe-image:';
const WORKSPACE_IMAGE_REF_CACHE_LIMIT = 512;
const MARKET_TICKER_STORE_KEY = 'simple-vibe-ide.marketTicker.v1';
const IDE_SETTINGS_KEY = 'simple-vibe-ide.settings.v1';
const NOTES_DIR = '.vibe-ide-temp/notes';
const WORKSPACE_SNAPSHOT_DEBOUNCE_MS = 260;
const WORKSPACE_RESTORE_SNAPSHOT_DEBOUNCE_MS = 900;
const STRING_FINGERPRINT_MIN_LENGTH = 256;
const STRING_FINGERPRINT_CACHE_LIMIT = 256;
const NOTE_THEMES: Array<{ id: NoteThemeId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'mint', label: 'Mint' },
  { id: 'rose', label: 'Rose' },
  { id: 'paper', label: 'Paper' }
];
const PANEL_SNAP_DISTANCE = 14;
const WIDGET_KEYBOARD_SCALE = 1.1;
const TERMINAL_PORT_SCAN_LIMIT = 4000;
const TERMINAL_CWD_SCAN_LIMIT = 6000;
const TERMINAL_PORT_SCAN_DEBOUNCE_MS = 220;
const TERMINAL_CWD_SCAN_DEBOUNCE_MS = 140;
const TERMINAL_INACTIVE_WRITE_BATCH_MS = 240;
const TERMINAL_BACKGROUND_WRITE_BATCH_MS = 900;
const TERMINAL_INPUT_BATCH_MS = 4;
const TERMINAL_INPUT_FORCE_FLUSH_CHARS = 4096;
const TERMINAL_BACKGROUND_SCAN_BATCH_MS = 900;
const TERMINAL_BACKGROUND_CWD_SAVE_DELAY_MS = 1200;
const TERMINAL_WRITE_FORCE_FLUSH_CHARS = 64 * 1024;
const TERMINAL_VISIBLE_WRITE_CHUNK_CHARS = 16 * 1024;
const TERMINAL_HIDDEN_WRITE_CHUNK_CHARS = 8 * 1024;
const TERMINAL_RECENT_INPUT_WRITE_CHUNK_CHARS = 2 * 1024;
const TERMINAL_CWD_CONTINUATION_TAIL_LIMIT = 512;
const TERMINAL_RECENT_INPUT_WINDOW_MS = 900;
// Defer post-composition repaint/refocus well past xterm's own setTimeout(0) finalize (which
// re-reads the helper-textarea), so our DOM/focus churn can't clobber the committed Hangul tail.
const TERMINAL_IME_RELEASE_DEFER_MS = 120;
const TERMINAL_IME_COMPOSITION_FALLBACK_MS = 1800;
const TERMINAL_FOCUS_RETRY_MS = 36;
const TERMINAL_PROMPT_SHORT_HINT_PATTERN = /(?:PS\s+[A-Za-z]:\\?|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]*:?|[#$>]\s*$)/;
const TERMINAL_PROMPT_CWD_HINT_PATTERN = /(?:PS\s+[A-Za-z]:\\|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:|[#$>]\s*$)/;
const TERMINAL_PROMPT_CONTINUATION_HINT_PATTERN = /(?:PS\s+[A-Za-z]:\\?|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]*:?|^[#$>]\s*$)/;
const TERMINAL_FILE_LINK_PATTERN = /(?:^|[\s([{"'`])(@?(?:(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])?(?:[A-Za-z0-9_@.+~()[\]-]+[\\/])*[A-Za-z0-9_@.+~()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg|ico|txt|md|json|jsonc|yaml|yml|toml|env|ini|conf|config|log|ts|tsx|js|jsx|mjs|cjs|css|scss|html|htm|py|rs|go|java|c|cpp|h|hpp|cs|sh|bash|ps1|bat|cmd))(?:[:#]\d+(?::\d+)?)?)/gi;
const TERMINAL_PREVIEW_PORT_HINT_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\b(?:listening|running|available|started|serving|server|port)\b|:\d{2,5}/i;
const TERMINAL_OSC7_CWD_PATTERN = /\x1b]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const TERMINAL_CPR_RESPONSE_PATTERN = /\x1b\[\d+;\d+R/g;
const LOCAL_PREVIEW_URL_PORT_PATTERN = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/gi;
const LOCAL_PREVIEW_LISTENING_PORT_PATTERN = /\b(?:listening|running|available|started|serving|server)\b[^\r\n]{0,80}\b(?:port\s*)?(\d{4,5})\b/gi;
const TERMINAL_POWERSHELL_PROMPT_CWD_PATTERN = /(?:^|\s)PS\s+([A-Za-z]:\\[^<>|?*\r\n]*)>\s*$/;
const TERMINAL_BASH_PROMPT_CWD_PATTERN = /(?:^|\s)[^@\s:]+@[^:\s]+:([^#$\r\n]+)[#$]\s*$/;
const EXPLORER_TYPEAHEAD_TIMEOUT_MS = 900;
const EXPLORER_WATCH_LOCAL_MS = 2500;
const EXPLORER_WATCH_WSL_MS = 3500;
const EXPLORER_WATCH_SSH_MS = 7000;
const EXPLORER_WATCH_MAX_DIRS = 12;
const EXPLORER_WATCH_LOCAL_DIRS = 8;
const EXPLORER_WATCH_HIDDEN_FACTOR = 4;
const EXPLORER_WATCH_SLOW_THRESHOLD_MS = 1400;
const EXPLORER_WATCH_SLOW_BACKOFF_FACTOR = 2;
const EXPLORER_DIRECTORY_CACHE_LIMIT = 160;
const EXPLORER_DIRECTORY_CACHE_PRUNE_BATCH = 32;
const EXPLORER_DIRECTORY_CACHE_BUSY_LIMIT = EXPLORER_DIRECTORY_CACHE_LIMIT + EXPLORER_DIRECTORY_CACHE_PRUNE_BATCH * 4;
const EXPLORER_DIRECTORY_CACHE_TTL_LOCAL_MS = 3000;
const EXPLORER_DIRECTORY_CACHE_TTL_WSL_MS = 6000;
const EXPLORER_DIRECTORY_CACHE_TTL_SSH_MS = 9000;
const NOTES_AUTOSAVE_DELAY_MS = 1800;
const TEXT_FILE_CACHE_LIMIT = 128;
const TEXT_FILE_PREFETCH_MAX_BYTES = 512 * 1024;
const SECRET_PARSE_CACHE_LIMIT = 32;
const EDITOR_LOADING_DELAY_MS = 180;
const EXPLORER_ROW_HEIGHT = 32;
const EXPLORER_VIRTUAL_OVERSCAN = 20;
const EXPLORER_VIRTUAL_WINDOW_STEP = 16;
const EXPLORER_VIRTUAL_SCROLL_OVERSCAN = 96;
const EXPLORER_VIRTUAL_SCROLL_WINDOW_STEP = 128;
const EXPLORER_ROW_ELEMENT_CACHE_LIMIT = 768;
const EXPLORER_ROW_ELEMENT_CACHE_PRUNE_BATCH = 96;
const EXPLORER_ROW_ELEMENT_CACHE_BUSY_LIMIT = EXPLORER_ROW_ELEMENT_CACHE_LIMIT + EXPLORER_ROW_ELEMENT_CACHE_PRUNE_BATCH * 4;
const EXPLORER_ROW_RECYCLE_LIMIT = 256;
const EXPLORER_PATH_KEY_CACHE_LIMIT = 8192;
const EXPLORER_PATH_KEY_CACHE_PRUNE_BATCH = 1024;
const EXPLORER_PATH_KEY_CACHE_BUSY_LIMIT = EXPLORER_PATH_KEY_CACHE_LIMIT + EXPLORER_PATH_KEY_CACHE_PRUNE_BATCH * 4;
const EXPLORER_SCROLL_IDLE_MS = 180;
const EXPLORER_HOVER_PREFETCH_DELAY_MS = 180;
const EXPLORER_DIRECTORY_PREFETCH_DELAY_MS = 120;
const EXPLORER_DIRECTORY_PREFETCH_LIMIT = 6;
const EXPLORER_VISIBLE_PREFETCH_ROW_PADDING = 8;
const PREVIEW_PROXY_PROBE_TTL_MS = 60_000;
const BROWSER_CONSOLE_LOG_LIMIT = 250;
const BROWSER_CONSOLE_HIDDEN_LOG_LIMIT = 80;
const BROWSER_CONSOLE_RENDER_LIMIT = 120;
const BROWSER_CONSOLE_ARG_LIMIT = 8;
const BROWSER_CONSOLE_MESSAGE_MAX_CHARS = 2000;
const BROWSER_CONSOLE_ARRAY_DETAIL_LIMIT = 40;
const BROWSER_CONSOLE_OBJECT_DETAIL_KEY_LIMIT = 40;
const BROWSER_CONSOLE_DETAIL_DEPTH_LIMIT = 2;
const BROWSER_CONSOLE_STRUCTURED_VALUE_MAX_CHARS = 1800;
const BROWSER_CONSOLE_PORT_SCAN_QUEUE_PRUNE_BATCH = 32;
const BROWSER_CONSOLE_HIDDEN_FLUSH_DEBOUNCE_MS = 220;
const BROWSER_CONSOLE_HIDDEN_FLUSH_IDLE_MS = 900;
const BROWSER_CONSOLE_LOCAL_URL_PORT_PATTERN = /\b(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})\b/gi;
const BROWSER_INACTIVE_FRAME_SUSPEND_DELAY_MS = 3500;
const BROWSER_WORKSPACE_SWITCH_FRAME_SUSPEND_DELAY_MS = 350;
const BROWSER_FRAME_SUSPEND_IDLE_MS = 250;
const WORKSPACE_RESTORE_BACKGROUND_DELAY_MS = 1800;
const DEFAULT_BROWSER_DEVICE_ID = 'iphone-15';
const BROWSER_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const IMAGE_PREVIEW_MIN_ZOOM = 0.1;
const IMAGE_PREVIEW_MAX_ZOOM = 12;
const IMAGE_PREVIEW_WHEEL_FACTOR = 1.12;
const USE_EDGE_CDP_BROWSER = false;
const USE_PREVIEW_PROXY_BROWSER = true;
const EDGE_SCREENCAST_QUALITY = 66;
const EDGE_SCREENCAST_EVERY_NTH_FRAME = 2;
const EDGE_SCREENCAST_MIN_DRAW_INTERVAL_MS = 58;
const EDGE_START_TIMEOUT_MS = 16000;
const EDGE_PAGE_TIMEOUT_MS = 6500;
const EDGE_CDP_CONNECT_TIMEOUT_MS = 6500;
const EDGE_CDP_COMMAND_TIMEOUT_MS = 5000;
const BROWSER_DEVICE_PRESETS: BrowserDevicePreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, kind: 'phone' },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, kind: 'phone' },
  { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', width: 430, height: 932, kind: 'phone' },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, kind: 'phone' },
  { id: 'galaxy-s23', label: 'Galaxy S23', width: 360, height: 780, kind: 'phone' },
  { id: 'galaxy-fold', label: 'Galaxy Fold', width: 280, height: 653, kind: 'phone' },
  { id: 'ipad-mini', label: 'iPad Mini', width: 768, height: 1024, kind: 'tablet' },
  { id: 'ipad-air', label: 'iPad Air', width: 820, height: 1180, kind: 'tablet' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11', width: 834, height: 1194, kind: 'tablet' },
  { id: 'surface-pro-7', label: 'Surface Pro 7', width: 912, height: 1368, kind: 'tablet' }
];
const BROWSER_DEVICE_PRESET_BY_ID = new Map(BROWSER_DEVICE_PRESETS.map((preset) => [preset.id, preset]));
const DEFAULT_MARKET_TICKERS: MarketTickerConfig[] = [
  { id: 'btc', label: 'BTC', symbol: 'BTCUSDT' },
  { id: 'nas100', label: 'NAS100', symbol: 'QQQUSDT' }
];
const MARKET_TICKER_WS_URL = 'wss://fstream.binance.com/market/stream?streams=';
const MARKET_TICKER_REST_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=';
const MARKET_TICKER_BOOT_DELAY_MS = 2200;
const MARKET_TICKER_VISIBLE_RESUME_DELAY_MS = 900;
const MARKET_TICKER_IDLE_TIMEOUT_MS = 2500;
const MARKET_TICKER_RENDER_MIN_MS = 1000;
const MARKET_TICKER_FETCH_TIMEOUT_MS = 8000;
const MARKET_TICKER_FALLBACK_MS = 30000;
const MARKET_TICKER_STALE_MS = 45000;
const MARKET_TICKER_MAX_CUSTOM = 1;
const UI_FONT_CHOICES: FontChoice[] = [
  { id: 'system', label: 'System KR/EN', stack: 'Inter, "Segoe UI", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif' },
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif' },
  { id: 'noto-kr', label: 'Noto Sans KR', stack: '"Noto Sans KR", "Malgun Gothic", "Segoe UI", system-ui, sans-serif' },
  { id: 'malgun', label: 'Malgun Gothic', stack: '"Malgun Gothic", "Segoe UI", system-ui, sans-serif' },
  { id: 'pretendard', label: 'Pretendard', stack: 'Pretendard, "Noto Sans KR", "Segoe UI", system-ui, sans-serif' },
  { id: 'inter', label: 'Inter', stack: 'Inter, "Noto Sans KR", "Segoe UI", system-ui, sans-serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Noto Sans KR", sans-serif' }
];
const MONO_FONT_CHOICES: FontChoice[] = [
  { id: 'cascadia', label: 'Cascadia Mono (mono)', stack: '"Cascadia Mono", Consolas, "D2Coding", monospace' },
  { id: 'cascadia-code', label: 'Cascadia Code (mono)', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'd2coding', label: 'D2Coding (mono)', stack: 'D2Coding, "Cascadia Mono", Consolas, monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono (mono)', stack: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'fira', label: 'Fira Code (mono)', stack: '"Fira Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'source-code-pro', label: 'Source Code Pro (mono)', stack: '"Source Code Pro", "Cascadia Mono", Consolas, monospace' },
  { id: 'noto-mono', label: 'Noto Sans Mono (mono)', stack: '"Noto Sans Mono", "D2Coding", "Cascadia Mono", monospace' },
  { id: 'consolas', label: 'Consolas (mono)', stack: 'Consolas, "Cascadia Mono", monospace' }
];
const TEXT_FILE_EXTENSIONS = new Set([
  'bash', 'bat', 'cmd', 'conf', 'config', 'cpp', 'cs', 'css', 'csv', 'c', 'env', 'go',
  'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'lock', 'log', 'lua',
  'md', 'mjs', 'ps1', 'py', 'rs', 'scss', 'sh', 'sql', 'svelte', 'toml', 'ts', 'tsx',
  'txt', 'vue', 'xml', 'yaml', 'yml'
]);
const EDITOR_THEME_CHOICES: EditorThemeChoice[] = [
  {
    id: 'simple-dark',
    label: 'VS Code Dark',
    vars: {
      '--cm-bg': '#1e1e1e',
      '--cm-text': '#d4d4d4',
      '--cm-gutter-bg': '#181818',
      '--cm-gutter-text': '#858585',
      '--cm-border': '#30363d',
      '--cm-active-line': 'rgba(45, 95, 145, 0.32)',
      '--cm-active-gutter-bg': '#263850',
      '--cm-active-gutter-text': '#ffffff',
      '--cm-caret': '#f8f8f0',
      '--cm-selection': 'rgba(38, 79, 120, 0.72)',
      '--cm-focus': 'rgba(0, 122, 204, 0.48)',
      '--cm-comment': '#6a9955',
      '--cm-keyword': '#569cd6',
      '--cm-string': '#ce9178',
      '--cm-number': '#b5cea8',
      '--cm-variable': '#9cdcfe',
      '--cm-definition': '#dcdcaa',
      '--cm-type': '#4ec9b0',
      '--cm-property': '#9cdcfe',
      '--cm-operator': '#d4d4d4',
      '--cm-punctuation': '#808080',
      '--cm-constant': '#4fc1ff',
      '--cm-regexp': '#d16969',
      '--cm-escape': '#d7ba7d',
      '--cm-meta': '#c586c0',
      '--cm-heading': '#4ec9b0',
      '--cm-link': '#3794ff',
      '--cm-inserted': '#b5cea8',
      '--cm-deleted': '#f48771',
      '--cm-invalid': '#f48771'
    }
  },
  {
    id: 'deep-contrast',
    label: 'Tokyo Night',
    vars: {
      '--cm-bg': '#1a1b26',
      '--cm-text': '#c0caf5',
      '--cm-gutter-bg': '#16161e',
      '--cm-gutter-text': '#565f89',
      '--cm-border': '#2f3549',
      '--cm-active-line': 'rgba(41, 46, 66, 0.88)',
      '--cm-active-gutter-bg': '#24283b',
      '--cm-active-gutter-text': '#c0caf5',
      '--cm-caret': '#c0caf5',
      '--cm-selection': 'rgba(55, 63, 90, 0.85)',
      '--cm-focus': 'rgba(122, 162, 247, 0.42)',
      '--cm-comment': '#565f89',
      '--cm-keyword': '#bb9af7',
      '--cm-string': '#9ece6a',
      '--cm-number': '#ff9e64',
      '--cm-variable': '#c0caf5',
      '--cm-definition': '#7aa2f7',
      '--cm-type': '#2ac3de',
      '--cm-property': '#73daca',
      '--cm-operator': '#89ddff',
      '--cm-punctuation': '#a9b1d6',
      '--cm-constant': '#ff9e64',
      '--cm-regexp': '#b4f9f8',
      '--cm-escape': '#e0af68',
      '--cm-meta': '#f7768e',
      '--cm-heading': '#7dcfff',
      '--cm-link': '#7aa2f7',
      '--cm-inserted': '#9ece6a',
      '--cm-deleted': '#f7768e',
      '--cm-invalid': '#ff757f'
    }
  },
  {
    id: 'soft-slate',
    label: 'GitHub Dark',
    vars: {
      '--cm-bg': '#0d1117',
      '--cm-text': '#c9d1d9',
      '--cm-gutter-bg': '#0b1016',
      '--cm-gutter-text': '#6e7681',
      '--cm-border': '#30363d',
      '--cm-active-line': 'rgba(56, 139, 253, 0.12)',
      '--cm-active-gutter-bg': '#161b22',
      '--cm-active-gutter-text': '#f0f6fc',
      '--cm-caret': '#f0f6fc',
      '--cm-selection': 'rgba(56, 139, 253, 0.36)',
      '--cm-focus': 'rgba(56, 139, 253, 0.38)',
      '--cm-comment': '#8b949e',
      '--cm-keyword': '#ff7b72',
      '--cm-string': '#a5d6ff',
      '--cm-number': '#79c0ff',
      '--cm-variable': '#c9d1d9',
      '--cm-definition': '#d2a8ff',
      '--cm-type': '#ffa657',
      '--cm-property': '#7ee787',
      '--cm-operator': '#ff7b72',
      '--cm-punctuation': '#8b949e',
      '--cm-constant': '#79c0ff',
      '--cm-regexp': '#a5d6ff',
      '--cm-escape': '#ffa657',
      '--cm-meta': '#d2a8ff',
      '--cm-heading': '#7ee787',
      '--cm-link': '#58a6ff',
      '--cm-inserted': '#7ee787',
      '--cm-deleted': '#ff7b72',
      '--cm-invalid': '#ffa198'
    }
  },
  {
    id: 'warm-terminal',
    label: 'Monokai',
    vars: {
      '--cm-bg': '#272822',
      '--cm-text': '#f8f8f2',
      '--cm-gutter-bg': '#20211c',
      '--cm-gutter-text': '#75715e',
      '--cm-border': '#3e3d32',
      '--cm-active-line': 'rgba(73, 72, 62, 0.86)',
      '--cm-active-gutter-bg': '#3e3d32',
      '--cm-active-gutter-text': '#f8f8f2',
      '--cm-caret': '#f8f8f0',
      '--cm-selection': 'rgba(73, 72, 62, 0.95)',
      '--cm-focus': 'rgba(166, 226, 46, 0.34)',
      '--cm-comment': '#75715e',
      '--cm-keyword': '#f92672',
      '--cm-string': '#e6db74',
      '--cm-number': '#ae81ff',
      '--cm-variable': '#f8f8f2',
      '--cm-definition': '#a6e22e',
      '--cm-type': '#66d9ef',
      '--cm-property': '#a6e22e',
      '--cm-operator': '#f92672',
      '--cm-punctuation': '#f8f8f2',
      '--cm-constant': '#ae81ff',
      '--cm-regexp': '#fd971f',
      '--cm-escape': '#fd971f',
      '--cm-meta': '#66d9ef',
      '--cm-heading': '#a6e22e',
      '--cm-link': '#66d9ef',
      '--cm-inserted': '#a6e22e',
      '--cm-deleted': '#f92672',
      '--cm-invalid': '#f92672'
    }
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    vars: {
      '--cm-bg': '#002b36',
      '--cm-text': '#839496',
      '--cm-gutter-bg': '#00212b',
      '--cm-gutter-text': '#586e75',
      '--cm-border': '#073642',
      '--cm-active-line': 'rgba(7, 54, 66, 0.92)',
      '--cm-active-gutter-bg': '#073642',
      '--cm-active-gutter-text': '#93a1a1',
      '--cm-caret': '#93a1a1',
      '--cm-selection': 'rgba(7, 54, 66, 0.96)',
      '--cm-focus': 'rgba(38, 139, 210, 0.38)',
      '--cm-comment': '#586e75',
      '--cm-keyword': '#859900',
      '--cm-string': '#2aa198',
      '--cm-number': '#d33682',
      '--cm-variable': '#93a1a1',
      '--cm-definition': '#268bd2',
      '--cm-type': '#b58900',
      '--cm-property': '#cb4b16',
      '--cm-operator': '#6c71c4',
      '--cm-punctuation': '#657b83',
      '--cm-constant': '#d33682',
      '--cm-regexp': '#2aa198',
      '--cm-escape': '#cb4b16',
      '--cm-meta': '#6c71c4',
      '--cm-heading': '#b58900',
      '--cm-link': '#268bd2',
      '--cm-inserted': '#859900',
      '--cm-deleted': '#dc322f',
      '--cm-invalid': '#dc322f'
    }
  },
  {
    id: 'dracula',
    label: 'Dracula',
    vars: {
      '--cm-bg': '#282a36',
      '--cm-text': '#f8f8f2',
      '--cm-gutter-bg': '#21222c',
      '--cm-gutter-text': '#6272a4',
      '--cm-border': '#44475a',
      '--cm-active-line': 'rgba(68, 71, 90, 0.78)',
      '--cm-active-gutter-bg': '#343746',
      '--cm-active-gutter-text': '#f8f8f2',
      '--cm-caret': '#f8f8f0',
      '--cm-selection': 'rgba(68, 71, 90, 0.96)',
      '--cm-focus': 'rgba(189, 147, 249, 0.42)',
      '--cm-comment': '#6272a4',
      '--cm-keyword': '#ff79c6',
      '--cm-string': '#f1fa8c',
      '--cm-number': '#bd93f9',
      '--cm-variable': '#f8f8f2',
      '--cm-definition': '#50fa7b',
      '--cm-type': '#8be9fd',
      '--cm-property': '#50fa7b',
      '--cm-operator': '#ff79c6',
      '--cm-punctuation': '#f8f8f2',
      '--cm-constant': '#bd93f9',
      '--cm-regexp': '#ffb86c',
      '--cm-escape': '#ffb86c',
      '--cm-meta': '#8be9fd',
      '--cm-heading': '#50fa7b',
      '--cm-link': '#8be9fd',
      '--cm-inserted': '#50fa7b',
      '--cm-deleted': '#ff5555',
      '--cm-invalid': '#ff5555'
    }
  },
  {
    id: 'nord',
    label: 'Nord',
    vars: {
      '--cm-bg': '#2e3440',
      '--cm-text': '#d8dee9',
      '--cm-gutter-bg': '#262c36',
      '--cm-gutter-text': '#6b778d',
      '--cm-border': '#3b4252',
      '--cm-active-line': 'rgba(67, 76, 94, 0.68)',
      '--cm-active-gutter-bg': '#3b4252',
      '--cm-active-gutter-text': '#eceff4',
      '--cm-caret': '#88c0d0',
      '--cm-selection': 'rgba(76, 86, 106, 0.9)',
      '--cm-focus': 'rgba(136, 192, 208, 0.38)',
      '--cm-comment': '#6b778d',
      '--cm-keyword': '#81a1c1',
      '--cm-string': '#a3be8c',
      '--cm-number': '#b48ead',
      '--cm-variable': '#d8dee9',
      '--cm-definition': '#88c0d0',
      '--cm-type': '#8fbcbb',
      '--cm-property': '#d8dee9',
      '--cm-operator': '#81a1c1',
      '--cm-punctuation': '#d8dee9',
      '--cm-constant': '#b48ead',
      '--cm-regexp': '#ebcb8b',
      '--cm-escape': '#d08770',
      '--cm-meta': '#5e81ac',
      '--cm-heading': '#88c0d0',
      '--cm-link': '#88c0d0',
      '--cm-inserted': '#a3be8c',
      '--cm-deleted': '#bf616a',
      '--cm-invalid': '#bf616a'
    }
  },
  {
    id: 'ayu-dark',
    label: 'Ayu Dark',
    vars: {
      '--cm-bg': '#0f1419',
      '--cm-text': '#e6e1cf',
      '--cm-gutter-bg': '#0b1015',
      '--cm-gutter-text': '#5c6773',
      '--cm-border': '#253340',
      '--cm-active-line': 'rgba(37, 51, 64, 0.72)',
      '--cm-active-gutter-bg': '#1b2733',
      '--cm-active-gutter-text': '#e6e1cf',
      '--cm-caret': '#f29718',
      '--cm-selection': 'rgba(67, 78, 92, 0.86)',
      '--cm-focus': 'rgba(255, 204, 102, 0.36)',
      '--cm-comment': '#5c6773',
      '--cm-keyword': '#ff7733',
      '--cm-string': '#bae67e',
      '--cm-number': '#ffcc66',
      '--cm-variable': '#e6e1cf',
      '--cm-definition': '#ffd580',
      '--cm-type': '#5ccfe6',
      '--cm-property': '#73d0ff',
      '--cm-operator': '#f29e74',
      '--cm-punctuation': '#95a3b3',
      '--cm-constant': '#d2a6ff',
      '--cm-regexp': '#95e6cb',
      '--cm-escape': '#ffcc66',
      '--cm-meta': '#f28779',
      '--cm-heading': '#ffd580',
      '--cm-link': '#73d0ff',
      '--cm-inserted': '#bae67e',
      '--cm-deleted': '#ff3333',
      '--cm-invalid': '#ff3333'
    }
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    vars: {
      '--cm-bg': '#282c34',
      '--cm-text': '#abb2bf',
      '--cm-gutter-bg': '#21252b',
      '--cm-gutter-text': '#5c6370',
      '--cm-border': '#3e4451',
      '--cm-active-line': 'rgba(44, 49, 60, 0.95)',
      '--cm-active-gutter-bg': '#2c313c',
      '--cm-active-gutter-text': '#abb2bf',
      '--cm-caret': '#528bff',
      '--cm-selection': 'rgba(62, 68, 81, 0.98)',
      '--cm-focus': 'rgba(82, 139, 255, 0.34)',
      '--cm-comment': '#5c6370',
      '--cm-keyword': '#c678dd',
      '--cm-string': '#98c379',
      '--cm-number': '#d19a66',
      '--cm-variable': '#abb2bf',
      '--cm-definition': '#61afef',
      '--cm-type': '#e5c07b',
      '--cm-property': '#e06c75',
      '--cm-operator': '#56b6c2',
      '--cm-punctuation': '#abb2bf',
      '--cm-constant': '#d19a66',
      '--cm-regexp': '#98c379',
      '--cm-escape': '#d19a66',
      '--cm-meta': '#c678dd',
      '--cm-heading': '#61afef',
      '--cm-link': '#56b6c2',
      '--cm-inserted': '#98c379',
      '--cm-deleted': '#e06c75',
      '--cm-invalid': '#e06c75'
    }
  }
];
const DEFAULT_IDE_SETTINGS: IdeSettings = {
  uiFont: 'system',
  monoFont: 'cascadia',
  editorTheme: 'simple-dark',
  extraMaskPatterns: ['*.env', '*.env.*', '*.secret', '*.private', '*.credentials']
};
const PANEL_RESIZE_DIRECTIONS: WindowResizeDirection[] = ['North', 'East', 'South', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];

const state = {
  profiles: [] as ConnectionProfile[],
  activeProfile: null as ConnectionProfile | null,
  workspaceOpen: false,
  workspaceRoot: '',
  currentDir: '',
  entries: [] as FileEntry[],
  explorerOpenMode: 'single' as ExplorerOpenMode,
  explorerSelectedPath: '',
  explorerSelectedPaths: new Set<string>(),
  explorerSelectionAnchorPath: '',
  explorerTypeahead: '',
  explorerTypeaheadAt: 0,
  explorerExpanded: new Set<string>(),
  explorerChildren: new Map<string, FileEntry[]>(),
  explorerLoading: new Set<string>(),
  explorerSignatures: new Map<string, string>(),
  explorerDropTargetDir: '',
  exportJobs: [] as ExportJobState[],
  workspaceSnapshots: [] as WorkspaceSnapshot[],
  activeWorkspaceId: '',
  workspaceCaptureProtected: false,
  captureProtectionApplied: false,
  openFile: null as OpenFileState | null,
  editorTabs: [] as EditorTabState[],
  activeEditorTabId: '',
  editorOpenInNewTab: false,
  editorWordWrap: false,
  terminalWidgets: [] as TerminalWidget[],
  terminals: [] as TerminalPane[],
  activePaneId: '',
  attachmentSession: new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14),
  imageCounter: 0,
  imagePreviewDataUrl: '',
  imagePreviewLabel: 'No image selected',
  imagePreviewZoom: 1,
  imagePreviewOffsetX: 0,
  imagePreviewOffsetY: 0,
  autoPasteImageTagToShell: true,
  imageHistoryVisible: false,
  imageHistory: [] as PastedImageItem[],
  imageTabs: [] as ImageTabState[],
  activeImageTabId: '',
  imageOpenInNewTab: false,
  noteTabs: [] as NoteTabState[],
  activeNoteTabId: '',
  notePinned: false,
  noteOpacity: 100,
  forwards: [] as PortForwardResult[],
  previewProxies: [] as PortForwardResult[],
  detectedPorts: [] as DetectedPortItem[],
  savedWorkspaces: [] as SavedWorkspaceEntry[],
  browserTabs: [] as BrowserTab[],
  browserHistory: [] as string[],
  activeBrowserTabId: '',
  previewUrl: '',
  browserDeviceId: DEFAULT_BROWSER_DEVICE_ID,
  browserOrientation: 'portrait' as BrowserOrientation,
  browserConsoleVisible: false,
  browserConsolePosition: 'bottom' as BrowserConsolePosition,
  browserConsoleSize: 0.34,
  browserConsoleLogs: [] as BrowserConsoleLog[],
  browserZoom: 1,
  calculatorExpression: '',
  calculatorResult: '',
  calculatorHistory: [] as CalculatorHistoryItem[],
  marketTickers: [] as MarketTickerConfig[],
  marketQuotes: new Map<string, MarketTickerQuote>(),
  marketTickerConnected: false,
  ideSettings: { ...DEFAULT_IDE_SETTINGS } as IdeSettings,
  showFileSizes: DEFAULT_SHOW_FILE_SIZES
};

let codeView: CodeMirrorView | null = null;
let codeViewFile: OpenFileState | null = null;
let codeViewRenderSignature = '\0';
let editorRenderToken = 0;
let editorRuntimePromise: Promise<EditorRuntime> | null = null;
let terminalRuntimePromise: Promise<TerminalRuntime> | null = null;
let panelZ = 20;
let keyboardResizeTarget: ResizeTarget = { kind: 'ide' };
let keyboardResizeTargetElement: HTMLElement | null = null;
let ideScale = 1;
let editorFontSize = 13;
let terminalFontSize = 13;
let noteFontSize = 14;
let noteOpacity = 100;
let calculatorFontSize = 15;
let restoringWorkspace = false;
let storedActiveWorkspaceId = '';
const layoutRatios = new WeakMap<HTMLElement, LayoutRatio>();
const autoForwardingPorts = new Set<string>();
const textFileCache = new Map<string, TextFileCacheEntry>();
const textFileReads = new Map<string, Promise<string>>();
const textFilePrefetchTimers = new Map<string, number>();
const secretParseCache = new Map<string, SecretLine[]>();
const editorLanguageCache = new Map<string, Promise<Extension>>();
const stringFingerprintCache = new Map<string, string>();
const profileById = new Map<string, ConnectionProfile>();
const terminalPaneById = new Map<string, TerminalPane>();
const terminalPaneByBackendId = new Map<string, TerminalPane>();
const terminalPanesByWidgetId = new Map<string, TerminalPane[]>();
const terminalWidgetById = new Map<string, TerminalWidget>();
const terminalWidgetByElement = new WeakMap<HTMLElement, TerminalWidget>();
const forwardById = new Map<string, PortForwardResult>();
const forwardByRemotePort = new Map<number, PortForwardResult>();
const detectedPortById = new Map<string, DetectedPortItem>();
const workspaceSnapshotById = new Map<string, WorkspaceSnapshot>();
const workspaceSnapshotIndexByIdLookup = new Map<string, number>();
const panelElementCache = new Map<FloatingPanelId, HTMLElement>();
const panelToggleCache = new Map<FloatingPanelId, HTMLButtonElement | null>();
const workspaceTabElementCache = new Map<string, HTMLElement>();
const workspaceTabPartCache = new WeakMap<HTMLElement, {
  label: HTMLButtonElement;
  input: HTMLInputElement;
  security: HTMLButtonElement;
  copy: HTMLButtonElement;
  close: HTMLButtonElement;
}>();
const editorTabById = new Map<string, EditorTabState>();
const editorTabByPath = new Map<string, EditorTabState>();
const editorTabIndexByIdLookup = new Map<string, number>();
const editorTabElementCache = new Map<string, HTMLElement>();
const exportJobById = new Map<string, ExportJobState>();
const exportJobElementCache = new Map<string, HTMLElement>();
let explorerDeleteUndo: ExplorerDeleteUndoState | null = null;
const exportJobPartCache = new WeakMap<HTMLElement, {
  title: HTMLElement;
  detail: HTMLElement;
  progress: HTMLElement;
  bar: HTMLElement;
  actions: HTMLElement;
}>();
const imageHistoryElementCache = new Map<string, HTMLElement>();
const imageHistoryPartCache = new WeakMap<HTMLElement, {
  image: HTMLImageElement;
  path: HTMLElement;
  createdAt: HTMLElement;
}>();
const imageTabById = new Map<string, ImageTabState>();
const imageTabBySourcePath = new Map<string, ImageTabState>();
const imageTabIndexByIdLookup = new Map<string, number>();
const imageTabElementCache = new Map<string, HTMLElement>();
const noteTabById = new Map<string, NoteTabState>();
const noteTabIndexByIdLookup = new Map<string, number>();
const noteTabElementCache = new Map<string, HTMLElement>();
const calculatorHistoryElementCache = new Map<string, HTMLElement>();
const explorerDirectorySignatureCache = new WeakMap<FileEntry[], string>();
const explorerDirectoryCache = new Map<string, { entries: FileEntry[]; cachedAt: number }>();
const explorerDirectoryReads = new Map<string, Promise<FileEntry[]>>();
const explorerDirectoryPrefetchTimers = new Map<string, number>();
const explorerDirectoryPrefetchPending = new Set<string>();
const workspaceRuntimeCache = new Map<string, WorkspaceRuntimeCache>();
const edgeDevtoolsSessions = new Map<string, EdgeDevtoolsSession>();
const noteSaveTimers = new Map<string, number>();
const previewProxyProbeAt = new Map<string, number>();
const previewProxyStarts = new Map<string, Promise<PortForwardResult>>();
const previewProxyByTargetOrigin = new Map<string, PortForwardResult>();
const previewProxyByLocalPort = new Map<number, PortForwardResult>();
const previewProxyLocalPortMisses = new Set<number>();
const browserFrameByTabId = new Map<string, HTMLIFrameElement>();
const browserFramesByWorkspaceId = new Map<string, Set<HTMLIFrameElement>>();
const browserWorkspaceSuspendTimers = new Map<string, number>();
const browserLoadRequestByTabId = new Map<string, number>();
const browserAssetRecoveryByTabId = new Map<string, { url: string; count: number; at: number }>();
const browserAssetRecoveryTimers = new Map<string, number>();
const browserTabById = new Map<string, BrowserTab>();
const browserTabByUrl = new Map<string, BrowserTab>();
const browserTabIndexByIdLookup = new Map<string, number>();
const browserTabElementCache = new Map<string, HTMLElement>();
const browserConsoleRowElementCache = new Map<string, HTMLElement>();
const forwardRowElementCache = new Map<string, HTMLElement>();
const forwardRowPartCache = new WeakMap<HTMLElement, {
  load: HTMLButtonElement;
  detail: HTMLElement;
  stop: HTMLButtonElement;
}>();
const marketTickerElementCache = new Map<string, HTMLElement>();
const marketTickerPartCache = new WeakMap<HTMLElement, {
  label: HTMLElement;
  price: HTMLElement;
  change: HTMLElement;
  remove?: HTMLButtonElement;
}>();
const selectOptionsRenderSignatures = new WeakMap<HTMLSelectElement, string>();
const explorerRowElementCache = new Map<string, HTMLElement>();
const explorerRowPartCache = new WeakMap<HTMLElement, {
  disclosure: HTMLElement;
  name: HTMLElement;
  size: HTMLElement;
}>();
const explorerReusableRowElements: HTMLElement[] = [];
const explorerPathKeyCache = new Map<string, string>();
const explorerEntryByPath = new Map<string, FileEntry>();
const explorerTopSpacer = createExplorerSpacerElement();
const explorerBottomSpacer = createExplorerSpacerElement();
const explorerVisibleIndexByPath = new Map<string, number>();
const explorerRenderedRowByPath = new Map<string, HTMLElement>();
let explorerVisibleRows: ExplorerVisibleRow[] = [];
let explorerTypeaheadCandidates: ExplorerTypeaheadCandidate[] = [];
const explorerTypeaheadIndexByPath = new Map<string, number>();
let explorerTypeaheadDirty = true;
let explorerRenderedStart = -1;
let explorerRenderedEnd = -1;
let explorerRenderedTotal = -1;
let explorerRenderFrame = 0;
let explorerRenderDirty = false;
let explorerViewportHeight = 0;
let explorerPathRowRenderSignature = '\0';
let explorerFileSizeModeRenderSignature = '\0';
let explorerOpenModeRenderSignature = '\0';
let explorerScrollIdleTimer = 0;
let explorerScrollingUntil = 0;
let explorerRowElementCachePruneTimer = 0;
let explorerPathKeyCachePruneTimer = 0;
let explorerDirectoryCachePruneTimer = 0;
let explorerHoverPrefetchTimer = 0;
let explorerHoverPrefetchPath = '';
let explorerResizeObserver: ResizeObserver | null = null;
let explorerDropTargetFrame = 0;
let explorerPendingDropPosition: { x: number; y: number } | undefined;
// Internal drag-to-move state (pointer-event based — Tauri dragDropEnabled breaks in-webview
// HTML5 drop targets on Windows WebView2, so we drive the move with raw pointer events).
let explorerDrag: {
  pointerId: number;
  startX: number;
  startY: number;
  paths: string[];
  active: boolean;
  ghost: HTMLElement | null;
  targetDir: string;
} | null = null;
let explorerDragEndAt = 0;
const EXPLORER_DRAG_THRESHOLD = 5;
const EXPLORER_CLICK_SUPPRESS_MS = 250;
let explorerWatchTimer = 0;
let explorerWatchIdleToken = 0;
let explorerWatchInFlight = false;
let explorerWatchLastDurationMs = 0;
let explorerDirectoryPrefetchActive = 0;
let explorerVisiblePrefetchTimer = 0;
let explorerVisiblePrefetchDueAt = 0;
let explorerCachedRefreshToken = 0;
const explorerCachedRefreshTimers = new Set<number>();
let explorerLastSelectedPath = '';
let explorerEntryLookupDirty = true;
let explorerModifierPointerPath = '';
let explorerModifierPointerUntil = 0;
let browserConsoleRenderFrame = 0;
let browserConsoleLastRenderedLogId = '';
let browserConsoleLastRenderedLogIndex = -1;
let browserConsoleLogVersion = 0;
let browserConsoleLogSequence = 0;
let browserConsoleLastTimeSecond = -1;
let browserConsoleLastTimeText = '';
let browserConsolePortScanTimer = 0;
let browserConsolePortScanQueue: string[] = [];
let browserConsoleHiddenPayloadTimer = 0;
let browserConsoleHiddenPayloadQueue: unknown[] = [];
let activeBrowserFrameId = '';
let browserInactiveFrameSuspendTimer = 0;
let browserLoadRequestSeq = 0;
let windowResizeFrame = 0;
let workspaceSnapshotTimer = 0;
let workspacePersistTimer = 0;
let workspaceStorePersistSignature = '';
let workspaceStorePersistWorkspacesSignature = '';
let workspaceStorePersistWorkspacesJson = '[]';
let workspaceImageStore: Record<string, string> = {};
let workspaceImageStoreDirty = false;
const workspaceImageRefCache = new Map<string, { dataUrl: string; key: string }>();
const workspaceSnapshotSignatures = new Map<string, string>();
let noteStatusRenderSignature = '\0';
let workspaceTabsRenderSignature = '\0';
let workspaceTabsOrderRenderSignature = '\0';
let savedWorkspaceSelectRenderSignature = '\0';
let editorTabsRenderSignature = '\0';
let editorTabsOrderRenderSignature = '\0';
let noteTabsRenderSignature = '\0';
let noteTabsOrderRenderSignature = '\0';
let browserTabsRenderSignature = '\0';
let browserTabsOrderRenderSignature = '\0';
let browserAddressSuggestionSignature = '\0';
let browserConsoleRenderSignature = '\0';
let shellTabsRenderSignature = '\0';
let exportJobsRenderSignature = '\0';
let exportJobsOrderRenderSignature = '\0';
let forwardsRenderSignature = '\0';
let forwardsOrderRenderSignature = '\0';
let imageTabsRenderSignature = '\0';
let imageTabsOrderRenderSignature = '\0';
let imageHistoryRenderSignature = '\0';
let imageHistoryOrderRenderSignature = '\0';
let imagePreviewRenderedDataUrl = '\0';
let imagePreviewRenderedLabel = '\0';
let imagePreviewRenderedTransform = '\0';
let imagePreviewDrag: { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null = null;
let imagePreviewDragDocumentBound = false;
let calculatorHistoryRenderSignature = '\0';
let calculatorHistoryOrderRenderSignature = '\0';
let calculatorKeysRendered = false;
let profilesRenderSignature = '\0';
let browserDeviceOptionsRenderSignature = '\0';
let visibleTerminalWorkspaceId = '';
const terminalWidgetTabsRenderSignatures = new WeakMap<TerminalWidget, string>();
const terminalWidgetTabsOrderRenderSignatures = new WeakMap<TerminalWidget, string>();
const terminalWidgetTabElementCaches = new WeakMap<TerminalWidget, Map<string, HTMLElement>>();
let workspaceTerminalRestoreToken = 0;
let inactiveEditorHydrationToken = 0;
let noteHydrationToken = 0;
let explorerVisiblePrefetchToken = 0;
let terminalCwdSaveTimer = 0;
let marketTickerSocket: WebSocket | null = null;
let marketTickerStarted = false;
let marketTickerStartTimer = 0;
let marketTickerReconnectTimer = 0;
let marketTickerFallbackTimer = 0;
let marketTickerRenderFrame = 0;
let marketTickerRenderTimer = 0;
let marketTickerLastRenderAt = 0;
let marketTickerRenderSignature = '\0';
let marketTickerOrderRenderSignature = '\0';
let marketTickerReconnectAttempt = 0;
let marketTickerSnapshotInFlight = false;
let marketTickerFetchAbort: AbortController | null = null;
let wslProfilesLoadTimer = 0;
let wslProfilesLoadInFlight = false;
let wslProfilesLoaded = false;
let workspaceDragState: WorkspaceDragState | null = null;
let suppressWorkspaceTabClick = false;
let fileOpenToken = 0;
let editorLoadingTimer = 0;
let editorLoadingRequest = 0;
let codeMeasureFrame = 0;
let activeEdgeCdp: EdgeCdpState | null = null;
let edgePreviewResizeObserver: ResizeObserver | null = null;
let edgeViewportFrame = 0;
let activeExplorerRename: {
  path: string;
  originalName: string;
  kind: FileEntry['kind'];
  created: boolean;
} | null = null;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

app.innerHTML = `
  <div class="shell">
    <div class="window-resize-zones" aria-hidden="true">
      <div class="window-resize-zone window-resize-n" data-window-resize-direction="North"></div>
      <div class="window-resize-zone window-resize-e" data-window-resize-direction="East"></div>
      <div class="window-resize-zone window-resize-s" data-window-resize-direction="South"></div>
      <div class="window-resize-zone window-resize-w" data-window-resize-direction="West"></div>
      <div class="window-resize-zone window-resize-ne" data-window-resize-direction="NorthEast"></div>
      <div class="window-resize-zone window-resize-nw" data-window-resize-direction="NorthWest"></div>
      <div class="window-resize-zone window-resize-se" data-window-resize-direction="SouthEast"></div>
      <div class="window-resize-zone window-resize-sw" data-window-resize-direction="SouthWest"></div>
    </div>
    <div id="capture-freeze-frame" class="capture-freeze-frame" aria-hidden="true">
      <div class="capture-freeze-card">
        <div class="capture-freeze-lock">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
            <rect x="5" y="11" width="14" height="10" rx="2"></rect>
          </svg>
        </div>
        <strong>방송 송출 보호 중</strong>
        <span>이 작업공간은 방송 송출에서 가려져 있습니다.</span>
      </div>
    </div>
    <header class="titlebar" data-window-drag-region>
      <div class="titlebar-brand" data-window-drag-region>
        <strong>Simple Vibe IDE</strong>
        <span id="title-context" class="muted">starting...</span>
      </div>
      <div id="status" class="status" data-window-drag-region>Ready</div>
      <div id="app-clock" class="app-clock" data-window-drag-region></div>
    </header>
    <section class="workspace-tabs-bar">
      <div id="workspace-tabs" class="workspace-tabs" aria-label="Workspaces"></div>
      <button id="new-workspace-tab" class="tab-add" title="New workspace">+</button>
    </section>
    <section class="workspace-bar">
      <label>Profile <select id="profile-select"></select></label>
      <label>Root <input id="root-input" spellcheck="false" placeholder="select a profile first" /></label>
      <button id="open-root">Open / Connect</button>
      <button id="save-workspace" title="Save the current workspace layout for later" disabled>Save WS</button>
      <label class="saved-workspace-control"><select id="saved-workspace-select" title="Saved workspaces" aria-label="Saved workspaces"></select></label>
      <button id="load-saved-workspace" title="Load the selected saved workspace" disabled>Load</button>
      <button id="delete-saved-workspace" title="Delete the selected saved workspace" disabled>Del</button>
      <button id="copy-current-cd" title="Copy a cd command for the current folder" disabled>Copy cd</button>
      <button id="new-shell" disabled>+ Shell</button>
      <button id="new-windows-shell" title="Open local Windows PowerShell at a non-user path">Win Shell</button>
      <button data-llm="codex">Codex</button>
      <button data-llm="claude">Claude</button>
      <button data-llm="grok">Grok</button>
      <button data-llm="antigravity">Antigravity</button>
      <button class="panel-toggle" data-toggle-panel="explorer" title="Toggle Explorer" aria-pressed="false">Exp</button>
      <button class="panel-toggle" data-toggle-panel="editor" title="Toggle Editor" aria-pressed="false">Edit</button>
      <button class="panel-toggle" data-toggle-panel="image" title="Toggle Image Preview" aria-pressed="false">Img</button>
      <button class="panel-toggle" data-toggle-panel="browser" title="Toggle Browser" aria-pressed="false">Web</button>
      <button class="panel-toggle" data-toggle-panel="notes" title="Toggle Notes" aria-pressed="false">Note</button>
      <button class="panel-toggle" data-toggle-panel="calculator" title="Toggle Calculator" aria-pressed="false">Calc</button>
      <button class="panel-toggle" data-toggle-panel="settings" title="Toggle IDE Settings" aria-pressed="false">Set</button>
      <button id="reset-layout" title="Reset panel layout" disabled>Reset</button>
      <div id="market-ticker" class="market-ticker" title="Binance USD-M Futures ticker">
        <div id="market-ticker-list" class="market-ticker-list" aria-live="polite"></div>
        <input id="market-symbol-input" spellcheck="false" placeholder="ETHUSDT" title="Add one Binance USD-M symbol" />
        <button id="market-add-symbol" title="Add ticker symbol">+</button>
      </div>
    </section>
    <main class="main-grid">
      <aside class="explorer panel floating-panel hidden" data-panel="explorer">
        <div class="panel-title panel-drag-handle">
          <span>Explorer</span>
          <span class="spacer"></span>
          <button id="new-file" class="panel-mode" title="New file">File</button>
          <button id="new-folder" class="panel-mode" title="New folder">Folder</button>
          <button id="refresh-explorer" class="panel-mode" title="Refresh Explorer">Refresh</button>
          <button id="export-selected" class="panel-mode" title="Export selected item for Windows drag-out">Export</button>
          <button id="toggle-explorer-open-mode" class="panel-mode" title="Toggle single/double click open">Open: 1x</button>
          <button id="toggle-file-sizes" class="panel-mode" title="Toggle file sizes" aria-pressed="false">Size</button>
          <button class="panel-close" data-close-panel="explorer" title="Close Explorer" aria-label="Close Explorer">x</button>
        </div>
        <div id="path-row" class="path-row"></div>
        <div id="export-list" class="export-list hidden" aria-live="polite"></div>
        <div id="file-list" class="file-list" tabindex="0" role="listbox" aria-label="Explorer files"></div>
      </aside>
      <div id="shell-tabs" class="shell-tabs hidden" aria-label="Shell tabs">
        <div id="shell-tab-list" class="widget-tabs"></div>
        <button id="shell-new-tab" class="tab-add" title="New shell">+</button>
      </div>
      <section id="terminal-grid" class="terminal-grid"></section>
      <section class="editor panel floating-panel hidden" data-panel="editor">
        <div class="panel-title editor-title panel-drag-handle">
          <span id="editor-label">Editor</span>
          <span class="spacer"></span>
          <label class="tab-option" title="Open unknown files in a new editor tab"><input id="editor-open-new-tab" type="checkbox" /> New tab</label>
          <label class="tab-option" title="Toggle editor word wrap"><input id="editor-word-wrap" type="checkbox" /> Wrap</label>
          <button id="editor-new-tab" class="panel-mode" title="New editor tab">+</button>
          <button id="toggle-raw" class="hidden">Raw</button>
          <button id="save-file" disabled>Save</button>
          <button class="panel-close" data-close-panel="editor" title="Close Editor" aria-label="Close Editor">x</button>
        </div>
        <div id="editor-tabs" class="widget-tabs"></div>
        <div id="editor-body" class="editor-body empty">Open a file from Explorer.</div>
      </section>
      <section class="panel notes-panel floating-panel hidden" data-panel="notes">
        <div class="panel-title panel-drag-handle">
          <span>Notes</span>
          <span id="notes-status" class="muted notes-status">Autosaved</span>
          <span class="spacer"></span>
          <label class="notes-opacity-control" title="Note background opacity">
            <span id="notes-opacity-value">100%</span>
            <input id="notes-opacity" type="range" min="45" max="100" step="5" value="100" />
          </label>
          <select id="notes-theme" class="notes-theme-select" title="Note theme"></select>
          <button id="notes-pin" class="panel-mode" title="Keep Notes above other widgets" aria-pressed="false">Pin</button>
          <button id="notes-new-tab" class="panel-mode" title="New note">+</button>
          <button class="panel-close" data-close-panel="notes" title="Close Notes" aria-label="Close Notes">x</button>
        </div>
        <div id="notes-tabs" class="widget-tabs"></div>
        <textarea id="notes-body" class="notes-body" spellcheck="true" placeholder="Quick notes for this workspace..."></textarea>
        <div id="notes-path" class="notes-path"></div>
      </section>
      <section class="panel image-panel floating-panel hidden" data-panel="image">
        <div class="panel-title panel-drag-handle">
          <span>Image Preview / Paste Target</span>
          <span class="spacer"></span>
          <label class="tab-option" title="Open unknown images in a new image tab"><input id="image-open-new-tab" type="checkbox" /> New tab</label>
          <button id="image-new-tab" class="panel-mode" title="New image tab">+</button>
          <button class="panel-close" data-close-panel="image" title="Close Image Preview" aria-label="Close Image Preview">x</button>
        </div>
        <div id="image-tabs" class="widget-tabs"></div>
        <div id="image-label" class="image-label">No image selected</div>
        <div class="image-tools">
          <label class="image-option" title="External image paste only"><input id="auto-paste-image-tag" type="checkbox" checked /> Auto paste to shell</label>
          <button id="image-fit" class="panel-mode" title="Fit whole image to preview">Fit</button>
          <button id="image-fit-width" class="panel-mode" title="Fit image to width (pan vertically)">Fit W</button>
          <button id="image-fit-height" class="panel-mode" title="Fit image to height (pan horizontally)">Fit H</button>
          <button id="toggle-image-history" class="panel-mode" title="Toggle pasted image history" aria-pressed="false">History</button>
          <button id="clear-image-history" class="panel-mode" title="Clear pasted image history">Clear</button>
        </div>
        <div id="image-history" class="image-history hidden"></div>
        <div id="image-preview-stage" class="image-preview-stage">
          <img id="image-preview" alt="pasted preview" draggable="false" />
        </div>
        <p class="hint">Pasted images are saved in the current folder under .vibe-ide-temp/attachments. Auto paste applies to images pasted from outside the preview.</p>
      </section>
      <section class="panel browser-panel floating-panel hidden" data-panel="browser">
        <div class="panel-title panel-drag-handle">
          <span>Browser</span>
          <span class="spacer"></span>
          <button class="panel-close" data-close-panel="browser" title="Close Browser" aria-label="Close Browser">x</button>
        </div>
        <div class="browser-form">
          <button id="browser-back" class="browser-nav-button" title="Back" aria-label="Back">&larr;</button>
          <button id="browser-forward" class="browser-nav-button" title="Forward" aria-label="Forward">&rarr;</button>
          <div class="browser-address-field">
            <input id="preview-url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="3000 or http://127.0.0.1:3000" />
            <div id="browser-address-suggestions" class="browser-address-suggestions hidden" role="listbox" aria-label="Workspace browser history"></div>
          </div>
          <button id="load-preview" title="Load URL">Go</button>
          <button id="reload-preview" class="browser-nav-button" title="Reload" aria-label="Reload">&#x21bb;</button>
          <button id="clear-browser-cache" class="browser-cache-button" title="Clear preview cache and reload">Clear cache</button>
        </div>
        <div id="browser-tabs" class="browser-tabs"></div>
        <div class="device-form">
          <select id="device-select" title="Device viewport"></select>
          <button id="rotate-device" title="Rotate device">Rotate</button>
          <button id="toggle-browser-console" title="Toggle preview console" aria-pressed="false">Console</button>
          <select id="browser-console-position" title="Console position">
            <option value="bottom">Bottom</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="left">Left</option>
          </select>
        </div>
        <div id="browser-workspace" class="browser-workspace console-bottom">
          <div id="browser-shell" class="browser-shell desktop">
            <iframe id="preview-frame" class="preview-frame hidden" title="local preview"></iframe>
            <canvas id="edge-preview-canvas" class="edge-preview-canvas hidden" tabindex="0" aria-label="Edge browser preview"></canvas>
            <div id="edge-preview-status" class="edge-preview-status hidden">Edge preview idle</div>
          </div>
          <div id="browser-console-resizer" class="browser-console-resizer" aria-hidden="true"></div>
          <section id="browser-console" class="browser-console hidden" aria-label="Preview console">
            <div class="browser-console-toolbar">
              <span>Console</span>
              <button id="clear-browser-console" title="Clear console">Clear</button>
            </div>
            <div id="browser-console-log" class="browser-console-log"></div>
          </section>
        </div>
        <details class="browser-advanced">
          <summary>Advanced ports</summary>
          <div class="port-form">
            <input id="remote-port" type="number" min="1" max="65535" placeholder="remote port" />
            <input id="local-port" type="number" min="0" max="65535" placeholder="local=remote" />
            <button id="start-forward">Forward</button>
            <button id="hard-refresh-preview" title="Reload with a cache-busting local URL">Hard reload</button>
          </div>
          <div id="forward-list" class="forward-list"></div>
        </details>
        <div class="console-note">Local and live URLs can open here. Some public sites block iframe embedding; open those in a full browser when their own policy rejects preview.</div>
      </section>
      <section class="panel calculator-panel floating-panel hidden" data-panel="calculator">
        <div class="panel-title panel-drag-handle">
          <span>Calculator</span>
          <span class="spacer"></span>
          <button id="calculator-clear" class="panel-mode" title="Clear calculator">Clear</button>
          <button class="panel-close" data-close-panel="calculator" title="Close Calculator" aria-label="Close Calculator">x</button>
        </div>
        <div class="calculator-display">
          <input id="calculator-expression" spellcheck="false" inputmode="decimal" placeholder="0" />
          <div id="calculator-result" class="calculator-result">0</div>
        </div>
        <div id="calculator-keys" class="calculator-keys" aria-label="Calculator keys"></div>
        <div id="calculator-history" class="calculator-history"></div>
      </section>
      <section class="panel settings-panel floating-panel hidden" data-panel="settings">
        <div class="panel-title panel-drag-handle">
          <span>IDE Settings</span>
          <span class="spacer"></span>
          <button id="settings-save" class="panel-mode" title="Apply settings">Save</button>
          <button class="panel-close" data-close-panel="settings" title="Close Settings" aria-label="Close Settings">x</button>
        </div>
        <div class="settings-body">
          <label>UI font <select id="settings-ui-font"></select></label>
          <label>Mono font <select id="settings-mono-font"></select></label>
          <label>Editor theme <select id="settings-editor-theme"></select></label>
          <label class="settings-textarea-label">
            Mask file patterns
            <textarea id="settings-mask-patterns" spellcheck="false" placeholder="*.env&#10;*.secret"></textarea>
          </label>
          <p class="hint">Patterns are app-wide. Example/sample files stay excluded from default masking.</p>
        </div>
      </section>
    </main>
  </div>
  <div class="window-controls" aria-label="Window controls" data-no-window-drag>
    <button id="window-minimize" class="window-control" type="button" title="Minimize" aria-label="Minimize" data-window-action="minimize"><span class="window-control-icon minimize" aria-hidden="true"></span></button>
    <button id="window-maximize" class="window-control" type="button" title="Maximize or restore" aria-label="Maximize or restore" data-window-action="toggle-maximize"><span class="window-control-icon maximize" aria-hidden="true"></span></button>
    <button id="window-close" class="window-control close" type="button" title="Close" aria-label="Close" data-window-action="close"><span class="window-control-icon close" aria-hidden="true"></span></button>
  </div>
  <div id="context-menu" class="context-menu hidden" role="menu" aria-hidden="true"></div>
`;

const el = {
  titlebar: document.querySelector<HTMLElement>('.titlebar')!,
  windowControlButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-window-action]')),
  windowResizeZones: Array.from(document.querySelectorAll<HTMLElement>('[data-window-resize-direction]')),
  closePanelButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-close-panel]')),
  togglePanelButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toggle-panel]')),
  llmButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-llm]')),
  titleContext: document.querySelector<HTMLSpanElement>('#title-context')!,
  status: document.querySelector<HTMLDivElement>('#status')!,
  appClock: document.querySelector<HTMLDivElement>('#app-clock')!,
  captureFreezeFrame: document.querySelector<HTMLDivElement>('#capture-freeze-frame')!,
  workspaceTabs: document.querySelector<HTMLDivElement>('#workspace-tabs')!,
  newWorkspaceTab: document.querySelector<HTMLButtonElement>('#new-workspace-tab')!,
  profileSelect: document.querySelector<HTMLSelectElement>('#profile-select')!,
  rootInput: document.querySelector<HTMLInputElement>('#root-input')!,
  openRoot: document.querySelector<HTMLButtonElement>('#open-root')!,
  saveWorkspace: document.querySelector<HTMLButtonElement>('#save-workspace')!,
  savedWorkspaceSelect: document.querySelector<HTMLSelectElement>('#saved-workspace-select')!,
  loadSavedWorkspace: document.querySelector<HTMLButtonElement>('#load-saved-workspace')!,
  deleteSavedWorkspace: document.querySelector<HTMLButtonElement>('#delete-saved-workspace')!,
  copyCurrentCd: document.querySelector<HTMLButtonElement>('#copy-current-cd')!,
  newShell: document.querySelector<HTMLButtonElement>('#new-shell')!,
  newWindowsShell: document.querySelector<HTMLButtonElement>('#new-windows-shell')!,
  resetLayout: document.querySelector<HTMLButtonElement>('#reset-layout')!,
  marketTickerList: document.querySelector<HTMLDivElement>('#market-ticker-list')!,
  marketSymbolInput: document.querySelector<HTMLInputElement>('#market-symbol-input')!,
  marketAddSymbol: document.querySelector<HTMLButtonElement>('#market-add-symbol')!,
  mainGrid: document.querySelector<HTMLElement>('.main-grid')!,
  newFile: document.querySelector<HTMLButtonElement>('#new-file')!,
  newFolder: document.querySelector<HTMLButtonElement>('#new-folder')!,
  refreshExplorer: document.querySelector<HTMLButtonElement>('#refresh-explorer')!,
  exportSelected: document.querySelector<HTMLButtonElement>('#export-selected')!,
  exportList: document.querySelector<HTMLDivElement>('#export-list')!,
  explorerOpenModeToggle: document.querySelector<HTMLButtonElement>('#toggle-explorer-open-mode')!,
  fileSizeToggle: document.querySelector<HTMLButtonElement>('#toggle-file-sizes')!,
  fileList: document.querySelector<HTMLDivElement>('#file-list')!,
  pathRow: document.querySelector<HTMLDivElement>('#path-row')!,
  shellTabs: document.querySelector<HTMLDivElement>('#shell-tabs')!,
  shellTabList: document.querySelector<HTMLDivElement>('#shell-tab-list')!,
  shellNewTab: document.querySelector<HTMLButtonElement>('#shell-new-tab')!,
  terminalGrid: document.querySelector<HTMLDivElement>('#terminal-grid')!,
  editorTabs: document.querySelector<HTMLDivElement>('#editor-tabs')!,
  editorNewTab: document.querySelector<HTMLButtonElement>('#editor-new-tab')!,
  editorOpenNewTab: document.querySelector<HTMLInputElement>('#editor-open-new-tab')!,
  editorWordWrap: document.querySelector<HTMLInputElement>('#editor-word-wrap')!,
  editorLabel: document.querySelector<HTMLSpanElement>('#editor-label')!,
  editorBody: document.querySelector<HTMLDivElement>('#editor-body')!,
  saveFile: document.querySelector<HTMLButtonElement>('#save-file')!,
  toggleRaw: document.querySelector<HTMLButtonElement>('#toggle-raw')!,
  notesTabs: document.querySelector<HTMLDivElement>('#notes-tabs')!,
  notesNewTab: document.querySelector<HTMLButtonElement>('#notes-new-tab')!,
  notesPin: document.querySelector<HTMLButtonElement>('#notes-pin')!,
  notesTheme: document.querySelector<HTMLSelectElement>('#notes-theme')!,
  notesOpacity: document.querySelector<HTMLInputElement>('#notes-opacity')!,
  notesOpacityValue: document.querySelector<HTMLSpanElement>('#notes-opacity-value')!,
  notesBody: document.querySelector<HTMLTextAreaElement>('#notes-body')!,
  notesStatus: document.querySelector<HTMLSpanElement>('#notes-status')!,
  notesPath: document.querySelector<HTMLDivElement>('#notes-path')!,
  imageTabs: document.querySelector<HTMLDivElement>('#image-tabs')!,
  imageNewTab: document.querySelector<HTMLButtonElement>('#image-new-tab')!,
  imageOpenNewTab: document.querySelector<HTMLInputElement>('#image-open-new-tab')!,
  imagePreviewStage: document.querySelector<HTMLDivElement>('#image-preview-stage')!,
  imagePreview: document.querySelector<HTMLImageElement>('#image-preview')!,
  imageLabel: document.querySelector<HTMLDivElement>('#image-label')!,
  autoPasteImageTag: document.querySelector<HTMLInputElement>('#auto-paste-image-tag')!,
  imageFit: document.querySelector<HTMLButtonElement>('#image-fit')!,
  imageFitWidth: document.querySelector<HTMLButtonElement>('#image-fit-width')!,
  imageFitHeight: document.querySelector<HTMLButtonElement>('#image-fit-height')!,
  imageHistoryToggle: document.querySelector<HTMLButtonElement>('#toggle-image-history')!,
  imageHistoryClear: document.querySelector<HTMLButtonElement>('#clear-image-history')!,
  imageHistory: document.querySelector<HTMLDivElement>('#image-history')!,
  remotePort: document.querySelector<HTMLInputElement>('#remote-port')!,
  localPort: document.querySelector<HTMLInputElement>('#local-port')!,
  startForward: document.querySelector<HTMLButtonElement>('#start-forward')!,
  previewUrl: document.querySelector<HTMLInputElement>('#preview-url')!,
  browserAddressSuggestions: document.querySelector<HTMLDivElement>('#browser-address-suggestions')!,
  loadPreview: document.querySelector<HTMLButtonElement>('#load-preview')!,
  browserBack: document.querySelector<HTMLButtonElement>('#browser-back')!,
  browserForward: document.querySelector<HTMLButtonElement>('#browser-forward')!,
  reloadPreview: document.querySelector<HTMLButtonElement>('#reload-preview')!,
  clearBrowserCache: document.querySelector<HTMLButtonElement>('#clear-browser-cache')!,
  hardRefreshPreview: document.querySelector<HTMLButtonElement>('#hard-refresh-preview')!,
  browserTabs: document.querySelector<HTMLDivElement>('#browser-tabs')!,
  browserPanel: document.querySelector<HTMLElement>('[data-panel="browser"]')!,
  desktopSize: document.querySelector<HTMLButtonElement>('#desktop-size'),
  deviceSelect: document.querySelector<HTMLSelectElement>('#device-select')!,
  rotateDevice: document.querySelector<HTMLButtonElement>('#rotate-device')!,
  browserConsoleToggle: document.querySelector<HTMLButtonElement>('#toggle-browser-console')!,
  browserConsolePosition: document.querySelector<HTMLSelectElement>('#browser-console-position')!,
  forwardList: document.querySelector<HTMLDivElement>('#forward-list')!,
  browserWorkspace: document.querySelector<HTMLDivElement>('#browser-workspace')!,
  browserShell: document.querySelector<HTMLDivElement>('#browser-shell')!,
  browserConsoleResizer: document.querySelector<HTMLDivElement>('#browser-console-resizer')!,
  browserConsole: document.querySelector<HTMLElement>('#browser-console')!,
  browserConsoleClear: document.querySelector<HTMLButtonElement>('#clear-browser-console')!,
  browserConsoleLog: document.querySelector<HTMLDivElement>('#browser-console-log')!,
  previewFrame: document.querySelector<HTMLIFrameElement>('#preview-frame')!,
  edgePreviewCanvas: document.querySelector<HTMLCanvasElement>('#edge-preview-canvas')!,
  edgePreviewStatus: document.querySelector<HTMLDivElement>('#edge-preview-status')!,
  calculatorExpression: document.querySelector<HTMLInputElement>('#calculator-expression')!,
  calculatorResult: document.querySelector<HTMLDivElement>('#calculator-result')!,
  calculatorKeys: document.querySelector<HTMLDivElement>('#calculator-keys')!,
  calculatorHistory: document.querySelector<HTMLDivElement>('#calculator-history')!,
  calculatorClear: document.querySelector<HTMLButtonElement>('#calculator-clear')!,
  settingsUiFont: document.querySelector<HTMLSelectElement>('#settings-ui-font')!,
  settingsMonoFont: document.querySelector<HTMLSelectElement>('#settings-mono-font')!,
  settingsEditorTheme: document.querySelector<HTMLSelectElement>('#settings-editor-theme')!,
  settingsMaskPatterns: document.querySelector<HTMLTextAreaElement>('#settings-mask-patterns')!,
  settingsSave: document.querySelector<HTMLButtonElement>('#settings-save')!,
  contextMenu: document.querySelector<HTMLDivElement>('#context-menu')!
};

const currentWindow = getCurrentWindow();
let appStatusRenderSignature = '\0';
let appClockRenderSignature = '\0';
let appTitleRenderSignature = '\0';
let workspaceControlsRenderSignature = '\0';

function setStatus(message: string, danger = false) {
  const signature = `${danger ? '1' : '0'}\t${message}`;
  if (appStatusRenderSignature === signature) return;
  appStatusRenderSignature = signature;
  setTextContentIfChanged(el.status, message);
  el.status.classList.toggle('danger', danger);
}

function setTextContentIfChanged(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function setDisabledIfChanged(
  element: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  disabled: boolean
) {
  if (element.disabled !== disabled) element.disabled = disabled;
}

function setInputValueIfChanged(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  if (element.value !== value) element.value = value;
}

function setCheckedIfChanged(element: HTMLInputElement, checked: boolean) {
  if (element.checked !== checked) element.checked = checked;
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function toggleClassIfChanged(element: HTMLElement, className: string, force: boolean) {
  if (element.classList.contains(className) !== force) element.classList.toggle(className, force);
}

function setElementTextIfChanged(element: HTMLElement, text: string) {
  setTextContentIfChanged(element, text);
}

function setDatasetValueIfChanged(element: HTMLElement, key: string, value: string) {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

function startAppClock() {
  renderAppClock();
  window.setInterval(renderAppClock, 1000);
}

function renderAppClock() {
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (value: number) => String(value).padStart(2, '0');
  const value = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (appClockRenderSignature === value) return;
  appClockRenderSignature = value;
  setTextContentIfChanged(el.appClock, value);
}

function refreshTitle() {
  const profile = state.activeProfile;
  const location = profile ? `${profile.label} ${state.currentDir || state.workspaceRoot}` : 'no profile';
  if (appTitleRenderSignature === location) return;
  appTitleRenderSignature = location;
  setTextContentIfChanged(el.titleContext, location);
  const title = `Simple Vibe IDE — ${location}`;
  if (document.title !== title) document.title = title;
}

async function init() {
  await listen<TerminalDataEvent>('terminal-data', (event) => {
    const pane = terminalPaneByBackendId.get(event.payload.id);
    if (!pane) return;
    handleTerminalData(pane, event.payload.data);
  });
  await listen<TerminalExitEvent>('terminal-exit', (event) => {
    const pane = terminalPaneByBackendId.get(event.payload.id);
    if (pane) {
      flushTerminalWriteBuffer(pane);
      setTerminalBackendId(pane, undefined);
      pane.title = `${pane.title} (exited)`;
      const widget = terminalWidgetForPane(pane);
      if (widget) renderTerminalWidgetTabs(widget);
    }
  });

  await listen<TauriDragDropPayload>('tauri://drag-enter', (event) => {
    updateExplorerDropTarget(event.payload.position);
  });
  await listen<TauriDragDropPayload>('tauri://drag-over', (event) => {
    updateExplorerDropTarget(event.payload.position);
  });
  await listen<TauriDragDropPayload>('tauri://drag-drop', (event) => {
    void handleExplorerFileDrop(event.payload);
  });
  await listen('tauri://drag-leave', () => {
    clearExplorerDropTarget();
  });

  await listen<ExportProgressEvent>('export-progress', (event) => {
    handleExportProgress(event.payload);
  });
  await currentWindow.onFocusChanged((event) => {
    if (event.payload) focusActiveTerminalPaneWhenItOwnsKeyboard();
  });
  window.addEventListener('focus', focusActiveTerminalPaneWhenItOwnsKeyboard);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) focusActiveTerminalPaneWhenItOwnsKeyboard();
  });

  setProfiles(await api.listProfiles());
  loadIdeSettings();
  loadWorkspaceStore();
  loadMarketTickerConfig();
  ensureEditorTab();
  ensureImageTab();
  renderProfiles();
  renderWorkspaceTabs();
  renderSavedWorkspaceSelect();
  renderEditorTabs();
  renderImageTabs();
  renderNoteThemeOptions();
  renderNoteTabs();
  renderNotes();
  renderNotePin();
  renderShellTabs();
  renderBrowserDeviceOptions();
  if (isPanelVisible('calculator')) renderCalculator();
  if (isPanelVisible('settings')) renderSettings();
  renderMarketTicker();
  setBrowserMode('desktop');
  setBrowserConsolePosition(state.browserConsolePosition);
  applyBrowserConsoleSize();
  setBrowserConsoleVisible(false);
  applyNoteFontSize();
  applyNoteOpacity();
  applyCalculatorFontSize();
  applyBrowserZoom();
  scheduleEditorRuntimeWarmup();
  scheduleTerminalRuntimeWarmup();
  bindEvents();
  startAppClock();
  selectProfile('');
  setWorkspaceOpen(false);
  setStatus('Ready');
  scheduleMarketTickerStart(MARKET_TICKER_BOOT_DELAY_MS);
  scheduleWslProfilesBackgroundLoad();
}

function renderProfiles() {
  const signature = profilesSignature();
  if (profilesRenderSignature === signature) return;
  profilesRenderSignature = signature;
  el.profileSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select profile...';
  el.profileSelect.append(placeholder);
  for (const profile of state.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    el.profileSelect.append(option);
  }
}

function profilesSignature() {
  let signature = '';
  for (let index = 0; index < state.profiles.length; index += 1) {
    const profile = state.profiles[index];
    if (index) signature += '\n';
    signature += `${profile.id}\t${profile.label}`;
  }
  return signature;
}

function clearProfileLookup() {
  profileById.clear();
}

function rebuildProfileLookup() {
  clearProfileLookup();
  for (const profile of state.profiles) rememberProfile(profile);
}

function rememberProfile(profile: ConnectionProfile) {
  profileById.set(profile.id, profile);
}

function setProfiles(profiles: ConnectionProfile[]) {
  state.profiles = profiles;
  rebuildProfileLookup();
}

function profileForId(id: string) {
  if (!id) return null;
  let profile = profileById.get(id) ?? null;
  if (!profile) {
    profile = state.profiles.find((item) => item.id === id) ?? null;
    if (profile) rememberProfile(profile);
  }
  return profile;
}

function profileForIdWithWindowsFallback(id: string) {
  return profileForId(id) ?? (id === 'windows-local' ? windowsLocalProfileFallback() : null);
}

function scheduleWslProfilesBackgroundLoad(delayMs = 900) {
  if (wslProfilesLoaded || wslProfilesLoadInFlight) return;
  if (wslProfilesLoadTimer) window.clearTimeout(wslProfilesLoadTimer);
  wslProfilesLoadTimer = window.setTimeout(() => {
    wslProfilesLoadTimer = 0;
    runWhenUiIdle(() => {
      if (document.hidden) {
        scheduleWslProfilesBackgroundLoad(2000);
        return;
      }
      void loadWslProfilesInBackground();
    }, 1600);
  }, delayMs);
}

async function loadWslProfilesInBackground() {
  if (wslProfilesLoaded || wslProfilesLoadInFlight) return;
  wslProfilesLoadInFlight = true;
  setStatus('Ready - loading WSL profiles...');
  try {
    const wslProfiles = await api.listWslProfiles();
    const existing = new Map<string, ConnectionProfile>();
    for (const profile of state.profiles) existing.set(profile.id, profile);
    for (const profile of wslProfiles) existing.set(profile.id, profile);
    setProfiles([...existing.values()]);
    const selected = el.profileSelect.value;
    renderProfiles();
    el.profileSelect.value = selected;
    setStatus('Ready');
  } catch (error) {
    setStatus(`Ready - WSL profile scan failed: ${String(error)}`, true);
  } finally {
    wslProfilesLoadInFlight = false;
    wslProfilesLoaded = true;
  }
}

function loadWorkspaceStore() {
  loadWorkspaceImageStore();
  loadSavedWorkspaceStore();
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_STORE_KEY) ?? '') as Partial<WorkspaceStore>;
    state.workspaceSnapshots = workspaceSnapshotsFromStore(parsed.workspaces);
    storedActiveWorkspaceId = typeof parsed.activeId === 'string' ? parsed.activeId : '';
    state.activeWorkspaceId = '';
  } catch {
    state.workspaceSnapshots = [];
    storedActiveWorkspaceId = '';
    state.activeWorkspaceId = '';
  }
  rebuildWorkspaceSnapshotLookup();
  workspaceSnapshotSignatures.clear();
  for (const snapshot of state.workspaceSnapshots) {
    workspaceSnapshotSignatures.set(snapshot.id, workspaceSnapshotSignature(snapshot));
  }
  workspaceStorePersistWorkspacesSignature = workspaceStoreWorkspacesSignature();
  workspaceStorePersistWorkspacesJson = workspaceStoreWorkspacesJsonForPersist(workspaceSnapshotsForStorePersist());
  workspaceStorePersistSignature = workspaceStoreSignature(workspaceStorePersistWorkspacesSignature);
}

function workspaceSnapshotsFromStore(workspaces: unknown) {
  const snapshots: WorkspaceSnapshot[] = [];
  if (!Array.isArray(workspaces)) return snapshots;
  for (const item of workspaces) {
    if (isWorkspaceSnapshot(item)) snapshots.push(hydrateWorkspaceImageRefs(item));
  }
  return snapshots;
}

function loadSavedWorkspaceStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_WORKSPACE_STORE_KEY) ?? '') as Partial<SavedWorkspaceStore>;
    state.savedWorkspaces = savedWorkspaceEntriesFromStore(parsed.saved);
  } catch {
    state.savedWorkspaces = [];
  }
}

function savedWorkspaceEntriesFromStore(saved: unknown) {
  const entries: SavedWorkspaceEntry[] = [];
  if (!Array.isArray(saved)) return entries;
  for (const item of saved) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<SavedWorkspaceEntry>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.savedAt !== 'string') continue;
    if (!isWorkspaceSnapshot(entry.snapshot)) continue;
    entries.push({
      id: entry.id,
      name: normalizeSavedWorkspaceName(entry.name, entry.snapshot),
      savedAt: entry.savedAt,
      profileKind: typeof entry.profileKind === 'string' ? entry.profileKind : undefined,
      profileLabel: typeof entry.profileLabel === 'string' ? entry.profileLabel : undefined,
      snapshot: hydrateWorkspaceImageRefs(entry.snapshot)
    });
    if (entries.length >= SAVED_WORKSPACE_LIMIT) break;
  }
  return entries;
}

function persistSavedWorkspaceStore() {
  const saved = state.savedWorkspaces.slice(0, SAVED_WORKSPACE_LIMIT);
  localStorage.setItem(SAVED_WORKSPACE_STORE_KEY, JSON.stringify({ version: 1, saved }));
  renderSavedWorkspaceSelect();
}

function normalizeSavedWorkspaceName(value: string, snapshot?: WorkspaceSnapshot) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 72)
    || (snapshot ? workspaceDisplayLabel(snapshot) : 'Saved workspace');
}

function loadWorkspaceImageStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_IMAGE_STORE_KEY) ?? '{}') as unknown;
    workspaceImageStore = workspaceImageStoreFromParsed(parsed);
  } catch {
    workspaceImageStore = {};
  }
  workspaceImageStoreDirty = false;
}

function workspaceImageStoreFromParsed(parsed: unknown) {
  const store: Record<string, string> = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return store;
  const record = parsed as Record<string, unknown>;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (typeof value === 'string') store[key] = value;
  }
  return store;
}

function persistWorkspaceStore() {
  if (workspacePersistTimer) {
    window.clearTimeout(workspacePersistTimer);
    workspacePersistTimer = 0;
  }
  const workspacesSignature = workspaceStoreWorkspacesSignature();
  const signature = workspaceStoreSignature(workspacesSignature);
  if (signature === workspaceStorePersistSignature) return;
  workspaceStorePersistSignature = signature;
  localStorage.setItem(WORKSPACE_STORE_KEY, workspaceStoreJsonPayload(workspacesSignature));
  if (workspaceTabsRenderNeeded()) renderWorkspaceTabs();
}

function workspaceStoreJsonPayload(workspacesSignature = workspaceStoreWorkspacesSignature()) {
  if (workspacesSignature !== workspaceStorePersistWorkspacesSignature || workspaceImageStoreDirty) {
    workspaceStorePersistWorkspacesSignature = workspacesSignature;
    workspaceStorePersistWorkspacesJson = workspaceStoreWorkspacesJsonForPersist(workspaceSnapshotsForStorePersist());
  }
  return `{"version":1,"activeId":${JSON.stringify(state.activeWorkspaceId)},"workspaces":${workspaceStorePersistWorkspacesJson}}`;
}

function workspaceSnapshotsForStorePersist(snapshots = state.workspaceSnapshots) {
  return snapshots.length > WORKSPACE_STORE_PERSIST_LIMIT
    ? snapshots.slice(0, WORKSPACE_STORE_PERSIST_LIMIT)
    : snapshots;
}

function workspaceStoreWorkspacesJsonForPersist(snapshots: WorkspaceSnapshot[]) {
  const compactJson = JSON.stringify(compactWorkspaceSnapshotsForStore(snapshots));
  if (persistWorkspaceImageStoreIfNeeded()) return compactJson;
  return JSON.stringify(snapshots);
}

function compactWorkspaceSnapshotsForStore(snapshots: WorkspaceSnapshot[]) {
  const usedImageRefs = new Set<string>();
  const compact: WorkspaceSnapshot[] = [];
  for (const snapshot of snapshots) compact.push(compactWorkspaceSnapshotForStore(snapshot, usedImageRefs));
  pruneWorkspaceImageStore(usedImageRefs);
  return compact;
}

function compactWorkspaceSnapshotForStore(snapshot: WorkspaceSnapshot, usedImageRefs: Set<string>): WorkspaceSnapshot {
  return {
    ...snapshot,
    imageTabs: compactImageTabsForStore(snapshot, usedImageRefs)
  };
}

function compactImageTabsForStore(snapshot: WorkspaceSnapshot, usedImageRefs: Set<string>) {
  const tabs: ImageTabSnapshot[] = [];
  for (const tab of snapshot.imageTabs ?? []) {
    tabs.push({
      ...tab,
      dataUrl: imageDataRefForStore(snapshot.id, `tab:${tab.id}`, tab.dataUrl, usedImageRefs),
      history: compactImageHistoryForStore(snapshot.id, tab, usedImageRefs)
    });
  }
  return tabs;
}

function compactImageHistoryForStore(workspaceId: string, tab: ImageTabSnapshot, usedImageRefs: Set<string>) {
  const history: PastedImageItem[] = [];
  for (const item of tab.history ?? []) {
    history.push({
      ...item,
      dataUrl: imageDataRefForStore(workspaceId, `history:${tab.id}:${item.id}`, item.dataUrl, usedImageRefs)
    });
  }
  return history;
}

function imageDataRefForStore(workspaceId: string, scope: string, dataUrl: string, usedImageRefs: Set<string>) {
  if (!dataUrl) return dataUrl;
  if (dataUrl.startsWith(WORKSPACE_IMAGE_REF_PREFIX)) {
    usedImageRefs.add(dataUrl.slice(WORKSPACE_IMAGE_REF_PREFIX.length));
    return dataUrl;
  }
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  const key = imageRefKeyForDataUrl(workspaceId, scope, dataUrl);
  usedImageRefs.add(key);
  if (workspaceImageStore[key] !== dataUrl) {
    workspaceImageStore[key] = dataUrl;
    workspaceImageStoreDirty = true;
  }
  return `${WORKSPACE_IMAGE_REF_PREFIX}${key}`;
}

function imageRefKeyForDataUrl(workspaceId: string, scope: string, dataUrl: string) {
  const cacheKey = `${workspaceId}:${scope}`;
  let cached = workspaceImageRefCache.get(cacheKey);
  let key = cached?.dataUrl === dataUrl ? cached.key : '';
  if (!key) {
    key = `${cacheKey}:${dataUrl.length}:${hashText(dataUrl).toString(36)}`;
    cached = { dataUrl, key };
  }
  const refEntry = cached ?? { dataUrl, key };
  workspaceImageRefCache.delete(cacheKey);
  workspaceImageRefCache.set(cacheKey, refEntry);
  pruneWorkspaceImageRefCache();
  return key;
}

function hydrateWorkspaceImageRefs(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    imageTabs: hydrateWorkspaceImageTabs(snapshot)
  };
}

function hydrateWorkspaceImageTabs(snapshot: WorkspaceSnapshot) {
  const tabs: ImageTabSnapshot[] = [];
  for (const tab of snapshot.imageTabs ?? []) {
    tabs.push({
      ...tab,
      dataUrl: hydrateWorkspaceImageDataUrl(snapshot.id, `tab:${tab.id}`, tab.dataUrl),
      history: hydrateWorkspaceImageHistory(snapshot.id, tab)
    });
  }
  return tabs;
}

function hydrateWorkspaceImageHistory(workspaceId: string, tab: ImageTabSnapshot) {
  const history: PastedImageItem[] = [];
  for (const item of tab.history ?? []) {
    history.push({
      ...item,
      dataUrl: hydrateWorkspaceImageDataUrl(workspaceId, `history:${tab.id}:${item.id}`, item.dataUrl)
    });
  }
  return history;
}

function hydrateWorkspaceImageDataUrl(workspaceId: string, scope: string, dataUrl: string) {
  if (!dataUrl?.startsWith(WORKSPACE_IMAGE_REF_PREFIX)) return dataUrl || '';
  const key = dataUrl.slice(WORKSPACE_IMAGE_REF_PREFIX.length);
  const stored = workspaceImageStore[key] ?? '';
  if (stored) {
    const cacheKey = `${workspaceId}:${scope}`;
    workspaceImageRefCache.delete(cacheKey);
    workspaceImageRefCache.set(cacheKey, { dataUrl: stored, key });
    pruneWorkspaceImageRefCache();
  }
  return stored;
}

function pruneWorkspaceImageStore(usedImageRefs: Set<string>) {
  for (const key of Object.keys(workspaceImageStore)) {
    if (usedImageRefs.has(key)) continue;
    delete workspaceImageStore[key];
    workspaceImageStoreDirty = true;
  }
  for (const [scope, cached] of workspaceImageRefCache) {
    if (usedImageRefs.has(cached.key)) continue;
    workspaceImageRefCache.delete(scope);
  }
}

function pruneWorkspaceImageRefCache() {
  while (workspaceImageRefCache.size > WORKSPACE_IMAGE_REF_CACHE_LIMIT) {
    const oldest = workspaceImageRefCache.keys().next().value;
    if (oldest === undefined) break;
    workspaceImageRefCache.delete(oldest);
  }
}

function persistWorkspaceImageStoreIfNeeded() {
  if (!workspaceImageStoreDirty) return true;
  try {
    localStorage.setItem(WORKSPACE_IMAGE_STORE_KEY, JSON.stringify(workspaceImageStore));
    workspaceImageStoreDirty = false;
    return true;
  } catch {
    // If the split image store cannot be written, fall back to full data URLs
    // in the main workspace payload for this persist attempt.
    return false;
  }
}

function workspaceStoreSignature(workspacesSignature = workspaceStoreWorkspacesSignature()) {
  return [
    'v1',
    workspaceSignaturePart(state.activeWorkspaceId),
    workspacesSignature
  ].join('\n');
}

function workspaceStoreWorkspacesSignature() {
  const count = Math.min(state.workspaceSnapshots.length, WORKSPACE_STORE_PERSIST_LIMIT);
  let signatureText = '';
  for (let index = 0; index < count; index += 1) {
    const snapshot = state.workspaceSnapshots[index];
    let signature = workspaceSnapshotSignatures.get(snapshot.id);
    if (!signature) {
      signature = workspaceSnapshotSignature(snapshot);
      workspaceSnapshotSignatures.set(snapshot.id, signature);
    }
    if (index) signatureText += '\n';
    signatureText += `${index}:${workspaceSignaturePart(snapshot.id)}:${signature}`;
  }
  return signatureText;
}

function workspaceTabsRenderNeeded() {
  return workspaceTabsRenderSignature !== workspaceTabsSignature()
    || workspaceTabsOrderRenderSignature !== workspaceTabsOrderSignature()
    || el.workspaceTabs.childElementCount !== state.workspaceSnapshots.length;
}

function scheduleWorkspaceStorePersist(delayMs = 180) {
  if (workspacePersistTimer) return;
  workspacePersistTimer = window.setTimeout(() => {
    workspacePersistTimer = 0;
    const delay = workspaceStorePersistDelayMs();
    if (delay > 0) {
      scheduleWorkspaceStorePersist(delay);
      return;
    }
    persistWorkspaceStore();
  }, delayMs);
}

function workspaceStorePersistDelayMs() {
  return workspacePersistenceBusyDelayMs();
}

function workspacePersistenceBusyDelayMs() {
  const scrollPause = explorerScrollingUntil - Date.now();
  if (scrollPause > 0) return scrollPause + EXPLORER_SCROLL_IDLE_MS;
  if (workspaceDragState?.dragging) return 240;
  if (uiInputPending()) return 80;
  return 0;
}

function flushWorkspaceStorePersist() {
  if (workspacePersistTimer) {
    window.clearTimeout(workspacePersistTimer);
    workspacePersistTimer = 0;
  }
  persistWorkspaceStore();
}

function loadIdeSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IDE_SETTINGS_KEY) ?? '') as Partial<IdeSettings>;
    state.ideSettings = {
      ...DEFAULT_IDE_SETTINGS,
      ...parsed,
      editorTheme: isEditorThemeId(parsed.editorTheme) ? parsed.editorTheme : DEFAULT_IDE_SETTINGS.editorTheme,
      extraMaskPatterns: Array.isArray(parsed.extraMaskPatterns)
        ? parsed.extraMaskPatterns.map(String).filter(Boolean)
        : DEFAULT_IDE_SETTINGS.extraMaskPatterns
    };
  } catch {
    state.ideSettings = { ...DEFAULT_IDE_SETTINGS };
  }
  applyIdeSettings();
}

function persistIdeSettings() {
  localStorage.setItem(IDE_SETTINGS_KEY, JSON.stringify(state.ideSettings));
}

function renderSettings() {
  renderFontOptions(el.settingsUiFont, UI_FONT_CHOICES, state.ideSettings.uiFont);
  renderFontOptions(el.settingsMonoFont, MONO_FONT_CHOICES, state.ideSettings.monoFont);
  renderChoiceOptions(el.settingsEditorTheme, EDITOR_THEME_CHOICES, state.ideSettings.editorTheme);
  const maskPatterns = state.ideSettings.extraMaskPatterns.join('\n');
  if (el.settingsMaskPatterns.value !== maskPatterns) el.settingsMaskPatterns.value = maskPatterns;
}

function renderFontOptions(select: HTMLSelectElement, choices: FontChoice[], activeId: string) {
  renderChoiceOptions(select, choices, activeId);
}

function renderChoiceOptions(select: HTMLSelectElement, choices: Array<{ id: string; label: string }>, activeId: string) {
  const optionsSignature = choiceOptionsSignature(choices);
  if (selectOptionsRenderSignatures.get(select) !== optionsSignature) {
    selectOptionsRenderSignatures.set(select, optionsSignature);
    select.innerHTML = '';
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = choice.label;
      select.append(option);
    }
  }
  const nextValue = choices.some((choice) => choice.id === activeId) ? activeId : choices[0].id;
  if (select.value !== nextValue) select.value = nextValue;
}

function choiceOptionsSignature(choices: Array<{ id: string; label: string }>) {
  let signature = '';
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index];
    if (index) signature += '\n';
    signature += `${choice.id}\t${choice.label}`;
  }
  return signature;
}

function saveSettingsFromForm() {
  state.ideSettings = {
    uiFont: el.settingsUiFont.value,
    monoFont: el.settingsMonoFont.value,
    editorTheme: editorThemeId(el.settingsEditorTheme.value),
    extraMaskPatterns: el.settingsMaskPatterns.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  };
  persistIdeSettings();
  applyIdeSettings();
  renderSettings();
  setStatus('Settings saved');
}

function applyIdeSettings() {
  const uiFont = fontChoice(UI_FONT_CHOICES, state.ideSettings.uiFont).stack;
  const monoFont = fontChoice(MONO_FONT_CHOICES, state.ideSettings.monoFont).stack;
  setRootStyleProperty('--ui-font', uiFont);
  setRootStyleProperty('--mono-font', monoFont);
  applyEditorTheme(state.ideSettings.editorTheme);
  configurePrivacyPolicy(state.ideSettings.extraMaskPatterns);
  for (const pane of state.terminals) {
    pane.term.options.fontFamily = monoFont;
    pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
    scheduleFitTerminal(pane);
  }
  requestCodeEditorMeasure();
}

function fontChoice(choices: FontChoice[], id: string) {
  return choices.find((choice) => choice.id === id) ?? choices[0];
}

function editorThemeChoice(id: string) {
  return EDITOR_THEME_CHOICES.find((choice) => choice.id === id) ?? EDITOR_THEME_CHOICES[0];
}

function editorThemeId(id: string): EditorThemeId {
  return editorThemeChoice(id).id;
}

function isEditorThemeId(id: unknown): id is EditorThemeId {
  return typeof id === 'string' && EDITOR_THEME_CHOICES.some((choice) => choice.id === id);
}

function applyEditorTheme(id: string) {
  const theme = editorThemeChoice(id);
  if (document.documentElement.dataset.editorTheme !== theme.id) {
    document.documentElement.dataset.editorTheme = theme.id;
  }
  for (const [name, value] of Object.entries(theme.vars)) {
    setRootStyleProperty(name, value);
  }
}

function setRootStyleProperty(name: string, value: string) {
  const style = document.documentElement.style;
  if (style.getPropertyValue(name) === value) return false;
  style.setProperty(name, value);
  return true;
}

function loadMarketTickerConfig() {
  state.marketTickers = DEFAULT_MARKET_TICKERS.map((item) => ({ ...item }));
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKET_TICKER_STORE_KEY) ?? '') as { custom?: unknown };
    if (!Array.isArray(parsed.custom)) return;
    const custom = parsed.custom
      .map((item) => normalizeMarketSymbol(String(item ?? '')))
      .filter((symbol) => symbol && !state.marketTickers.some((ticker) => ticker.symbol === symbol))
      .slice(0, MARKET_TICKER_MAX_CUSTOM);
    for (const symbol of custom) {
      state.marketTickers.push({ id: `custom-${symbol.toLowerCase()}`, label: displaySymbol(symbol), symbol, removable: true });
    }
  } catch {
    localStorage.removeItem(MARKET_TICKER_STORE_KEY);
  }
}

function persistMarketTickerConfig() {
  const custom: string[] = [];
  for (const ticker of state.marketTickers) {
    if (!ticker.removable) continue;
    custom.push(ticker.symbol);
    if (custom.length >= MARKET_TICKER_MAX_CUSTOM) break;
  }
  localStorage.setItem(MARKET_TICKER_STORE_KEY, JSON.stringify({ custom }));
}

function marketTickerRenderStateSignature() {
  let signature = '';
  let customCount = 0;
  for (let index = 0; index < state.marketTickers.length; index += 1) {
    const ticker = state.marketTickers[index];
    const quote = state.marketQuotes.get(ticker.symbol);
    const updatedSecond = quote?.updatedAt ? Math.floor(quote.updatedAt / 1000) : 0;
    if (ticker.removable) customCount += 1;
    if (index) signature += '\n';
    signature += `${ticker.id}|${ticker.label}|${ticker.symbol}|${ticker.removable ? 1 : 0}|${quote?.price ?? ''}|${quote?.changePercent ?? ''}|${updatedSecond}|${quote?.status ?? 'loading'}|${quote?.message ?? ''}`;
  }
  return `${customCount}/${MARKET_TICKER_MAX_CUSTOM}\n${signature}`;
}

function renderMarketTicker() {
  const signature = marketTickerRenderStateSignature();
  if (signature === marketTickerRenderSignature) return;
  const orderSignature = marketTickerOrderSignature();
  const sameOrder = marketTickerOrderRenderSignature === orderSignature
    && el.marketTickerList.childElementCount === state.marketTickers.length;
  marketTickerRenderSignature = signature;
  marketTickerLastRenderAt = Date.now();

  if (sameOrder) {
    for (const ticker of state.marketTickers) {
      updateMarketTickerElement(marketTickerElement(ticker.id), ticker);
    }
    updateMarketTickerAddControls();
    return;
  }

  marketTickerOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const ticker of state.marketTickers) {
    seen.add(ticker.id);
    const item = marketTickerElement(ticker.id);
    updateMarketTickerElement(item, ticker);
    fragment.append(item);
  }
  el.marketTickerList.replaceChildren(fragment);
  pruneMarketTickerElementCache(seen);
  updateMarketTickerAddControls();
}

function marketTickerElement(id: string) {
  const cached = marketTickerElementCache.get(id);
  if (cached) return cached;
  const item = document.createElement('div');
  item.className = 'market-chip';

  const label = document.createElement('span');
  label.className = 'market-label';
  const price = document.createElement('span');
  price.className = 'market-price';
  const change = document.createElement('span');
  change.className = 'market-change';
  item.append(label, price, change);
  marketTickerPartCache.set(item, { label, price, change });
  marketTickerElementCache.set(id, item);
  return item;
}

function marketTickerParts(item: HTMLElement) {
  const cached = marketTickerPartCache.get(item);
  if (cached) return cached;
  const parts: {
    label: HTMLElement;
    price: HTMLElement;
    change: HTMLElement;
    remove?: HTMLButtonElement;
  } = {
    label: item.querySelector<HTMLElement>('.market-label')!,
    price: item.querySelector<HTMLElement>('.market-price')!,
    change: item.querySelector<HTMLElement>('.market-change')!
  };
  const remove = item.querySelector<HTMLButtonElement>('.market-remove');
  if (remove) parts.remove = remove;
  marketTickerPartCache.set(item, parts);
  return parts;
}

function updateMarketTickerElement(item: HTMLElement, ticker: MarketTickerConfig) {
  const quote = state.marketQuotes.get(ticker.symbol) ?? {
    symbol: ticker.symbol,
    price: null,
    changePercent: null,
    updatedAt: 0,
    status: 'loading' as const
  };
  const trend = marketTrendClass(quote);
  const title = marketTickerTitle(ticker, quote);
  const priceText = formatMarketPrice(quote.price);
  const changeText = formatMarketChange(quote.changePercent);
  const signature = `${ticker.id}\t${ticker.label}\t${ticker.symbol}\t${ticker.removable ? '1' : '0'}\t${trend}\t${title}\t${priceText}\t${changeText}`;
  item.dataset.marketTickerId = ticker.id;
  item.dataset.marketSymbol = ticker.symbol;
  const parts = marketTickerParts(item);
  if (item.dataset.renderSignature !== signature) {
    item.dataset.renderSignature = signature;
    item.className = `market-chip ${trend}`;
    item.title = title;
    setTextContentIfChanged(parts.label, ticker.label);
    setTextContentIfChanged(parts.price, priceText);
    setTextContentIfChanged(parts.change, changeText);
  }

  let remove = parts.remove;
  if (ticker.removable) {
    if (!remove || !remove.isConnected) {
      remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'market-remove';
      remove.textContent = 'x';
      remove.addEventListener('click', () => {
        const symbol = item.dataset.marketSymbol;
        if (symbol) removeMarketTicker(symbol);
      });
      item.append(remove);
      parts.remove = remove;
    }
    remove.title = `Remove ${ticker.symbol}`;
  } else {
    if (remove) {
      remove.remove();
      delete parts.remove;
    }
  }
}

function pruneMarketTickerElementCache(seen: Set<string>) {
  for (const id of marketTickerElementCache.keys()) {
    if (!seen.has(id)) marketTickerElementCache.delete(id);
  }
}

function marketTickerOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.marketTickers.length; index += 1) {
    if (index) signature += '\n';
    signature += state.marketTickers[index].id;
  }
  return signature;
}

function updateMarketTickerAddControls() {
  let customCount = 0;
  for (const ticker of state.marketTickers) {
    if (ticker.removable) customCount += 1;
  }
  const canAdd = customCount < MARKET_TICKER_MAX_CUSTOM;
  el.marketSymbolInput.classList.toggle('hidden', !canAdd);
  el.marketAddSymbol.classList.toggle('hidden', !canAdd);
  el.marketSymbolInput.disabled = !canAdd;
  el.marketAddSymbol.disabled = !canAdd;
}

function marketTickerTitle(ticker: MarketTickerConfig, quote: MarketTickerQuote) {
  const source = ticker.symbol === 'QQQUSDT' && ticker.label === 'NAS100'
    ? 'Nasdaq-100 proxy via Binance USD-M QQQUSDT'
    : `Binance USD-M ${ticker.symbol}`;
  const status = quote.status === 'live'
    ? `updated ${new Date(quote.updatedAt).toLocaleTimeString()}`
    : quote.message || quote.status;
  return `${source} - ${status}`;
}

function marketTrendClass(quote: MarketTickerQuote) {
  const stale = quote.status === 'stale' || quote.status === 'error';
  if (quote.changePercent === null || quote.status === 'loading') return stale ? 'stale' : 'flat';
  if (quote.changePercent > 0) return stale ? 'up stale' : 'up';
  if (quote.changePercent < 0) return stale ? 'down stale' : 'down';
  return stale ? 'flat stale' : 'flat';
}

function scheduleMarketTickerRender() {
  if (document.hidden) return;
  if (marketTickerRenderFrame || marketTickerRenderTimer) return;
  const elapsed = Date.now() - marketTickerLastRenderAt;
  if (elapsed < MARKET_TICKER_RENDER_MIN_MS) {
    marketTickerRenderTimer = window.setTimeout(() => {
      marketTickerRenderTimer = 0;
      scheduleMarketTickerRender();
    }, MARKET_TICKER_RENDER_MIN_MS - elapsed);
    return;
  }
  marketTickerRenderFrame = window.requestAnimationFrame(() => {
    marketTickerRenderFrame = 0;
    renderMarketTicker();
  });
}

function scheduleMarketTickerStart(delayMs = MARKET_TICKER_VISIBLE_RESUME_DELAY_MS) {
  if (document.hidden) return;
  if (marketTickerStarted && marketTickerSocket && (marketTickerSocket.readyState === WebSocket.CONNECTING || marketTickerSocket.readyState === WebSocket.OPEN)) {
    scheduleMarketTickerRender();
    return;
  }
  if (marketTickerStartTimer) window.clearTimeout(marketTickerStartTimer);
  marketTickerStartTimer = window.setTimeout(() => {
    marketTickerStartTimer = 0;
    runWhenUiIdle(() => {
      if (!document.hidden) startMarketTicker();
    }, MARKET_TICKER_IDLE_TIMEOUT_MS);
  }, delayMs);
}

function startMarketTicker() {
  if (document.hidden) return;
  marketTickerStarted = true;
  void fetchMarketTickerSnapshot();
  connectMarketTickerSocket();
}

function restartMarketTicker() {
  if (marketTickerStartTimer) window.clearTimeout(marketTickerStartTimer);
  marketTickerStartTimer = 0;
  if (marketTickerReconnectTimer) window.clearTimeout(marketTickerReconnectTimer);
  marketTickerReconnectTimer = 0;
  if (marketTickerFallbackTimer) window.clearTimeout(marketTickerFallbackTimer);
  marketTickerFallbackTimer = 0;
  marketTickerFetchAbort?.abort();
  marketTickerFetchAbort = null;
  const socket = marketTickerSocket;
  marketTickerSocket = null;
  if (socket) socket.close();
  marketTickerReconnectAttempt = 0;
  marketTickerStarted = false;
  scheduleMarketTickerStart(0);
}

function pauseMarketTickerForHidden() {
  if (marketTickerStartTimer) window.clearTimeout(marketTickerStartTimer);
  if (marketTickerReconnectTimer) window.clearTimeout(marketTickerReconnectTimer);
  if (marketTickerFallbackTimer) window.clearTimeout(marketTickerFallbackTimer);
  if (marketTickerRenderTimer) window.clearTimeout(marketTickerRenderTimer);
  if (marketTickerRenderFrame) window.cancelAnimationFrame(marketTickerRenderFrame);
  marketTickerStartTimer = 0;
  marketTickerReconnectTimer = 0;
  marketTickerFallbackTimer = 0;
  marketTickerRenderTimer = 0;
  marketTickerRenderFrame = 0;
  marketTickerFetchAbort?.abort();
  marketTickerFetchAbort = null;
  const socket = marketTickerSocket;
  marketTickerSocket = null;
  if (socket) socket.close();
  marketTickerStarted = false;
  state.marketTickerConnected = false;
  markMarketQuotesStale();
}

function connectMarketTickerSocket() {
  if (document.hidden) return;
  if (marketTickerSocket && (marketTickerSocket.readyState === WebSocket.CONNECTING || marketTickerSocket.readyState === WebSocket.OPEN)) return;
  const streams = state.marketTickers
    .map((ticker) => `${ticker.symbol.toLowerCase()}@ticker`)
    .join('/');
  if (!streams) return;
  if (marketTickerReconnectTimer) {
    window.clearTimeout(marketTickerReconnectTimer);
    marketTickerReconnectTimer = 0;
  }
  try {
    const socket = new WebSocket(`${MARKET_TICKER_WS_URL}${streams}`);
    marketTickerSocket = socket;
    socket.addEventListener('open', () => {
      if (socket !== marketTickerSocket) return;
      state.marketTickerConnected = true;
      marketTickerReconnectAttempt = 0;
      scheduleMarketTickerRender();
    });
    socket.addEventListener('message', (event) => {
      if (socket !== marketTickerSocket) return;
      handleMarketTickerMessage(event.data);
    });
    socket.addEventListener('close', () => {
      if (socket !== marketTickerSocket) return;
      state.marketTickerConnected = false;
      if (document.hidden) return;
      markMarketQuotesStale();
      scheduleMarketTickerReconnect();
    });
    socket.addEventListener('error', () => {
      if (socket !== marketTickerSocket) return;
      state.marketTickerConnected = false;
      socket.close();
    });
  } catch {
    state.marketTickerConnected = false;
    markMarketQuotesStale();
    scheduleMarketTickerReconnect();
  }
}

function scheduleMarketTickerReconnect() {
  if (document.hidden) return;
  if (marketTickerReconnectTimer) window.clearTimeout(marketTickerReconnectTimer);
  const delay = Math.min(60000, 2500 * 2 ** Math.min(marketTickerReconnectAttempt, 5));
  marketTickerReconnectAttempt += 1;
  marketTickerReconnectTimer = window.setTimeout(() => {
    marketTickerReconnectTimer = 0;
    if (!document.hidden) connectMarketTickerSocket();
  }, delay);
}

function handleMarketTickerMessage(raw: unknown) {
  try {
    const payload = JSON.parse(String(raw)) as { data?: Record<string, unknown> };
    const data = payload.data ?? payload as Record<string, unknown>;
    const symbol = String(data.s ?? '').toUpperCase();
    if (!symbol || !state.marketTickers.some((ticker) => ticker.symbol === symbol)) return;
    updateMarketQuote(symbol, Number(data.c), Number(data.P), 'live');
  } catch {
    // Ignore malformed market packets; the next ticker update arrives independently.
  }
}

function updateMarketQuote(symbol: string, price: number, changePercent: number, status: MarketTickerQuote['status'], message?: string) {
  state.marketQuotes.set(symbol, {
    symbol,
    price: Number.isFinite(price) ? price : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    updatedAt: Date.now(),
    status,
    message
  });
  scheduleMarketTickerRender();
}

async function fetchMarketTickerSnapshot() {
  if (document.hidden || marketTickerSnapshotInFlight) return;
  if (marketTickerFallbackTimer) window.clearTimeout(marketTickerFallbackTimer);
  marketTickerFallbackTimer = 0;
  const tickers = state.marketTickers.slice();
  if (!tickers.length) return;
  marketTickerSnapshotInFlight = true;
  const controller = new AbortController();
  marketTickerFetchAbort = controller;
  const abortTimer = window.setTimeout(() => controller.abort(), MARKET_TICKER_FETCH_TIMEOUT_MS);
  try {
    await Promise.allSettled(tickers.map(async (ticker) => {
      try {
        const response = await fetch(`${MARKET_TICKER_REST_URL}${encodeURIComponent(ticker.symbol)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { lastPrice?: string; priceChangePercent?: string };
        updateMarketQuote(ticker.symbol, Number(data.lastPrice), Number(data.priceChangePercent), state.marketTickerConnected ? 'live' : 'stale');
      } catch (error) {
        if (controller.signal.aborted) return;
        markMarketQuoteError(ticker.symbol, String(error));
      }
    }));
  } finally {
    window.clearTimeout(abortTimer);
    if (marketTickerFetchAbort === controller) marketTickerFetchAbort = null;
    marketTickerSnapshotInFlight = false;
    if (!document.hidden) {
      marketTickerFallbackTimer = window.setTimeout(() => void fetchMarketTickerSnapshot(), MARKET_TICKER_FALLBACK_MS);
    }
  }
}

function markMarketQuotesStale() {
  for (const ticker of state.marketTickers) {
    const quote = state.marketQuotes.get(ticker.symbol);
    if (!quote) continue;
    const status = Date.now() - quote.updatedAt > MARKET_TICKER_STALE_MS ? 'stale' : quote.status;
    state.marketQuotes.set(ticker.symbol, { ...quote, status });
  }
  scheduleMarketTickerRender();
}

function markMarketQuoteError(symbol: string, message: string) {
  const existing = state.marketQuotes.get(symbol);
  if (existing && existing.price !== null) {
    state.marketQuotes.set(symbol, { ...existing, status: 'stale', message });
  } else {
    state.marketQuotes.set(symbol, {
      symbol,
      price: null,
      changePercent: null,
      updatedAt: Date.now(),
      status: 'error',
      message
    });
  }
  scheduleMarketTickerRender();
}

function addMarketTickerFromInput() {
  const symbol = normalizeMarketSymbol(el.marketSymbolInput.value);
  if (!symbol) {
    el.marketSymbolInput.focus();
    return;
  }
  if (state.marketTickers.some((ticker) => ticker.symbol === symbol)) {
    el.marketSymbolInput.value = '';
    return;
  }
  let customCount = 0;
  for (const ticker of state.marketTickers) {
    if (ticker.removable) customCount += 1;
  }
  if (customCount >= MARKET_TICKER_MAX_CUSTOM) return;
  state.marketTickers.push({ id: `custom-${symbol.toLowerCase()}`, label: displaySymbol(symbol), symbol, removable: true });
  el.marketSymbolInput.value = '';
  persistMarketTickerConfig();
  renderMarketTicker();
  restartMarketTicker();
}

function removeMarketTicker(symbol: string) {
  state.marketTickers = state.marketTickers.filter((ticker) => ticker.symbol !== symbol || !ticker.removable);
  state.marketQuotes.delete(symbol);
  persistMarketTickerConfig();
  renderMarketTicker();
  restartMarketTicker();
}

function normalizeMarketSymbol(value: string) {
  return value.trim().replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 24);
}

function displaySymbol(symbol: string) {
  return symbol.endsWith('USDT') && symbol.length > 4 ? symbol.slice(0, -4) : symbol;
}

function formatMarketPrice(price: number | null) {
  if (price === null) return '--';
  const maximumFractionDigits = price >= 1000 ? 1 : price >= 100 ? 2 : price >= 1 ? 4 : 8;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(price);
}

function formatMarketChange(change: number | null) {
  if (change === null) return '--';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  const item = value as WorkspaceSnapshot;
  return Boolean(item && typeof item.id === 'string' && typeof item.profileId === 'string');
}

function clearWorkspaceSnapshotLookup() {
  workspaceSnapshotById.clear();
  workspaceSnapshotIndexByIdLookup.clear();
}

function rebuildWorkspaceSnapshotLookup() {
  clearWorkspaceSnapshotLookup();
  for (let index = 0; index < state.workspaceSnapshots.length; index += 1) {
    rememberWorkspaceSnapshot(state.workspaceSnapshots[index], index);
  }
}

function rememberWorkspaceSnapshot(snapshot: WorkspaceSnapshot, index?: number) {
  workspaceSnapshotById.set(snapshot.id, snapshot);
  if (index !== undefined) workspaceSnapshotIndexByIdLookup.set(snapshot.id, index);
}

function forgetWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  workspaceSnapshotById.delete(snapshot.id);
  workspaceSnapshotIndexByIdLookup.delete(snapshot.id);
}

function workspaceSnapshotForId(id: string) {
  if (!id) return null;
  let snapshot = workspaceSnapshotById.get(id) ?? null;
  if (!snapshot) {
    for (let index = 0; index < state.workspaceSnapshots.length; index += 1) {
      const candidate = state.workspaceSnapshots[index];
      if (candidate.id !== id) continue;
      snapshot = candidate;
      rememberWorkspaceSnapshot(snapshot, index);
      break;
    }
  }
  return snapshot;
}

function workspaceSnapshotIndexById(id: string) {
  const cachedIndex = workspaceSnapshotIndexByIdLookup.get(id);
  if (cachedIndex !== undefined && state.workspaceSnapshots[cachedIndex]?.id === id) return cachedIndex;
  for (let index = 0; index < state.workspaceSnapshots.length; index += 1) {
    const snapshot = state.workspaceSnapshots[index];
    if (snapshot.id !== id) continue;
    rememberWorkspaceSnapshot(snapshot, index);
    return index;
  }
  workspaceSnapshotIndexByIdLookup.delete(id);
  return -1;
}

function insertWorkspaceSnapshot(index: number, snapshot: WorkspaceSnapshot) {
  const insertIndex = clamp(index, 0, state.workspaceSnapshots.length);
  state.workspaceSnapshots.splice(insertIndex, 0, snapshot);
  refreshWorkspaceSnapshotIndexLookup(insertIndex);
}

function replaceWorkspaceSnapshot(index: number, snapshot: WorkspaceSnapshot) {
  const previous = state.workspaceSnapshots[index];
  if (previous && previous.id !== snapshot.id) forgetWorkspaceSnapshot(previous);
  state.workspaceSnapshots[index] = snapshot;
  rememberWorkspaceSnapshot(snapshot, index);
}

function removeWorkspaceSnapshotById(id: string) {
  const index = workspaceSnapshotIndexById(id);
  if (index < 0) return null;
  const [snapshot] = state.workspaceSnapshots.splice(index, 1);
  if (snapshot) forgetWorkspaceSnapshot(snapshot);
  refreshWorkspaceSnapshotIndexLookup(index);
  return snapshot ?? null;
}

function refreshWorkspaceSnapshotIndexLookup(startIndex = 0) {
  const start = clamp(startIndex, 0, state.workspaceSnapshots.length);
  for (let index = start; index < state.workspaceSnapshots.length; index += 1) {
    rememberWorkspaceSnapshot(state.workspaceSnapshots[index], index);
  }
}

function renderWorkspaceTabs() {
  const signature = workspaceTabsSignature();
  if (workspaceTabsRenderSignature === signature) return;
  const orderSignature = workspaceTabsOrderSignature();
  const sameOrder = workspaceTabsOrderRenderSignature === orderSignature
    && el.workspaceTabs.childElementCount === state.workspaceSnapshots.length;
  workspaceTabsRenderSignature = signature;

  if (sameOrder) {
    for (const workspace of state.workspaceSnapshots) {
      updateWorkspaceTabElement(workspaceTabElement(workspace.id), workspace);
    }
    return;
  }

  workspaceTabsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const workspace of state.workspaceSnapshots) {
    seen.add(workspace.id);
    const tab = workspaceTabElement(workspace.id);
    updateWorkspaceTabElement(tab, workspace);
    fragment.append(tab);
  }
  el.workspaceTabs.replaceChildren(fragment);
  pruneWorkspaceTabElementCache(seen);
}

function renderWorkspaceTabActivation(previousActiveId: string, activeWorkspace: WorkspaceSnapshot) {
  const orderSignature = workspaceTabsOrderSignature();
  const previousChanged = Boolean(previousActiveId && previousActiveId !== activeWorkspace.id);
  const previousWorkspace = previousChanged
    ? workspaceSnapshotForId(previousActiveId)
    : null;
  const previousTab = previousChanged ? connectedWorkspaceTabElement(previousActiveId) : null;
  const activeTab = connectedWorkspaceTabElement(activeWorkspace.id);
  if (
    workspaceTabsOrderRenderSignature !== orderSignature
    || el.workspaceTabs.childElementCount !== state.workspaceSnapshots.length
    || !activeTab
    || (previousChanged && (!previousWorkspace || !previousTab))
  ) {
    renderWorkspaceTabs();
    return;
  }
  if (previousWorkspace && previousTab) updateWorkspaceTabElement(previousTab, previousWorkspace);
  updateWorkspaceTabElement(activeTab, activeWorkspace);
  workspaceTabsRenderSignature = workspaceTabsSignature();
}

function connectedWorkspaceTabElement(id: string) {
  const tab = workspaceTabElementCache.get(id);
  return tab?.isConnected ? tab : null;
}

function workspaceTabElement(id: string) {
  const cached = workspaceTabElementCache.get(id);
  if (cached) return cached;
  const tab = document.createElement('div');
  tab.className = 'workspace-tab';
  tab.draggable = false;
  const label = document.createElement('button');
  label.className = 'workspace-tab-label';
  label.type = 'button';
  label.title = 'Open workspace. Double-click or press F2 to rename.';
  const input = document.createElement('input');
  input.className = 'workspace-tab-name-input';
  input.type = 'text';
  input.maxLength = 64;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Workspace name');
  const security = document.createElement('button');
  security.className = 'workspace-tab-security';
  security.type = 'button';
  security.append(workspaceTabSvgIcon([
    ['path', { d: 'M5 7V5a3 3 0 0 1 6 0v2' }],
    ['rect', { x: '3.5', y: '7', width: '9', height: '7', rx: '1.5' }]
  ]));
  const copy = document.createElement('button');
  copy.className = 'workspace-tab-copy';
  copy.type = 'button';
  copy.title = 'Copy workspace';
  copy.setAttribute('aria-label', 'Copy workspace');
  copy.append(workspaceTabSvgIcon([
    ['rect', { x: '5', y: '3', width: '8', height: '10', rx: '1.5' }],
    ['path', { d: 'M3 11V5.5A1.5 1.5 0 0 1 4.5 4H10' }]
  ]));
  const close = document.createElement('button');
  close.className = 'workspace-tab-close';
  close.type = 'button';
  close.title = 'Close workspace';
  close.setAttribute('aria-label', 'Close workspace');
  close.textContent = 'x';
  tab.append(label, security, copy, close, input);
  const parts = { label, input, security, copy, close };
  workspaceTabPartCache.set(tab, parts);
  parts.label.draggable = false;
  parts.input.draggable = false;
  parts.security.draggable = false;
  parts.copy.draggable = false;
  parts.close.draggable = false;
  parts.label.addEventListener('click', (event) => {
    if (suppressWorkspaceTabClick) {
      event.preventDefault();
      return;
    }
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) void activateWorkspaceTab(workspaceId);
  });
  parts.label.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) startWorkspaceTabRename(workspaceId);
  });
  parts.label.addEventListener('keydown', (event) => {
    if (event.key !== 'F2') return;
    event.preventDefault();
    event.stopPropagation();
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) startWorkspaceTabRename(workspaceId);
  });
  parts.input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finishWorkspaceTabRename(tab, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishWorkspaceTabRename(tab, false);
    }
  });
  parts.input.addEventListener('blur', () => finishWorkspaceTabRename(tab, true));
  parts.input.addEventListener('pointerdown', (event) => event.stopPropagation());
  parts.input.addEventListener('click', (event) => event.stopPropagation());
  parts.security.addEventListener('click', (event) => {
    event.stopPropagation();
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) void toggleWorkspaceCaptureProtection(workspaceId);
  });
  parts.copy.addEventListener('click', (event) => {
    event.stopPropagation();
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) void copyWorkspaceTab(workspaceId);
  });
  parts.close.addEventListener('click', (event) => {
    event.stopPropagation();
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) void closeWorkspaceTab(workspaceId);
  });
  tab.addEventListener('pointerdown', (event) => {
    const workspaceId = workspaceIdForTabElement(tab);
    if (workspaceId) startWorkspaceTabPointerDrag(event, workspaceId, tab);
  });
  tab.addEventListener('pointermove', (event) => updateWorkspaceTabPointerDrag(event, tab));
  tab.addEventListener('pointerup', (event) => finishWorkspaceTabPointerDrag(event, tab, true));
  tab.addEventListener('pointercancel', (event) => finishWorkspaceTabPointerDrag(event, tab, false));
  workspaceTabElementCache.set(id, tab);
  return tab;
}

function workspaceTabSvgIcon(children: Array<['path' | 'rect', Record<string, string>]>) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of children) {
    const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) child.setAttribute(name, value);
    svg.append(child);
  }
  return svg;
}

function workspaceTabParts(tab: HTMLElement) {
  const cached = workspaceTabPartCache.get(tab);
  if (cached) return cached;
  const parts = {
    label: tab.querySelector<HTMLButtonElement>('.workspace-tab-label')!,
    input: tab.querySelector<HTMLInputElement>('.workspace-tab-name-input')!,
    security: tab.querySelector<HTMLButtonElement>('.workspace-tab-security')!,
    copy: tab.querySelector<HTMLButtonElement>('.workspace-tab-copy')!,
    close: tab.querySelector<HTMLButtonElement>('.workspace-tab-close')!
  };
  workspaceTabPartCache.set(tab, parts);
  return parts;
}

function updateWorkspaceTabElement(tab: HTMLElement, workspace: WorkspaceSnapshot) {
  const protectedWorkspace = Boolean(workspace.captureProtected);
  const active = workspace.id === state.activeWorkspaceId;
  const displayLabel = workspaceDisplayLabel(workspace);
  const signature = `${workspace.id}\t${active ? '1' : '0'}\t${workspace.label}\t${workspace.customLabel ?? ''}\t${workspace.root}\t${protectedWorkspace ? '1' : '0'}`;
  tab.dataset.workspaceId = workspace.id;
  if (tab.dataset.renderSignature === signature) return;
  tab.dataset.renderSignature = signature;
  tab.className = `workspace-tab${active ? ' active' : ''}${protectedWorkspace ? ' protected' : ''}`;
  tab.title = `${displayLabel} - ${workspace.root || 'empty'}${workspace.customLabel ? ` - ${workspace.label}` : ''}${protectedWorkspace ? ' - capture blocked when active' : ''}`;
  const parts = workspaceTabParts(tab);
  const label = parts.label;
  setTextContentIfChanged(label, displayLabel);
  const security = parts.security;
  const securityTitle = protectedWorkspace ? 'Disable capture block' : 'Block capture while this workspace is active';
  toggleClassIfChanged(security, 'active', protectedWorkspace);
  if (security.title !== securityTitle) security.title = securityTitle;
  setAttributeIfChanged(security, 'aria-label', securityTitle);
  setAttributeIfChanged(security, 'aria-pressed', String(protectedWorkspace));
}

function workspaceIdForTabElement(tab: HTMLElement) {
  return tab.dataset.workspaceId || '';
}

function workspaceDisplayLabel(workspace: WorkspaceSnapshot) {
  const custom = normalizeWorkspaceCustomLabel(workspace.customLabel ?? '');
  return custom || workspace.label || 'Workspace';
}

function savedWorkspaceSelectSignature() {
  let signature = '';
  for (const entry of state.savedWorkspaces) {
    if (signature) signature += '\n';
    signature += `${entry.id}\t${entry.name}\t${entry.savedAt}\t${entry.snapshot.profileId}\t${entry.snapshot.root}\t${savedWorkspaceProfileKind(entry) ?? ''}`;
  }
  return signature;
}

function renderSavedWorkspaceSelect() {
  const signature = savedWorkspaceSelectSignature();
  const previous = el.savedWorkspaceSelect.value;
  if (savedWorkspaceSelectRenderSignature !== signature) {
    savedWorkspaceSelectRenderSignature = signature;
    el.savedWorkspaceSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.savedWorkspaces.length ? 'select...' : 'none saved';
    el.savedWorkspaceSelect.append(placeholder);
    for (const entry of state.savedWorkspaces) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = savedWorkspaceOptionLabel(entry);
      option.title = savedWorkspaceOptionTooltip(entry);
      el.savedWorkspaceSelect.append(option);
    }
    el.savedWorkspaceSelect.value = state.savedWorkspaces.some((entry) => entry.id === previous)
      ? previous
      : '';
  }
  const selected = Boolean(selectedSavedWorkspaceEntry());
  setDisabledIfChanged(el.loadSavedWorkspace, !selected);
  setDisabledIfChanged(el.deleteSavedWorkspace, !selected);
}

function savedWorkspaceProfileKind(entry: SavedWorkspaceEntry): ConnectionProfile['kind'] | undefined {
  // Prefer the kind stored at save time; fall back to resolving the profile live (older entries).
  return entry.profileKind ?? profileForId(entry.snapshot.profileId)?.kind;
}

function savedWorkspaceProfileLabel(entry: SavedWorkspaceEntry): string {
  return entry.profileLabel ?? profileForId(entry.snapshot.profileId)?.label ?? '';
}

function connectionKindTag(kind: ConnectionProfile['kind'] | undefined): string {
  if (kind === 'ssh') return 'SSH';
  if (kind === 'wsl') return 'WSL';
  if (kind === 'windows') return 'Win';
  return '';
}

function savedWorkspaceOptionLabel(entry: SavedWorkspaceEntry) {
  const root = pathBasename(entry.snapshot.root, entry.snapshot.root);
  const base = root ? `${entry.name} (${root})` : entry.name;
  const tag = connectionKindTag(savedWorkspaceProfileKind(entry));
  return tag ? `[${tag}] ${base}` : base;
}

function savedWorkspaceOptionTooltip(entry: SavedWorkspaceEntry) {
  const connection = [connectionKindTag(savedWorkspaceProfileKind(entry)), savedWorkspaceProfileLabel(entry)]
    .filter(Boolean)
    .join(' ');
  const parts: string[] = [];
  if (connection) parts.push(connection);
  parts.push(entry.snapshot.root || 'empty');
  parts.push(`saved ${new Date(entry.savedAt).toLocaleString()}`);
  return parts.join(' - ');
}

function selectedSavedWorkspaceEntry() {
  const id = el.savedWorkspaceSelect.value;
  if (!id) return null;
  return state.savedWorkspaces.find((entry) => entry.id === id) ?? null;
}

async function saveCurrentWorkspaceForLater() {
  if (!state.workspaceOpen || !state.activeProfile || !state.activeWorkspaceId) {
    setStatus('Open a workspace before saving it', true);
    return;
  }
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
  const snapshot = activeWorkspaceSnapshot();
  if (!snapshot?.profileId || !snapshot.root) {
    setStatus('Nothing to save for this workspace', true);
    return;
  }

  const savedProfile = profileForId(snapshot.profileId);
  const saved: SavedWorkspaceEntry = {
    id: crypto.randomUUID(),
    name: normalizeSavedWorkspaceName(workspaceDisplayLabel(snapshot), snapshot),
    savedAt: new Date().toISOString(),
    profileKind: savedProfile?.kind,
    profileLabel: savedProfile?.label,
    snapshot: cloneWorkspaceSnapshotForSavedStore(snapshot)
  };
  state.savedWorkspaces = [
    saved,
    ...state.savedWorkspaces.filter((entry) => entry.id !== saved.id)
  ].slice(0, SAVED_WORKSPACE_LIMIT);
  persistSavedWorkspaceStore();
  el.savedWorkspaceSelect.value = saved.id;
  renderSavedWorkspaceSelect();
  setStatus(`Workspace saved: ${saved.name}`);
}

async function loadSelectedSavedWorkspace() {
  const saved = selectedSavedWorkspaceEntry();
  if (!saved) return;
  if (!profileForId(saved.snapshot.profileId)) {
    setStatus(`Saved workspace profile is unavailable: ${saved.name}`, true);
    return;
  }

  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
  saveActiveWorkspaceRuntimeCache();
  const snapshot = cloneWorkspaceSnapshotForSavedLoad(saved);
  workspaceSnapshotSignatures.set(snapshot.id, workspaceSnapshotSignature(snapshot));
  const activeIndex = workspaceSnapshotIndexById(state.activeWorkspaceId);
  insertWorkspaceSnapshot(activeIndex >= 0 ? activeIndex + 1 : state.workspaceSnapshots.length, snapshot);
  const previousActiveId = state.activeWorkspaceId;
  state.activeWorkspaceId = snapshot.id;
  renderWorkspaceTabActivation(previousActiveId, snapshot);
  persistWorkspaceStore();
  await restoreWorkspaceSnapshot(snapshot);
}

function deleteSelectedSavedWorkspace() {
  const saved = selectedSavedWorkspaceEntry();
  if (!saved) return;
  if (!window.confirm(`Delete saved workspace "${saved.name}"?`)) return;
  state.savedWorkspaces = state.savedWorkspaces.filter((entry) => entry.id !== saved.id);
  el.savedWorkspaceSelect.value = '';
  savedWorkspaceSelectRenderSignature = '\0';
  persistSavedWorkspaceStore();
  setStatus(`Deleted saved workspace: ${saved.name}`);
}

function cloneWorkspaceSnapshotForSavedStore(source: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...source,
    updatedAt: new Date().toISOString(),
    panels: cloneJson(source.panels),
    terminalSpawnRect: source.terminalSpawnRect ? { ...source.terminalSpawnRect } : undefined,
    terminals: cloneTerminalSnapshotsForSavedWorkspace(source.terminals),
    editorTabs: cloneEditorTabSnapshots(source.editorTabs),
    imageTabs: cloneImageTabSnapshotsForSavedWorkspace(source.imageTabs),
    noteTabs: cloneNoteTabSnapshots(source.noteTabs),
    browserTabs: cloneBrowserTabSnapshots(source.browserTabs),
    browserHistory: cloneBrowserHistory(source.browserHistory),
    calculatorHistory: cloneCalculatorHistory(source.calculatorHistory)
  };
}

function cloneWorkspaceSnapshotForSavedLoad(saved: SavedWorkspaceEntry): WorkspaceSnapshot {
  const source = saved.snapshot;
  const snapshot = cloneWorkspaceSnapshotForSavedStore(source);
  snapshot.id = crypto.randomUUID();
  snapshot.customLabel = saved.name;
  snapshot.updatedAt = new Date().toISOString();
  snapshot.terminals = cloneTerminalSnapshotsForSavedWorkspace(source.terminals).map((terminal) => ({
    ...terminal,
    widgetId: terminal.widgetId || crypto.randomUUID()
  }));
  return snapshot;
}

function cloneTerminalSnapshotsForSavedWorkspace(terminals: WorkspaceTerminalSnapshot[]) {
  const cloned: WorkspaceTerminalSnapshot[] = [];
  for (const terminal of terminals) {
    const { backendId: _backendId, ...rest } = terminal;
    cloned.push({ ...rest, rect: terminal.rect ? { ...terminal.rect } : undefined });
  }
  return cloned;
}

function cloneImageTabSnapshotsForSavedWorkspace(tabs: ImageTabSnapshot[]) {
  const cloned: ImageTabSnapshot[] = [];
  for (const tab of tabs) {
    if (!tab.sourcePath) continue;
    cloned.push({
      ...tab,
      dataUrl: '',
      history: [],
      historyVisible: false
    });
  }
  return cloned;
}

function normalizeWorkspaceCustomLabel(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
}

function workspaceSnapshotCanAcceptOpen(snapshot: WorkspaceSnapshot | null | undefined) {
  return Boolean(snapshot && !snapshot.workspaceOpen && !snapshot.profileId && !snapshot.root);
}

function pruneWorkspaceTabElementCache(seen: Set<string>) {
  for (const id of workspaceTabElementCache.keys()) {
    if (!seen.has(id)) workspaceTabElementCache.delete(id);
  }
}

function workspaceTabsSignature() {
  let signature = '';
  for (let index = 0; index < state.workspaceSnapshots.length; index += 1) {
    const workspace = state.workspaceSnapshots[index];
    if (index) signature += '\n';
    signature += `${workspace.id}\t${workspace.id === state.activeWorkspaceId ? '1' : '0'}\t${workspace.label}\t${workspace.customLabel ?? ''}\t${workspace.root}\t${workspace.captureProtected ? '1' : '0'}`;
  }
  return signature;
}

function workspaceTabsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.workspaceSnapshots.length; index += 1) {
    if (index) signature += '\n';
    signature += state.workspaceSnapshots[index].id;
  }
  return signature;
}

function startWorkspaceTabRename(id: string) {
  if (workspaceDragState?.dragging) return;
  const snapshot = workspaceSnapshotForId(id);
  const tab = connectedWorkspaceTabElement(id);
  if (!snapshot || !tab) return;
  const parts = workspaceTabParts(tab);
  tab.classList.add('renaming');
  parts.input.value = workspaceDisplayLabel(snapshot);
  parts.input.dataset.originalValue = parts.input.value;
  parts.input.focus();
  parts.input.select();
  suppressWorkspaceTabClick = true;
}

function finishWorkspaceTabRename(tab: HTMLElement, commit: boolean) {
  if (!tab.classList.contains('renaming')) return;
  const id = workspaceIdForTabElement(tab);
  const snapshot = workspaceSnapshotForId(id);
  const parts = workspaceTabParts(tab);
  const previous = parts.input.dataset.originalValue ?? '';
  const next = normalizeWorkspaceCustomLabel(parts.input.value);
  tab.classList.remove('renaming');
  delete parts.input.dataset.originalValue;
  window.setTimeout(() => {
    suppressWorkspaceTabClick = false;
  }, 0);
  if (!snapshot || !commit) {
    parts.input.value = previous;
    return;
  }

  const autoLabel = normalizeWorkspaceCustomLabel(snapshot.label);
  const customLabel = next && next !== autoLabel ? next : undefined;
  if ((snapshot.customLabel ?? '') === (customLabel ?? '')) {
    renderWorkspaceTabs();
    return;
  }
  if (customLabel) snapshot.customLabel = customLabel;
  else delete snapshot.customLabel;
  snapshot.updatedAt = new Date().toISOString();
  workspaceSnapshotSignatures.set(snapshot.id, workspaceSnapshotSignature(snapshot));
  tab.dataset.renderSignature = '';
  renderWorkspaceTabs();
  persistWorkspaceStore();
  setStatus(`Workspace name: ${workspaceDisplayLabel(snapshot)}`);
}

function startWorkspaceTabPointerDrag(event: PointerEvent, id: string, tab: HTMLElement) {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (tab.classList.contains('renaming')) return;
  if (target?.closest('.workspace-tab-security, .workspace-tab-copy, .workspace-tab-close, .workspace-tab-name-input')) return;
  workspaceDragState = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    target: null
  };
  tab.setPointerCapture(event.pointerId);
}

function updateWorkspaceTabPointerDrag(event: PointerEvent, tab: HTMLElement) {
  const drag = workspaceDragState;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.dragging && moved < 6) return;
  event.preventDefault();
  drag.dragging = true;
  suppressWorkspaceTabClick = true;
  tab.classList.add('dragging');
  setWorkspaceDropTarget(workspaceDropTargetAt(event.clientX, event.clientY, drag.id));
}

function finishWorkspaceTabPointerDrag(event: PointerEvent, tab: HTMLElement, commit: boolean) {
  const drag = workspaceDragState;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (tab.hasPointerCapture(event.pointerId)) tab.releasePointerCapture(event.pointerId);
  const wasDragging = drag.dragging;
  const shouldActivate = commit && !wasDragging;
  suppressWorkspaceTabClick = commit;
  if (commit && wasDragging && drag.target) {
    reorderWorkspaceTab(drag.id, drag.target.targetId, drag.target.position);
  } else if (shouldActivate) {
    void activateWorkspaceTab(drag.id);
  }
  tab.classList.remove('dragging');
  workspaceDragState = null;
  clearWorkspaceDropMarkers();
  window.setTimeout(() => {
    suppressWorkspaceTabClick = false;
  }, 0);
}

function workspaceDropTargetAt(x: number, y: number, sourceId: string): WorkspaceDropTarget | null {
  const direct = document.elementFromPoint(x, y)?.closest<HTMLElement>('.workspace-tab');
  if (direct?.dataset.workspaceId && direct.dataset.workspaceId !== sourceId) {
    return { targetId: direct.dataset.workspaceId, position: workspaceDropPosition(x, direct) };
  }

  let best: { tab: HTMLElement; score: number } | null = null;
  for (const child of el.workspaceTabs.children) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('workspace-tab')) continue;
    const workspaceId = child.dataset.workspaceId;
    if (!workspaceId || workspaceId === sourceId) continue;
    const tab = child;
    const rect = tab.getBoundingClientRect();
    const verticalPenalty = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const horizontalPenalty = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const score = verticalPenalty * 3 + horizontalPenalty;
    if (!best || score < best.score) best = { tab, score };
  }
  if (!best?.tab.dataset.workspaceId) return null;
  return { targetId: best.tab.dataset.workspaceId, position: workspaceDropPosition(x, best.tab) };
}

function workspaceDropPosition(clientX: number, tab: HTMLElement): 'before' | 'after' {
  const rect = tab.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function setWorkspaceDropTarget(target: WorkspaceDropTarget | null) {
  if (!workspaceDragState) return;
  workspaceDragState.target = target;
  clearWorkspaceDropMarkers();
  if (!target) return;
  const tab = connectedWorkspaceTabElement(target.targetId);
  tab?.classList.toggle('drop-before', target.position === 'before');
  tab?.classList.toggle('drop-after', target.position === 'after');
}

function clearWorkspaceDropMarkers() {
  for (const child of el.workspaceTabs.children) {
    if (child instanceof HTMLElement && child.classList.contains('workspace-tab')) {
      child.classList.remove('drop-before', 'drop-after');
    }
  }
}

function reorderWorkspaceTab(sourceId: string, targetId: string, position: 'before' | 'after' = 'before') {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = workspaceSnapshotIndexById(sourceId);
  if (sourceIndex < 0) return;
  const [item] = state.workspaceSnapshots.splice(sourceIndex, 1);
  const targetIndex = workspaceSnapshotIndexById(targetId);
  let refreshIndex = sourceIndex;
  if (targetIndex < 0) {
    state.workspaceSnapshots.push(item);
    refreshIndex = Math.min(sourceIndex, state.workspaceSnapshots.length - 1);
  } else {
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    state.workspaceSnapshots.splice(insertIndex, 0, item);
    refreshIndex = Math.min(sourceIndex, insertIndex);
  }
  refreshWorkspaceSnapshotIndexLookup(refreshIndex);
  persistWorkspaceStore();
}

async function toggleWorkspaceCaptureProtection(id: string) {
  const snapshot = workspaceSnapshotForId(id);
  if (!snapshot) return;

  const enabled = !snapshot.captureProtected;
  snapshot.captureProtected = enabled;
  // Apply the OS block immediately for the window the user is looking at — including before any
  // workspace is connected (activeWorkspaceId is '' at startup) — so there is no unprotected gap
  // between toggling and connecting. A non-active background tab only updates its stored flag.
  if (id === state.activeWorkspaceId || !state.activeWorkspaceId) {
    state.workspaceCaptureProtected = enabled;
    await applyWorkspaceCaptureProtection(enabled);
  }
  persistWorkspaceStore();
  setStatus(enabled
    ? 'Capture blocked while this workspace is active'
    : 'Capture block disabled for this workspace');
}

async function applyWorkspaceCaptureProtection(enabled: boolean, options: { quiet?: boolean } = {}) {
  document.body.classList.toggle('capture-protected', enabled);
  if (state.captureProtectionApplied === enabled) return;

  try {
    if (enabled) await primeCaptureFreezeFrame();
    await api.setCaptureProtection(enabled);
    state.captureProtectionApplied = enabled;
    if (enabled) hideCaptureFreezeFrameSoon();
    else hideCaptureFreezeFrame();
  } catch (error) {
    document.body.classList.toggle('capture-protected', state.captureProtectionApplied);
    hideCaptureFreezeFrame();
    if (!options.quiet) setStatus(`Capture protection failed: ${String(error)}`, true);
  }
}

const CAPTURE_FREEZE_MAX_MS = 4000;
let captureFreezeFailsafe = 0;

async function primeCaptureFreezeFrame() {
  document.body.classList.add('capture-freeze-visible');
  el.captureFreezeFrame.setAttribute('aria-hidden', 'false');
  // Failsafe: the freeze overlay must NEVER get stuck on screen (that forces an app restart).
  // Arm a hard cap the moment it's shown so it comes down even if the backend call below hangs.
  if (captureFreezeFailsafe) window.clearTimeout(captureFreezeFailsafe);
  captureFreezeFailsafe = window.setTimeout(hideCaptureFreezeFrame, CAPTURE_FREEZE_MAX_MS);
  // Let the overlay paint, but never block on requestAnimationFrame — rAF pauses while the
  // window is hidden/backgrounded, which would otherwise hang the whole apply. Cap with a timer.
  await Promise.race([
    (async () => {
      await nextAnimationFrame();
      await nextAnimationFrame();
      await delay(520);
    })(),
    delay(650)
  ]);
}

function hideCaptureFreezeFrameSoon() {
  window.setTimeout(hideCaptureFreezeFrame, 260);
}

function hideCaptureFreezeFrame() {
  if (captureFreezeFailsafe) {
    window.clearTimeout(captureFreezeFailsafe);
    captureFreezeFailsafe = 0;
  }
  document.body.classList.remove('capture-freeze-visible');
  el.captureFreezeFrame.setAttribute('aria-hidden', 'true');
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function createBlankWorkspaceTab() {
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
  saveActiveWorkspaceRuntimeCache();
  const previousId = state.activeWorkspaceId;
  const id = crypto.randomUUID();
  const insertIndex = previousId
    ? workspaceSnapshotIndexById(previousId) + 1
    : state.workspaceSnapshots.length;
  state.workspaceCaptureProtected = false;
  const snapshot = blankWorkspaceSnapshot(id);
  workspaceSnapshotSignatures.set(snapshot.id, workspaceSnapshotSignature(snapshot));
  insertWorkspaceSnapshot(insertIndex, snapshot);
  state.activeWorkspaceId = id;
  await closeWorkspace();
  persistWorkspaceStore();
  setStatus('New empty workspace');
}

async function copyWorkspaceTab(id: string) {
  await saveAllDirtyNotes();
  if (id === state.activeWorkspaceId) {
    saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
    saveActiveWorkspaceRuntimeCache();
  }
  const sourceIndex = workspaceSnapshotIndexById(id);
  if (sourceIndex < 0) return;
  const clone = cloneWorkspaceSnapshotForCopy(state.workspaceSnapshots[sourceIndex]);
  workspaceSnapshotSignatures.set(clone.id, workspaceSnapshotSignature(clone));
  insertWorkspaceSnapshot(sourceIndex + 1, clone);
  state.activeWorkspaceId = clone.id;
  persistWorkspaceStore();
  if (!clone.profileId) {
    await closeWorkspace();
    state.workspaceCaptureProtected = Boolean(clone.captureProtected);
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });
    renderWorkspaceTabs();
  } else {
    await restoreWorkspaceSnapshot(clone);
  }
  setStatus(`Workspace copied: ${workspaceDisplayLabel(clone)}`);
}

function cloneWorkspaceSnapshotForCopy(source: WorkspaceSnapshot): WorkspaceSnapshot {
  const copiedLabel = `${workspaceDisplayLabel(source)} copy`;
  return {
    ...source,
    id: crypto.randomUUID(),
    label: `${source.label} copy`,
    customLabel: copiedLabel,
    updatedAt: new Date().toISOString(),
    panels: cloneJson(source.panels),
    terminalSpawnRect: source.terminalSpawnRect ? { ...source.terminalSpawnRect } : undefined,
    terminals: cloneTerminalSnapshots(source.terminals),
    editorTabs: cloneEditorTabSnapshots(source.editorTabs),
    imageTabs: cloneImageTabSnapshots(source.imageTabs),
    noteTabs: cloneNoteTabSnapshots(source.noteTabs),
    browserTabs: cloneBrowserTabSnapshots(source.browserTabs),
    browserHistory: cloneBrowserHistory(source.browserHistory),
    calculatorHistory: cloneCalculatorHistory(source.calculatorHistory)
  };
}

function cloneTerminalSnapshots(terminals: WorkspaceTerminalSnapshot[]) {
  const cloned: WorkspaceTerminalSnapshot[] = [];
  for (const terminal of terminals) {
    cloned.push({ ...terminal, rect: terminal.rect ? { ...terminal.rect } : undefined });
  }
  return cloned;
}

function cloneEditorTabSnapshots(tabs: EditorTabSnapshot[]) {
  const cloned: EditorTabSnapshot[] = [];
  for (const tab of tabs) cloned.push({ ...tab });
  return cloned;
}

function cloneImageTabSnapshots(tabs: ImageTabSnapshot[]) {
  const cloned: ImageTabSnapshot[] = [];
  for (const tab of tabs) {
    cloned.push({
      ...tab,
      history: cloneImageHistoryItems(tab.history)
    });
  }
  return cloned;
}

function cloneImageHistoryItems(history: PastedImageItem[] = []) {
  const cloned: PastedImageItem[] = [];
  for (const item of history) cloned.push({ ...item });
  return cloned;
}

function cloneNoteTabSnapshots(tabs: NoteTabSnapshot[]) {
  const cloned: NoteTabSnapshot[] = [];
  for (const tab of tabs) cloned.push({ ...tab });
  return cloned;
}

function cloneBrowserTabSnapshots(tabs: BrowserTab[]) {
  const cloned: BrowserTab[] = [];
  for (const tab of tabs) cloned.push({ ...tab });
  return cloned;
}

function cloneBrowserHistory(history: string[] | undefined) {
  return Array.isArray(history) ? history.slice(0, BROWSER_ADDRESS_HISTORY_LIMIT) : [];
}

function cloneCalculatorHistory(history: CalculatorHistoryItem[] | undefined) {
  const cloned: CalculatorHistoryItem[] = [];
  if (!history) return cloned;
  for (const item of history) cloned.push({ ...item });
  return cloned;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function closeWorkspaceTab(id: string) {
  const wasActive = state.activeWorkspaceId === id;
  if (wasActive) {
    saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
    saveActiveWorkspaceRuntimeCache();
  }
  await closeTerminalsForWorkspace(id, {
    backgroundKill: true,
    saveSnapshot: false,
    renderShellTabs: false
  });
  removeWorkspaceRuntimeCache(id);
  workspaceSnapshotSignatures.delete(id);
  removeWorkspaceSnapshotById(id);
  if (wasActive) {
    const next = state.workspaceSnapshots[0];
    if (next) {
      state.activeWorkspaceId = next.id;
      renderWorkspaceTabs();
      if (!next.profileId) {
        await closeWorkspace();
        state.workspaceCaptureProtected = Boolean(next.captureProtected);
        await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });
        renderWorkspaceTabs();
        scheduleWorkspaceStorePersist();
        return;
      }
      await restoreWorkspaceSnapshot(next);
      return;
    }
    state.activeWorkspaceId = '';
    await closeWorkspace({ killTerminals: true });
  }
  persistWorkspaceStore();
}

async function activateWorkspaceTab(id: string) {
  if (id === state.activeWorkspaceId && state.workspaceOpen) return;
  const previousActiveId = state.activeWorkspaceId;
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
  saveActiveWorkspaceRuntimeCache();
  const snapshot = workspaceSnapshotForId(id);
  if (!snapshot) return;
  state.activeWorkspaceId = id;
  renderWorkspaceTabActivation(previousActiveId, snapshot);
  if (!snapshot.profileId) {
    await closeWorkspace();
    state.workspaceCaptureProtected = Boolean(snapshot.captureProtected);
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });
    renderWorkspaceTabs();
    scheduleWorkspaceStorePersist();
    setStatus('Empty workspace');
    return;
  }
  await restoreWorkspaceSnapshot(snapshot);
}

function blankWorkspaceSnapshot(id: string): WorkspaceSnapshot {
  return {
    id,
    label: 'New Workspace',
    customLabel: undefined,
    profileId: '',
    root: '',
    currentDir: '',
    workspaceOpen: false,
    captureProtected: false,
    updatedAt: new Date().toISOString(),
    panels: {},
    terminalSpawnRect: undefined,
    terminals: [],
    activeTerminalIndex: 0,
    editorTabs: [],
    activeEditorTabId: '',
    editorOpenInNewTab: false,
    editorWordWrap: false,
    imageTabs: [],
    activeImageTabId: '',
    imageOpenInNewTab: false,
    noteTabs: [],
    activeNoteTabId: '',
    notePinned: false,
    noteOpacity: 100,
    browserTabs: [],
    browserHistory: [],
    activeBrowserTabId: '',
    browserDeviceId: 'desktop',
    browserOrientation: 'portrait',
    browserConsoleVisible: false,
    browserConsolePosition: 'bottom',
    browserConsoleSize: 0.34,
    browserZoom: 1,
    calculatorExpression: '',
    calculatorHistory: [],
    explorerOpenMode: 'single',
    showFileSizes: DEFAULT_SHOW_FILE_SIZES,
    editorFontSize: 13,
    terminalFontSize: 13,
    noteFontSize: 14,
    calculatorFontSize: 15,
    ideScale: 1
  };
}

function saveActiveWorkspaceSnapshot(options: { immediate?: boolean; persist?: WorkspaceSnapshotPersistMode } = {}) {
  if (restoringWorkspace) return;
  if (options.immediate) {
    flushActiveWorkspaceSnapshotSave(options.persist ?? 'flush');
    return;
  }
  scheduleActiveWorkspaceSnapshotSave();
}

function scheduleActiveWorkspaceSnapshotSave(delayMs = WORKSPACE_SNAPSHOT_DEBOUNCE_MS) {
  if (workspaceSnapshotTimer) return;
  workspaceSnapshotTimer = window.setTimeout(() => {
    workspaceSnapshotTimer = 0;
    const delay = workspaceSnapshotSaveDelayMs();
    if (delay > 0) {
      scheduleActiveWorkspaceSnapshotSave(delay);
      return;
    }
    writeActiveWorkspaceSnapshot('defer');
  }, delayMs);
}

function workspaceSnapshotSaveDelayMs() {
  return workspacePersistenceBusyDelayMs();
}

function flushActiveWorkspaceSnapshotSave(persistMode: WorkspaceSnapshotPersistMode = 'flush') {
  if (workspaceSnapshotTimer) {
    window.clearTimeout(workspaceSnapshotTimer);
    workspaceSnapshotTimer = 0;
  }
  writeActiveWorkspaceSnapshot(persistMode);
}

function writeActiveWorkspaceSnapshot(persistMode: WorkspaceSnapshotPersistMode) {
  if (!state.activeWorkspaceId || !state.activeProfile || !state.workspaceOpen) {
    commitWorkspaceStorePersist(persistMode);
    return;
  }

  syncActiveImageTabFromState();
  const index = workspaceSnapshotIndexById(state.activeWorkspaceId);
  const snapshot = createCurrentWorkspaceSnapshot(state.activeWorkspaceId, state.workspaceSnapshots[index]?.updatedAt);
  const signature = workspaceSnapshotSignature(snapshot);
  if (workspaceSnapshotSignatures.get(snapshot.id) === signature) {
    if (persistMode === 'flush' && workspacePersistTimer) flushWorkspaceStorePersist();
    return;
  }
  snapshot.updatedAt = new Date().toISOString();
  workspaceSnapshotSignatures.set(snapshot.id, signature);
  if (index >= 0) replaceWorkspaceSnapshot(index, snapshot);
  else insertWorkspaceSnapshot(0, snapshot);
  commitWorkspaceStorePersist(persistMode);
}

function commitWorkspaceStorePersist(persistMode: WorkspaceSnapshotPersistMode) {
  if (persistMode === 'flush') flushWorkspaceStorePersist();
  else if (persistMode === 'defer') scheduleWorkspaceStorePersist();
}

function createCurrentWorkspaceSnapshot(
  id: string = crypto.randomUUID(),
  updatedAt = activeWorkspaceSnapshot()?.updatedAt ?? new Date().toISOString()
): WorkspaceSnapshot {
  const profile = state.activeProfile!;
  const previousSnapshot = workspaceSnapshotForId(id);
  const terminalSnapshotState = currentWorkspaceTerminalSnapshotState();
  const editorTabs = currentEditorTabSnapshots();
  return {
    id,
    label: workspaceLabel(profile, state.workspaceRoot || state.currentDir || profile.root),
    customLabel: previousSnapshot?.customLabel,
    profileId: profile.id,
    root: state.workspaceRoot,
    currentDir: state.currentDir || state.workspaceRoot,
    workspaceOpen: state.workspaceOpen,
    captureProtected: state.workspaceCaptureProtected,
    updatedAt,
    panels: snapshotPanels(),
    terminalSpawnRect: terminalSnapshotState.terminalSpawnRect,
    terminals: terminalSnapshotState.terminals,
    activeTerminalIndex: terminalSnapshotState.activeTerminalIndex,
    editorTabs,
    activeEditorTabId: state.activeEditorTabId,
    editorOpenInNewTab: state.editorOpenInNewTab,
    editorWordWrap: state.editorWordWrap,
    imageTabs: currentImageTabSnapshots(),
    activeImageTabId: state.activeImageTabId,
    imageOpenInNewTab: state.imageOpenInNewTab,
    noteTabs: currentNoteTabSnapshots(),
    activeNoteTabId: state.activeNoteTabId,
    notePinned: state.notePinned,
    noteOpacity,
    browserTabs: currentBrowserTabSnapshots(),
    browserHistory: currentBrowserHistorySnapshot(),
    activeBrowserTabId: state.activeBrowserTabId,
    browserDeviceId: state.browserDeviceId,
    browserOrientation: state.browserOrientation,
    browserConsoleVisible: state.browserConsoleVisible,
    browserConsolePosition: state.browserConsolePosition,
    browserConsoleSize: state.browserConsoleSize,
    browserZoom: state.browserZoom,
    calculatorExpression: state.calculatorExpression,
    calculatorHistory: currentCalculatorHistorySnapshot(),
    explorerOpenMode: state.explorerOpenMode,
    showFileSizes: state.showFileSizes,
    editorFontSize,
    terminalFontSize,
    noteFontSize,
    calculatorFontSize,
    ideScale
  };
}

function currentEditorTabSnapshots() {
  const tabs: EditorTabSnapshot[] = [];
  for (const tab of state.editorTabs) {
    const path = tab.file?.path ?? tab.pendingPath;
    if (!path) continue;
    tabs.push({
      id: tab.id,
      path,
      rawMode: tab.file?.rawMode ?? Boolean(tab.pendingRawMode)
    });
  }
  return tabs;
}

function currentImageTabSnapshots() {
  const tabs: ImageTabSnapshot[] = [];
  for (const tab of state.imageTabs) {
    if (!tab.dataUrl && !tab.sourcePath) continue;
    tabs.push({
      id: tab.id,
      sourcePath: tab.sourcePath,
      dataUrl: tab.dataUrl,
      label: tab.label,
      history: currentImageHistorySnapshot(tab.history),
      historyVisible: tab.historyVisible,
      zoom: normalizedImageZoom(tab.zoom),
      offsetX: tab.offsetX,
      offsetY: tab.offsetY
    });
  }
  return tabs;
}

function currentImageHistorySnapshot(history: PastedImageItem[]) {
  const snapshot: PastedImageItem[] = [];
  const limit = Math.min(history.length, 24);
  for (let index = 0; index < limit; index += 1) snapshot.push(history[index]);
  return snapshot;
}

function currentNoteTabSnapshots() {
  const tabs: NoteTabSnapshot[] = [];
  for (const tab of state.noteTabs) {
    tabs.push({ id: tab.id, path: tab.path, title: tab.title, customTitle: tab.customTitle, theme: tab.theme });
  }
  return tabs;
}

function currentBrowserTabSnapshots() {
  const tabs: BrowserTab[] = [];
  for (const tab of state.browserTabs) {
    tabs.push(browserTabSnapshot(tab));
  }
  return tabs;
}

function browserTabSnapshot(tab: BrowserTab): BrowserTab {
  return {
    id: tab.id,
    url: tab.url,
    label: tab.label,
    deviceId: normalizedBrowserDeviceId(tab.deviceId ?? state.browserDeviceId),
    orientation: normalizedBrowserOrientation(tab.orientation ?? state.browserOrientation),
    zoom: normalizedBrowserZoom(tab.zoom ?? state.browserZoom)
  };
}

function currentBrowserHistorySnapshot() {
  return state.browserHistory.slice(0, BROWSER_ADDRESS_HISTORY_LIMIT);
}

function currentCalculatorHistorySnapshot() {
  const snapshot: CalculatorHistoryItem[] = [];
  const limit = Math.min(state.calculatorHistory.length, 20);
  for (let index = 0; index < limit; index += 1) snapshot.push(state.calculatorHistory[index]);
  return snapshot;
}

function workspaceSnapshotSignature(snapshot: WorkspaceSnapshot) {
  let signature = workspaceSignaturePart(snapshot.id);
  signature += `|${workspaceSignaturePart(snapshot.label)}`;
  signature += `|${workspaceSignaturePart(snapshot.customLabel)}`;
  signature += `|${workspaceSignaturePart(snapshot.profileId)}`;
  signature += `|${workspaceSignaturePart(snapshot.root)}`;
  signature += `|${workspaceSignaturePart(snapshot.currentDir)}`;
  signature += `|${snapshot.workspaceOpen ? '1' : '0'}`;
  signature += `|${snapshot.captureProtected ? '1' : '0'}`;
  signature += `|${workspacePanelsSignature(snapshot.panels)}`;
  signature += `|${layoutRatioSignature(snapshot.terminalSpawnRect)}`;
  signature += `|${terminalSnapshotsSignature(snapshot.terminals)}`;
  signature += `|${String(snapshot.activeTerminalIndex)}`;
  signature += `|${editorTabSnapshotsSignature(snapshot.editorTabs)}`;
  signature += `|${workspaceSignaturePart(snapshot.activeEditorTabId)}`;
  signature += `|${snapshot.editorOpenInNewTab ? '1' : '0'}`;
  signature += `|${snapshot.editorWordWrap ? '1' : '0'}`;
  signature += `|${imageTabSnapshotsSignature(snapshot.id, snapshot.imageTabs)}`;
  signature += `|${workspaceSignaturePart(snapshot.activeImageTabId)}`;
  signature += `|${snapshot.imageOpenInNewTab ? '1' : '0'}`;
  signature += `|${noteTabSnapshotsSignature(snapshot.noteTabs)}`;
  signature += `|${workspaceSignaturePart(snapshot.activeNoteTabId)}`;
  signature += `|${snapshot.notePinned ? '1' : '0'}`;
  signature += `|${String(snapshot.noteOpacity)}`;
  signature += `|${browserTabSnapshotsSignature(snapshot.browserTabs)}`;
  signature += `|${browserHistorySignature(snapshot.browserHistory)}`;
  signature += `|${workspaceSignaturePart(snapshot.activeBrowserTabId)}`;
  signature += `|${workspaceSignaturePart(snapshot.browserDeviceId)}`;
  signature += `|${workspaceSignaturePart(snapshot.browserOrientation)}`;
  signature += `|${snapshot.browserConsoleVisible ? '1' : '0'}`;
  signature += `|${workspaceSignaturePart(snapshot.browserConsolePosition)}`;
  signature += `|${String(snapshot.browserConsoleSize ?? '')}`;
  signature += `|${String(snapshot.browserZoom ?? '')}`;
  signature += `|${workspaceSignaturePart(snapshot.calculatorExpression)}`;
  signature += `|${calculatorSnapshotHistorySignature(snapshot.calculatorHistory)}`;
  signature += `|${workspaceSignaturePart(snapshot.explorerOpenMode)}`;
  signature += `|${snapshot.showFileSizes ? '1' : '0'}`;
  signature += `|${String(snapshot.editorFontSize)}`;
  signature += `|${String(snapshot.terminalFontSize)}`;
  signature += `|${String(snapshot.noteFontSize)}`;
  signature += `|${String(snapshot.calculatorFontSize)}`;
  signature += `|${String(snapshot.ideScale)}`;
  return signature;
}

function workspacePanelsSignature(panels: WorkspaceSnapshot['panels']) {
  let signature = '';
  for (let index = 0; index < FLOATING_PANELS.length; index += 1) {
    const id = FLOATING_PANELS[index];
    const panel = panels?.[id];
    if (index) signature += ';';
    signature += `${id}:${panel?.visible ? '1' : '0'}:${layoutRatioSignature(panel?.rect)}`;
  }
  return signature;
}

function terminalSnapshotsSignature(terminals: WorkspaceSnapshot['terminals']) {
  let signature = '';
  for (let index = 0; index < terminals.length; index += 1) {
    if (index) signature += ';';
    signature += terminalSnapshotSignature(terminals[index]);
  }
  return signature;
}

function terminalSnapshotSignature(terminal: WorkspaceSnapshot['terminals'][number]) {
  return `${workspaceSignaturePart(terminal.title)},${workspaceSignaturePart(terminal.command ?? '')},${workspaceSignaturePart(terminal.backendId ?? '')},${workspaceSignaturePart(terminal.widgetId ?? '')},${workspaceSignaturePart(terminal.profileId)},${workspaceSignaturePart(terminal.cwd)},${layoutRatioSignature(terminal.rect)}`;
}

function editorTabSnapshotsSignature(tabs: WorkspaceSnapshot['editorTabs']) {
  let signature = '';
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (index) signature += ';';
    signature += `${workspaceSignaturePart(tab.id)},${workspaceSignaturePart(tab.path)},${tab.rawMode ? '1' : '0'}`;
  }
  return signature;
}

function imageTabSnapshotsSignature(workspaceId: string, tabs: WorkspaceSnapshot['imageTabs']) {
  let signature = '';
  for (let index = 0; index < tabs.length; index += 1) {
    if (index) signature += ';';
    signature += imageSnapshotSignature(workspaceId, tabs[index]);
  }
  return signature;
}

function imageSnapshotSignature(workspaceId: string, tab: ImageTabSnapshot) {
  return `${workspaceSignaturePart(tab.id)},${workspaceSignaturePart(tab.sourcePath ?? '')},${workspaceImageSignaturePart(workspaceId, `tab:${tab.id}`, tab.dataUrl)},${workspaceSignaturePart(tab.label)},${imageSnapshotHistorySignature(workspaceId, tab)},${tab.historyVisible ? '1' : '0'},${workspaceSignaturePart(tab.zoom)},${workspaceSignaturePart(tab.offsetX)},${workspaceSignaturePart(tab.offsetY)}`;
}

function imageSnapshotHistorySignature(workspaceId: string, tab: ImageTabSnapshot) {
  let signature = '';
  for (let index = 0; index < tab.history.length; index += 1) {
    const item = tab.history[index];
    if (index) signature += ':';
    signature += `${workspaceSignaturePart(item.id)},${workspaceSignaturePart(item.path)},${workspaceSignaturePart(item.tag)},${workspaceSignaturePart(item.createdAt)},${workspaceImageSignaturePart(workspaceId, `history:${tab.id}:${item.id}`, item.dataUrl)}`;
  }
  return signature;
}

function noteTabSnapshotsSignature(tabs: WorkspaceSnapshot['noteTabs']) {
  let signature = '';
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (index) signature += ';';
    signature += `${workspaceSignaturePart(tab.id)},${workspaceSignaturePart(tab.path)},${workspaceSignaturePart(tab.title)},${workspaceSignaturePart(tab.customTitle)},${workspaceSignaturePart(tab.theme)}`;
  }
  return signature;
}

function browserTabSnapshotsSignature(tabs: WorkspaceSnapshot['browserTabs']) {
  let signature = '';
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (index) signature += ';';
    signature += `${workspaceSignaturePart(tab.id)},${workspaceSignaturePart(tab.url)},${workspaceSignaturePart(tab.label)},${workspaceSignaturePart(tab.deviceId)},${workspaceSignaturePart(tab.orientation)},${workspaceSignaturePart(tab.zoom)}`;
  }
  return signature;
}

function browserHistorySignature(history?: string[]) {
  if (!history?.length) return '';
  let signature = '';
  for (let index = 0; index < history.length; index += 1) {
    if (index) signature += ';';
    signature += workspaceSignaturePart(history[index]);
  }
  return signature;
}

function calculatorSnapshotHistorySignature(history?: WorkspaceSnapshot['calculatorHistory']) {
  if (!history?.length) return '';
  let signature = '';
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (index) signature += ';';
    signature += `${workspaceSignaturePart(item.id)},${workspaceSignaturePart(item.expression)},${workspaceSignaturePart(item.result)}`;
  }
  return signature;
}

function workspaceImageSignaturePart(workspaceId: string, scope: string, dataUrl: string) {
  if (!dataUrl) return '';
  if (dataUrl.startsWith(WORKSPACE_IMAGE_REF_PREFIX)) return dataUrl.slice(WORKSPACE_IMAGE_REF_PREFIX.length);
  if (!dataUrl.startsWith('data:image/')) return workspaceSignaturePart(dataUrl);
  return imageRefKeyForDataUrl(workspaceId, scope, dataUrl);
}

function layoutRatioSignature(rect?: LayoutRatio) {
  if (!rect) return '';
  return `${rect.left.toFixed(5)},${rect.top.toFixed(5)},${rect.width.toFixed(5)},${rect.height.toFixed(5)}`;
}

function workspaceSignaturePart(value: unknown) {
  const text = String(value ?? '');
  if (text.length < STRING_FINGERPRINT_MIN_LENGTH) return JSON.stringify(text);
  return stringFingerprint(text);
}

function stringFingerprint(value: string) {
  const cached = stringFingerprintCache.get(value);
  if (cached) return cached;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const signature = `${value.length}:${(hash >>> 0).toString(36)}`;
  stringFingerprintCache.set(value, signature);
  while (stringFingerprintCache.size > STRING_FINGERPRINT_CACHE_LIMIT) {
    const oldest = stringFingerprintCache.keys().next().value;
    if (oldest === undefined) break;
    stringFingerprintCache.delete(oldest);
  }
  return signature;
}

function snapshotPanels() {
  const panels: Partial<Record<FloatingPanelId, WorkspacePanelSnapshot>> = {};
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    panels[id] = {
      visible: !panel.classList.contains('hidden'),
      rect: elementLayoutRatio(panel, { preferCache: true })
    };
  }
  return panels;
}

function currentWorkspaceTerminalSnapshotState(): Pick<
  WorkspaceSnapshot,
  'terminals' | 'activeTerminalIndex' | 'terminalSpawnRect'
> {
  const terminals: WorkspaceSnapshot['terminals'] = [];
  let activeTerminalIndex = -1;
  let firstWidget: TerminalWidget | null = null;
  let activeWidget: TerminalWidget | null = null;
  for (const pane of state.terminals) {
    if (pane.workspaceId !== state.activeWorkspaceId) continue;
    if (!firstWidget) firstWidget = terminalWidgetForPane(pane);
    if (pane.paneId === state.activePaneId) {
      activeTerminalIndex = terminals.length;
      activeWidget = terminalWidgetForPane(pane);
    }
    terminals.push({
      title: pane.title.replace(/\s+\(exited\)$/i, ''),
      command: pane.command,
      widgetId: pane.widgetId,
      profileId: pane.profileId,
      cwd: pane.cwd,
      rect: elementLayoutRatio(pane.element, { preferCache: true })
    });
  }
  const spawnWidget = activeWidget ?? firstWidget ?? firstActiveWorkspaceTerminalWidget();
  return {
    terminals,
    activeTerminalIndex: Math.max(0, activeTerminalIndex),
    terminalSpawnRect: spawnWidget
      ? elementLayoutRatio(spawnWidget.element, { preferCache: true })
      : activeWorkspaceSnapshot()?.terminalSpawnRect
  };
}

function activeWorkspaceSnapshot() {
  return workspaceSnapshotForId(state.activeWorkspaceId);
}

function saveActiveWorkspaceRuntimeCache() {
  if (!state.activeWorkspaceId || !state.workspaceOpen) return;
  const workspaceId = state.activeWorkspaceId;
  syncActiveEditorTabFromView();
  workspaceRuntimeCache.set(workspaceId, {
    editorTabs: snapshotEditorTabsForRuntime(state.editorTabs),
    activeEditorTabId: state.activeEditorTabId,
    explorer: snapshotExplorerRuntimeCache(),
    browserTabs: snapshotBrowserTabsForRuntime(),
    browserHistory: currentBrowserHistorySnapshot(),
    activeBrowserTabId: state.activeBrowserTabId,
    previewUrl: state.previewUrl,
    previewProxies: snapshotPreviewProxiesForRuntime(),
    browserConsoleLogs: snapshotBrowserConsoleLogsForRuntime()
  });
  clearExplorerBackgroundWork();
  if (hasBrowserFramesForWorkspace(workspaceId)) {
    hideBrowserFramesForWorkspace(workspaceId);
    if (isBrowserPanelHidden() || document.hidden) {
      suspendBrowserFramesForWorkspace(workspaceId, { includeActive: true });
    } else {
      scheduleBrowserWorkspaceFrameSuspend(workspaceId, {
        includeActive: true
      });
    }
  }
  if (activeEdgeCdp && browserTabForId(activeEdgeCdp.tabId)) {
    disconnectActiveEdgeCdp();
    setEdgePreviewVisible(false);
  }
}

function restoreWorkspaceRuntimeCache(workspaceId: string) {
  return workspaceRuntimeCache.get(workspaceId) ?? null;
}

function removeWorkspaceRuntimeCache(workspaceId: string) {
  cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
  const cached = workspaceRuntimeCache.get(workspaceId);
  if (cached) {
    for (const proxy of cached.previewProxies) {
      previewProxyProbeAt.delete(proxy.id);
      void api.stopPortForward(proxy.id).catch(() => undefined);
    }
  }
  stopEdgeDevtoolsForWorkspace(workspaceId);
  workspaceRuntimeCache.delete(workspaceId);
  clearBrowserFrames(workspaceId);
}

function snapshotEditorTabsForRuntime(tabs: EditorTabState[]) {
  const snapshot: EditorTabState[] = [];
  for (const tab of tabs) snapshot.push(tab);
  return snapshot;
}

function snapshotBrowserTabsForRuntime() {
  if (!state.browserTabs.length) return [];
  const tabs: BrowserTab[] = [];
  for (const tab of state.browserTabs) tabs.push(normalizeBrowserTabForCurrentMode(tab));
  return tabs;
}

function snapshotPreviewProxiesForRuntime() {
  if (!USE_PREVIEW_PROXY_BROWSER || !state.previewProxies.length) return [];
  const proxies: PortForwardResult[] = [];
  for (const proxy of state.previewProxies) proxies.push({ ...proxy });
  return proxies;
}

function snapshotBrowserConsoleLogsForRuntime() {
  if (!state.browserConsoleLogs.length) return [];
  return browserConsoleLogTail(state.browserConsoleLogs, browserConsoleRuntimeLogLimit());
}

function browserConsoleRuntimeLogLimit(visible = browserConsoleActuallyVisible()) {
  return visible ? BROWSER_CONSOLE_LOG_LIMIT : BROWSER_CONSOLE_HIDDEN_LOG_LIMIT;
}

function browserConsoleLogTail(logs: BrowserConsoleLog[], limit: number) {
  if (logs.length <= limit) {
    const copied: BrowserConsoleLog[] = [];
    for (const log of logs) copied.push(log);
    return copied;
  }
  const copied: BrowserConsoleLog[] = [];
  for (let index = logs.length - limit; index < logs.length; index += 1) {
    copied.push(logs[index]);
  }
  return copied;
}

function appendBrowserConsoleLogEntries(target: BrowserConsoleLog[], entries: BrowserConsoleLog[]) {
  for (let index = 0; index < entries.length; index += 1) target.push(entries[index]);
}

function snapshotExplorerRuntimeCache(): ExplorerRuntimeCache {
  return {
    currentDir: state.currentDir,
    entries: state.entries,
    expanded: state.explorerExpanded,
    children: state.explorerChildren,
    signatures: state.explorerSignatures,
    selectedPath: state.explorerSelectedPath,
    selectedPaths: state.explorerSelectedPaths,
    selectionAnchorPath: state.explorerSelectionAnchorPath
  };
}

function restoreExplorerRuntimeCache(workspaceId: string, currentDir: string) {
  const cached = restoreWorkspaceRuntimeCache(workspaceId)?.explorer;
  if (!cached || !sameExplorerPath(cached.currentDir, currentDir)) return false;
  state.entries = cached.entries;
  state.currentDir = cached.currentDir;
  state.explorerExpanded = cached.expanded;
  state.explorerChildren = cached.children;
  markExplorerEntryLookupDirty();
  state.explorerLoading = new Set();
  state.explorerSignatures = cached.signatures;
  state.explorerSelectedPath = cached.selectedPath;
  state.explorerSelectedPaths = cached.selectedPaths ?? new Set(cached.selectedPath ? [cached.selectedPath] : []);
  state.explorerSelectionAnchorPath = cached.selectionAnchorPath || cached.selectedPath;
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  renderExplorer();
  refreshTitle();
  if (!getPanel('explorer').classList.contains('hidden')) {
    scheduleCachedExplorerDirectoryRefresh(currentDir, state.activeProfile?.id ?? '', state.activeWorkspaceId, {
      force: true,
      requireCurrentDir: true
    });
    queueVisibleExplorerDirectoryPrefetch(900);
  }
  return true;
}

function deferExplorerDirectoryRestore(path: string, profileId: string, workspaceId: string) {
  const cached = cachedExplorerDirectory(profileId, path, workspaceId);
  if (cached) {
    applyLoadedDirectory(path, cached);
    return;
  }
  state.entries = [];
  state.currentDir = path;
  state.explorerExpanded = new Set();
  state.explorerChildren = new Map();
  markExplorerEntryLookupDirty();
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map();
  resetExplorerSelection();
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  explorerRenderDirty = true;
  refreshTitle();
}

async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  const profile = profileForId(snapshot.profileId);
  if (!profile) {
    setStatus(`Workspace profile is unavailable: ${snapshot.label}`, true);
    return;
  }

  const terminalRestoreToken = ++workspaceTerminalRestoreToken;
  restoringWorkspace = true;
  try {
    hideAllTerminalWidgets();
    clearWorkspacePanels({ skipIntermediateRenders: true });
    state.activeProfile = profile;
    state.workspaceRoot = snapshot.root || profile.root;
    state.currentDir = snapshot.currentDir || state.workspaceRoot;
    state.workspaceOpen = true;
    state.workspaceCaptureProtected = Boolean(snapshot.captureProtected);
    state.explorerOpenMode = snapshot.explorerOpenMode ?? 'single';
    state.showFileSizes = snapshot.showFileSizes ?? DEFAULT_SHOW_FILE_SIZES;
    state.editorOpenInNewTab = Boolean(snapshot.editorOpenInNewTab);
    state.editorWordWrap = Boolean(snapshot.editorWordWrap);
    state.imageOpenInNewTab = Boolean(snapshot.imageOpenInNewTab);
    state.notePinned = Boolean(snapshot.notePinned);
    noteOpacity = clamp(snapshot.noteOpacity || 100, 45, 100);
    state.browserConsoleSize = clamp(snapshot.browserConsoleSize || 0.34, 0.18, 0.72);
    state.browserZoom = normalizedBrowserZoom(snapshot.browserZoom);
    state.calculatorExpression = snapshot.calculatorExpression || '';
    state.calculatorHistory = Array.isArray(snapshot.calculatorHistory) ? snapshot.calculatorHistory.slice(0, 20) : [];
    state.calculatorResult = '';
    editorFontSize = clamp(snapshot.editorFontSize || 13, 10, 24);
    terminalFontSize = clamp(snapshot.terminalFontSize || 13, 9, 24);
    noteFontSize = clamp(snapshot.noteFontSize || 14, 10, 28);
    calculatorFontSize = clamp(snapshot.calculatorFontSize || 15, 10, 28);
    ideScale = clamp(snapshot.ideScale || 1, 0.72, 1.45);
    setRootStyleProperty('--editor-font-size', `${editorFontSize}px`);
    setRootStyleProperty('--ide-scale', ideScale.toFixed(3));
    applyNoteFontSize();
    applyNoteOpacity();
    applyCalculatorFontSize();
    applyBrowserConsoleSize();
    applyBrowserZoom();
    setInputValueIfChanged(el.profileSelect, profile.id);
    setInputValueIfChanged(el.rootInput, state.workspaceRoot);
    const rootPlaceholder = profile.kind === 'ssh' ? 'remote working directory' : 'working directory';
    if (el.rootInput.placeholder !== rootPlaceholder) el.rootInput.placeholder = rootPlaceholder;
    setCheckedIfChanged(el.editorOpenNewTab, state.editorOpenInNewTab);
    setCheckedIfChanged(el.editorWordWrap, state.editorWordWrap);
    setCheckedIfChanged(el.imageOpenNewTab, state.imageOpenInNewTab);
    updateExplorerOpenMode();
    updateExplorerFileSizeMode();
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });

    setWorkspaceOpen(true, { preserveVisibility: true });
    restorePanelSnapshots(snapshot.panels);
    if (isPanelVisible('calculator')) renderCalculator();
    if (isPanelVisible('settings')) renderSettings();
    refreshTitle();
    setStatus(`Switching workspace: ${snapshot.label}`);
    await yieldToUi();
    if (state.activeWorkspaceId !== snapshot.id) return;

    const hasLiveTerminals = state.terminals.some((pane) => pane.workspaceId === snapshot.id);
    if (hasLiveTerminals) {
      await restoreWorkspaceTerminals(snapshot, profile);
      await nextAnimationFrame();
    }

    const explorerRuntimeRestored = restoreExplorerRuntimeCache(snapshot.id, state.currentDir);
    if (!explorerRuntimeRestored && isPanelVisible('explorer')) {
      await openWorkspace(state.currentDir);
    } else if (!explorerRuntimeRestored) {
      deferExplorerDirectoryRestore(state.currentDir, profile.id, snapshot.id);
    }
    await yieldToUi();
    if (state.activeWorkspaceId !== snapshot.id) return;
    await restoreEditorTabs(snapshot);
    restoreImageTabs(snapshot);
    await restoreNoteTabs(snapshot);
    restoreBrowserState(snapshot);

    if (!hasLiveTerminals) scheduleWorkspaceTerminalRestore(snapshot, profile, terminalRestoreToken);
    refreshTitle();
    setStatus(`Workspace loaded: ${snapshot.label}${hasLiveTerminals ? '' : ' (shells starting)'}`);
  } finally {
    restoringWorkspace = false;
    scheduleActiveWorkspaceSnapshotSave(WORKSPACE_RESTORE_SNAPSHOT_DEBOUNCE_MS);
  }
}

function scheduleWorkspaceTerminalRestore(
  snapshot: WorkspaceSnapshot,
  profile: ConnectionProfile,
  token: number
) {
  runWhenUiIdle(() => {
    if (!isWorkspaceTerminalRestoreCurrent(snapshot.id, token)) return;
    void restoreWorkspaceTerminals(snapshot, profile, { token })
      .then(() => {
        if (!isWorkspaceTerminalRestoreCurrent(snapshot.id, token)) return;
        refreshTitle();
        renderShellTabs();
        saveActiveWorkspaceSnapshot();
      })
      .catch((error) => {
        if (isWorkspaceTerminalRestoreCurrent(snapshot.id, token)) {
          setStatus(`Terminal restore failed: ${String(error)}`, true);
        }
      });
  }, 650);
}

function isWorkspaceTerminalRestoreCurrent(workspaceId: string, token?: number) {
  return token === undefined
    || (token === workspaceTerminalRestoreToken && state.activeWorkspaceId === workspaceId && state.workspaceOpen);
}

function restorePanelSnapshots(panels: WorkspaceSnapshot['panels']) {
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    const snapshot = panels?.[id];
    const wasHidden = panel.classList.contains('hidden');
    const visible = snapshot?.visible ?? DEFAULT_PANEL_VISIBILITY[id];
    if (snapshot?.rect) layoutRatios.set(panel, snapshot.rect);
    setPanelVisible(id, visible, { skipSave: true, skipFocus: true });
    if (visible && !wasHidden && snapshot?.rect) applyLayoutRatio(panel, snapshot.rect);
  }
}

async function restoreWorkspaceTerminals(
  snapshot: WorkspaceSnapshot,
  profile: ConnectionProfile,
  options: { token?: number } = {}
) {
  if (!isWorkspaceTerminalRestoreCurrent(snapshot.id, options.token)) return;
  showTerminalWidgetsForWorkspace(snapshot.id);
  if (!hasActiveWorkspaceTerminalPane()) {
    const terminalSnapshots = (snapshot.terminals ?? []).length
      ? snapshot.terminals
      : [{ title: 'shell', command: null, rect: undefined }];
    const widgetsBySnapshotId = new Map<string, TerminalWidget>();
    for (const terminal of terminalSnapshots) {
      if (!isWorkspaceTerminalRestoreCurrent(snapshot.id, options.token)) return;
      const terminalProfile = profileForId(terminal.profileId ?? '') ?? profile;
      const widgetKey = terminal.widgetId || crypto.randomUUID();
      const existingWidget = widgetsBySnapshotId.get(widgetKey);
      const terminalOptions: CreateTerminalOptions = {
        focus: false,
        profile: terminalProfile,
        cwd: terminal.cwd || workspaceShellCwd(),
        skipSnapshotSave: true
      };
      const terminalTitle = terminal.title || 'shell';
      const terminalCommand = terminal.command;
      if (existingWidget) {
        await createTerminalTab(existingWidget, terminalCommand, terminalTitle, terminalOptions);
      } else {
        const widget = await createTerminal(terminalCommand, terminalTitle, {
          ...terminalOptions,
          rect: terminal.rect
        });
        if (widget) widgetsBySnapshotId.set(widgetKey, widget);
      }
      if (!isWorkspaceTerminalRestoreCurrent(snapshot.id, options.token)) {
        hideTerminalWidgetsForWorkspace(snapshot.id);
        return;
      }
      await yieldToUi();
    }
  }

  const active = activeWorkspaceTerminalPaneAtClamped(snapshot.activeTerminalIndex || 0);
  if (active) {
    setActivePane(active.paneId);
    bringPanelToFront(active.element);
  } else {
    state.activePaneId = '';
    syncActivePaneClass();
  }
}

async function restoreEditorTabs(snapshot: WorkspaceSnapshot) {
  const runtime = restoreWorkspaceRuntimeCache(snapshot.id);
  if (runtime?.editorTabs.length) {
    state.editorTabs = snapshotEditorTabsForRuntime(runtime.editorTabs);
    rebuildEditorTabLookup();
    state.activeEditorTabId = editorTabForId(runtime.activeEditorTabId)
      ? runtime.activeEditorTabId
      : state.editorTabs[0].id;
    state.openFile = activeEditorTab().file;
    if (isEditorPanelVisible()) {
      renderEditorTabs();
      renderEditor();
    } else {
      destroyCodeEditorView();
    }
    return;
  }

  state.editorTabs = restoredEditorTabsFromSnapshot(snapshot);
  rebuildEditorTabLookup();
  if (!state.editorTabs.length) createEditorTab(null, false);
  state.activeEditorTabId = editorTabForId(snapshot.activeEditorTabId)
    ? snapshot.activeEditorTabId
    : state.editorTabs[0].id;
  state.openFile = activeEditorTab().file;
  if (isEditorPanelVisible()) {
    renderEditorTabs();
    renderEditor();
    void hydrateVisibleEditorTab();
    scheduleInactiveEditorHydration();
  } else {
    destroyCodeEditorView();
  }
}

function restoredEditorTabsFromSnapshot(snapshot: WorkspaceSnapshot) {
  const tabs: EditorTabState[] = [];
  for (const tab of snapshot.editorTabs ?? []) {
    tabs.push({
      id: tab.id || crypto.randomUUID(),
      file: null,
      pendingPath: tab.path,
      pendingRawMode: tab.rawMode,
      pendingProfileId: snapshot.profileId,
      loading: false
    });
  }
  return tabs;
}

function isEditorPanelVisible() {
  return !getPanel('editor').classList.contains('hidden');
}

function destroyCodeEditorView() {
  if (codeMeasureFrame) {
    window.cancelAnimationFrame(codeMeasureFrame);
    codeMeasureFrame = 0;
  }
  codeView?.destroy();
  codeView = null;
  codeViewFile = null;
  codeViewRenderSignature = '\0';
}

function requestCodeEditorMeasure() {
  if (!codeView || codeMeasureFrame) return;
  codeMeasureFrame = window.requestAnimationFrame(() => {
    codeMeasureFrame = 0;
    codeView?.requestMeasure();
  });
}

async function ensureEditorReady() {
  renderEditorTabs();
  renderEditor();
  await hydrateVisibleEditorTab();
  scheduleInactiveEditorHydration();
}

async function hydrateVisibleEditorTab() {
  const tab = activeEditorTab();
  await hydrateEditorTab(tab, true);
}

function scheduleInactiveEditorHydration() {
  const token = ++inactiveEditorHydrationToken;
  runWhenUiIdle(() => hydrateInactiveEditorTabs(token), 900);
}

function hydrateInactiveEditorTabs(token = inactiveEditorHydrationToken) {
  if (token !== inactiveEditorHydrationToken) return;
  const tab = state.editorTabs.find((item) => item.id !== state.activeEditorTabId && item.pendingPath && !item.loading);
  if (!tab) return;
  void hydrateEditorTab(tab, false).finally(() => {
    if (token === inactiveEditorHydrationToken) runWhenUiIdle(() => hydrateInactiveEditorTabs(token), 900);
  });
}

async function hydrateEditorTab(tab: EditorTabState, renderWhenDone: boolean) {
  if (!tab.pendingPath || !tab.pendingProfileId || tab.loading) return;
  const workspaceId = state.activeWorkspaceId;
  const path = tab.pendingPath;
  const rawMode = Boolean(tab.pendingRawMode);
  const profileId = tab.pendingProfileId;
  tab.loading = true;
  if (!getPanel('editor').classList.contains('hidden')) renderEditorTabs();
  try {
    const content = await readTextFileCached(profileId, path);
    if (state.activeWorkspaceId !== workspaceId) return;
    const liveTab = editorTabForId(tab.id);
    if (!liveTab || liveTab.pendingPath !== path) return;
    const masked = shouldMaskFile(path);
    setEditorTabFile(liveTab, {
      path,
      content,
      masked,
      rawMode,
      lines: masked ? parseSecretLinesCached(content, path) : [],
      dirty: false
    });
    liveTab.pendingPath = undefined;
    liveTab.pendingRawMode = undefined;
    liveTab.pendingProfileId = undefined;
    liveTab.loading = false;
    if (renderWhenDone && state.activeEditorTabId === liveTab.id) {
      state.openFile = liveTab.file;
      renderEditor();
    } else if (!getPanel('editor').classList.contains('hidden')) {
      renderEditorTabs();
    }
    saveActiveWorkspaceSnapshot();
  } catch {
    if (state.activeWorkspaceId !== workspaceId) return;
    const liveTab = editorTabForId(tab.id);
    if (liveTab) {
      liveTab.loading = false;
      if (renderWhenDone && state.activeEditorTabId === liveTab.id) renderEditor();
      else if (!getPanel('editor').classList.contains('hidden')) renderEditorTabs();
    }
  }
}

function restoreImageTabs(snapshot: WorkspaceSnapshot) {
  state.imageTabs = restoredImageTabsFromSnapshot(snapshot);
  rebuildImageTabLookup();
  if (!state.imageTabs.length) createImageTab(undefined, false);
  state.activeImageTabId = imageTabForId(snapshot.activeImageTabId)
    ? snapshot.activeImageTabId
    : state.imageTabs[0].id;
  syncImageStateFromActiveTab();
  if (getPanel('image').classList.contains('hidden')) return;
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
}

function restoredImageTabsFromSnapshot(snapshot: WorkspaceSnapshot) {
  const tabs: ImageTabState[] = [];
  for (const tab of snapshot.imageTabs ?? []) {
    tabs.push({
      id: tab.id || crypto.randomUUID(),
      sourcePath: tab.sourcePath,
      dataUrl: tab.dataUrl || '',
      label: tab.label || 'No image selected',
      history: Array.isArray(tab.history) ? tab.history : [],
      historyVisible: Boolean(tab.historyVisible),
      zoom: normalizedImageZoom(tab.zoom),
      offsetX: finiteNumber(tab.offsetX, 0),
      offsetY: finiteNumber(tab.offsetY, 0)
    });
  }
  return tabs;
}

async function restoreNoteTabs(snapshot: WorkspaceSnapshot) {
  const notesVisible = !getPanel('notes').classList.contains('hidden');
  state.noteTabs = restoredNoteTabsFromSnapshot(snapshot);
  rebuildNoteTabLookup();
  state.activeNoteTabId = noteTabForId(snapshot.activeNoteTabId)
    ? snapshot.activeNoteTabId
    : state.noteTabs[0]?.id ?? '';
  if (!notesVisible) return;
  renderNoteTabs();
  renderNotes();
  if (!state.noteTabs.length) {
    await createNoteTab({ focus: false });
  } else {
    scheduleDeferredNoteHydration(snapshot.id, snapshot.profileId, 200);
  }
}

function restoredNoteTabsFromSnapshot(snapshot: WorkspaceSnapshot) {
  const tabs: NoteTabState[] = [];
  for (const tab of snapshot.noteTabs ?? []) {
    if (!tab.path) continue;
    tabs.push({
      id: tab.id || crypto.randomUUID(),
      path: tab.path,
      title: tab.title || noteTitleFromPath(tab.path),
      customTitle: typeof tab.customTitle === 'string' ? tab.customTitle : undefined,
      theme: normalizeNoteTheme(tab.theme),
      content: '',
      dirty: false,
      saving: false,
      loading: true
    });
  }
  return tabs;
}

function scheduleDeferredNoteHydration(workspaceId: string, profileId: string, timeout = 700) {
  const token = ++noteHydrationToken;
  runWhenUiIdle(() => {
    if (token !== noteHydrationToken) return;
    void hydrateDeferredNoteTabs(workspaceId, profileId, token);
  }, timeout);
}

async function hydrateDeferredNoteTabs(workspaceId: string, profileId: string, token = ++noteHydrationToken) {
  if (state.activeWorkspaceId !== workspaceId) return;
  const pending = noteTabsInHydrationOrder();
  if (!pending.length) return;

  for (const tab of pending) {
    if (token !== noteHydrationToken || state.activeWorkspaceId !== workspaceId) return;
    await hydrateNoteTabContent(tab, workspaceId, profileId);
    if (state.activeWorkspaceId !== workspaceId) return;
    if (!getPanel('notes').classList.contains('hidden') && tab.id === state.activeNoteTabId) {
      renderNoteTabs();
      renderNotes();
    }
    await yieldToUi();
  }

  if (state.activeWorkspaceId !== workspaceId) return;
  if (!getPanel('notes').classList.contains('hidden')) {
    renderNoteTabs();
    renderNotes();
  }
  saveActiveWorkspaceSnapshot();
}

function noteTabsInHydrationOrder() {
  const pending: NoteTabState[] = [];
  let active: NoteTabState | null = null;
  for (const tab of state.noteTabs) {
    if (!tab.loading) continue;
    if (tab.id === state.activeNoteTabId) active = tab;
    else pending.push(tab);
  }
  if (active) pending.unshift(active);
  return pending;
}

async function hydrateNoteTabContent(tab: NoteTabState, workspaceId: string, profileId: string) {
  if (!tab.loading) return;
  let content = '';
  try {
    content = await api.readTextFile(profileId, tab.path);
  } catch {
    content = '';
  }
  if (state.activeWorkspaceId !== workspaceId) return;
  const live = noteTabForId(tab.id);
  if (!live || live.dirty) return;
  live.content = content;
  live.loading = false;
  live.lastSavedAt = Date.now();
}

async function ensureNotesReady() {
  if (!state.workspaceOpen || !state.activeProfile) return;
  if (state.noteTabs.some((tab) => tab.loading)) {
    await hydrateDeferredNoteTabs(state.activeWorkspaceId, state.activeProfile.id);
  }
  if (!state.noteTabs.length) await createNoteTab({ focus: true });
  else {
    renderNoteTabs();
    renderNotes();
    el.notesBody.focus();
  }
}

async function createNoteTab(options: { focus?: boolean } = {}) {
  if (!state.workspaceOpen || !state.activeProfile) return null;
  const tab: NoteTabState = {
    id: crypto.randomUUID(),
    path: newNotePath(),
    title: 'Quick note',
    theme: activeNoteTab()?.theme ?? 'default',
    content: '',
    dirty: true,
    saving: false
  };
  const index = state.noteTabs.length;
  state.noteTabs.push(tab);
  rememberNoteTab(tab, index);
  state.activeNoteTabId = tab.id;
  renderNoteTabs();
  renderNotes();
  scheduleNoteSave(tab, 0);
  saveActiveWorkspaceSnapshot();
  if (options.focus !== false) el.notesBody.focus();
  return tab;
}

function clearNoteTabLookup() {
  noteTabById.clear();
  noteTabIndexByIdLookup.clear();
}

function rebuildNoteTabLookup() {
  clearNoteTabLookup();
  for (let index = 0; index < state.noteTabs.length; index += 1) {
    rememberNoteTab(state.noteTabs[index], index);
  }
}

function rememberNoteTab(tab: NoteTabState, index?: number) {
  noteTabById.set(tab.id, tab);
  if (index !== undefined) noteTabIndexByIdLookup.set(tab.id, index);
}

function forgetNoteTab(tab: NoteTabState) {
  noteTabById.delete(tab.id);
  noteTabIndexByIdLookup.delete(tab.id);
}

function noteTabForId(id: string) {
  if (!id) return null;
  let tab = noteTabById.get(id) ?? null;
  if (!tab) {
    for (let index = 0; index < state.noteTabs.length; index += 1) {
      const candidate = state.noteTabs[index];
      if (candidate.id !== id) continue;
      tab = candidate;
      rememberNoteTab(tab, index);
      break;
    }
  }
  return tab;
}

function noteTabIndexById(id: string) {
  const cachedIndex = noteTabIndexByIdLookup.get(id);
  if (cachedIndex !== undefined && state.noteTabs[cachedIndex]?.id === id) return cachedIndex;
  for (let index = 0; index < state.noteTabs.length; index += 1) {
    const tab = state.noteTabs[index];
    if (tab.id !== id) continue;
    rememberNoteTab(tab, index);
    return index;
  }
  noteTabIndexByIdLookup.delete(id);
  return -1;
}

function refreshNoteTabIndexLookup(startIndex = 0) {
  const start = clamp(startIndex, 0, state.noteTabs.length);
  for (let index = start; index < state.noteTabs.length; index += 1) {
    noteTabIndexByIdLookup.set(state.noteTabs[index].id, index);
  }
}

function activeNoteTab() {
  return noteTabForId(state.activeNoteTabId);
}

function activateNoteTab(id: string) {
  void saveActiveNoteNow();
  const previousActiveId = state.activeNoteTabId;
  const tab = noteTabForId(id);
  if (!tab) return;
  state.activeNoteTabId = tab.id;
  renderNoteTabActivation(previousActiveId, tab);
  renderNotes();
  if (tab.loading && state.activeProfile) {
    scheduleDeferredNoteHydration(state.activeWorkspaceId, state.activeProfile.id, 120);
  }
  if (previousActiveId !== id) saveActiveWorkspaceSnapshot();
  el.notesBody.focus();
}

function closeNoteTab(id: string) {
  const index = noteTabIndexById(id);
  if (index < 0) return;
  const tab = state.noteTabs[index];
  void saveNoteTabNow(tab);
  const timer = noteSaveTimers.get(id);
  if (timer) window.clearTimeout(timer);
  noteSaveTimers.delete(id);
  forgetNoteTab(tab);
  state.noteTabs.splice(index, 1);
  refreshNoteTabIndexLookup(index);
  if (state.activeNoteTabId === id) state.activeNoteTabId = state.noteTabs[0]?.id ?? '';
  renderNoteTabs();
  renderNotes();
  saveActiveWorkspaceSnapshot();
}

function renameNoteTab(id: string) {
  const tab = noteTabForId(id);
  if (!tab) return;
  const current = noteTabCustomTitle(tab) || noteTabAutoLabel(tab);
  const next = window.prompt('Note tab name. Leave empty to use the automatic title.', current);
  if (next === null) return;
  setNoteTabCustomTitle(id, next);
}

function setNoteTabCustomTitle(id: string, title: string) {
  const tab = noteTabForId(id);
  if (!tab) return;
  const previousLabel = noteTabLabel(tab);
  const customTitle = title.trim();
  tab.customTitle = customTitle || undefined;
  const nextLabel = noteTabLabel(tab);
  if (previousLabel === nextLabel) noteTabsRenderSignature = '\0';
  renderNoteTabs();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'defer' });
  setStatus(customTitle ? `Note tab renamed: ${customTitle}` : 'Note tab uses automatic title');
}

function renderNoteTabs() {
  if (getPanel('notes').classList.contains('hidden')) return;
  const signature = noteTabsSignature();
  if (noteTabsRenderSignature === signature) return;
  const orderSignature = noteTabsOrderSignature();
  const sameOrder = noteTabsOrderRenderSignature === orderSignature
    && el.notesTabs.childElementCount === state.noteTabs.length;
  noteTabsRenderSignature = signature;

  if (sameOrder) {
    for (const tab of state.noteTabs) {
      updateNoteTabElement(noteTabElement(tab.id), tab);
    }
    return;
  }

  noteTabsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const tab of state.noteTabs) {
    seen.add(tab.id);
    const row = noteTabElement(tab.id);
    updateNoteTabElement(row, tab);
    fragment.append(row);
  }
  el.notesTabs.replaceChildren(fragment);
  pruneNoteTabElementCache(seen);
}

function renderNoteTabActivation(previousActiveId: string, activeTab: NoteTabState) {
  if (getPanel('notes').classList.contains('hidden')) return;
  const orderSignature = noteTabsOrderSignature();
  const previousChanged = Boolean(previousActiveId && previousActiveId !== activeTab.id);
  const previousTab = previousChanged ? noteTabForId(previousActiveId) : null;
  const previousElement = previousChanged ? connectedNoteTabElement(previousActiveId) : null;
  const activeElement = connectedNoteTabElement(activeTab.id);
  if (
    noteTabsOrderRenderSignature !== orderSignature
    || el.notesTabs.childElementCount !== state.noteTabs.length
    || !activeElement
    || (previousChanged && (!previousTab || !previousElement))
  ) {
    renderNoteTabs();
    return;
  }
  if (previousTab && previousElement) updateNoteTabElement(previousElement, previousTab);
  updateNoteTabElement(activeElement, activeTab);
  noteTabsRenderSignature = noteTabsSignature();
}

function noteTabElement(id: string) {
  const cached = noteTabElementCache.get(id);
  if (cached) return cached;
  const row = document.createElement('div');
  row.className = 'widget-tab note-tab';
  const labelButton = document.createElement('button');
  labelButton.className = 'widget-tab-label';
  labelButton.type = 'button';
  labelButton.addEventListener('click', () => {
    const id = row.dataset.noteTabId ?? '';
    if (id) activateNoteTab(id);
  });
  labelButton.addEventListener('keydown', (event) => {
    if (event.key !== 'F2') return;
    event.preventDefault();
    event.stopPropagation();
    const id = row.dataset.noteTabId ?? '';
    if (id) renameNoteTab(id);
  });
  const closeButton = document.createElement('button');
  closeButton.className = 'widget-tab-close';
  closeButton.type = 'button';
  closeButton.title = 'Close note tab';
  closeButton.setAttribute('aria-label', 'Close note tab');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = row.dataset.noteTabId ?? '';
    if (id) closeNoteTab(id);
  });
  row.append(labelButton, closeButton);
  noteTabElementCache.set(id, row);
  return row;
}

function connectedNoteTabElement(id: string) {
  const row = noteTabElementCache.get(id);
  return row?.isConnected ? row : null;
}

function updateNoteTabElement(row: HTMLElement, tab: NoteTabState) {
  const theme = tab.theme ?? 'default';
  const active = tab.id === state.activeNoteTabId;
  const label = `${noteTabLabel(tab)}${tab.dirty ? ' *' : ''}`;
  const signature = `${tab.id}\t${active ? '1' : '0'}\t${theme}\t${label}\t${tab.path}\t${noteTabCustomTitle(tab)}`;
  row.dataset.noteTabId = tab.id;
  if (row.dataset.renderSignature === signature) return;
  row.dataset.renderSignature = signature;
  row.className = `widget-tab note-tab note-tab-${theme}${active ? ' active' : ''}`;
  const labelButton = noteTabLabelButton(row);
  const title = noteTabCustomTitle(tab)
    ? `${tab.path}\nCustom tab name: ${noteTabCustomTitle(tab)}`
    : tab.path;
  if (labelButton.title !== title) labelButton.title = title;
  setTextContentIfChanged(labelButton, label);
}

function noteTabLabelButton(row: HTMLElement) {
  return row.firstElementChild as HTMLButtonElement;
}

function pruneNoteTabElementCache(seen: Set<string>) {
  for (const id of noteTabElementCache.keys()) {
    if (!seen.has(id)) noteTabElementCache.delete(id);
  }
}

function noteTabsSignature() {
  let signature = '';
  for (let index = 0; index < state.noteTabs.length; index += 1) {
    const tab = state.noteTabs[index];
    if (index) signature += '\n';
    signature += `${tab.id}\t${tab.id === state.activeNoteTabId ? '1' : '0'}\t${tab.theme}\t${noteTabLabel(tab)}\t${noteTabCustomTitle(tab)}\t${tab.dirty ? '1' : '0'}\t${tab.loading ? '1' : '0'}`;
  }
  return signature;
}

function noteTabsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.noteTabs.length; index += 1) {
    if (index) signature += '\n';
    signature += state.noteTabs[index].id;
  }
  return signature;
}

function renderNotes() {
  const tab = activeNoteTab();
  setDisabledIfChanged(el.notesBody, !tab || Boolean(tab.loading));
  setInputValueIfChanged(el.notesBody, tab?.content ?? '');
  setDisabledIfChanged(el.notesTheme, !tab);
  setInputValueIfChanged(el.notesTheme, tab?.theme ?? 'default');
  setTextContentIfChanged(
    el.notesPath,
    tab ? noteRelativePath(tab.path) : 'Notes are saved under .vibe-ide-temp/notes in this workspace.'
  );
  applyNoteTheme(tab?.theme ?? 'default');
  renderNotePin();
  renderNoteStatus();
}

function renderNoteThemeOptions() {
  el.notesTheme.innerHTML = '';
  for (const theme of NOTE_THEMES) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    el.notesTheme.append(option);
  }
}

function setActiveNoteTheme(theme: NoteThemeId) {
  const tab = activeNoteTab();
  if (!tab) return;
  tab.theme = normalizeNoteTheme(theme);
  applyNoteTheme(tab.theme);
  renderNoteTabs();
  saveActiveWorkspaceSnapshot();
}

function normalizeNoteTheme(theme: unknown): NoteThemeId {
  return NOTE_THEMES.some((item) => item.id === theme) ? theme as NoteThemeId : 'default';
}

function applyNoteTheme(theme: NoteThemeId) {
  const normalized = normalizeNoteTheme(theme);
  const panel = getPanel('notes');
  const className = `note-theme-${normalized}`;
  if (panel.dataset.noteThemeClass === className && panel.classList.contains(className)) return;
  for (const item of NOTE_THEMES) panel.classList.remove(`note-theme-${item.id}`);
  panel.classList.add(className);
  panel.dataset.noteThemeClass = className;
}

function toggleNotePin() {
  state.notePinned = !state.notePinned;
  renderNotePin();
  saveActiveWorkspaceSnapshot();
}

function renderNotePin() {
  const panel = getPanel('notes');
  toggleClassIfChanged(panel, 'pinned', state.notePinned);
  toggleClassIfChanged(el.notesPin, 'active', state.notePinned);
  setAttributeIfChanged(el.notesPin, 'aria-pressed', String(state.notePinned));
  const title = state.notePinned ? 'Unpin Notes' : 'Keep Notes above other widgets';
  if (el.notesPin.title !== title) el.notesPin.title = title;
  if (state.notePinned && !panel.classList.contains('hidden')) bringPanelToFront(panel);
}

function handleNoteInput() {
  const tab = activeNoteTab();
  if (!tab) return;
  const previousLabel = noteTabLabel(tab);
  tab.content = el.notesBody.value;
  tab.dirty = true;
  tab.title = noteTabAutoLabel(tab);
  if (noteTabLabel(tab) !== previousLabel) renderNoteTabs();
  renderNoteStatus();
  scheduleNoteSave(tab, NOTES_AUTOSAVE_DELAY_MS);
}

function scheduleNoteSave(tab: NoteTabState, delayMs: number) {
  const existing = noteSaveTimers.get(tab.id);
  if (existing) window.clearTimeout(existing);
  noteSaveTimers.set(tab.id, window.setTimeout(() => {
    noteSaveTimers.delete(tab.id);
    void saveNoteTabNow(tab);
  }, delayMs));
}

async function saveActiveNoteNow() {
  const tab = activeNoteTab();
  if (tab && shouldSaveNoteTabNow(tab)) await saveNoteTabNow(tab);
}

async function saveAllDirtyNotes() {
  const pending: Promise<void>[] = [];
  for (const tab of state.noteTabs) {
    if (shouldSaveNoteTabNow(tab)) pending.push(saveNoteTabNow(tab));
  }
  if (!pending.length) return;
  await Promise.all(pending);
}

async function saveNoteTabNow(tab: NoteTabState) {
  const timer = noteSaveTimers.get(tab.id);
  if (timer) window.clearTimeout(timer);
  noteSaveTimers.delete(tab.id);
  if (tab.loading && !tab.dirty) return;
  if (!state.activeProfile || !tab.dirty) return;
  const profileId = state.activeProfile.id;
  const content = tab.content;
  tab.saving = true;
  renderNoteStatus();
  try {
    await api.writeTextFile(profileId, tab.path, content);
    invalidateExplorerParentDirectoryCache(profileId, tab.path);
    tab.saving = false;
    tab.lastSavedAt = Date.now();
    if (tab.content === content) tab.dirty = false;
    renderNoteTabs();
    renderNoteStatus();
  } catch (error) {
    tab.saving = false;
    tab.dirty = true;
    renderNoteStatus(`Save failed: ${String(error)}`, true);
  }
}

function shouldSaveNoteTabNow(tab: NoteTabState) {
  return tab.dirty || noteSaveTimers.has(tab.id);
}

function renderNoteStatus(message?: string, danger = false) {
  const tab = activeNoteTab();
  const text = message
    ? message
    : !tab
      ? 'No note'
      : tab.saving
        ? 'Saving...'
        : tab.loading
          ? 'Loading...'
          : tab.dirty
            ? 'Unsaved'
            : tab.lastSavedAt
              ? `Saved ${new Date(tab.lastSavedAt).toLocaleTimeString()}`
              : 'Autosaved';
  const signature = `${danger ? '1' : '0'}\t${text}`;
  if (noteStatusRenderSignature === signature) return;
  noteStatusRenderSignature = signature;
  el.notesStatus.classList.toggle('danger', danger);
  setTextContentIfChanged(el.notesStatus, text);
}

function newNotePath() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return joinProfilePath(workspaceBaseDir(), NOTES_DIR, `note-${stamp}-${state.noteTabs.length + 1}.txt`);
}

function workspaceBaseDir() {
  return state.workspaceRoot || state.currentDir || state.activeProfile?.root || '.';
}

function joinProfilePath(base: string, ...parts: string[]) {
  const sep = state.activeProfile?.kind === 'windows' ? '\\' : '/';
  let prefix = base || '.';
  if (/^[A-Za-z]:[\\/]?$/.test(prefix)) prefix = prefix.slice(0, 2);
  else prefix = prefix.replace(/[\\/]+$/, '');
  const cleanParts = parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean);
  return [prefix, ...cleanParts].join(sep);
}

function pathBasename(path: string, fallback = path) {
  let end = path.length;
  while (end > 0 && isPathSeparator(path.charCodeAt(end - 1))) end -= 1;
  let start = end;
  while (start > 0 && !isPathSeparator(path.charCodeAt(start - 1))) start -= 1;
  return start < end ? path.slice(start, end) : fallback;
}

function isPathSeparator(code: number) {
  return code === 47 || code === 92;
}

function noteTabLabel(tab: NoteTabState) {
  return noteTabCustomTitle(tab) || noteTabAutoLabel(tab);
}

function noteTabCustomTitle(tab: NoteTabState) {
  return tab.customTitle?.trim() ?? '';
}

function noteTabAutoLabel(tab: NoteTabState) {
  const firstLine = tab.content.match(/[^\s][^\r\n]*/)?.[0].trim();
  if (firstLine) return firstLine.slice(0, 40);
  return tab.title || noteTitleFromPath(tab.path);
}

function noteTitleFromPath(path: string) {
  return pathBasename(path, '').replace(/\.txt$/i, '') || 'Quick note';
}

function noteRelativePath(path: string) {
  const marker = `${NOTES_DIR}/`;
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : noteTitleFromPath(path);
}

function renderCalculatorKeys() {
  if (calculatorKeysRendered) return;
  calculatorKeysRendered = true;
  const keys = [
    '(', ')', '%', '⌫',
    '7', '8', '9', '/',
    '4', '5', '6', '*',
    '1', '2', '3', '-',
    '0', '.', '=', '+'
  ];
  el.calculatorKeys.innerHTML = '';
  for (const key of keys) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = key;
    button.dataset.key = key;
    if (['/', '*', '-', '+', '=', '%'].includes(key)) button.classList.add('operator');
    if (key === '=') button.classList.add('equals');
    button.addEventListener('click', () => handleCalculatorButton(key));
    el.calculatorKeys.append(button);
  }
}

function renderCalculator() {
  renderCalculatorKeys();
  el.calculatorExpression.value = state.calculatorExpression;
  updateCalculatorPreview();
  renderCalculatorHistory();
}

function handleCalculatorButton(key: string) {
  applyCalculatorInput(key === '⌫' ? 'backspace' : key);
  el.calculatorExpression.focus();
}

function handleCalculatorKey(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const action = calculatorKeyAction(event);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  applyCalculatorInput(action, document.activeElement === el.calculatorExpression);
}

function handleCalculatorGlobalKey(event: KeyboardEvent) {
  if (event.target === el.calculatorExpression) return;
  if (!isCalculatorKeyboardTarget(event.target)) return;
  handleCalculatorKey(event);
}

function handleNoteRenameShortcut(event: KeyboardEvent) {
  if (event.key !== 'F2' || event.ctrlKey || event.metaKey || event.altKey) return;
  const notes = getPanel('notes');
  if (notes.classList.contains('hidden')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, select, .terminal-card, .cm-editor') && !notes.contains(target)) return;
  const noteTab = target?.closest<HTMLElement>('.note-tab');
  const id = noteTab?.dataset.noteTabId
    || (event.target instanceof Node && notes.contains(event.target) ? state.activeNoteTabId : '');
  if (!id || !noteTabForId(id)) return;

  event.preventDefault();
  event.stopPropagation();
  renameNoteTab(id);
}

function isCalculatorKeyboardTarget(target: EventTarget | null) {
  const calculator = getPanel('calculator');
  if (calculator.classList.contains('hidden')) return false;
  if (target instanceof Element && target.closest('input, textarea, select, .terminal-card, .cm-editor')
    && !calculator.contains(target)) {
    return false;
  }
  return keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'calculator'
    || target instanceof Node && calculator.contains(target);
}

function calculatorKeyAction(event: KeyboardEvent) {
  if (event.code.startsWith('Numpad')) {
    if (/^Numpad\d$/.test(event.code)) return event.code.slice(-1);
    const map: Record<string, string> = {
      NumpadDecimal: event.key === 'Delete' ? 'delete' : '.',
      NumpadAdd: '+',
      NumpadSubtract: '-',
      NumpadMultiply: '*',
      NumpadDivide: '/',
      NumpadEnter: '='
    };
    return map[event.code] ?? null;
  }
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (['+', '-', '*', '/', '.', '(', ')', '%'].includes(event.key)) return event.key;
  if (event.key === 'Enter') return '=';
  if (event.key === 'Backspace') return 'backspace';
  if (event.key === 'Delete') return 'delete';
  if (event.key === 'Escape') return 'clear';
  return null;
}

function applyCalculatorInput(action: string, inputFocused = false) {
  if (action === '=') {
    evaluateCalculator({ commit: true });
    return;
  }
  if (action === 'clear') {
    clearCalculator();
    return;
  }
  if (action === 'backspace') {
    editCalculatorExpression('backspace', inputFocused);
    return;
  }
  if (action === 'delete') {
    if (inputFocused) editCalculatorExpression('delete', true);
    else editCalculatorExpression('backspace', false);
    return;
  }
  editCalculatorExpression(action, inputFocused);
}

function editCalculatorExpression(action: string, inputFocused: boolean) {
  const value = state.calculatorExpression;
  const start = inputFocused ? el.calculatorExpression.selectionStart ?? value.length : value.length;
  const end = inputFocused ? el.calculatorExpression.selectionEnd ?? start : start;
  let next = value;
  let caret = start;

  if (action === 'backspace') {
    if (start !== end) {
      next = value.slice(0, start) + value.slice(end);
      caret = start;
    } else if (start > 0) {
      next = value.slice(0, start - 1) + value.slice(end);
      caret = start - 1;
    }
  } else if (action === 'delete') {
    if (start !== end) {
      next = value.slice(0, start) + value.slice(end);
    } else {
      next = value.slice(0, start) + value.slice(start + 1);
    }
    caret = start;
  } else {
    next = value.slice(0, start) + action + value.slice(end);
    caret = start + action.length;
  }

  setCalculatorExpression(next, caret);
}

function setCalculatorExpression(value: string, caret = value.length) {
  state.calculatorExpression = value;
  el.calculatorExpression.value = value;
  updateCalculatorPreview();
  saveActiveWorkspaceSnapshot();
  el.calculatorExpression.focus();
  requestAnimationFrame(() => {
    el.calculatorExpression.setSelectionRange(caret, caret);
  });
}

function clearCalculator() {
  state.calculatorExpression = '';
  state.calculatorResult = '';
  renderCalculator();
  saveActiveWorkspaceSnapshot();
  el.calculatorExpression.focus();
}

function updateCalculatorPreview() {
  const expression = state.calculatorExpression.trim();
  if (!expression) {
    state.calculatorResult = '0';
    el.calculatorResult.textContent = '0';
    el.calculatorResult.classList.remove('error');
    return;
  }
  try {
    const result = formatCalculatorResult(evaluateExpression(expression));
    state.calculatorResult = result;
    el.calculatorResult.textContent = result;
    el.calculatorResult.classList.remove('error');
  } catch {
    state.calculatorResult = '';
    el.calculatorResult.textContent = '...';
    el.calculatorResult.classList.remove('error');
  }
}

function evaluateCalculator(options: { commit: boolean }) {
  const expression = state.calculatorExpression.trim();
  if (!expression) return;
  try {
    const result = formatCalculatorResult(evaluateExpression(expression));
    state.calculatorResult = result;
    el.calculatorResult.textContent = result;
    el.calculatorResult.classList.remove('error');
    if (options.commit) {
      state.calculatorHistory.unshift({
        id: crypto.randomUUID(),
        expression,
        result
      });
      state.calculatorHistory = state.calculatorHistory.slice(0, 20);
      state.calculatorExpression = result;
      el.calculatorExpression.value = result;
      renderCalculatorHistory();
      saveActiveWorkspaceSnapshot();
    }
  } catch (error) {
    state.calculatorResult = 'Error';
    el.calculatorResult.textContent = 'Error';
    el.calculatorResult.classList.add('error');
    setStatus(`Calculator: ${String(error)}`, true);
  }
}

function renderCalculatorHistory() {
  const signature = calculatorHistorySignature();
  if (calculatorHistoryRenderSignature === signature) return;
  const orderSignature = calculatorHistoryOrderSignature();
  const sameOrder = calculatorHistoryOrderRenderSignature === orderSignature
    && el.calculatorHistory.childElementCount === state.calculatorHistory.length;
  calculatorHistoryRenderSignature = signature;
  if (!state.calculatorHistory.length) {
    calculatorHistoryOrderRenderSignature = '';
    calculatorHistoryElementCache.clear();
    el.calculatorHistory.innerHTML = '<div class="calculator-empty">No calculations yet</div>';
    return;
  }
  const seen = new Set<string>();

  if (sameOrder) {
    for (const item of state.calculatorHistory) {
      seen.add(item.id);
      updateCalculatorHistoryElement(calculatorHistoryElement(item.id), item);
    }
    pruneCalculatorHistoryElementCache(seen);
    return;
  }

  calculatorHistoryOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  for (const item of state.calculatorHistory) {
    seen.add(item.id);
    const row = calculatorHistoryElement(item.id);
    updateCalculatorHistoryElement(row, item);
    fragment.append(row);
  }
  el.calculatorHistory.replaceChildren(fragment);
  pruneCalculatorHistoryElementCache(seen);
}

function calculatorHistoryElement(id: string) {
  const cached = calculatorHistoryElementCache.get(id);
  if (cached) return cached;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'calculator-history-row';
  row.innerHTML = '<span></span><strong></strong>';
  row.addEventListener('click', () => {
    state.calculatorExpression = row.dataset.calculatorResult ?? '';
    renderCalculator();
    saveActiveWorkspaceSnapshot();
    el.calculatorExpression.focus();
  });
  calculatorHistoryElementCache.set(id, row);
  return row;
}

function updateCalculatorHistoryElement(row: HTMLElement, item: CalculatorHistoryItem) {
  row.dataset.calculatorHistoryId = item.id;
  row.dataset.calculatorResult = item.result;
  const signature = `${item.expression}\t${item.result}`;
  if (row.dataset.renderSignature === signature) return;
  row.dataset.renderSignature = signature;
  setTextContentIfChanged(row.querySelector<HTMLElement>('span')!, item.expression);
  setTextContentIfChanged(row.querySelector<HTMLElement>('strong')!, item.result);
}

function pruneCalculatorHistoryElementCache(seen: Set<string>) {
  for (const id of calculatorHistoryElementCache.keys()) {
    if (!seen.has(id)) calculatorHistoryElementCache.delete(id);
  }
}

function calculatorHistorySignature() {
  let signature = '';
  for (let index = 0; index < state.calculatorHistory.length; index += 1) {
    const item = state.calculatorHistory[index];
    if (index) signature += '\n';
    signature += `${item.id}\t${item.expression}\t${item.result}`;
  }
  return signature;
}

function calculatorHistoryOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.calculatorHistory.length; index += 1) {
    if (index) signature += '\n';
    signature += state.calculatorHistory[index].id;
  }
  return signature;
}

function evaluateExpression(expression: string) {
  const tokens = tokenizeExpression(expression);
  let position = 0;

  const parseExpression = (): number => {
    let value = parseTerm();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (tokens[position] === '*' || tokens[position] === '/' || tokens[position] === '%') {
      const operator = tokens[position++];
      const right = parseFactor();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('division by zero');
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  };

  const parseFactor = (): number => {
    const token = tokens[position++];
    if (token === '+') return parseFactor();
    if (token === '-') return -parseFactor();
    if (token === '(') {
      const value = parseExpression();
      if (tokens[position++] !== ')') throw new Error('missing closing parenthesis');
      return value;
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('invalid expression');
    return Number(token);
  };

  const value = parseExpression();
  if (position !== tokens.length) throw new Error('invalid expression');
  if (!Number.isFinite(value)) throw new Error('invalid result');
  return value;
}

function tokenizeExpression(expression: string) {
  const normalized = expression.replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/\s+/g, '');
  const tokens = normalized.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/%]/g) ?? [];
  if (tokens.join('') !== normalized) throw new Error('invalid character');
  return tokens;
}

function formatCalculatorResult(value: number) {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(12)).toString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${(timeoutMs / 1000).toFixed(1)}s`));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function yieldToUi() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

function runWhenUiIdle(callback: () => void, timeout = 700) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
  };
  const run = () => {
    const delay = uiBusyDelayMs();
    if (delay > 0) {
      window.setTimeout(() => runWhenUiIdle(callback, timeout), delay);
      return;
    }
    callback();
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run, { timeout });
    return;
  }
  window.setTimeout(() => window.requestAnimationFrame(run), Math.min(timeout, 160));
}

function uiBusyDelayMs() {
  const scrollPause = explorerScrollingUntil - Date.now();
  if (scrollPause > 0) return scrollPause + EXPLORER_SCROLL_IDLE_MS;
  if (workspaceDragState?.dragging) return 240;
  return uiInputPending() ? 80 : 0;
}

function uiInputPending() {
  const maybeNavigator = navigator as Navigator & {
    scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean };
  };
  try {
    return Boolean(maybeNavigator.scheduling?.isInputPending?.({ includeContinuous: true }));
  } catch {
    return false;
  }
}

function normalizedBrowserConsolePosition(value: unknown): BrowserConsolePosition {
  return value === 'bottom' || value === 'right' || value === 'top' || value === 'left'
    ? value
    : 'bottom';
}

function normalizedBrowserDeviceId(value: unknown) {
  return value === 'desktop' || (typeof value === 'string' && BROWSER_DEVICE_PRESET_BY_ID.has(value))
    ? String(value)
    : DEFAULT_BROWSER_DEVICE_ID;
}

function normalizedBrowserOrientation(value: unknown): BrowserOrientation {
  return value === 'landscape' ? 'landscape' : 'portrait';
}

function normalizedBrowserZoom(value: unknown) {
  const zoom = Number(value);
  return clamp(Number.isFinite(zoom) ? zoom : 1, BROWSER_ZOOM_LEVELS[0], BROWSER_ZOOM_LEVELS[BROWSER_ZOOM_LEVELS.length - 1]);
}

function restoreBrowserState(snapshot: WorkspaceSnapshot) {
  const runtime = restoreWorkspaceRuntimeCache(snapshot.id);
  const browserVisible = !isBrowserPanelHidden();
  const browserConsoleVisible = Boolean(snapshot.browserConsoleVisible);
  state.browserTabs = restoredBrowserTabs(snapshot, runtime);
  state.browserHistory = restoredBrowserHistory(snapshot, runtime);
  rebuildBrowserTabLookup();
  state.previewProxies = USE_PREVIEW_PROXY_BROWSER && runtime ? restoredPreviewProxies(runtime.previewProxies) : [];
  rebuildPreviewProxyLookup();
  state.browserConsoleLogs = browserConsoleLogTail(
    runtime ? runtime.browserConsoleLogs : state.browserConsoleLogs,
    browserConsoleRuntimeLogLimit(browserConsoleVisible && browserVisible)
  );
  clearBrowserConsoleRowElementCache();
  markBrowserConsoleLogsChanged();
  state.activeBrowserTabId = runtime?.activeBrowserTabId ?? '';
  state.previewUrl = runtime?.previewUrl ?? '';
  state.browserDeviceId = normalizedBrowserDeviceId(snapshot.browserDeviceId);
  state.browserOrientation = normalizedBrowserOrientation(snapshot.browserOrientation);
  state.browserConsolePosition = normalizedBrowserConsolePosition(snapshot.browserConsolePosition);
  state.browserConsoleVisible = browserConsoleVisible;
  if (state.browserTabs.length) {
    const active = browserTabForId(runtime?.activeBrowserTabId || snapshot.activeBrowserTabId) ?? state.browserTabs[0];
    state.activeBrowserTabId = active.id;
    state.previewUrl = active.url;
    applyBrowserViewportFromTab(active);
    setInputValueIfChanged(el.previewUrl, active.url);
    if (browserVisible) applyVisibleBrowserLayout();
    if (browserVisible) showRestoredBrowserIdle(active);
  } else {
    if (browserVisible) applyVisibleBrowserLayout();
    setInputValueIfChanged(el.previewUrl, state.previewUrl);
  }
  hideBrowserAddressSuggestions();
  if (browserVisible) {
    renderBrowserTabs();
    if (state.browserConsoleVisible) renderBrowserConsole();
  }
}

function restoredBrowserTabs(snapshot: WorkspaceSnapshot, runtime: WorkspaceRuntimeCache | null | undefined) {
  const tabs: BrowserTab[] = [];
  const fallbackDeviceId = normalizedBrowserDeviceId(snapshot.browserDeviceId);
  const fallbackOrientation = normalizedBrowserOrientation(snapshot.browserOrientation);
  const fallbackZoom = normalizedBrowserZoom(snapshot.browserZoom);
  if (runtime?.browserTabs.length) {
    for (const tab of runtime.browserTabs) tabs.push(normalizeBrowserTabForCurrentMode(tab, fallbackDeviceId, fallbackOrientation, fallbackZoom));
    return tabs;
  }
  if (!Array.isArray(snapshot.browserTabs)) return tabs;
  for (const tab of snapshot.browserTabs) {
    if (!tab || typeof tab.url !== 'string') continue;
    tabs.push(normalizeBrowserTabForCurrentMode({
      id: tab.id || makeBrowserTabId(),
      url: tab.url,
      label: tab.label || browserTabLabel(tab.url),
      deviceId: tab.deviceId,
      orientation: tab.orientation,
      zoom: tab.zoom
    }, fallbackDeviceId, fallbackOrientation, fallbackZoom));
  }
  return tabs;
}

function restoredBrowserHistory(snapshot: WorkspaceSnapshot, runtime: WorkspaceRuntimeCache | null | undefined) {
  const history = Array.isArray(runtime?.browserHistory) && runtime.browserHistory.length
    ? runtime.browserHistory
    : Array.isArray(snapshot.browserHistory) && snapshot.browserHistory.length
      ? snapshot.browserHistory
      : (Array.isArray(snapshot.browserTabs) ? snapshot.browserTabs.map((tab) => tab?.url).filter(Boolean) : []);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of history) {
    if (typeof value !== 'string') continue;
    const url = normalizeBrowserHistoryUrl(value);
    if (!url || seen.has(url)) continue;
    normalized.push(url);
    seen.add(url);
    if (normalized.length >= BROWSER_ADDRESS_HISTORY_LIMIT) break;
  }
  return normalized;
}

function restoredPreviewProxies(proxies: PortForwardResult[]) {
  const restored: PortForwardResult[] = [];
  for (const proxy of proxies) restored.push({ ...proxy });
  return restored;
}

function normalizeBrowserTabForCurrentMode(
  tab: BrowserTab,
  fallbackDeviceId = state.browserDeviceId,
  fallbackOrientation = state.browserOrientation,
  fallbackZoom = state.browserZoom
): BrowserTab {
  const normalized = { ...tab };
  normalized.deviceId = normalizedBrowserDeviceId(normalized.deviceId ?? fallbackDeviceId);
  normalized.orientation = normalizedBrowserOrientation(normalized.orientation ?? fallbackOrientation);
  normalized.zoom = normalizedBrowserZoom(normalized.zoom ?? fallbackZoom);
  if (!USE_EDGE_CDP_BROWSER) normalized.edge = undefined;
  if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(normalized.url)) {
    normalized.frameUrl = undefined;
  } else if (!USE_PREVIEW_PROXY_BROWSER) {
    normalized.frameUrl = normalized.url;
  }
  return normalized;
}

function showRestoredBrowserIdle(tab: BrowserTab) {
  disconnectActiveEdgeCdp();
  if (!USE_EDGE_CDP_BROWSER) {
    setEdgePreviewVisible(false);
    if (browserTabFrameReady(tab)) showBrowserFrame(tab);
    else {
      hideAllBrowserFrames();
      toggleClassIfChanged(el.browserShell, 'has-preview', false);
      logBrowserConsole('info', `Browser preview idle for ${tab.label}; click the tab or Reload to resume.`);
    }
    return;
  }
  hideAllBrowserFrames();
  setEdgePreviewVisible(true);
  showEdgePreviewStatus(`Browser paused. Click "${tab.label}" or Reload to reconnect.`);
}

function workspaceLabel(profile: ConnectionProfile, root: string) {
  const tail = pathBasename(root, '') || root || 'workspace';
  return `${profile.label}: ${tail}`;
}

function selectProfile(profileId: string): boolean {
  const profile = profileForId(profileId);
  state.activeProfile = profile;
  if (!profile) {
    state.workspaceRoot = '';
    state.currentDir = '';
    el.profileSelect.value = '';
    el.rootInput.value = '';
    el.rootInput.placeholder = 'select a profile first';
    refreshTitle();
    return false;
  }

  state.workspaceRoot = profile.root;
  state.currentDir = state.workspaceOpen ? state.currentDir : '';
  el.profileSelect.value = profile.id;
  el.rootInput.value = profile.root;
  el.rootInput.placeholder = profile.kind === 'ssh' ? 'remote working directory' : 'working directory';
  refreshTitle();
  return true;
}

function bindEvents() {
  el.newWorkspaceTab.addEventListener('click', () => void createBlankWorkspaceTab());
  el.profileSelect.addEventListener('change', async () => {
    saveActiveWorkspaceSnapshot();
    const canFillActiveEmptyWorkspace = workspaceSnapshotCanAcceptOpen(activeWorkspaceSnapshot());
    if (state.workspaceOpen) await closeWorkspace();
    if (!canFillActiveEmptyWorkspace) state.activeWorkspaceId = '';
    renderWorkspaceTabs();
    selectProfile(el.profileSelect.value);
  });
  el.openRoot.addEventListener('click', async () => {
    if (!state.activeProfile && !selectProfile(el.profileSelect.value)) {
      setStatus('Select a profile first', true);
      return;
    }
    state.workspaceRoot = await resolveSelectedRoot();
    await switchWorkspace(state.workspaceRoot);
  });
  el.saveWorkspace.addEventListener('click', () => void saveCurrentWorkspaceForLater());
  el.savedWorkspaceSelect.addEventListener('change', renderSavedWorkspaceSelect);
  el.loadSavedWorkspace.addEventListener('click', () => void loadSelectedSavedWorkspace());
  el.deleteSavedWorkspace.addEventListener('click', deleteSelectedSavedWorkspace);
  el.newShell.addEventListener('click', () => createTerminal(null, 'shell'));
  el.shellNewTab.addEventListener('click', () => {
    const widget = activeTerminalWidget();
    if (widget) void createShellTabInWidget(widget);
    else void createTerminal(null, 'shell');
  });
  el.newWindowsShell.addEventListener('click', () => void createWindowsShell());
  el.copyCurrentCd.addEventListener('click', () => void copyCurrentFolderCdCommand());
  el.marketAddSymbol.addEventListener('click', addMarketTickerFromInput);
  el.marketSymbolInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    addMarketTickerFromInput();
  });
  el.editorNewTab.addEventListener('click', () => {
    createEditorTab(null, true);
    renderEditor();
  });
  el.editorOpenNewTab.addEventListener('change', () => {
    state.editorOpenInNewTab = el.editorOpenNewTab.checked;
    saveActiveWorkspaceSnapshot();
  });
  el.editorWordWrap.addEventListener('change', () => {
    state.editorWordWrap = el.editorWordWrap.checked;
    renderEditor();
    saveActiveWorkspaceSnapshot();
  });
  el.notesNewTab.addEventListener('click', () => {
    void createNoteTab({ focus: true });
  });
  el.notesPin.addEventListener('click', toggleNotePin);
  el.notesTheme.addEventListener('change', () => {
    setActiveNoteTheme(el.notesTheme.value as NoteThemeId);
  });
  el.notesOpacity.addEventListener('input', () => {
    setNoteOpacity(Number(el.notesOpacity.value), { save: false });
  });
  el.notesOpacity.addEventListener('change', () => {
    setNoteOpacity(Number(el.notesOpacity.value), { save: true });
  });
  el.notesBody.addEventListener('input', handleNoteInput);
  el.notesBody.addEventListener('blur', () => void saveActiveNoteNow());
  el.notesBody.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    void saveActiveNoteNow();
  });
  el.imageNewTab.addEventListener('click', () => {
    createImageTab(undefined, true);
    renderImagePreview();
    renderImageHistory();
  });
  el.imageOpenNewTab.addEventListener('change', () => {
    state.imageOpenInNewTab = el.imageOpenNewTab.checked;
    saveActiveWorkspaceSnapshot();
  });
  el.imageFit.addEventListener('click', fitActiveImagePreview);
  el.imageFitWidth.addEventListener('click', () => fitImagePreviewToAxis('width'));
  el.imageFitHeight.addEventListener('click', () => fitImagePreviewToAxis('height'));
  el.imagePreviewStage.addEventListener('wheel', handleImagePreviewWheel, { passive: false });
  el.imagePreviewStage.addEventListener('pointerdown', startImagePreviewDrag);
  el.imagePreviewStage.addEventListener('pointermove', moveImagePreviewDrag);
  el.imagePreviewStage.addEventListener('pointerup', finishImagePreviewDrag);
  el.imagePreviewStage.addEventListener('pointercancel', finishImagePreviewDrag);
  el.imagePreviewStage.addEventListener('lostpointercapture', finishImagePreviewDrag);
  el.imagePreviewStage.addEventListener('dblclick', fitActiveImagePreview);
  el.imagePreview.addEventListener('dragstart', (event) => event.preventDefault());
  el.imagePreview.addEventListener('load', () => {
    clampImagePreviewPan();
    applyImagePreviewTransform();
  });
  for (const button of el.llmButtons) {
    button.addEventListener('click', () => launchLlm(button.dataset.llm ?? 'llm'));
  }
  bindWindowChrome();
  bindFloatingPanels();
  el.saveFile.addEventListener('click', saveOpenFile);
  el.toggleRaw.addEventListener('click', toggleRawMode);
  el.startForward.addEventListener('click', startForward);
  el.loadPreview.addEventListener('click', () => void openPreviewValue(el.previewUrl.value.trim()));
  el.previewUrl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void openPreviewValue(el.previewUrl.value.trim());
  });
  el.previewUrl.addEventListener('focus', () => renderBrowserAddressSuggestions(true));
  el.previewUrl.addEventListener('click', () => renderBrowserAddressSuggestions(true));
  el.previewUrl.addEventListener('input', () => renderBrowserAddressSuggestions(true));
  el.previewUrl.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!el.browserAddressSuggestions.matches(':hover')) hideBrowserAddressSuggestions();
    }, 120);
  });
  el.browserAddressSuggestions.addEventListener('pointerdown', (event) => {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.browser-address-suggestion[data-url]')
      : null;
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const url = item.dataset.url ?? '';
    setInputValueIfChanged(el.previewUrl, url);
    hideBrowserAddressSuggestions();
    void openPreviewValue(url);
  });
  el.browserBack.addEventListener('click', () => navigateBrowserHistory(-1));
  el.browserForward.addEventListener('click', () => navigateBrowserHistory(1));
  el.reloadPreview.addEventListener('click', () => refreshPreview(false));
  el.clearBrowserCache.addEventListener('click', () => void clearBrowserCacheAndReload());
  el.hardRefreshPreview.addEventListener('click', () => refreshPreview(true));
  el.newFile.addEventListener('click', () => void createExplorerItem('file'));
  el.newFolder.addEventListener('click', () => void createExplorerItem('dir'));
  el.refreshExplorer.addEventListener('click', () => void refreshExplorerTree({ manual: true }));
  el.exportSelected.addEventListener('click', () => void startExportSelectedExplorerEntry());
  el.explorerOpenModeToggle.addEventListener('click', () => {
    state.explorerOpenMode = state.explorerOpenMode === 'single' ? 'double' : 'single';
    updateExplorerOpenMode();
  });
  el.fileSizeToggle.addEventListener('click', () => {
    state.showFileSizes = !state.showFileSizes;
    updateExplorerFileSizeMode();
    if (state.showFileSizes) void refreshExplorerTree({ manual: true });
    else renderExplorer();
    saveActiveWorkspaceSnapshot();
  });
  bindExplorerListEvents();
  el.autoPasteImageTag.addEventListener('change', () => {
    state.autoPasteImageTagToShell = el.autoPasteImageTag.checked;
  });
  el.imageHistoryToggle.addEventListener('click', () => {
    state.imageHistoryVisible = !state.imageHistoryVisible;
    syncActiveImageTabFromState();
    renderImageHistory();
    saveActiveWorkspaceSnapshot();
  });
  el.imageHistoryClear.addEventListener('click', () => {
    state.imageHistory = [];
    syncActiveImageTabFromState();
    renderImageHistory();
    setStatus('Image history cleared');
    saveActiveWorkspaceSnapshot();
  });
  el.desktopSize?.addEventListener('click', () => setBrowserMode('desktop'));
  el.deviceSelect.addEventListener('change', () => {
    if (el.deviceSelect.value === 'desktop') setBrowserMode('desktop');
    else setBrowserDevice(el.deviceSelect.value);
  });
  el.rotateDevice.addEventListener('click', rotateBrowserDevice);
  el.browserConsoleToggle.addEventListener('click', () => setBrowserConsoleVisible(!state.browserConsoleVisible));
  el.browserConsolePosition.addEventListener('change', () => setBrowserConsolePosition(el.browserConsolePosition.value as BrowserConsolePosition));
  el.browserConsoleResizer.addEventListener('pointerdown', startBrowserConsoleResize);
  el.browserConsoleClear.addEventListener('click', () => {
    state.browserConsoleLogs = [];
    clearBrowserConsoleRowElementCache();
    clearBrowserConsoleHiddenPayloadQueue();
    markBrowserConsoleLogsChanged();
    renderBrowserConsole();
  });
  el.browserShell.addEventListener('pointerdown', activateBrowserPanel);
  bindBrowserFrameEvents(el.previewFrame);
  bindEdgePreviewInput();
  el.calculatorExpression.addEventListener('input', () => {
    state.calculatorExpression = el.calculatorExpression.value;
    updateCalculatorPreview();
    saveActiveWorkspaceSnapshot();
  });
  el.calculatorExpression.addEventListener('keydown', handleCalculatorKey);
  el.calculatorClear.addEventListener('click', clearCalculator);
  el.settingsSave.addEventListener('click', saveSettingsFromForm);
  window.addEventListener('message', handleBrowserConsoleMessage);
  document.addEventListener('paste', handlePaste);
  document.addEventListener('keydown', handleImageClipboardShortcut, true);
  document.addEventListener('keydown', handleEditorSaveShortcut, true);
  document.addEventListener('keydown', handleBrowserZoomShortcut, true);
  document.addEventListener('keydown', handleResizeShortcut, true);
  document.addEventListener('keydown', handleWidgetFocusShortcut, true);
  document.addEventListener('keydown', handleNoteRenameShortcut, true);
  document.addEventListener('keydown', handleExplorerKeyboard, true);
  document.addEventListener('keydown', handleCalculatorGlobalKey, true);
  document.addEventListener('keydown', handleBrowserRefreshShortcut, true);
  document.addEventListener('mousedown', handleExplorerMouseNavigation, true);
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('pointerdown', handleContextMenuPointerDown, true);
  document.addEventListener('keydown', handleContextMenuKeydown, true);
  window.addEventListener('resize', scheduleWindowResizeWork);
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('pagehide', flushTerminalCwdSnapshotSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushTerminalCwdSnapshotSave();
      flushWorkspaceStorePersist();
      clearExplorerBackgroundWork();
      pauseMarketTickerForHidden();
      cancelBrowserFrameSuspend();
      suspendBrowserFramesForAllWorkspaces();
    } else if (state.workspaceOpen) {
      cancelBrowserFrameSuspend();
      scheduleExplorerWatch(1200);
      queueVisibleExplorerDirectoryPrefetch(900);
      forEachActiveWorkspaceTerminalWidget((widget) => scheduleFitTerminalWidget(widget, { activeOnly: true }));
      scheduleMarketTickerStart(MARKET_TICKER_VISIBLE_RESUME_DELAY_MS);
      scheduleMarketTickerRender();
      scheduleWslProfilesBackgroundLoad(1200);
      if (!isBrowserPanelHidden()) ensureActiveBrowserFrame();
    } else {
      cancelBrowserFrameSuspend();
      scheduleMarketTickerStart(MARKET_TICKER_VISIBLE_RESUME_DELAY_MS);
      scheduleMarketTickerRender();
      scheduleWslProfilesBackgroundLoad(1200);
    }
  });
  window.addEventListener('beforeunload', () => {
    flushTerminalCwdSnapshotSave();
    flushWorkspaceStorePersist();
    pauseMarketTickerForHidden();
    suspendBrowserFramesForWorkspace(state.activeWorkspaceId, { includeActive: true });
    stopAllEdgeDevtoolsSessions();
    hideCaptureFreezeFrame();
    if (state.captureProtectionApplied) void api.setCaptureProtection(false);
  });
}

function handleContextMenu(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const items = contextMenuItemsForEvent(event);
  event.preventDefault();
  event.stopPropagation();
  if (!items.length) {
    hideContextMenu();
    return;
  }
  showContextMenu(event.clientX, event.clientY, items);
}

function scheduleWindowResizeWork() {
  if (windowResizeFrame) return;
  windowResizeFrame = window.requestAnimationFrame(() => {
    windowResizeFrame = 0;
    hideContextMenu();
    FLOATING_PANELS.forEach((id) => {
      const panel = getPanel(id);
      if (!panel.classList.contains('hidden')) applyStoredLayoutRatio(panel);
    });
    state.terminalWidgets.forEach((widget) => {
      if (widget.element.classList.contains('hidden')) return;
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget);
    });
    scheduleExplorerVirtualRender();
    requestCodeEditorMeasure();
    scheduleConfigureEdgeViewport();
  });
}

function handleContextMenuPointerDown(event: PointerEvent) {
  if (event.button === 2) return;
  if (event.target instanceof Node && el.contextMenu.contains(event.target)) return;
  hideContextMenu();
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hideContextMenu();
}

function contextMenuItemsForEvent(event: MouseEvent): ContextMenuItem[] {
  const target = event.target as Element;
  const workspaceTab = target.closest<HTMLElement>('.workspace-tab');
  if (workspaceTab?.dataset.workspaceId) return workspaceTabContextMenu(workspaceTab.dataset.workspaceId);

  const noteTab = target.closest<HTMLElement>('.note-tab');
  if (noteTab?.dataset.noteTabId) return noteTabContextMenuItems(noteTab.dataset.noteTabId);

  const codeEditor = target.closest('.cm-editor');
  if (codeEditor) return editorContextMenuItems();

  const editable = editableTarget(target);
  if (editable) return textContextMenuItems(editable);

  const terminalCard = target.closest<HTMLElement>('.terminal-card');
  if (terminalCard) return terminalContextMenuItems(target, terminalCard);

  const fileRow = target.closest<HTMLElement>('.file-row');
  if (fileRow?.dataset.path && !isExplorerPathSelected(fileRow.dataset.path)) selectExplorerEntry(fileRow.dataset.path, false);
  if (target.closest('.explorer')) return explorerContextMenuItems();

  if (target.closest('.image')) return imageContextMenuItems();
  if (target.closest('.notes-panel')) return notesContextMenuItems();
  if (target.closest('.browser')) return browserContextMenuItems();
  return [];
}

function showContextMenu(x: number, y: number, items: ContextMenuItem[]) {
  el.contextMenu.innerHTML = '';
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      el.contextMenu.append(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-menu-item${item.danger ? ' danger' : ''}`;
    button.textContent = item.label ?? '';
    button.disabled = Boolean(item.disabled || !item.action);
    button.addEventListener('click', () => {
      hideContextMenu();
      if (!item.action) return;
      Promise.resolve(item.action()).catch((error) => setStatus(String(error), true));
    });
    el.contextMenu.append(button);
  }
  el.contextMenu.classList.remove('hidden');
  el.contextMenu.setAttribute('aria-hidden', 'false');
  const rect = el.contextMenu.getBoundingClientRect();
  const left = clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const top = clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8));
  el.contextMenu.style.left = `${Math.round(left)}px`;
  el.contextMenu.style.top = `${Math.round(top)}px`;
}

function hideContextMenu() {
  el.contextMenu.classList.add('hidden');
  el.contextMenu.setAttribute('aria-hidden', 'true');
}

function workspaceTabContextMenu(id: string): ContextMenuItem[] {
  const workspace = workspaceSnapshotForId(id);
  if (!workspace) return [];
  return [
    { label: 'Open workspace', action: () => activateWorkspaceTab(id), disabled: id === state.activeWorkspaceId && state.workspaceOpen },
    { label: 'Rename workspace', action: () => startWorkspaceTabRename(id) },
    { label: 'Copy workspace', action: () => copyWorkspaceTab(id) },
    {
      label: workspace.captureProtected ? 'Disable capture block' : 'Block capture while active',
      action: () => toggleWorkspaceCaptureProtection(id)
    },
    { separator: true },
    { label: 'Close workspace', action: () => closeWorkspaceTab(id), danger: true }
  ];
}

function explorerContextMenuItems(): ContextMenuItem[] {
  const entries = compactRecursiveExplorerSelection(selectedExplorerEntries());
  const entry = entries.length === 1 ? entries[0] : findExplorerEntry(state.explorerSelectedPath);
  const selectedCount = entries.length;
  const multi = selectedCount > 1;
  const items: ContextMenuItem[] = [
    { label: 'Open', action: () => { if (entry) openExplorerEntry(entry); }, disabled: !entry || multi },
    ...(entry && !multi && isPowerShellScriptPath(entry.path)
      ? [{
          label: 'Run ps1 as Admin',
          action: () => void runPowerShellScriptAsAdmin(entry.path),
          disabled: !canRunPowerShellScriptAsAdmin()
        }]
      : []),
    { label: 'Rename', action: renameSelectedExplorerEntry, disabled: !entry || multi },
    { label: multi ? `Export ${selectedCount} items` : 'Export', action: startExportSelectedExplorerEntry, disabled: !selectedCount },
    { label: multi ? `Delete ${selectedCount} items` : 'Delete', action: deleteSelectedExplorerEntries, disabled: !selectedCount, danger: true },
    { label: 'Undo delete', action: undoExplorerDelete, disabled: !explorerDeleteUndo },
    { separator: true },
    { label: 'New file', action: () => createExplorerItem('file') },
    { label: 'New folder', action: () => createExplorerItem('dir') },
    { label: 'Copy current cd', action: copyCurrentFolderCdCommand },
    { label: 'Refresh', action: () => refreshExplorerTree({ manual: true }) }
  ];
  return items;
}

function editorContextMenuItems(): ContextMenuItem[] {
  const hasSelection = Boolean(codeView && !codeView.state.selection.main.empty);
  return [
    { label: 'Cut', action: cutCodeSelection, disabled: !hasSelection },
    { label: 'Copy', action: copyCodeSelection, disabled: !hasSelection },
    { label: 'Paste', action: pasteIntoCodeEditor, disabled: !codeView },
    { label: 'Select all', action: selectAllCodeEditor, disabled: !codeView },
    { separator: true },
    { label: 'Save', action: saveOpenFile, disabled: !state.openFile },
    { label: state.editorWordWrap ? 'Word wrap off' : 'Word wrap on', action: toggleEditorWordWrap }
  ];
}

function terminalContextMenuItems(target: Element, card: HTMLElement): ContextMenuItem[] {
  const host = target.closest<HTMLElement>('.terminal-host');
  const pane = host?.dataset.paneId
    ? terminalPaneById.get(host.dataset.paneId) ?? activePaneForElement(card)
    : activePaneForElement(card);
  if (pane) setActivePane(pane.paneId);
  const widget = terminalWidgetForElement(card);
  const selected = pane?.term.getSelection() ?? '';
  return [
    { label: 'Copy', action: () => copyTextToClipboard(selected, 'Copied terminal selection'), disabled: !selected },
    { label: 'Paste', action: () => pasteIntoTerminal(pane), disabled: !pane },
    { label: 'Clear', action: () => pane?.term.clear(), disabled: !pane },
    { separator: true },
    { label: 'New shell tab', action: () => { if (widget) void createShellTabInWidget(widget); }, disabled: !widget },
    { label: 'Close shell tab', action: () => { if (pane) void closeTerminalPane(pane.paneId); }, disabled: !pane, danger: true },
    { label: 'Close shell widget', action: () => { if (widget) void closeTerminalWidget(widget.widgetId); }, disabled: !widget, danger: true }
  ];
}

function browserContextMenuItems(): ContextMenuItem[] {
  const tab = currentBrowserTab();
  return [
    { label: 'Back', action: () => navigateBrowserHistory(-1), disabled: !tab },
    { label: 'Forward', action: () => navigateBrowserHistory(1), disabled: !tab },
    { label: 'Reload', action: () => refreshPreview(false), disabled: !tab },
    { label: 'Hard refresh', action: () => refreshPreview(true), disabled: !tab },
    { label: 'Clear cache and reload', action: () => { void clearBrowserCacheAndReload(); }, disabled: !tab },
    { label: 'Copy URL', action: () => { if (tab) void copyTextToClipboard(tab.url, 'Copied browser URL'); }, disabled: !tab },
    { separator: true },
    { label: state.browserConsoleVisible ? 'Hide console' : 'Show console', action: () => setBrowserConsoleVisible(!state.browserConsoleVisible) },
    { label: 'Clear console', action: () => { state.browserConsoleLogs = []; clearBrowserConsoleRowElementCache(); clearBrowserConsoleHiddenPayloadQueue(); markBrowserConsoleLogsChanged(); renderBrowserConsole(); } },
    { separator: true },
    { label: 'Close browser tab', action: () => { if (tab) closeBrowserTab(tab.id); }, disabled: !tab, danger: true }
  ];
}

function imageContextMenuItems(): ContextMenuItem[] {
  const latest = state.imageHistory[0];
  return [
    { label: 'Copy image', action: copyCurrentPreviewImage, disabled: !state.imagePreviewDataUrl },
    { label: 'Paste image from clipboard', action: pasteImageFromNativeClipboard },
    { label: 'Paste latest tag to shell', action: async () => { if (latest) await pasteImageTagToActiveTerminal(latest.tag); }, disabled: !latest },
    { separator: true },
    { label: state.imageHistoryVisible ? 'Hide history' : 'Show history', action: () => { state.imageHistoryVisible = !state.imageHistoryVisible; syncActiveImageTabFromState(); renderImageHistory(); saveActiveWorkspaceSnapshot(); } },
    { label: 'Clear history', action: () => { state.imageHistory = []; syncActiveImageTabFromState(); renderImageHistory(); saveActiveWorkspaceSnapshot(); }, disabled: !state.imageHistory.length, danger: true }
  ];
}

function notesContextMenuItems(): ContextMenuItem[] {
  return [
    { label: 'New note', action: () => createNoteTab({ focus: true }) },
    { label: 'Save note', action: saveActiveNoteNow, disabled: !activeNoteTab() },
    { label: state.notePinned ? 'Unpin notes' : 'Pin notes', action: toggleNotePin }
  ];
}

function noteTabContextMenuItems(id: string): ContextMenuItem[] {
  const tab = noteTabForId(id);
  if (!tab) return notesContextMenuItems();
  return [
    { label: 'Rename tab', action: () => renameNoteTab(id) },
    { label: 'Use auto title', action: () => setNoteTabCustomTitle(id, ''), disabled: !noteTabCustomTitle(tab) },
    { separator: true },
    { label: 'New note', action: () => createNoteTab({ focus: true }) },
    { label: 'Save note', action: () => saveNoteTabNow(tab), disabled: !shouldSaveNoteTabNow(tab) },
    { separator: true },
    { label: 'Close note tab', action: () => closeNoteTab(id), danger: true }
  ];
}

function textContextMenuItems(target: HTMLInputElement | HTMLTextAreaElement): ContextMenuItem[] {
  const hasSelection = Boolean(selectedTextFromEditable(target));
  const readOnly = target.readOnly || target.disabled;
  return [
    { label: 'Cut', action: () => cutEditableSelection(target), disabled: !hasSelection || readOnly },
    { label: 'Copy', action: () => copyEditableSelection(target), disabled: !hasSelection },
    { label: 'Paste', action: () => pasteIntoEditable(target), disabled: readOnly },
    { label: 'Select all', action: () => target.select() }
  ];
}

function editableTarget(target: Element) {
  const editable = target.closest<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!editable) return null;
  if (editable instanceof HTMLTextAreaElement) return editable;
  const blocked = ['button', 'checkbox', 'file', 'image', 'radio', 'range', 'reset', 'submit'];
  return blocked.includes(editable.type) ? null : editable;
}

function selectedTextFromEditable(target: HTMLInputElement | HTMLTextAreaElement) {
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  return start === end ? '' : target.value.slice(start, end);
}

async function copyEditableSelection(target: HTMLInputElement | HTMLTextAreaElement) {
  const text = selectedTextFromEditable(target);
  if (!text) return;
  await copyTextToClipboard(text, 'Copied selection');
}

async function cutEditableSelection(target: HTMLInputElement | HTMLTextAreaElement) {
  const text = selectedTextFromEditable(target);
  if (!text) return;
  await writeText(text);
  replaceEditableSelection(target, '');
}

async function pasteIntoEditable(target: HTMLInputElement | HTMLTextAreaElement) {
  replaceEditableSelection(target, await readText());
}

function replaceEditableSelection(target: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.setRangeText(text, start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
}

async function copyCodeSelection() {
  if (!codeView) return;
  const text = codeView.state.selection.ranges
    .map((range) => codeView!.state.doc.sliceString(range.from, range.to))
    .join('\n');
  if (text) await copyTextToClipboard(text, 'Copied editor selection');
}

async function cutCodeSelection() {
  if (!codeView || codeView.state.selection.main.empty) return;
  await copyCodeSelection();
  codeView.dispatch(codeView.state.replaceSelection(''));
  codeView.focus();
}

async function pasteIntoCodeEditor() {
  if (!codeView) return;
  codeView.dispatch(codeView.state.replaceSelection(await readText()));
  codeView.focus();
}

function selectAllCodeEditor() {
  if (!codeView) return;
  codeView.dispatch({ selection: { anchor: 0, head: codeView.state.doc.length }, scrollIntoView: true });
  codeView.focus();
}

function toggleEditorWordWrap() {
  state.editorWordWrap = !state.editorWordWrap;
  el.editorWordWrap.checked = state.editorWordWrap;
  renderEditor();
  saveActiveWorkspaceSnapshot();
}

async function pasteIntoTerminal(pane: TerminalPane | null | undefined) {
  if (!pane) return;
  pane.term.paste(await readText());
  pane.term.focus();
}

async function copyTextToClipboard(text: string, message: string) {
  await writeText(text);
  setStatus(message);
}

async function copyCurrentFolderCdCommand() {
  const activeWidget = activeTerminalWidget();
  const activePane = activeWidget ? activePaneForWidget(activeWidget) : null;
  const dir = activePane?.cwd ?? state.currentDir ?? state.workspaceRoot;
  if (!dir) {
    setStatus('No current folder to copy', true);
    return;
  }
  const profile = activePane
    ? profileForId(activePane.profileId) ?? state.activeProfile
    : state.activeProfile;
  await writeText(cdCommandForPath(dir, profile?.kind ?? 'wsl'));
  setStatus('Copied cd command for current folder');
}

function cdCommandForPath(path: string, profileKind: string) {
  if (profileKind === 'windows' || isWindowsPath(path)) return `Set-Location -LiteralPath ${powershellQuote(path)}`;
  return `cd ${posixShellQuote(path)}`;
}

function posixShellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bindWindowChrome() {
  el.titlebar.addEventListener('mousedown', handleTitlebarMouseDown);
  el.windowControlButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runWindowAction(button.dataset.windowAction ?? '');
    });
  });
  el.windowResizeZones.forEach((zone) => {
    zone.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const direction = zone.dataset.windowResizeDirection as WindowResizeDirection | undefined;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      void currentWindow.startResizeDragging(direction);
    });
  });
}

function activateBrowserPanel() {
  const panel = getPanel('browser');
  if (panel.classList.contains('hidden')) return;
  bringPanelToFront(panel);
  setKeyboardResizeTarget({ kind: 'panel', id: 'browser' });
}

function handleTitlebarMouseDown(event: MouseEvent) {
  setKeyboardResizeTarget({ kind: 'ide' });
  if (event.button !== 0 || isWindowChromeInteractive(event.target)) return;

  event.preventDefault();
  if (event.detail >= 2) {
    void currentWindow.toggleMaximize();
    return;
  }
  void currentWindow.startDragging();
}

function isWindowChromeInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a, [data-no-window-drag]'));
}

async function runWindowAction(action: string) {
  if (action === 'minimize') await currentWindow.minimize();
  else if (action === 'toggle-maximize') await currentWindow.toggleMaximize();
  else if (action === 'close') {
    // Close immediately for a snappy exit. Don't await teardown here: the
    // backend RunEvent::ExitRequested hook runs shutdown_runtime_sessions as
    // the window tears down, and the Windows Job Object guarantees the child
    // process tree dies with the app even if that never runs. We still kick off
    // teardown fire-and-forget so it starts a beat earlier.
    void api.shutdownRuntimeSessions().catch(() => undefined);
    await currentWindow.close();
  }
}
async function resolveSelectedRoot() {
  if (!state.activeProfile) return '.';
  const requested = el.rootInput.value.trim() || state.activeProfile.root || '.';
  setStatus(`Resolving ${state.activeProfile.label} root...`);
  const resolved = await api.resolveProfilePath(state.activeProfile.id, requested);
  el.rootInput.value = resolved;
  return resolved;
}

function launchLlm(id: string) {
  void startLlmLauncher(id);
}

async function startLlmLauncher(id: string) {
  // Launch the CLI by TYPING the command at the prompt (sending it as terminal input), NOT by
  // embedding it in the startup rcfile. node-launched CLIs (e.g. codex via nvm) only enter
  // bypass/YOLO mode when started as a real interactive foreground job; running them during rc
  // init silently downgrades them. (Typed-ahead input is buffered and runs once the prompt is
  // ready.) The command itself stays visible in the terminal; hiding it is a separate concern.
  const command = llmLauncherCommand(id);
  const widget = await createTerminal(null, id, { initialHeight: 420 });
  if (!widget) return;
  const pane = activePaneForWidget(widget);
  if (!pane?.backendId) return;
  await sendTerminalInputNow(pane, `${command}\r`).catch((error) => {
    setStatus(`Failed to launch ${id}: ${String(error)}`, true);
  });
}

function llmLauncherCommand(id: string) {
  const launcher = LLM_LAUNCHERS[id];
  if (!launcher) return id;
  return state.activeProfile?.kind === 'windows'
    ? powershellLlmLauncherCommand(launcher)
    : bashLlmLauncherCommand(launcher);
}

function bashLlmLauncherCommand(launcher: LlmLauncherConfig) {
  const executable = launcher.executable;
  // Add the bypass flag only when it is NOT already in the resolved command. `type` reveals an
  // alias/function body; a wrapper SCRIPT on PATH only shows its path via `type`, so also fold in
  // the script's own text (shebang files only). If the flag is found there, the user's
  // alias/wrapper already supplies it — don't add a second one (codex errors on a duplicate).
  // Otherwise add it. claude additionally refuses the flag as root, so gate it on a non-zero uid.
  const needsRootGate = launcher.flags.some((flag) => flag.skipWhenRoot);
  const lines = [
    `__svi_source="$(type ${executable} 2>/dev/null || true)"`,
    `__svi_path="$(command -v ${executable} 2>/dev/null || true)"`,
    `case "$__svi_path" in /*) if [ -f "$__svi_path" ] && [ "$(head -c 2 "$__svi_path" 2>/dev/null)" = '#!' ]; then __svi_source="$__svi_source $(head -c 8192 "$__svi_path" 2>/dev/null)"; fi ;; esac`,
    '__svi_args=()'
  ];
  if (needsRootGate) lines.push(`__svi_euid="$(id -u 2>/dev/null || echo 1000)"`);
  for (const flag of launcher.flags) {
    const add = `case "$__svi_source" in ${flag.bashPattern}) ;; *) __svi_args+=(${flag.args.map(bashQuote).join(' ')}) ;; esac`;
    lines.push(flag.skipWhenRoot ? `if [ "$__svi_euid" != 0 ]; then ${add}; fi` : add);
  }
  lines.push(`${executable} "\${__svi_args[@]}"`);
  return lines.join('\n');
}

function powershellLlmLauncherCommand(launcher: LlmLauncherConfig) {
  const executable = launcher.executable;
  return [
    `$sviSource = (Get-Command ${executable} -All -ErrorAction SilentlyContinue | Format-List CommandType,Name,Definition,Source | Out-String)`,
    '$sviArgs = @()',
    ...launcher.flags.map((flag) =>
      `if ($sviSource -notmatch ${powershellQuote(flag.powershellPattern)}) { $sviArgs += @(${flag.args.map(powershellQuote).join(', ')}) }`
    ),
    `& ${executable} @sviArgs`
  ].join('\n');
}

function bashQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: string) {
  return `'${value.replace(/'/g, `''`)}'`;
}

async function createWindowsShell() {
  const profile = profileForIdWithWindowsFallback('windows-local')!;
  const cwd = await api.windowsShellRoot().catch(() => 'C:\\Windows\\Temp\\simple-vibe-ide-shell');
  await createTerminal(null, 'Windows PowerShell', { profile, cwd });
}

function handleEditorSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() !== 's') return;
  if (event.target instanceof Element && event.target.closest('.notes-panel')) return;
  if (!state.openFile) return;

  event.preventDefault();
  event.stopPropagation();
  void saveOpenFile();
}

function handleResizeShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const direction = shortcutResizeDirection(event);
  if (!direction) return;

  event.preventDefault();
  event.stopPropagation();
  resizeKeyboardTarget(direction);
}

function handleWidgetFocusShortcut(event: KeyboardEvent) {
  if (!isWidgetFocusShortcut(event)) return;
  if (event.target instanceof Element && event.target.closest('.terminal-host .xterm')) return;

  event.preventDefault();
  event.stopPropagation();
  cycleWidgetFocus(event.shiftKey ? -1 : 1);
}

function isWidgetFocusShortcut(event: KeyboardEvent) {
  return event.type === 'keydown'
    && event.key === 'F6'
    && !event.ctrlKey
    && !event.altKey
    && !event.metaKey;
}

function shortcutResizeDirection(event: KeyboardEvent) {
  if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') return 1;
  if (event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') return -1;
  return 0;
}

function handleBrowserZoomShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (!browserZoomShortcutTargetActive(event)) return;
  const action = browserZoomShortcutAction(event);
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  if (action === 'reset') resetBrowserZoom();
  else resizeBrowserZoom(action);
}

function browserZoomShortcutTargetActive(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.browser-panel')) return true;
  return keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'browser';
}

function browserZoomShortcutAction(event: KeyboardEvent): number | 'reset' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') return 1;
  if (event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') return -1;
  if (event.code === 'Digit0' || event.code === 'Numpad0' || event.key === '0') return 'reset';
  return null;
}

function handleExplorerMouseNavigation(event: MouseEvent) {
  if (event.button !== 3) return;
  const explorer = getPanel('explorer');
  if (explorer.classList.contains('hidden')) return;
  if (!(event.target instanceof Node) || !explorer.contains(event.target)) return;

  event.preventDefault();
  event.stopPropagation();
  void goToParentDirectory();
}

function handleExplorerKeyboard(event: KeyboardEvent) {
  if (!shouldHandleExplorerKeyboard(event)) return;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.stopPropagation();
    void undoExplorerDelete();
    return;
  }

  if (event.key === 'F2') {
    event.preventDefault();
    event.stopPropagation();
    void renameSelectedExplorerEntry();
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    event.stopPropagation();
    void deleteSelectedExplorerEntries();
    return;
  }

  if (event.key === 'Enter') {
    if (openSelectedExplorerEntry()) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    moveExplorerSelection(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
  selectExplorerByTypeahead(event.key);
  event.preventDefault();
  event.stopPropagation();
}

function shouldHandleExplorerKeyboard(event: KeyboardEvent) {
  const explorer = getPanel('explorer');
  if (explorer.classList.contains('hidden')) return false;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, .terminal-card, .cm-editor')) {
    return false;
  }
  return keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'explorer'
    || event.target instanceof Node && explorer.contains(event.target);
}

function resizeKeyboardTarget(direction: number) {
  const target = keyboardResizeTarget;
  if (target.kind === 'ide') {
    resizeIde(direction);
    return;
  }

  if (target.kind === 'panel') {
    if (target.id === 'editor') {
      resizeEditorFont(direction);
      return;
    }
    if (target.id === 'notes') {
      resizeNoteFont(direction);
      return;
    }
    if (target.id === 'browser') {
      resizeBrowserZoom(direction);
      return;
    }
    if (target.id === 'calculator') {
      resizeCalculatorFont(direction);
      return;
    }
    const panel = getPanel(target.id);
    if (!panel.classList.contains('hidden')) resizeFloatingPanelByKeyboard(panel, direction);
    return;
  }

  const pane = terminalPaneById.get(target.paneId);
  if (pane) resizeTerminalFont(direction);
}

function resizeIde(direction: number) {
  const factor = direction > 0 ? 1.05 : 1 / 1.05;
  ideScale = clamp(ideScale * factor, 0.72, 1.45);
  setRootStyleProperty('--ide-scale', ideScale.toFixed(3));
  requestAnimationFrame(() => {
    FLOATING_PANELS.forEach((id) => applyStoredLayoutRatio(getPanel(id)));
    state.terminalWidgets.forEach((widget) => {
      if (widget.element.classList.contains('hidden')) return;
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget, { activeOnly: true });
    });
    requestCodeEditorMeasure();
  });
  saveActiveWorkspaceSnapshot();
}

function resizeFloatingPanelByKeyboard(panel: HTMLElement, direction: number) {
  const workspace = panel.parentElement as HTMLElement;
  const factor = direction > 0 ? WIDGET_KEYBOARD_SCALE : 1 / WIDGET_KEYBOARD_SCALE;
  bringPanelToFront(panel);
  commitPanelRect(panel);
  const rect = currentPanelRect(panel, workspace);
  const rawRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width * factor,
    height: rect.height * factor
  };
  const next = direction > 0
    ? snapPanelRect(panel, rawRect, { resizeX: true, resizeY: true })
    : clampPanelRect(panel, rawRect);
  applyPanelRect(panel, next);
  if (panel.dataset.panel === 'editor') requestCodeEditorMeasure();
  saveActiveWorkspaceSnapshot();
}

function resizeTerminalByKeyboard(pane: TerminalPane, direction: number) {
  const factor = direction > 0 ? WIDGET_KEYBOARD_SCALE : 1 / WIDGET_KEYBOARD_SCALE;
  const workspace = pane.element.parentElement as HTMLElement;
  commitPanelRect(pane.element);
  const rect = currentPanelRect(pane.element, workspace);
  const rawRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width * factor,
    height: rect.height * factor
  };
  const next = direction > 0
    ? snapPanelRect(pane.element, rawRect, { resizeX: true, resizeY: true })
    : clampPanelRect(pane.element, rawRect);
  applyPanelRect(pane.element, next);
  scheduleFitTerminal(pane);
  saveActiveWorkspaceSnapshot();
}

function resizeEditorFont(direction: number) {
  editorFontSize = clamp(editorFontSize + direction, 10, 24);
  setRootStyleProperty('--editor-font-size', `${editorFontSize}px`);
  requestCodeEditorMeasure();
  saveActiveWorkspaceSnapshot();
}

function resizeTerminalFont(direction: number) {
  terminalFontSize = clamp(terminalFontSize + direction, 9, 24);
  for (const pane of state.terminals) {
    pane.term.options.fontSize = terminalFontSize;
    pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
    scheduleFitTerminal(pane);
  }
  saveActiveWorkspaceSnapshot();
}

function resizeNoteFont(direction: number) {
  noteFontSize = clamp(noteFontSize + direction, 10, 28);
  applyNoteFontSize();
  saveActiveWorkspaceSnapshot();
}

function applyNoteFontSize() {
  setRootStyleProperty('--notes-font-size', `${noteFontSize}px`);
}

function setNoteOpacity(value: number, options: { save: boolean }) {
  noteOpacity = clamp(Number.isFinite(value) ? value : 100, 45, 100);
  applyNoteOpacity();
  if (options.save) saveActiveWorkspaceSnapshot();
}

function applyNoteOpacity() {
  const percent = `${Math.round(noteOpacity)}%`;
  setRootStyleProperty('--notes-opacity', percent);
  setInputValueIfChanged(el.notesOpacity, String(Math.round(noteOpacity)));
  setTextContentIfChanged(el.notesOpacityValue, percent);
}

function resizeBrowserZoom(direction: number) {
  state.browserZoom = nextBrowserZoom(state.browserZoom, direction);
  syncActiveBrowserTabViewport();
  applyBrowserZoom();
  setStatus(`Browser zoom ${Math.round(state.browserZoom * 100)}%`);
  saveActiveWorkspaceSnapshot();
}

function resetBrowserZoom() {
  state.browserZoom = 1;
  syncActiveBrowserTabViewport();
  applyBrowserZoom();
  setStatus('Browser zoom 100%');
  saveActiveWorkspaceSnapshot();
}

function nextBrowserZoom(current: number, direction: number) {
  const normalized = normalizedBrowserZoom(current);
  if (direction > 0) {
    return BROWSER_ZOOM_LEVELS.find((level) => level > normalized + 0.001) ?? BROWSER_ZOOM_LEVELS[BROWSER_ZOOM_LEVELS.length - 1];
  }
  for (let index = BROWSER_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    if (BROWSER_ZOOM_LEVELS[index] < normalized - 0.001) return BROWSER_ZOOM_LEVELS[index];
  }
  return BROWSER_ZOOM_LEVELS[0];
}

function applyBrowserZoom() {
  setRootStyleProperty('--browser-preview-zoom', state.browserZoom.toFixed(2));
  applyBrowserFrameSizingForActiveFrame();
  applyEdgePreviewSizing();
  scheduleConfigureEdgeViewport();
}

function resizeCalculatorFont(direction: number) {
  calculatorFontSize = clamp(calculatorFontSize + direction, 10, 28);
  applyCalculatorFontSize();
  saveActiveWorkspaceSnapshot();
}

function applyCalculatorFontSize() {
  setRootStyleProperty('--calculator-font-size', `${calculatorFontSize}px`);
}

function terminalMinWidth() {
  return window.matchMedia('(max-width: 900px)').matches ? 220 : 300;
}

function terminalMinHeight() {
  return window.matchMedia('(max-width: 900px)').matches ? 220 : 280;
}

function setKeyboardResizeTarget(target: ResizeTarget) {
  keyboardResizeTarget = target;
  const nextElement = keyboardResizeElementForTarget(target);
  if (keyboardResizeTargetElement && keyboardResizeTargetElement !== nextElement) {
    keyboardResizeTargetElement.classList.remove('keyboard-target');
  }
  el.titlebar.classList.toggle('keyboard-target', target.kind === 'ide');
  if (target.kind === 'panel') {
    nextElement?.classList.add('keyboard-target');
  } else if (target.kind === 'terminal') {
    nextElement?.classList.add('keyboard-target');
  }
  keyboardResizeTargetElement = nextElement;
}

function keyboardResizeElementForTarget(target: ResizeTarget) {
  if (target.kind === 'panel') return getPanel(target.id);
  if (target.kind === 'terminal') return terminalPaneById.get(target.paneId)?.element ?? null;
  return null;
}

type WidgetFocusItem =
  | { kind: 'panel'; id: FloatingPanelId; element: HTMLElement }
  | { kind: 'terminal'; pane: TerminalPane; element: HTMLElement };

function cycleWidgetFocus(direction: number, fromPaneId = '') {
  const items = focusableWidgets();
  if (!items.length) {
    setKeyboardResizeTarget({ kind: 'ide' });
    return;
  }

  const currentIndex = currentWidgetFocusIndex(items, fromPaneId);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : items.length - 1)
    : (currentIndex + direction + items.length) % items.length;
  focusWidget(items[nextIndex]);
}

function focusableWidgets(): WidgetFocusItem[] {
  const items: WidgetFocusItem[] = [];
  addPanelFocusItem(items, 'explorer');
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId !== state.activeWorkspaceId) continue;
    const pane = activePaneForWidget(widget);
    if (pane && widget.element.isConnected) items.push({ kind: 'terminal', pane, element: widget.element });
  }
  addPanelFocusItem(items, 'editor');
  addPanelFocusItem(items, 'notes');
  addPanelFocusItem(items, 'image');
  addPanelFocusItem(items, 'browser');
  addPanelFocusItem(items, 'calculator');
  addPanelFocusItem(items, 'settings');
  return items;
}

function addPanelFocusItem(items: WidgetFocusItem[], id: FloatingPanelId) {
  const panel = getPanel(id);
  if (!panel.classList.contains('hidden')) items.push({ kind: 'panel', id, element: panel });
}

function currentWidgetFocusIndex(items: WidgetFocusItem[], fromPaneId: string) {
  if (fromPaneId) {
    const index = items.findIndex((item) => item.kind === 'terminal' && item.pane.paneId === fromPaneId);
    if (index >= 0) return index;
  }

  const target = keyboardResizeTarget;
  if (target.kind === 'panel') {
    const index = items.findIndex((item) => item.kind === 'panel' && item.id === target.id);
    if (index >= 0) return index;
  }
  if (target.kind === 'terminal') {
    const index = items.findIndex((item) => item.kind === 'terminal' && item.pane.paneId === target.paneId);
    if (index >= 0) return index;
  }

  const active = document.activeElement;
  if (active) {
    const index = items.findIndex((item) => item.element.contains(active));
    if (index >= 0) return index;
  }
  return -1;
}

function focusWidget(item: WidgetFocusItem) {
  bringPanelToFront(item.element);
  if (item.kind === 'terminal') {
    setActivePane(item.pane.paneId);
    item.pane.term.focus();
    setStatus(`Focused ${item.pane.title}`);
    return;
  }

  setKeyboardResizeTarget({ kind: 'panel', id: item.id });
  if (item.id === 'explorer') {
    el.fileList.focus();
  } else if (item.id === 'editor' && codeView) {
    codeView.focus();
  } else if (item.id === 'notes') {
    el.notesBody.focus();
  } else if (item.id === 'browser') {
    el.previewUrl.focus();
  } else if (item.id === 'calculator') {
    el.calculatorExpression.focus();
  } else {
    focusPanelElement(item.element);
  }
  setStatus(`Focused ${panelFocusLabel(item.id)}`);
}

function focusPanelElement(panel: HTMLElement) {
  if (panel.tabIndex < 0) panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
}

function panelFocusLabel(id: FloatingPanelId) {
  return id === 'image' ? 'Image Preview' : id[0].toUpperCase() + id.slice(1);
}

function bindFloatingPanels() {
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    const handle = panel.querySelector<HTMLElement>('.panel-drag-handle');
    const grips = ensureResizeGrips(panel, id);
    panel.addEventListener('pointerdown', () => {
      bringPanelToFront(panel);
      setKeyboardResizeTarget({ kind: 'panel', id });
    });
    handle?.addEventListener('pointerdown', (event) => startPanelDrag(event, panel));
    grips.forEach((grip) => {
      grip.addEventListener('pointerdown', (event) => startPanelResize(event, panel, grip));
    });

    if (id === 'editor') {
      new ResizeObserver(requestCodeEditorMeasure).observe(panel);
    }
  }

  for (const button of el.closePanelButtons) {
    button.addEventListener('click', () => setPanelVisible(button.dataset.closePanel as FloatingPanelId, false));
  }
  for (const button of el.togglePanelButtons) {
    button.addEventListener('click', () => {
      const id = button.dataset.togglePanel as FloatingPanelId;
      setPanelVisible(id, getPanel(id).classList.contains('hidden'));
    });
  }
  el.resetLayout.addEventListener('click', resetFloatingLayout);
}

function getPanel(id: FloatingPanelId) {
  const cached = panelElementCache.get(id);
  if (cached?.isConnected) return cached;
  const panel = document.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
  panelElementCache.set(id, panel);
  return panel;
}

function isBrowserPanelHidden() {
  return el.browserPanel.classList.contains('hidden');
}

function isPanelVisible(id: FloatingPanelId) {
  return !getPanel(id).classList.contains('hidden');
}

function getPanelToggle(id: FloatingPanelId) {
  if (panelToggleCache.has(id)) {
    const cached = panelToggleCache.get(id) ?? null;
    if (!cached || cached.isConnected) return cached;
  }
  const toggle = document.querySelector<HTMLButtonElement>(`[data-toggle-panel="${id}"]`);
  panelToggleCache.set(id, toggle);
  return toggle;
}

function ensureResizeGrips(panel: HTMLElement, label: string) {
  const grips: HTMLElement[] = [];
  for (const direction of PANEL_RESIZE_DIRECTIONS) {
    const existing = panel.querySelector<HTMLElement>(`[data-panel-resize-direction="${direction}"]`);
    if (existing) {
      grips.push(existing);
      continue;
    }
    const grip = document.createElement('div');
    grip.className = `panel-resize-grip panel-resize-${direction.toLowerCase()}`;
    grip.title = `Resize ${label}`;
    grip.dataset.panelResizeDirection = direction;
    grip.setAttribute('aria-hidden', 'true');
    panel.append(grip);
    grips.push(grip);
  }
  return grips;
}

function setPanelVisible(id: FloatingPanelId, visible: boolean, options: { skipSave?: boolean; skipFocus?: boolean } = {}) {
  const panel = getPanel(id);
  const wasHidden = panel.classList.contains('hidden');
  const visibilityChanged = wasHidden === visible;
  if (visibilityChanged) panel.classList.toggle('hidden', !visible);
  const toggle = getPanelToggle(id);
  if (toggle) {
    toggleClassIfChanged(toggle, 'active', visible);
    setAttributeIfChanged(toggle, 'aria-pressed', String(visible));
  }
  if (visible) {
    if (wasHidden) applyStoredLayoutRatio(panel);
    if (!options.skipFocus) {
      bringPanelToFront(panel);
      if (!wasHidden) pinPanelToWorkspace(panel);
      setKeyboardResizeTarget({ kind: 'panel', id });
    }
    if (id === 'editor' && wasHidden && !restoringWorkspace) void ensureEditorReady();
    if (id === 'notes' && wasHidden && !restoringWorkspace) void ensureNotesReady();
    if (id === 'image' && wasHidden && !restoringWorkspace) {
      renderImageTabs();
      renderImagePreview();
      renderImageHistory();
    }
    if (id === 'calculator' && wasHidden && !restoringWorkspace) renderCalculator();
    if (id === 'settings' && wasHidden && !restoringWorkspace) renderSettings();
    if (id === 'explorer' && wasHidden && state.workspaceOpen && !restoringWorkspace) {
      if (shouldLoadExplorerDirectoryOnShow()) {
        void loadDirectory(state.currentDir);
      } else {
        if (explorerRenderDirty || !el.fileList.childElementCount) renderExplorer();
        void refreshExplorerTree({ silent: true });
      }
      scheduleExplorerWatch();
    }
    if (id === 'browser' && !restoringWorkspace) {
      cancelBrowserFrameSuspend();
      if (wasHidden) {
        applyVisibleBrowserLayout();
        renderForwards();
        if (!ensureActiveBrowserFrame()) renderBrowserTabs();
        if (state.browserConsoleVisible) renderBrowserConsole();
      }
    }
    if (id === 'editor') requestCodeEditorMeasure();
  } else {
    if (id === 'editor' && !wasHidden) {
      syncActiveEditorTabFromView();
      destroyCodeEditorView();
    }
    if (id === 'browser' && !wasHidden && !restoringWorkspace) {
      syncBrowserConsoleCaptureForActiveFrame();
      trimBrowserConsoleLogs();
      cancelBrowserFrameSuspend();
      suspendBrowserFramesForWorkspace(state.activeWorkspaceId, { includeActive: true });
    }
    if (!wasHidden && keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === id) {
      setKeyboardResizeTarget({ kind: 'ide' });
    }
  }
  if (visibilityChanged && !options.skipSave) saveActiveWorkspaceSnapshot();
}

function resetFloatingLayout() {
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    panel.style.height = '';
    panel.style.zIndex = '';
    setPanelVisible(id, DEFAULT_PANEL_VISIBILITY[id]);
  }
  requestCodeEditorMeasure();
  saveActiveWorkspaceSnapshot();
}

function startPanelDrag(event: PointerEvent, panel: HTMLElement) {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a')) return;

  event.preventDefault();
  bringPanelToFront(panel);
  if (panel.classList.contains('terminal-card')) {
    const pane = activePaneForElement(panel);
    if (pane) setKeyboardResizeTarget({ kind: 'terminal', paneId: pane.paneId });
  } else {
    setKeyboardResizeTarget({ kind: 'panel', id: panel.dataset.panel as FloatingPanelId });
  }
  commitPanelRect(panel);

  const workspace = panel.parentElement as HTMLElement;
  const workspaceRect = workspace.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = panelRect.left - workspaceRect.left;
  const startTop = panelRect.top - workspaceRect.top;
  const workspaceWidth = workspace.clientWidth;
  const workspaceHeight = workspace.clientHeight;
  const panelWidth = panelRect.width;
  const panelHeight = panelRect.height;
  const snapGuides = collectSnapGuides(panel, workspace);

  panel.setPointerCapture(event.pointerId);
  panel.classList.add('dragging');

  const move = (moveEvent: PointerEvent) => {
    const maxLeft = Math.max(0, workspaceWidth - panelWidth);
    const maxTop = Math.max(0, workspaceHeight - panelHeight);
    const rawRect = {
      left: clamp(startLeft + moveEvent.clientX - startX, 0, maxLeft),
      top: clamp(startTop + moveEvent.clientY - startY, 0, maxTop),
      width: panelWidth,
      height: panelHeight
    };
    applyPanelRect(panel, snapPanelRect(panel, rawRect, { moveX: true, moveY: true }, snapGuides));
  };

  const up = (upEvent: PointerEvent) => {
    panel.classList.remove('dragging');
    panel.releasePointerCapture(upEvent.pointerId);
    panel.removeEventListener('pointermove', move);
    panel.removeEventListener('pointerup', up);
    panel.removeEventListener('pointercancel', up);
    saveActiveWorkspaceSnapshot();
  };

  panel.addEventListener('pointermove', move);
  panel.addEventListener('pointerup', up);
  panel.addEventListener('pointercancel', up);
}

function startPanelResize(event: PointerEvent, panel: HTMLElement, grip: HTMLElement) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const direction = (grip.dataset.panelResizeDirection as WindowResizeDirection | undefined) ?? 'SouthEast';
  const resizeWest = direction.includes('West');
  const resizeEast = direction.includes('East');
  const resizeNorth = direction.includes('North');
  const resizeSouth = direction.includes('South');
  bringPanelToFront(panel);
  if (panel.classList.contains('terminal-card')) {
    const pane = activePaneForElement(panel);
    if (pane) setKeyboardResizeTarget({ kind: 'terminal', paneId: pane.paneId });
  } else {
    setKeyboardResizeTarget({ kind: 'panel', id: panel.dataset.panel as FloatingPanelId });
  }
  commitPanelRect(panel);

  const workspace = panel.parentElement as HTMLElement;
  const panelRect = currentPanelRect(panel, workspace);
  const startX = event.clientX;
  const startY = event.clientY;
  const minWidth = panelMinWidth(panel);
  const minHeight = panelMinHeight(panel);
  const workspaceWidth = workspace.clientWidth;
  const workspaceHeight = workspace.clientHeight;
  const snapGuides = collectSnapGuides(panel, workspace);

  grip.setPointerCapture(event.pointerId);
  panel.classList.add('resizing');

  const move = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    let left = panelRect.left;
    let top = panelRect.top;
    let width = panelRect.width;
    let height = panelRect.height;

    if (resizeEast) {
      width = clamp(panelRect.width + deltaX, minWidth, workspaceWidth - panelRect.left);
    }
    if (resizeSouth) {
      height = clamp(panelRect.height + deltaY, minHeight, workspaceHeight - panelRect.top);
    }
    if (resizeWest) {
      const boundedDelta = clamp(deltaX, -panelRect.left, panelRect.width - minWidth);
      left = panelRect.left + boundedDelta;
      width = panelRect.width - boundedDelta;
    }
    if (resizeNorth) {
      const boundedDelta = clamp(deltaY, -panelRect.top, panelRect.height - minHeight);
      top = panelRect.top + boundedDelta;
      height = panelRect.height - boundedDelta;
    }

    applyPanelRect(panel, snapPanelRect(panel, { left, top, width, height }, {
      resizeLeft: resizeWest,
      resizeRight: resizeEast,
      resizeTop: resizeNorth,
      resizeBottom: resizeSouth
    }, snapGuides));
    if (panel.dataset.panel === 'editor') requestCodeEditorMeasure();
    const widget = terminalWidgetForElement(panel);
    if (widget) scheduleFitTerminalWidget(widget);
  };

  const up = (upEvent: PointerEvent) => {
    panel.classList.remove('resizing');
    grip.releasePointerCapture(upEvent.pointerId);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    requestCodeEditorMeasure();
    const widget = terminalWidgetForElement(panel);
    if (widget) scheduleFitTerminalWidget(widget);
    saveActiveWorkspaceSnapshot();
  };

  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}

function bringPanelToFront(panel: HTMLElement) {
  panel.style.zIndex = String(++panelZ);
}

function commitPanelRect(panel: HTMLElement) {
  const workspace = panel.parentElement as HTMLElement;
  const workspaceRect = workspace.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  applyPanelRect(panel, {
    left: Math.round(panelRect.left - workspaceRect.left),
    top: Math.round(panelRect.top - workspaceRect.top),
    width: Math.round(panelRect.width),
    height: Math.round(panelRect.height)
  });
}

function pinPanelToWorkspace(panel: HTMLElement) {
  if (panel.classList.contains('hidden') || !panel.style.left || !panel.style.top) return;
  applyPanelRect(panel, clampPanelRect(panel, {
    left: parseFloat(panel.style.left),
    top: parseFloat(panel.style.top),
    width: panel.offsetWidth,
    height: panel.offsetHeight
  }));
}

function applyPanelRect(panel: HTMLElement, rect: PanelRect) {
  panel.style.left = `${Math.round(rect.left)}px`;
  panel.style.top = `${Math.round(rect.top)}px`;
  panel.style.width = `${Math.round(rect.width)}px`;
  panel.style.height = `${Math.round(rect.height)}px`;
  const workspace = panel.parentElement as HTMLElement | null;
  if (workspace?.clientWidth && workspace.clientHeight) {
    layoutRatios.set(panel, rectToLayoutRatio(rect, workspace));
  }
}

function snapPanelRect(
  panel: HTMLElement,
  rect: PanelRect,
  mode: {
    moveX?: boolean;
    moveY?: boolean;
    resizeX?: boolean;
    resizeY?: boolean;
    resizeLeft?: boolean;
    resizeRight?: boolean;
    resizeTop?: boolean;
    resizeBottom?: boolean;
  },
  guides = collectSnapGuides(panel, panel.parentElement as HTMLElement)
) {
  const next = { ...rect };

  if (mode.moveX) {
    next.left = snapMovingAxis(rect.left, rect.width, guides.x);
  }
  if (mode.moveY) {
    next.top = snapMovingAxis(rect.top, rect.height, guides.y);
  }
  if (mode.resizeLeft) {
    const snappedLeft = snapEdge(next.left, guides.x);
    if (snappedLeft !== null) {
      next.width += next.left - snappedLeft;
      next.left = snappedLeft;
    }
  } else if (mode.resizeX || mode.resizeRight) {
    const snappedRight = snapEdge(next.left + next.width, guides.x);
    if (snappedRight !== null) next.width = snappedRight - next.left;
  }
  if (mode.resizeTop) {
    const snappedTop = snapEdge(next.top, guides.y);
    if (snappedTop !== null) {
      next.height += next.top - snappedTop;
      next.top = snappedTop;
    }
  } else if (mode.resizeY || mode.resizeBottom) {
    const snappedBottom = snapEdge(next.top + next.height, guides.y);
    if (snappedBottom !== null) next.height = snappedBottom - next.top;
  }

  return clampPanelRect(panel, next);
}

function collectSnapGuides(panel: HTMLElement, workspace: HTMLElement) {
  const x = [0, workspace.clientWidth];
  const y = [0, workspace.clientHeight];
  for (const id of FLOATING_PANELS) {
    const element = getPanel(id);
    if (element === panel || element.classList.contains('hidden')) continue;
    addSnapGuidesForElement(element, workspace, x, y);
  }
  for (const widget of state.terminalWidgets) {
    const element = widget.element;
    if (element === panel || !element.isConnected) continue;
    addSnapGuidesForElement(element, workspace, x, y);
  }
  if (el.terminalGrid !== panel && el.terminalGrid.isConnected) {
    addSnapGuidesForElement(el.terminalGrid, workspace, x, y);
  }

  return { x, y };
}

function addSnapGuidesForElement(element: HTMLElement, workspace: HTMLElement, x: number[], y: number[]) {
  const rect = currentPanelRect(element, workspace);
  x.push(rect.left, rect.left + rect.width);
  y.push(rect.top, rect.top + rect.height);
}

function snapMovingAxis(start: number, size: number, guides: number[]) {
  const leading = nearestSnap(start, guides);
  const trailing = nearestSnap(start + size, guides);
  if (!leading && !trailing) return start;
  if (leading && (!trailing || leading.distance <= trailing.distance)) return leading.guide;
  return trailing!.guide - size;
}

function snapEdge(edge: number, guides: number[]) {
  return nearestSnap(edge, guides)?.guide ?? null;
}

function nearestSnap(edge: number, guides: number[]) {
  let best: number | null = null;
  let bestDistance = PANEL_SNAP_DISTANCE + 1;
  for (const guide of guides) {
    const distance = Math.abs(edge - guide);
    if (distance <= PANEL_SNAP_DISTANCE && distance < bestDistance) {
      best = guide;
      bestDistance = distance;
    }
  }
  return best === null ? null : { guide: best, distance: bestDistance };
}

function clampPanelRect(panel: HTMLElement, rect: PanelRect) {
  const workspace = panel.parentElement as HTMLElement;
  const minWidth = panelMinWidth(panel);
  const minHeight = panelMinHeight(panel);
  const width = clamp(rect.width, minWidth, workspace.clientWidth);
  const height = clamp(rect.height, minHeight, workspace.clientHeight);
  const left = clamp(rect.left, 0, Math.max(0, workspace.clientWidth - width));
  const top = clamp(rect.top, 0, Math.max(0, workspace.clientHeight - height));
  return { left, top, width, height };
}

function currentPanelRect(element: HTMLElement, workspace: HTMLElement): PanelRect {
  const workspaceRect = workspace.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - workspaceRect.left,
    top: rect.top - workspaceRect.top,
    width: rect.width,
    height: rect.height
  };
}

function elementLayoutRatio(element: HTMLElement, options: { preferCache?: boolean } = {}): LayoutRatio | undefined {
  const cached = layoutRatios.get(element);
  if (options.preferCache && cached) return cached;
  const workspace = element.parentElement as HTMLElement | null;
  if (!workspace?.clientWidth || !workspace.clientHeight) return cached;
  if (element.classList.contains('hidden')) return cached;
  const ratio = rectToLayoutRatio(currentPanelRect(element, workspace), workspace);
  layoutRatios.set(element, ratio);
  return ratio;
}

function rectToLayoutRatio(rect: PanelRect, workspace: HTMLElement): LayoutRatio {
  return {
    left: rect.left / workspace.clientWidth,
    top: rect.top / workspace.clientHeight,
    width: rect.width / workspace.clientWidth,
    height: rect.height / workspace.clientHeight
  };
}

function applyLayoutRatio(element: HTMLElement, ratio: LayoutRatio) {
  const workspace = element.parentElement as HTMLElement | null;
  if (!workspace?.clientWidth || !workspace.clientHeight) {
    layoutRatios.set(element, ratio);
    return;
  }
  const rect = {
    left: ratio.left * workspace.clientWidth,
    top: ratio.top * workspace.clientHeight,
    width: ratio.width * workspace.clientWidth,
    height: ratio.height * workspace.clientHeight
  };
  applyPanelRect(element, clampPanelRect(element, rect));
  layoutRatios.set(element, ratio);
}

function applyStoredLayoutRatio(element: HTMLElement) {
  const ratio = layoutRatios.get(element);
  if (ratio) applyLayoutRatio(element, ratio);
  else pinPanelToWorkspace(element);
}

function panelMinWidth(panel: HTMLElement) {
  return parseFloat(getComputedStyle(panel).minWidth) || 180;
}

function panelMinHeight(panel: HTMLElement) {
  return parseFloat(getComputedStyle(panel).minHeight) || 120;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function openWorkspace(path: string) {
  state.currentDir = path;
  await loadDirectory(path);
  refreshTitle();
}

async function switchWorkspace(path: string) {
  if (!state.activeProfile) {
    setStatus('Select a profile first', true);
    return;
  }
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'none' });
  state.workspaceRoot = path;
  state.currentDir = path;
  el.rootInput.value = path;
  if (!state.activeWorkspaceId) state.activeWorkspaceId = crypto.randomUUID();
  await closeTerminalsForWorkspace(state.activeWorkspaceId);
  discardWorkspacePreviewRuntime(state.activeWorkspaceId);
  clearWorkspacePanels();
  await openWorkspace(path);
  setWorkspaceOpen(true);
  await createTerminal(null, 'shell', { cwd: path });
  saveActiveWorkspaceSnapshot({ immediate: true, persist: 'defer' });
}

function discardWorkspacePreviewRuntime(workspaceId: string) {
  cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
  for (const proxy of state.previewProxies) {
    previewProxyProbeAt.delete(proxy.id);
    void api.stopPortForward(proxy.id).catch(() => undefined);
  }
  state.previewProxies = [];
  clearPreviewProxyLookup();
  stopEdgeDevtoolsForWorkspace(workspaceId);
  removeWorkspaceRuntimeCache(workspaceId);
}

async function closeWorkspace(options: { killTerminals?: boolean } = {}) {
  await saveAllDirtyNotes();
  const workspaceId = state.activeWorkspaceId;
  state.workspaceCaptureProtected = false;
  await applyWorkspaceCaptureProtection(false, { quiet: true });
  state.activeProfile = null;
  state.workspaceOpen = false;
  state.workspaceRoot = '';
  state.currentDir = '';
  state.entries = [];
  setInputValueIfChanged(el.profileSelect, '');
  setInputValueIfChanged(el.rootInput, '');
  if (el.rootInput.placeholder !== 'select a profile first') el.rootInput.placeholder = 'select a profile first';
  if (options.killTerminals && workspaceId) {
    await closeTerminalsForWorkspace(workspaceId, {
      backgroundKill: true,
      saveSnapshot: false,
      renderShellTabs: false
    });
  }
  hideAllTerminalWidgets();
  clearWorkspacePanels();
  renderExplorer();
  refreshTitle();
  setWorkspaceOpen(false);
}

async function closeAllTerminals() {
  const terminals = [...state.terminals];
  const widgets = [...state.terminalWidgets];
  state.terminals = [];
  state.terminalWidgets = [];
  state.activePaneId = '';
  terminalPaneById.clear();
  terminalPaneByBackendId.clear();
  terminalPanesByWidgetId.clear();
  terminalWidgetById.clear();
  for (const pane of terminals) {
    await flushTerminalInput(pane).catch(() => undefined);
    if (pane.backendId) await api.killTerminal(pane.backendId).catch(() => undefined);
    cleanupTerminalWriteBuffer(pane);
    if (pane.fitFrame) cancelAnimationFrame(pane.fitFrame);
    pane.resizeObserver?.disconnect();
    pane.term.dispose();
    pane.host.remove();
  }
  for (const widget of widgets) {
    forgetTerminalWidget(widget);
    widget.element.remove();
  }
  syncActivePaneClass();
  renderShellTabs();
}

async function closeTerminalsForWorkspace(workspaceId: string, options: CloseTerminalOptions = {}) {
  const widgetIds: string[] = [];
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId === workspaceId) widgetIds.push(widget.widgetId);
  }
  for (const widgetId of widgetIds) {
    await closeTerminalWidget(widgetId, options);
  }
  const activePane = state.activePaneId ? terminalPaneById.get(state.activePaneId) : null;
  if (state.activePaneId && activePane?.workspaceId !== state.activeWorkspaceId) {
    state.activePaneId = '';
  }
  syncActivePaneClass();
  if (options.renderShellTabs !== false) renderShellTabs();
}

function hideAllTerminalWidgets() {
  hideTerminalWidgetsForWorkspace(visibleTerminalWorkspaceId);
  visibleTerminalWorkspaceId = '';
  state.activePaneId = '';
  syncActivePaneClass();
  renderShellTabs();
}

function hideTerminalWidgetsForWorkspace(workspaceId: string) {
  for (const widget of state.terminalWidgets) {
    if (workspaceId && widget.workspaceId !== workspaceId) continue;
    if (!workspaceId && widget.element.classList.contains('hidden')) continue;
    toggleClassIfChanged(widget.element, 'hidden', true);
  }
}

function filterTerminalInputData(pane: TerminalPane, data: string) {
  const suppressUntil = pane.suppressTerminalQueryResponsesUntil ?? 0;
  if (!suppressUntil || performance.now() >= suppressUntil) return data;
  return data.replace(TERMINAL_CPR_RESPONSE_PATTERN, '');
}

function queueTerminalInput(pane: TerminalPane, data: string) {
  if (!data) return;
  pane.inputWriteBuffer += data;
  if (pane.inputWriteBuffer.length >= TERMINAL_INPUT_FORCE_FLUSH_CHARS) {
    void flushTerminalInput(pane);
    return;
  }
  if (pane.inputFlushTimer) return;
  pane.inputFlushTimer = window.setTimeout(() => {
    pane.inputFlushTimer = undefined;
    void flushTerminalInput(pane);
  }, TERMINAL_INPUT_BATCH_MS);
}

function terminalInputShouldSendImmediately(data: string) {
  if (!data) return false;
  if (/[^\x00-\x7F]/.test(data)) return true;
  if (data.length <= 8 && /[\x00-\x1F\x7F]/.test(data)) return true;
  return false;
}

async function sendTerminalInputNow(pane: TerminalPane, data: string) {
  if (!data) return;
  if (pane.inputWriteBuffer) await flushTerminalInput(pane);
  if (pane.inputWritePromise) await pane.inputWritePromise.catch(() => undefined);
  if (!pane.backendId) return;
  await api.writeTerminal(pane.backendId, data);
}

async function flushTerminalInput(pane: TerminalPane): Promise<void> {
  if (pane.inputFlushTimer) {
    window.clearTimeout(pane.inputFlushTimer);
    pane.inputFlushTimer = undefined;
  }
  if (!pane.inputWriteBuffer || !pane.backendId) {
    if (pane.inputWritePromise) await pane.inputWritePromise.catch(() => undefined);
    return;
  }
  const data = pane.inputWriteBuffer;
  const backendId = pane.backendId;
  pane.inputWriteBuffer = '';
  const previousWrite = pane.inputWritePromise ?? Promise.resolve();
  const currentWrite = previousWrite
    .catch(() => undefined)
    .then(() => api.writeTerminal(backendId, data))
    .catch((error) => {
      pane.inputWriteBuffer = data + pane.inputWriteBuffer;
      throw error;
    });
  const trackedWrite = currentWrite.finally(() => {
    if (pane.inputWritePromise === trackedWrite) pane.inputWritePromise = undefined;
    if (pane.inputWriteBuffer && !pane.inputFlushTimer) {
      pane.inputFlushTimer = window.setTimeout(() => {
        pane.inputFlushTimer = undefined;
        void flushTerminalInput(pane);
      }, TERMINAL_INPUT_BATCH_MS);
    }
  });
  pane.inputWritePromise = trackedWrite;
  await trackedWrite;
}

function setTerminalBackendId(pane: TerminalPane, backendId: string | undefined) {
  if (pane.backendId) terminalPaneByBackendId.delete(pane.backendId);
  pane.backendId = backendId;
  pane.backendOutputChars = 0;
  if (backendId) terminalPaneByBackendId.set(backendId, pane);
}

function showTerminalWidgetsForWorkspace(workspaceId: string) {
  if (visibleTerminalWorkspaceId && visibleTerminalWorkspaceId !== workspaceId) {
    hideTerminalWidgetsForWorkspace(visibleTerminalWorkspaceId);
  }
  visibleTerminalWorkspaceId = workspaceId;
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId !== workspaceId) continue;
    const wasHidden = widget.element.classList.contains('hidden');
    if (wasHidden) {
      widget.element.classList.remove('hidden');
      applyStoredLayoutRatio(widget.element);
      syncTerminalWidgetActiveState(widget);
      scheduleFitTerminalWidget(widget, { activeOnly: true });
    }
    const activePane = activePaneForWidget(widget);
    if (activePane) flushTerminalWriteBuffer(activePane);
  }
}

function clearWorkspacePanels(options: { skipIntermediateRenders?: boolean } = {}) {
  const renderIntermediate = !options.skipIntermediateRenders;
  clearExplorerBackgroundWork();
  destroyCodeEditorView();
  state.entries = [];
  state.explorerExpanded = new Set();
  state.explorerChildren = new Map();
  markExplorerEntryLookupDirty();
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map();
  resetExplorerSelection();
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  state.explorerDropTargetDir = '';
  state.exportJobs = [];
  exportJobById.clear();
  if (renderIntermediate) renderExportJobs();
  state.openFile = null;
  state.editorTabs = [];
  clearEditorTabLookup();
  state.activeEditorTabId = '';
  if (renderIntermediate) ensureEditorTab();
  state.imagePreviewDataUrl = '';
  state.imagePreviewLabel = 'No image selected';
  state.imagePreviewZoom = 1;
  state.imagePreviewOffsetX = 0;
  state.imagePreviewOffsetY = 0;
  state.imageHistory = [];
  state.imageHistoryVisible = false;
  state.imageTabs = [];
  clearImageTabLookup();
  state.activeImageTabId = '';
  if (renderIntermediate) ensureImageTab();
  for (const timer of noteSaveTimers.values()) window.clearTimeout(timer);
  noteSaveTimers.clear();
  noteHydrationToken += 1;
  state.noteTabs = [];
  clearNoteTabLookup();
  state.activeNoteTabId = '';
  state.notePinned = false;
  noteOpacity = 100;
  applyNoteOpacity();
  if (renderIntermediate && isPanelVisible('notes')) {
    renderNoteTabs();
    renderNotes();
    renderNotePin();
  }
  state.calculatorExpression = '';
  state.calculatorResult = '';
  state.calculatorHistory = [];
  if (renderIntermediate && isPanelVisible('calculator')) renderCalculator();
  state.previewProxies = [];
  clearPreviewProxyLookup();
  state.previewUrl = '';
  state.forwards = [];
  clearForwardLookup();
  state.detectedPorts = [];
  clearDetectedPortLookup();
  state.browserTabs = [];
  state.browserHistory = [];
  clearBrowserTabLookup();
  state.activeBrowserTabId = '';
  state.browserConsoleLogs = [];
  clearBrowserConsoleRowElementCache();
  clearBrowserConsoleHiddenPayloadQueue();
  clearBrowserConsoleLocalPortScanQueue();
  markBrowserConsoleLogsChanged();
  setInputValueIfChanged(el.previewUrl, '');
  hideBrowserAddressSuggestions();
  if (state.activeWorkspaceId) hideBrowserFramesForWorkspace(state.activeWorkspaceId);
  else hideAllBrowserFrames();
  disconnectActiveEdgeCdp();
  setEdgePreviewVisible(false);
  toggleClassIfChanged(el.browserShell, 'has-preview', false);
  if (renderIntermediate && isPanelVisible('editor')) {
    renderEditorTabs();
    renderEditor();
  }
  if (renderIntermediate && isPanelVisible('image')) {
    renderImageTabs();
    renderImagePreview();
    renderImageHistory();
  }
  if (renderIntermediate && !isBrowserPanelHidden()) {
    renderForwards();
    renderBrowserTabs();
    renderBrowserConsole();
  }
}

function clearExplorerBackgroundWork() {
  endExplorerDragSession();
  cancelExplorerWatchSchedule();
  cancelExplorerHoverPrefetch();
  cancelVisibleExplorerDirectoryPrefetch();
  cancelCachedExplorerDirectoryRefreshes();
  toggleClassIfChanged(el.fileList, 'scrolling', false);
  explorerScrollingUntil = 0;
  if (explorerScrollIdleTimer) window.clearTimeout(explorerScrollIdleTimer);
  explorerScrollIdleTimer = 0;
  if (explorerRenderFrame) window.cancelAnimationFrame(explorerRenderFrame);
  explorerRenderFrame = 0;
  for (const timer of explorerDirectoryPrefetchTimers.values()) window.clearTimeout(timer);
  explorerDirectoryPrefetchTimers.clear();
  explorerDirectoryPrefetchPending.clear();
  for (const timer of textFilePrefetchTimers.values()) window.clearTimeout(timer);
  textFilePrefetchTimers.clear();
  explorerDirectoryPrefetchActive = 0;
}

function cancelExplorerWatchSchedule() {
  if (explorerWatchTimer) window.clearTimeout(explorerWatchTimer);
  explorerWatchTimer = 0;
  explorerWatchIdleToken += 1;
}

function cancelCachedExplorerDirectoryRefreshes() {
  explorerCachedRefreshToken += 1;
  for (const timer of explorerCachedRefreshTimers) window.clearTimeout(timer);
  explorerCachedRefreshTimers.clear();
}

function setWorkspaceOpen(open: boolean, options: { preserveVisibility?: boolean } = {}) {
  state.workspaceOpen = open;
  renderWorkspaceControls(open);

  if (!options.preserveVisibility) {
    for (const id of FLOATING_PANELS) {
      setPanelVisible(id, open && DEFAULT_PANEL_VISIBILITY[id], { skipSave: true });
    }
  }
  if (!open) setKeyboardResizeTarget({ kind: 'ide' });
  if (open) scheduleExplorerWatch(1200);
  else stopExplorerWatch();
  renderShellTabs();
}

function renderWorkspaceControls(open: boolean) {
  const signature = open ? '1' : '0';
  if (workspaceControlsRenderSignature === signature) return;
  workspaceControlsRenderSignature = signature;
  setDisabledIfChanged(el.copyCurrentCd, !open);
  setDisabledIfChanged(el.saveWorkspace, !open);
  setDisabledIfChanged(el.newShell, !open);
  setDisabledIfChanged(el.shellNewTab, !open);
  el.shellTabs.classList.add('hidden');
  setDisabledIfChanged(el.resetLayout, !open);
  for (const button of el.llmButtons) {
    setDisabledIfChanged(button, !open);
  }
  for (const button of el.togglePanelButtons) {
    setDisabledIfChanged(button, !open && button.dataset.togglePanel !== 'settings');
  }
  setDisabledIfChanged(el.newFile, !open);
  setDisabledIfChanged(el.newFolder, !open);
  setDisabledIfChanged(el.refreshExplorer, !open);
  setDisabledIfChanged(el.exportSelected, !open);
}

function explorerDirectoryCacheKey(
  profileId: string,
  path: string,
  workspaceId = state.activeWorkspaceId,
  includeSizes = state.showFileSizes
) {
  return `${workspaceId || 'workspace'}\0${profileId}\0${includeSizes ? 'size' : 'nosize'}\0${path}`;
}

function hasCachedExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  return hasCachedExplorerDirectoryKey(explorerDirectoryCacheKey(profileId, path, workspaceId));
}

function hasCachedExplorerDirectoryKey(key: string) {
  return explorerDirectoryCache.has(key);
}

function cloneExplorerEntries(entries: FileEntry[]) {
  // Directory listings are treated as immutable snapshots throughout the
  // Explorer pipeline. Returning the same array avoids hot-path shallow copies
  // when cache hits, watcher polls, and prefetches pass large directory lists
  // between cache, state, and render code.
  const clone = entries;
  const signature = explorerDirectorySignatureCache.get(entries);
  if (signature) explorerDirectorySignatureCache.set(clone, signature);
  return clone;
}

function cachedExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  const cached = explorerDirectoryCache.get(key);
  if (!cached) return null;
  explorerDirectoryCache.delete(key);
  explorerDirectoryCache.set(key, cached);
  return cloneExplorerEntries(cached.entries);
}

function cachedFreshExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  return cachedFreshExplorerDirectoryByKey(key, profileId);
}

function cachedFreshExplorerDirectoryByKey(key: string, profileId: string) {
  const cached = explorerDirectoryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > explorerDirectoryCacheTtl(profileId)) return null;
  explorerDirectoryCache.delete(key);
  explorerDirectoryCache.set(key, cached);
  return cloneExplorerEntries(cached.entries);
}

function cacheExplorerDirectory(profileId: string, path: string, entries: FileEntry[], workspaceId = state.activeWorkspaceId) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  const signature = explorerDirectorySignature(entries);
  const cachedEntries = cloneExplorerEntries(entries);
  explorerDirectorySignatureCache.set(cachedEntries, signature);
  explorerDirectoryCache.delete(key);
  explorerDirectoryCache.set(key, { entries: cachedEntries, cachedAt: Date.now() });
  pruneExplorerDirectoryCache();
}

function pruneExplorerDirectoryCache() {
  if (explorerDirectoryCache.size <= EXPLORER_DIRECTORY_CACHE_LIMIT + EXPLORER_DIRECTORY_CACHE_PRUNE_BATCH) return;
  if (explorerCachePruneBusy()) {
    scheduleExplorerDirectoryCachePrune();
    if (explorerDirectoryCache.size <= EXPLORER_DIRECTORY_CACHE_BUSY_LIMIT) return;
    pruneExplorerDirectoryCacheEntries(EXPLORER_DIRECTORY_CACHE_PRUNE_BATCH);
    return;
  }
  pruneExplorerDirectoryCacheEntries();
}

function pruneExplorerDirectoryCacheEntries(maxDeletes = Number.POSITIVE_INFINITY) {
  let deleted = 0;
  while (explorerDirectoryCache.size > EXPLORER_DIRECTORY_CACHE_LIMIT && deleted < maxDeletes) {
    const oldest = explorerDirectoryCache.keys().next().value;
    if (!oldest) break;
    explorerDirectoryCache.delete(oldest);
    deleted += 1;
  }
}

function scheduleExplorerDirectoryCachePrune() {
  if (explorerDirectoryCachePruneTimer) return;
  const delay = Math.max(160, explorerScrollingUntil - Date.now() + EXPLORER_SCROLL_IDLE_MS);
  explorerDirectoryCachePruneTimer = window.setTimeout(() => {
    explorerDirectoryCachePruneTimer = 0;
    runWhenUiIdle(pruneExplorerDirectoryCache, 720);
  }, delay);
}

function invalidateExplorerDirectoryCache(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const sizeKey = explorerDirectoryCacheKey(profileId, path, workspaceId, true);
  explorerDirectoryCache.delete(sizeKey);
  explorerDirectoryReads.delete(sizeKey);
  const noSizeKey = explorerDirectoryCacheKey(profileId, path, workspaceId, false);
  explorerDirectoryCache.delete(noSizeKey);
  explorerDirectoryReads.delete(noSizeKey);
}

function invalidateExplorerParentDirectoryCache(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  invalidateExplorerDirectoryCache(profileId, parentPath(path), workspaceId);
}

function createExplorerDirectoryPendingRead() {
  let resolve!: (entries: FileEntry[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<FileEntry[]>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

async function readExplorerDirectoryCached(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const cached = cachedExplorerDirectory(profileId, path, workspaceId);
  if (cached) return cached;
  return fetchExplorerDirectory(profileId, path, workspaceId);
}

async function fetchExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId, force = false) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  if (!force) {
    const cached = cachedFreshExplorerDirectoryByKey(key, profileId);
    if (cached) return cached;
  }
  const pending = explorerDirectoryReads.get(key);
  if (pending && !force) return cloneExplorerEntries(await pending);

  let read: Promise<FileEntry[]>;
  read = api.listDirectory(profileId, path, state.showFileSizes)
    .then((entries) => {
      cacheExplorerDirectory(profileId, path, entries, workspaceId);
      return cloneExplorerEntries(entries);
    })
    .finally(() => {
      if (explorerDirectoryReads.get(key) === read) explorerDirectoryReads.delete(key);
    });
  explorerDirectoryReads.set(key, read);
  return cloneExplorerEntries(await read);
}

async function fetchExplorerDirectories(
  profileId: string,
  paths: string[],
  workspaceId = state.activeWorkspaceId,
  force = false
) {
  const results = new Map<string, DirectoryListingResult>();
  const misses: string[] = [];
  const missKeys = new Set<string>();
  const pendingReads: Array<Promise<void>> = [];

  for (const path of paths) {
    const resultKey = explorerPathKey(path);
    const cacheKey = explorerDirectoryCacheKey(profileId, path, workspaceId);
    if (!force) {
      const cached = cachedFreshExplorerDirectoryByKey(cacheKey, profileId);
      if (cached) {
        results.set(resultKey, { path, entries: cached, error: null });
        continue;
      }
      const pending = explorerDirectoryReads.get(cacheKey);
      if (pending) {
        pendingReads.push(pending
          .then((entries) => {
            results.set(resultKey, { path, entries: cloneExplorerEntries(entries), error: null });
          })
          .catch((error) => {
            results.set(resultKey, { path, entries: [], error: String(error) });
          }));
        continue;
      }
    }
    if (!missKeys.has(cacheKey)) {
      missKeys.add(cacheKey);
      misses.push(path);
    }
  }

  if (pendingReads.length) await Promise.all(pendingReads);
  if (misses.length) {
    const batchReads = new Map<string, ReturnType<typeof createExplorerDirectoryPendingRead>>();
    for (const path of misses) {
      const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
      if (explorerDirectoryReads.has(key)) continue;
      const pending = createExplorerDirectoryPendingRead();
      explorerDirectoryReads.set(key, pending.promise);
      batchReads.set(key, pending);
    }
    try {
      const listings = await api.listDirectories(profileId, misses, state.showFileSizes);
      const completedKeys = new Set<string>();
      for (const listing of listings) {
        const key = explorerPathKey(listing.path);
        const cacheKey = explorerDirectoryCacheKey(profileId, listing.path, workspaceId);
        completedKeys.add(cacheKey);
        const pending = batchReads.get(cacheKey);
        if (listing.error) {
          results.set(key, { path: listing.path, entries: [], error: listing.error });
          pending?.reject(new Error(listing.error));
        } else {
          const entries = cloneExplorerEntries(listing.entries);
          cacheExplorerDirectory(profileId, listing.path, entries, workspaceId);
          results.set(key, { path: listing.path, entries, error: null });
          pending?.resolve(cloneExplorerEntries(entries));
        }
      }
      for (const [key, pending] of batchReads) {
        if (completedKeys.has(key)) continue;
        pending.reject(new Error('Directory listing was unavailable'));
      }
    } catch (error) {
      for (const [key, pending] of batchReads) {
        if (explorerDirectoryReads.get(key) === pending.promise) explorerDirectoryReads.delete(key);
      }
      await Promise.all(misses.map(async (path) => {
        const cacheKey = explorerDirectoryCacheKey(profileId, path, workspaceId);
        const pending = batchReads.get(cacheKey);
        try {
          const entries = await fetchExplorerDirectory(profileId, path, workspaceId, force);
          results.set(explorerPathKey(path), { path, entries, error: null });
          pending?.resolve(cloneExplorerEntries(entries));
        } catch (readError) {
          results.set(explorerPathKey(path), { path, entries: [], error: String(readError || error) });
          pending?.reject(readError || error);
        }
      }));
    } finally {
      for (const [key, pending] of batchReads) {
        if (explorerDirectoryReads.get(key) === pending.promise) explorerDirectoryReads.delete(key);
      }
    }
  }

  return results;
}

function explorerDirectoryCacheTtl(profileId: string) {
  const profile = profileForId(profileId) ?? state.activeProfile;
  if (profile?.kind === 'ssh') return EXPLORER_DIRECTORY_CACHE_TTL_SSH_MS;
  if (profile?.kind === 'wsl') return EXPLORER_DIRECTORY_CACHE_TTL_WSL_MS;
  return EXPLORER_DIRECTORY_CACHE_TTL_LOCAL_MS;
}

function applyLoadedDirectory(path: string, entries: FileEntry[]) {
  state.entries = cloneExplorerEntries(entries);
  state.currentDir = path;
  state.explorerExpanded = new Set([path]);
  state.explorerChildren = new Map();
  markExplorerEntryLookupDirty();
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map([[path, explorerDirectorySignature(state.entries)]]);
  resetExplorerSelection();
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  renderExplorer();
  queueVisibleExplorerDirectoryPrefetch(900);
  refreshTitle();
}

async function loadDirectory(path: string) {
  if (!state.activeProfile) return;
  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  const cached = cachedExplorerDirectory(profileId, path, workspaceId);
  if (cached) {
    applyLoadedDirectory(path, cached);
    setStatus('Directory loaded from cache');
    saveActiveWorkspaceSnapshot();
    scheduleCachedExplorerDirectoryRefresh(path, profileId, workspaceId, {
      force: true,
      requireCurrentDir: true,
      saveAfter: true
    });
    return;
  }
  setStatus(`Loading ${path}...`);
  try {
    const entries = await fetchExplorerDirectory(profileId, path, workspaceId);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    applyLoadedDirectory(path, entries);
    setStatus('Directory loaded');
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function shouldLoadExplorerDirectoryOnShow() {
  return Boolean(
    state.activeProfile
    && state.workspaceOpen
    && state.currentDir
    && !state.explorerSignatures.has(state.currentDir)
  );
}

function scheduleCachedExplorerDirectoryRefresh(
  path: string,
  profileId: string,
  workspaceId: string,
  options: { force?: boolean; requireCurrentDir?: boolean; requireExpanded?: boolean; saveAfter?: boolean; delayMs?: number } = {}
) {
  const token = explorerCachedRefreshToken;
  const runRefresh = () => runWhenUiIdle(() => {
    if (token !== explorerCachedRefreshToken) return;
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    if (getPanel('explorer').classList.contains('hidden')) return;
    if (options.requireCurrentDir && !sameExplorerPath(state.currentDir, path)) return;
    if (options.requireExpanded && !state.explorerExpanded.has(path)) return;
    void refreshExplorerDirectory(path, profileId, workspaceId, true, Boolean(options.force))
      .then(() => {
        if (options.saveAfter) saveActiveWorkspaceSnapshot();
      })
      .catch(() => undefined);
  }, 1300);
  const delayMs = options.delayMs ?? (restoringWorkspace ? WORKSPACE_RESTORE_BACKGROUND_DELAY_MS : 0);
  if (delayMs > 0) {
    const timer = window.setTimeout(() => {
      explorerCachedRefreshTimers.delete(timer);
      if (token === explorerCachedRefreshToken) runRefresh();
    }, delayMs);
    explorerCachedRefreshTimers.add(timer);
  }
  else runRefresh();
}

function renderExplorer() {
  if (getPanel('explorer').classList.contains('hidden')) {
    explorerRenderDirty = true;
    return;
  }
  explorerRenderDirty = false;
  const scrollTop = el.fileList.scrollTop;
  updateExplorerFileSizeMode();
  updateExplorerOpenMode();
  renderExplorerPathRow();

  rebuildExplorerVisibleRows();
  renderVirtualExplorerRows(scrollTop, { force: true });
  renderExportJobs();
  queueVisibleExplorerDirectoryPrefetch(900);
}

function renderExplorerPathRow() {
  const signature = `${state.currentDir}\t${state.workspaceOpen ? 1 : 0}`;
  if (explorerPathRowRenderSignature === signature) return;
  explorerPathRowRenderSignature = signature;
  el.pathRow.innerHTML = '';
  const up = document.createElement('button');
  up.textContent = '..';
  up.title = 'Parent directory';
  up.addEventListener('click', () => void goToParentDirectory());
  const useFolder = document.createElement('button');
  useFolder.textContent = 'Use This Folder';
  useFolder.title = 'Restart workspace from this directory';
  useFolder.addEventListener('click', () => {
    const selected = findExplorerEntry(state.explorerSelectedPath);
    void switchWorkspace(selected?.kind === 'dir' ? selected.path : state.currentDir);
  });
  el.pathRow.append(up, pathBadge(state.currentDir), useFolder);
}

function openExplorerEntry(entry: FileEntry) {
  selectExplorerEntry(entry.path, false);
  if (entry.kind === 'dir') {
    void toggleExplorerDirectory(entry);
  } else if (isWindowsExecutablePath(entry.path)) {
    void openExecutablePath(entry.path);
  } else {
    void openFile(entry.path);
  }
}

function openSelectedExplorerEntry() {
  const entry = findExplorerEntry(state.explorerSelectedPath);
  if (!entry) return false;
  openExplorerEntry(entry);
  return true;
}

function rebuildExplorerVisibleRows() {
  explorerVisibleRows.length = 0;
  explorerTypeaheadCandidates.length = 0;
  explorerVisibleIndexByPath.clear();
  explorerTypeaheadIndexByPath.clear();
  explorerTypeaheadDirty = true;
  explorerRenderedStart = -1;
  explorerRenderedEnd = -1;
  explorerRenderedTotal = -1;
  appendExplorerVisibleRows(state.entries, 0);
}

function appendExplorerVisibleRows(entries: FileEntry[], depth: number) {
  for (const entry of entries) {
    const index = explorerVisibleRows.length;
    const pathKey = explorerPathKey(entry.path);
    const expanded = entry.kind === 'dir' && state.explorerExpanded.has(entry.path);
    const disclosureText = entry.kind === 'dir' ? expanded ? 'v' : '>' : '';
    const sizeText = explorerFileSizeText(entry);
    explorerVisibleRows.push({
      entry,
      path: entry.path,
      pathKey,
      depth,
      loading: false,
      disclosureText,
      sizeText,
      staticSignature: explorerRowStaticSignature(pathKey, entry, depth, disclosureText, sizeText)
    });
    explorerVisibleIndexByPath.set(pathKey, index);

    if (expanded) {
      const children = state.explorerChildren.get(entry.path);
      if (children) appendExplorerVisibleRows(children, depth + 1);
      else if (state.explorerLoading.has(entry.path)) {
        const loadingPath = `${entry.path}::loading`;
        const loadingPathKey = explorerPathKey(loadingPath);
        explorerVisibleRows.push({
          entry: null,
          path: loadingPath,
          pathKey: loadingPathKey,
          depth: depth + 1,
          loading: true,
          disclosureText: '',
          sizeText: '',
          staticSignature: `loading\t${depth + 1}`
        });
      }
    }
  }
}

function explorerRowStaticSignature(
  pathKey: string,
  entry: FileEntry,
  depth: number,
  disclosureText: string,
  sizeText: string
) {
  return `${pathKey}\t${entry.name}\t${entry.kind}\t${sizeText}\t${depth}\t${disclosureText}`;
}

function rebuildExplorerTypeaheadCandidates() {
  explorerTypeaheadCandidates.length = 0;
  explorerTypeaheadIndexByPath.clear();
  appendExplorerTypeaheadCandidates('dir');
  appendExplorerTypeaheadCandidates('file');
  explorerTypeaheadDirty = false;
}

function appendExplorerTypeaheadCandidates(kind: 'dir' | 'file') {
  for (const row of explorerVisibleRows) {
    const entry = row.entry;
    if (!entry || entry.kind !== kind) continue;
    explorerTypeaheadIndexByPath.set(row.pathKey, explorerTypeaheadCandidates.length);
    explorerTypeaheadCandidates.push({
      entry,
      pathKey: row.pathKey,
      nameKey: entry.name.toLowerCase()
    });
  }
}

function explorerVirtualWindowMetrics(scrollTop = el.fileList.scrollTop) {
  const total = explorerVisibleRows.length;
  const viewportHeight = Math.max(explorerViewportHeight || el.fileList.clientHeight, EXPLORER_ROW_HEIGHT * 8);
  const maxScrollTop = Math.max(0, total * EXPLORER_ROW_HEIGHT - viewportHeight);
  const nextScrollTop = clamp(scrollTop, 0, maxScrollTop);
  const scrolling = Date.now() < explorerScrollingUntil;
  const overscan = scrolling ? EXPLORER_VIRTUAL_SCROLL_OVERSCAN : EXPLORER_VIRTUAL_OVERSCAN;
  const windowStep = scrolling ? EXPLORER_VIRTUAL_SCROLL_WINDOW_STEP : EXPLORER_VIRTUAL_WINDOW_STEP;
  const visibleCount = Math.ceil(viewportHeight / EXPLORER_ROW_HEIGHT) + overscan * 2 + windowStep;
  const viewportStart = Math.floor(nextScrollTop / EXPLORER_ROW_HEIGHT);
  const viewportEnd = Math.ceil((nextScrollTop + viewportHeight) / EXPLORER_ROW_HEIGHT);
  const neededStart = clamp(viewportStart - overscan, 0, total);
  const neededEnd = clamp(viewportEnd + overscan, neededStart, total);
  const rawStart = Math.max(0, viewportStart - overscan);
  const nextStart = clamp(Math.floor(rawStart / windowStep) * windowStep, 0, total);
  const nextEnd = clamp(Math.max(nextStart + visibleCount, neededEnd), nextStart, total);
  return { total, nextScrollTop, neededStart, neededEnd, nextStart, nextEnd };
}

function explorerRenderedWindowCoversScroll(scrollTop = el.fileList.scrollTop) {
  if (explorerRenderDirty || !el.fileList.childElementCount) return false;
  const metrics = explorerVirtualWindowMetrics(scrollTop);
  return explorerRenderedTotal === metrics.total
    && explorerRenderedStart <= metrics.neededStart
    && explorerRenderedEnd >= metrics.neededEnd;
}

function renderVirtualExplorerRows(
  scrollTop = el.fileList.scrollTop,
  options: { force?: boolean; shrink?: boolean } = {}
) {
  const {
    total,
    nextScrollTop,
    neededStart,
    neededEnd,
    nextStart,
    nextEnd
  } = explorerVirtualWindowMetrics(scrollTop);
  const sameWindow = !options.force
    && !options.shrink
    && explorerRenderedTotal === total
    && explorerRenderedStart <= neededStart
    && explorerRenderedEnd >= neededEnd
    && el.fileList.childElementCount > 0;

  if (sameWindow) {
    if (el.fileList.scrollTop !== nextScrollTop) el.fileList.scrollTop = nextScrollTop;
    return;
  }

  const selectedKeys = explorerSelectedPathKeys();
  const dropTargetKey = state.explorerDropTargetDir ? explorerPathKey(state.explorerDropTargetDir) : '';
  const renameKey = activeExplorerRename ? explorerPathKey(activeExplorerRename.path) : '';

  if (!options.force && patchVirtualExplorerRows({
    total,
    nextScrollTop,
    nextStart,
    nextEnd,
    selectedKeys,
    dropTargetKey,
    renameKey
  })) {
    return;
  }

  explorerRenderedStart = nextStart;
  explorerRenderedEnd = nextEnd;
  explorerRenderedTotal = total;

  explorerRenderedRowByPath.clear();
  const fragment = document.createDocumentFragment();
  appendExplorerSpacer(fragment, explorerRenderedStart * EXPLORER_ROW_HEIGHT, explorerTopSpacer);
  for (let index = explorerRenderedStart; index < explorerRenderedEnd; index += 1) {
    fragment.append(explorerRowForWindowIndex(index, selectedKeys, dropTargetKey, renameKey));
  }
  appendExplorerSpacer(fragment, (total - explorerRenderedEnd) * EXPLORER_ROW_HEIGHT, explorerBottomSpacer);
  el.fileList.replaceChildren(fragment);
  if (el.fileList.scrollTop !== nextScrollTop) el.fileList.scrollTop = nextScrollTop;
  explorerLastSelectedPath = state.explorerSelectedPath;
}

function patchVirtualExplorerRows(options: {
  total: number;
  nextScrollTop: number;
  nextStart: number;
  nextEnd: number;
  selectedKeys: Set<string>;
  dropTargetKey: string;
  renameKey: string;
}) {
  const { total, nextScrollTop, nextStart, nextEnd, selectedKeys, dropTargetKey, renameKey } = options;
  const oldStart = explorerRenderedStart;
  const oldEnd = explorerRenderedEnd;
  if (
    explorerRenderedTotal !== total
    || oldStart < 0
    || oldEnd < oldStart
    || !explorerTopSpacer.isConnected
    || !explorerBottomSpacer.isConnected
    || nextEnd <= oldStart
    || nextStart >= oldEnd
  ) {
    return false;
  }

  for (let index = oldStart; index < nextStart; index += 1) {
    removeExplorerRenderedChild(el.fileList.children[1]);
  }
  for (let index = nextEnd; index < oldEnd; index += 1) {
    removeExplorerRenderedChild(explorerBottomSpacer.previousElementSibling);
  }

  if (nextStart < oldStart) {
    const fragment = document.createDocumentFragment();
    for (let index = nextStart; index < oldStart; index += 1) {
      fragment.append(explorerRowForWindowIndex(index, selectedKeys, dropTargetKey, renameKey));
    }
    el.fileList.insertBefore(fragment, explorerTopSpacer.nextSibling);
  }

  if (nextEnd > oldEnd) {
    const fragment = document.createDocumentFragment();
    for (let index = oldEnd; index < nextEnd; index += 1) {
      fragment.append(explorerRowForWindowIndex(index, selectedKeys, dropTargetKey, renameKey));
    }
    el.fileList.insertBefore(fragment, explorerBottomSpacer);
  }

  explorerRenderedStart = nextStart;
  explorerRenderedEnd = nextEnd;
  explorerRenderedTotal = total;
  updateExplorerSpacerHeight(explorerTopSpacer, explorerRenderedStart * EXPLORER_ROW_HEIGHT);
  updateExplorerSpacerHeight(explorerBottomSpacer, (total - explorerRenderedEnd) * EXPLORER_ROW_HEIGHT);
  if (el.fileList.scrollTop !== nextScrollTop) el.fileList.scrollTop = nextScrollTop;
  explorerLastSelectedPath = state.explorerSelectedPath;
  return true;
}

function explorerRowForWindowIndex(
  index: number,
  selectedKeys: Set<string>,
  dropTargetKey: string,
  renameKey: string
) {
  const item = explorerVisibleRows[index];
  return item.loading
    ? cachedExplorerLoadingRow(item)
    : cachedExplorerRow(item, selectedKeys, dropTargetKey, renameKey);
}

function removeExplorerRenderedChild(child: Element | null) {
  if (!(child instanceof HTMLElement) || child === explorerTopSpacer || child === explorerBottomSpacer) return;
  const key = child.dataset.pathKey;
  if (key && explorerRenderedRowByPath.get(key) === child) explorerRenderedRowByPath.delete(key);
  child.remove();
}

function createExplorerSpacerElement() {
  const spacer = document.createElement('div');
  spacer.className = 'explorer-spacer';
  return spacer;
}

function appendExplorerSpacer(fragment: DocumentFragment, height: number, spacer: HTMLElement) {
  updateExplorerSpacerHeight(spacer, height);
  fragment.append(spacer);
}

function updateExplorerSpacerHeight(spacer: HTMLElement, height: number) {
  const heightText = `${height}px`;
  if (spacer.style.height !== heightText) spacer.style.height = heightText;
}

function cachedExplorerRow(
  item: ExplorerVisibleRow,
  selectedKeys: Set<string>,
  dropTargetKey: string,
  renameKey: string
) {
  const key = `row:${item.pathKey}`;
  const row = cachedExplorerRowElement(key);
  updateExplorerRowElement(row, item, selectedKeys, dropTargetKey, renameKey);
  explorerRenderedRowByPath.set(item.pathKey, row);
  return row;
}

function cachedExplorerLoadingRow(item: ExplorerVisibleRow) {
  const row = cachedExplorerRowElement(`loading:${item.pathKey}`);
  updateExplorerLoadingRowElement(row, item.depth);
  return row;
}

function cachedExplorerRowElement(key: string) {
  const cached = explorerRowElementCache.get(key);
  if (cached) {
    explorerRowElementCache.delete(key);
    explorerRowElementCache.set(key, cached);
    return cached;
  }
  const row = takeReusableExplorerRowElement() ?? createExplorerRowElement();
  explorerRowElementCache.set(key, row);
  pruneExplorerRowElementCache();
  return row;
}

function takeReusableExplorerRowElement() {
  while (explorerReusableRowElements.length) {
    const row = explorerReusableRowElements.pop()!;
    if (!row.isConnected) return row;
  }
  return null;
}

function createExplorerRowElement() {
  const row = document.createElement('div');
  row.tabIndex = 0;
  row.setAttribute('role', 'option');

  const disclosure = document.createElement('span');
  disclosure.className = 'file-disclosure';
  const name = document.createElement('span');
  name.className = 'file-name';
  const size = document.createElement('small');
  row.append(disclosure, name, size);
  explorerRowPartCache.set(row, { disclosure, name, size });
  return row;
}

function explorerRowParts(row: HTMLElement) {
  const cached = explorerRowPartCache.get(row);
  if (cached) return cached;
  const parts = {
    disclosure: row.children[0] as HTMLElement,
    name: row.children[1] as HTMLElement,
    size: row.children[2] as HTMLElement
  };
  explorerRowPartCache.set(row, parts);
  return parts;
}

function updateExplorerRowElement(
  row: HTMLElement,
  item: ExplorerVisibleRow,
  selectedKeys: Set<string>,
  dropTargetKey: string,
  renameKey: string
) {
  const entry = item.entry!;
  const selected = selectedKeys.has(item.pathKey);
  const dropTarget = item.pathKey === dropTargetKey;
  const renameActive = item.pathKey === renameKey;
  const stateSignature = `${selected ? '1' : '0'}${dropTarget ? '1' : '0'}${renameActive ? '1' : '0'}`;
  const staticChanged = row.dataset.staticSignature !== item.staticSignature;
  const stateChanged = row.dataset.stateSignature !== stateSignature;
  if (!staticChanged && !stateChanged) return;

  const renameChanged = row.dataset.renameActive !== (renameActive ? '1' : '0');
  row.dataset.staticSignature = item.staticSignature;
  row.dataset.stateSignature = stateSignature;
  row.dataset.renameActive = renameActive ? '1' : '0';
  if (staticChanged) {
    row.className = `file-row ${entry.kind}`;
    row.dataset.path = entry.path;
    row.dataset.pathKey = item.pathKey;
    if (row.tabIndex !== 0) row.tabIndex = 0;
    const depthText = String(item.depth);
    if (row.style.getPropertyValue('--depth') !== depthText) row.style.setProperty('--depth', depthText);
    setAttributeIfChanged(row, 'role', 'option');
  }
  if (staticChanged || stateChanged) {
    toggleClassIfChanged(row, 'selected', selected);
    toggleClassIfChanged(row, 'drop-target', dropTarget);
    setAttributeIfChanged(row, 'aria-selected', String(selected));
  }
  const { disclosure, name, size } = explorerRowParts(row);
  if (staticChanged) {
    setTextContentIfChanged(disclosure, item.disclosureText);
    setTextContentIfChanged(size, item.sizeText);
  }
  if (staticChanged || renameChanged) {
    if (renameActive) {
      name.replaceChildren();
      attachExplorerRenameInput(name, entry);
    } else {
      if (name.childElementCount) name.replaceChildren();
      setTextContentIfChanged(name, entry.name);
    }
  }
}

function explorerFileSizeText(entry: FileEntry) {
  return state.showFileSizes && entry.kind === 'file' ? formatBytes(entry.size) : '';
}

function updateExplorerLoadingRowElement(row: HTMLElement, depth: number) {
  const signature = `loading\t${depth}`;
  if (row.dataset.staticSignature === signature) return;
  row.dataset.staticSignature = signature;
  row.dataset.stateSignature = '';
  row.dataset.renameActive = '0';
  row.className = 'file-row loading';
  delete row.dataset.path;
  delete row.dataset.pathKey;
  const depthText = String(depth);
  if (row.style.getPropertyValue('--depth') !== depthText) row.style.setProperty('--depth', depthText);
  row.removeAttribute('aria-selected');
  if (row.tabIndex !== -1) row.tabIndex = -1;
  setAttributeIfChanged(row, 'role', 'option');
  const { disclosure, name, size } = explorerRowParts(row);
  setTextContentIfChanged(disclosure, '');
  if (name.childElementCount) name.replaceChildren();
  setTextContentIfChanged(name, 'Loading...');
  setTextContentIfChanged(size, '');
}

function pruneExplorerRowElementCache() {
  if (explorerRowElementCache.size <= EXPLORER_ROW_ELEMENT_CACHE_LIMIT + EXPLORER_ROW_ELEMENT_CACHE_PRUNE_BATCH) return;
  if (explorerCachePruneBusy()) {
    scheduleExplorerRowElementCachePrune();
    if (explorerRowElementCache.size <= EXPLORER_ROW_ELEMENT_CACHE_BUSY_LIMIT) return;
    pruneExplorerRowElementCacheEntries(EXPLORER_ROW_ELEMENT_CACHE_PRUNE_BATCH);
    return;
  }
  pruneExplorerRowElementCacheEntries();
}

function pruneExplorerRowElementCacheEntries(maxDeletes = Number.POSITIVE_INFINITY) {
  let deleted = 0;
  while (explorerRowElementCache.size > EXPLORER_ROW_ELEMENT_CACHE_LIMIT && deleted < maxDeletes) {
    const oldest = explorerRowElementCache.keys().next().value;
    if (oldest === undefined) break;
    const row = explorerRowElementCache.get(oldest);
    explorerRowElementCache.delete(oldest);
    recycleExplorerRowElement(row);
    deleted += 1;
  }
}

function scheduleExplorerRowElementCachePrune() {
  if (explorerRowElementCachePruneTimer) return;
  const delay = Math.max(80, explorerScrollingUntil - Date.now() + EXPLORER_SCROLL_IDLE_MS);
  explorerRowElementCachePruneTimer = window.setTimeout(() => {
    explorerRowElementCachePruneTimer = 0;
    runWhenUiIdle(pruneExplorerRowElementCache, 520);
  }, delay);
}

function explorerCachePruneBusy() {
  return Date.now() < explorerScrollingUntil || uiInputPending();
}

function recycleExplorerRowElement(row?: HTMLElement) {
  if (!row || row.isConnected || explorerReusableRowElements.length >= EXPLORER_ROW_RECYCLE_LIMIT) return;
  row.dataset.staticSignature = '';
  row.dataset.stateSignature = '';
  row.dataset.renameActive = '0';
  delete row.dataset.path;
  delete row.dataset.pathKey;
  row.className = 'file-row';
  explorerReusableRowElements.push(row);
}

function bindExplorerListEvents() {
  el.fileList.addEventListener('scroll', handleExplorerScroll, { passive: true });
  el.fileList.addEventListener('pointerover', handleExplorerPointerOver);
  el.fileList.addEventListener('pointerdown', handleExplorerPointerDown);
  el.fileList.addEventListener('selectstart', handleExplorerSelectStart);
  el.fileList.addEventListener('focusin', handleExplorerFocusIn);
  el.fileList.addEventListener('click', handleExplorerClick);
  el.fileList.addEventListener('dblclick', handleExplorerDoubleClick);
  explorerResizeObserver = new ResizeObserver((entries) => {
    explorerViewportHeight = Math.round(entries[0]?.contentRect.height ?? el.fileList.clientHeight);
    scheduleExplorerVirtualRender();
  });
  explorerResizeObserver.observe(el.fileList);
}

function handleExplorerScroll() {
  markExplorerScrolling();
  scheduleExplorerVirtualRender();
}

function scheduleExplorerVirtualRender() {
  if (getPanel('explorer').classList.contains('hidden')) {
    explorerRenderDirty = true;
    return;
  }
  if (explorerRenderFrame) return;
  if (explorerRenderedWindowCoversScroll()) return;
  explorerRenderFrame = window.requestAnimationFrame(() => {
    explorerRenderFrame = 0;
    renderVirtualExplorerRows();
  });
}

function markExplorerScrolling() {
  const now = Date.now();
  const scrollTimerActive = explorerScrollIdleTimer !== 0;
  const alreadyScrolling = scrollTimerActive || now < explorerScrollingUntil;
  explorerScrollingUntil = now + EXPLORER_SCROLL_IDLE_MS;
  if (!scrollTimerActive) toggleClassIfChanged(el.fileList, 'scrolling', true);
  if (!alreadyScrolling) {
    cancelExplorerHoverPrefetch();
    cancelVisibleExplorerDirectoryPrefetch();
  }
  if (scrollTimerActive) return;
  const waitForScrollIdle = () => {
    const remaining = explorerScrollingUntil - Date.now();
    if (remaining > 0) {
      explorerScrollIdleTimer = window.setTimeout(waitForScrollIdle, remaining);
      return;
    }
    explorerScrollIdleTimer = 0;
    toggleClassIfChanged(el.fileList, 'scrolling', false);
    if (explorerRenderDirty && !getPanel('explorer').classList.contains('hidden')) {
      renderExplorer();
    } else {
      shrinkExplorerVirtualWindowAfterScrollIdle();
    }
    queueVisibleExplorerDirectoryPrefetch(700);
  };
  explorerScrollIdleTimer = window.setTimeout(waitForScrollIdle, EXPLORER_SCROLL_IDLE_MS);
}

function shrinkExplorerVirtualWindowAfterScrollIdle() {
  runWhenUiIdle(() => {
    if (Date.now() < explorerScrollingUntil) return;
    if (getPanel('explorer').classList.contains('hidden')) return;
    if (explorerRenderDirty) {
      renderExplorer();
      return;
    }
    renderVirtualExplorerRows(el.fileList.scrollTop, { shrink: true });
  }, 260);
}

function handleExplorerPointerOver(event: PointerEvent) {
  if (Date.now() < explorerScrollingUntil) return;
  const row = explorerRowFromEvent(event);
  if (!row || row.contains(event.relatedTarget as Node | null)) return;
  const entry = explorerEntryForRow(row);
  if (!entry) return;
  scheduleExplorerHoverPrefetch(entry);
}

function handleExplorerPointerDown(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  if (event.button !== 0) return;
  const row = explorerRowFromEvent(event);
  if (!row) return;
  const entry = explorerEntryForRow(row);
  if (!entry) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    rememberExplorerModifierPointer(entry.path);
    clearExplorerTextSelection();
    scheduleTextFilePrefetch(entry, 0);
    scheduleExplorerDirectoryPrefetch(entry, 0);
    return;
  }
  beginExplorerDragCandidate(event, entry);
  clearExplorerModifierPointer();
  selectExplorerEntryFromPointer(entry, event, false);
  scheduleTextFilePrefetch(entry, 0);
  scheduleExplorerDirectoryPrefetch(entry, 0);
}

function handleExplorerSelectStart(event: Event) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  if (explorerRowFromEvent(event)) event.preventDefault();
}

function clearExplorerTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  selection.removeAllRanges();
}

function handleExplorerFocusIn(event: FocusEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  const entry = explorerEntryFromEvent(event);
  if (!entry) return;
  if (isExplorerModifierPointerActive(entry.path)) {
    scheduleTextFilePrefetch(entry, 0);
    scheduleExplorerDirectoryPrefetch(entry, 0);
    return;
  }
  if (!isExplorerPathSelected(entry.path)) selectExplorerEntry(entry.path, false);
  scheduleTextFilePrefetch(entry, 0);
  scheduleExplorerDirectoryPrefetch(entry, 0);
}

function handleExplorerClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  // Swallow the click synthesized by a drag's pointer sequence (self-expiring window so the
  // flag can never leak into a later, unrelated click).
  if (Date.now() - explorerDragEndAt < EXPLORER_CLICK_SUPPRESS_MS) return;
  const entry = explorerEntryFromEvent(event);
  if (!entry) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    event.preventDefault();
    clearExplorerTextSelection();
    selectExplorerEntryFromPointer(entry, event, false);
    clearExplorerModifierPointer();
    return;
  }
  if (state.explorerOpenMode === 'single') openExplorerEntry(entry);
  else selectExplorerEntry(entry.path, false);
}

function handleExplorerDoubleClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  const entry = explorerEntryFromEvent(event);
  if (entry) openExplorerEntry(entry);
}

function explorerEntryFromEvent(event: Event) {
  const row = explorerRowFromEvent(event);
  return row ? explorerEntryForRow(row) : null;
}

function explorerRowFromEvent(event: Event) {
  if (!(event.target instanceof Element)) return null;
  const row = event.target.closest<HTMLElement>('.file-row[data-path]');
  return row && el.fileList.contains(row) ? row : null;
}

function explorerEntryForRow(row: HTMLElement) {
  const path = row.dataset.path ?? '';
  const pathKey = row.dataset.pathKey || explorerPathKey(path);
  return explorerVisibleEntryForPathKey(pathKey) ?? findExplorerEntry(path);
}

function selectExplorerEntryFromPointer(entry: FileEntry, event: MouseEvent | PointerEvent, scrollIntoView = true) {
  if (event.shiftKey) {
    selectExplorerRange(entry.path, scrollIntoView);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    toggleExplorerSelection(entry.path, scrollIntoView);
    return;
  }
  selectExplorerEntry(entry.path, scrollIntoView);
}

function rememberExplorerModifierPointer(path: string) {
  explorerModifierPointerPath = path;
  explorerModifierPointerUntil = performance.now() + 900;
}

function isExplorerModifierPointerActive(path: string) {
  if (!explorerModifierPointerPath || performance.now() > explorerModifierPointerUntil) return false;
  return sameExplorerPath(explorerModifierPointerPath, path);
}

function clearExplorerModifierPointer() {
  explorerModifierPointerPath = '';
  explorerModifierPointerUntil = 0;
}

function selectExplorerRange(path: string, scrollIntoView = true) {
  const anchor = state.explorerSelectionAnchorPath || state.explorerSelectedPath || path;
  const anchorIndex = explorerVisibleIndexByPath.get(explorerPathKey(anchor));
  const targetIndex = explorerVisibleIndexByPath.get(explorerPathKey(path));
  if (anchorIndex === undefined || targetIndex === undefined) {
    selectExplorerEntry(path, scrollIntoView);
    return;
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const paths: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const entry = explorerVisibleRows[index]?.entry;
    if (entry) paths.push(entry.path);
  }
  setExplorerSelection(paths, path, anchor, scrollIntoView);
}

function toggleExplorerSelection(path: string, scrollIntoView = true) {
  const selected = new Set(state.explorerSelectedPaths);
  if (!selected.size && state.explorerSelectedPath) selected.add(state.explorerSelectedPath);
  if (selected.has(path) && selected.size > 1) selected.delete(path);
  else selected.add(path);
  const activePath = selected.has(path) ? path : selected.values().next().value || '';
  setExplorerSelection(selected, activePath, state.explorerSelectionAnchorPath || activePath, scrollIntoView);
}

function explorerVisibleEntryForPathKey(pathKey: string) {
  const index = explorerVisibleIndexByPath.get(pathKey);
  return index === undefined ? null : explorerVisibleRows[index]?.entry ?? null;
}

function scheduleExplorerHoverPrefetch(entry: FileEntry) {
  if (Date.now() < explorerScrollingUntil) return;
  if (explorerHoverPrefetchTimer) window.clearTimeout(explorerHoverPrefetchTimer);
  explorerHoverPrefetchPath = entry.path;
  explorerHoverPrefetchTimer = window.setTimeout(() => {
    explorerHoverPrefetchTimer = 0;
    if (Date.now() < explorerScrollingUntil || explorerHoverPrefetchPath !== entry.path) return;
    scheduleTextFilePrefetch(entry);
    scheduleExplorerDirectoryPrefetch(entry, EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + 120);
  }, EXPLORER_HOVER_PREFETCH_DELAY_MS);
}

function cancelExplorerHoverPrefetch() {
  explorerHoverPrefetchPath = '';
  if (explorerHoverPrefetchTimer) {
    window.clearTimeout(explorerHoverPrefetchTimer);
    explorerHoverPrefetchTimer = 0;
  }
}

async function startExportSelectedExplorerEntry() {
  if (!state.activeProfile || !state.workspaceOpen) return;
  const entries = compactRecursiveExplorerSelection(selectedExplorerEntries());
  if (!entries.length) {
    setStatus('Select an item to export', true);
    return;
  }

  const batchId = entries.length > 1 ? crypto.randomUUID() : '';
  try {
    let queued = 0;
    for (const entry of entries) {
      const result = await api.startExportPath(state.activeProfile.id, entry.path);
      upsertExportJob({
        id: result.id,
        name: result.name,
        status: 'running',
        progress: 0,
        outputPath: null,
        message: 'Export queued',
        directory: entry.kind === 'dir',
        createdAt: Date.now(),
        batchId,
        batchTotal: entries.length
      });
      queued += 1;
    }
    setStatus(queued === 1
      ? `Exporting ${entries[0].name} in background`
      : `Exporting ${queued} items in background`);
  } catch (error) {
    setStatus(`Export failed to start: ${String(error)}`, true);
  }
}

async function deleteSelectedExplorerEntries() {
  if (!state.activeProfile || !state.workspaceOpen) return;
  const entries = selectedExplorerEntries();
  if (!entries.length) {
    setStatus('Select an item to delete', true);
    return;
  }

  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  try {
    const deleted = await api.deletePaths(profileId, entries.map((entry) => entry.path));
    explorerDeleteUndo = { profileId, workspaceId, items: deleted };
    for (const item of deleted) {
      invalidateExplorerParentDirectoryCache(profileId, item.originalPath);
      invalidateExplorerParentDirectoryCache(profileId, item.trashPath);
      invalidateExplorerDirectoryCache(profileId, item.originalPath);
    }
    clearDeletedExplorerReferences(deleted);
    resetExplorerSelection();
    await refreshExplorerTree({ manual: true, silent: true });
    setStatus(deleted.length === 1
      ? `Deleted ${deleted[0].name}. Ctrl+Z to undo`
      : `Deleted ${deleted.length} items. Ctrl+Z to undo`);
  } catch (error) {
    setStatus(`Delete failed: ${String(error)}`, true);
  }
}

async function undoExplorerDelete() {
  if (!explorerDeleteUndo) {
    setStatus('Nothing to undo');
    return;
  }
  const undo = explorerDeleteUndo;
  if (!state.activeProfile || state.activeProfile.id !== undo.profileId) {
    setStatus('Switch back to the original profile to undo delete', true);
    return;
  }
  try {
    await api.restoreDeletedPaths(undo.profileId, undo.items);
    for (const item of undo.items) {
      invalidateExplorerParentDirectoryCache(undo.profileId, item.originalPath);
      invalidateExplorerParentDirectoryCache(undo.profileId, item.trashPath);
    }
    explorerDeleteUndo = null;
    await refreshExplorerTree({ manual: true, silent: true });
    setExplorerSelection(undo.items.map((item) => item.originalPath), undo.items[0]?.originalPath ?? '');
    setStatus(undo.items.length === 1 ? `Restored ${undo.items[0].name}` : `Restored ${undo.items.length} items`);
  } catch (error) {
    setStatus(`Undo delete failed: ${String(error)}`, true);
  }
}

function clearDeletedExplorerReferences(items: DeletedPathItem[]) {
  for (const item of items) {
    invalidateTextFileCache(state.activeProfile?.id ?? '', item.originalPath);
    state.explorerExpanded.delete(item.originalPath);
    state.explorerChildren.delete(item.originalPath);
    state.explorerSignatures.delete(item.originalPath);
  }
  markExplorerEntryLookupDirty();
}

function handleExportProgress(payload: ExportProgressEvent) {
  const existing = exportJobById.get(payload.id);
  upsertExportJob({
    id: payload.id,
    name: payload.name,
    status: payload.status,
    progress: payload.progress ?? null,
    outputPath: payload.outputPath ?? null,
    message: payload.message ?? null,
    directory: payload.directory,
    createdAt: existing?.createdAt ?? Date.now(),
    batchId: existing?.batchId,
    batchTotal: existing?.batchTotal
  });
  if (payload.status === 'completed') {
    const batchStatus = existing?.batchId ? exportBatchCompletionStatus(existing.batchId) : null;
    if (batchStatus?.done) setStatus(`${batchStatus.total} items exported and ready to drag out`);
    else if (!existing?.batchId) setStatus(`${payload.name} ready to drag out`);
  }
  else if (payload.status === 'failed') setStatus(`Export failed: ${payload.message ?? payload.name}`, true);
  else if (payload.status === 'cancelled') setStatus(`Export cancelled: ${payload.name}`);
}

function upsertExportJob(job: ExportJobState) {
  const existing = exportJobById.get(job.id);
  if (existing) {
    Object.assign(existing, job);
  } else {
    state.exportJobs.unshift(job);
    exportJobById.set(job.id, job);
    while (state.exportJobs.length > 24) {
      const removed = state.exportJobs.pop();
      if (removed) exportJobById.delete(removed.id);
    }
  }
  renderExportJobs();
}

function exportBatchCompletionStatus(batchId: string) {
  const jobs = state.exportJobs.filter((job) => job.batchId === batchId);
  if (!jobs.length) return null;
  const total = jobs[0].batchTotal || jobs.length;
  const doneCount = jobs.filter((job) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled').length;
  return { total, done: doneCount >= total };
}

function renderExportJobs() {
  const signature = exportJobsSignature();
  if (exportJobsRenderSignature === signature) return;
  const orderSignature = exportJobsOrderSignature();
  const sameOrder = exportJobsOrderRenderSignature === orderSignature
    && el.exportList.childElementCount === state.exportJobs.length;
  exportJobsRenderSignature = signature;
  el.exportList.classList.toggle('hidden', state.exportJobs.length === 0);

  if (sameOrder) {
    for (const job of state.exportJobs) {
      updateExportJobElement(exportJobElement(job.id), job);
    }
    return;
  }

  exportJobsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const job of state.exportJobs) {
    seen.add(job.id);
    const row = exportJobElement(job.id);
    updateExportJobElement(row, job);
    fragment.append(row);
  }
  el.exportList.replaceChildren(fragment);
  pruneExportJobElementCache(seen);
}

function exportJobElement(id: string) {
  const cached = exportJobElementCache.get(id);
  if (cached) return cached;
  const row = document.createElement('div');
  row.dataset.exportJobId = id;
  const meta = document.createElement('div');
  meta.className = 'export-meta';
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  meta.append(title, detail);
  const progress = document.createElement('div');
  progress.className = 'export-progress';
  const bar = document.createElement('div');
  progress.append(bar);
  const actions = document.createElement('div');
  actions.className = 'export-actions';
  row.append(meta, progress, actions);
  exportJobPartCache.set(row, { title, detail, progress, bar, actions });
  exportJobElementCache.set(id, row);
  return row;
}

function exportJobParts(row: HTMLElement) {
  const cached = exportJobPartCache.get(row);
  if (cached) return cached;
  const meta = row.querySelector<HTMLElement>('.export-meta');
  const progress = row.querySelector<HTMLElement>('.export-progress');
  const actions = row.querySelector<HTMLElement>('.export-actions');
  if (meta && progress && actions) {
    let bar = progress.firstElementChild as HTMLElement | null;
    if (!bar) {
      bar = document.createElement('div');
      progress.append(bar);
    }
    const parts = {
      title: meta.querySelector<HTMLElement>('strong')!,
      detail: meta.querySelector<HTMLElement>('span')!,
      progress,
      bar,
      actions
    };
    exportJobPartCache.set(row, parts);
    return parts;
  }
  row.replaceChildren();
  const rebuiltMeta = document.createElement('div');
  rebuiltMeta.className = 'export-meta';
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  rebuiltMeta.append(title, detail);
  const rebuiltProgress = document.createElement('div');
  rebuiltProgress.className = 'export-progress';
  const bar = document.createElement('div');
  rebuiltProgress.append(bar);
  const rebuiltActions = document.createElement('div');
  rebuiltActions.className = 'export-actions';
  row.append(rebuiltMeta, rebuiltProgress, rebuiltActions);
  const parts = { title, detail, progress: rebuiltProgress, bar, actions: rebuiltActions };
  exportJobPartCache.set(row, parts);
  return parts;
}

function updateExportJobElement(row: HTMLElement, job: ExportJobState) {
  const detailText = exportJobDetail(job);
  const progressPercent = `${Math.round((job.progress ?? 0) * 100)}%`;
  const actionSignature = job.status === 'running'
    ? 'cancel'
    : job.status === 'completed' && job.outputPath
      ? 'drag-open-clear'
      : 'clear';
  const signature = `${job.id}\t${job.name}\t${job.status}\t${progressPercent}\t${job.progress == null ? '1' : '0'}\t${detailText}\t${job.outputPath ?? ''}\t${actionSignature}`;
  row.dataset.exportJobId = job.id;
  if (row.dataset.renderSignature === signature) return;
  row.dataset.renderSignature = signature;
  row.className = `export-job ${job.status}`;

  const parts = exportJobParts(row);
  setTextContentIfChanged(parts.title, job.name);
  setTextContentIfChanged(parts.detail, detailText);
  parts.progress.classList.toggle('indeterminate', job.status === 'running' && job.progress == null);
  if (parts.bar.style.width !== progressPercent) parts.bar.style.width = progressPercent;

  if (row.dataset.actionSignature !== actionSignature) {
    row.dataset.actionSignature = actionSignature;
    parts.actions.replaceChildren();
    if (job.status === 'running') {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        const id = row.dataset.exportJobId;
        if (id) void cancelExportJob(id);
      });
      parts.actions.append(cancel);
    } else if (job.status === 'completed' && job.outputPath) {
      const drag = document.createElement('button');
      drag.textContent = 'Drag out';
      drag.className = 'export-drag';
      drag.draggable = true;
      drag.title = 'Drag this to Windows Explorer';
      drag.addEventListener('dragstart', (event) => {
        const current = exportJobForRow(row);
        if (current) prepareExportDrag(event, current);
      });
      const open = document.createElement('button');
      open.textContent = 'Open';
      open.addEventListener('click', () => {
        const current = exportJobForRow(row);
        if (current?.outputPath) void api.openExportPath(current.outputPath);
      });
      const clear = exportJobClearButton(row);
      parts.actions.append(drag, open, clear);
    } else {
      parts.actions.append(exportJobClearButton(row));
    }
  }
}

function exportJobClearButton(row: HTMLElement) {
  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => {
    const id = row.dataset.exportJobId;
    if (id) clearExportJob(id);
  });
  return clear;
}

function clearExportJob(id: string) {
  const index = state.exportJobs.findIndex((job) => job.id === id);
  if (index >= 0) state.exportJobs.splice(index, 1);
  exportJobById.delete(id);
  exportJobsRenderSignature = '\0';
  renderExportJobs();
  if (!state.exportJobs.length) setStatus('Export messages cleared');
}

function exportJobForRow(row: HTMLElement) {
  return exportJobById.get(row.dataset.exportJobId ?? '') ?? null;
}

function pruneExportJobElementCache(seen: Set<string>) {
  for (const id of exportJobElementCache.keys()) {
    if (!seen.has(id)) exportJobElementCache.delete(id);
  }
}

function exportJobsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.exportJobs.length; index += 1) {
    if (index) signature += '\n';
    signature += state.exportJobs[index].id;
  }
  return signature;
}

function exportJobsSignature() {
  let signature = '';
  for (let index = 0; index < state.exportJobs.length; index += 1) {
    const job = state.exportJobs[index];
    if (index) signature += '\n';
    signature += `${job.id}\t${job.status}\t${job.progress ?? ''}\t${job.outputPath ?? ''}\t${job.message ?? ''}\t${job.directory ? '1' : '0'}`;
  }
  return signature;
}

function exportJobDetail(job: ExportJobState) {
  if (job.status === 'running') return job.message ?? 'Running in background';
  if (job.status === 'completed') return job.directory ? 'Ready in export folder' : 'Ready to drag out';
  if (job.status === 'cancelled') return 'Cancelled';
  return job.message ?? 'Failed';
}

async function cancelExportJob(id: string) {
  await api.cancelExportPath(id).catch((error) => setStatus(String(error), true));
}

function prepareExportDrag(event: DragEvent, job: ExportJobState) {
  if (!event.dataTransfer || !job.outputPath) return;
  const url = windowsPathToFileUrl(job.outputPath);
  const mime = job.directory ? 'application/x-directory' : mimeTypeForExportName(job.name);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('DownloadURL', `${mime}:${job.name}:${url}`);
  event.dataTransfer.setData('text/uri-list', url);
  event.dataTransfer.setData('text/plain', job.name);
  setStatus(`Drag ${job.name} to Windows Explorer`);
}

function windowsPathToFileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const encoded = normalized.split('/').map((part, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(part)) return part;
    return encodeURIComponent(part);
  }).join('/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encoded}`;
  if (normalized.startsWith('//')) return `file:${encoded}`;
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

function mimeTypeForExportName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.log')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.tar')) return 'application/x-tar';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

async function handleExplorerFileDrop(payload: TauriDragDropPayload) {
  const targetDir = explorerDropTargetDirectory(payload.position);
  const sourcePaths = (payload.paths ?? []).filter(Boolean);
  clearExplorerDropTarget();

  if (!targetDir || !sourcePaths.length || !state.activeProfile || !state.workspaceOpen) return;

  try {
    setStatus(`Copying ${sourcePaths.length} dropped item${sourcePaths.length === 1 ? '' : 's'}...`);
    const copied = await api.copyDroppedFiles(state.activeProfile.id, targetDir, sourcePaths);
    invalidateExplorerDirectoryCache(state.activeProfile.id, targetDir);
    await reloadExplorerDirectory(targetDir);
    selectExplorerEntry(targetDir, false);
    setStatus(`Copied ${copied} dropped item${copied === 1 ? '' : 's'}`);
  } catch (error) {
    setStatus(`Drop copy failed: ${String(error)}`, true);
  }
}

function updateExplorerDropTarget(position?: { x: number; y: number }) {
  explorerPendingDropPosition = position;
  if (explorerDropTargetFrame) return;
  explorerDropTargetFrame = window.requestAnimationFrame(() => {
    explorerDropTargetFrame = 0;
    applyExplorerDropTarget(explorerPendingDropPosition);
  });
}

function applyExplorerDropTarget(position?: { x: number; y: number }) {
  setExplorerDropTargetDir(explorerDropTargetDirectory(position) || '');
}

function setExplorerDropTargetDir(targetDir: string) {
  const explorer = getPanel('explorer');
  if (state.explorerDropTargetDir === (targetDir ?? '')) return;
  explorer.classList.toggle('drop-active', Boolean(targetDir));
  if (state.explorerDropTargetDir) {
    explorerRowForPath(state.explorerDropTargetDir)?.classList.remove('drop-target');
  }
  state.explorerDropTargetDir = targetDir ?? '';
  if (targetDir) explorerRowForPath(targetDir)?.classList.add('drop-target');
}

function clearExplorerDropTarget() {
  explorerPendingDropPosition = undefined;
  if (explorerDropTargetFrame) {
    window.cancelAnimationFrame(explorerDropTargetFrame);
    explorerDropTargetFrame = 0;
  }
  if (!state.explorerDropTargetDir) {
    getPanel('explorer').classList.remove('drop-active');
    return;
  }
  const previous = state.explorerDropTargetDir;
  state.explorerDropTargetDir = '';
  getPanel('explorer').classList.remove('drop-active');
  explorerRowForPath(previous)?.classList.remove('drop-target');
}

function beginExplorerDragCandidate(event: PointerEvent, entry: FileEntry) {
  if (!state.workspaceOpen || !state.activeProfile) return;
  if (!event.isPrimary || activeExplorerRename) return; // ignore secondary touches / active rename
  if (explorerDrag) endExplorerDragSession();
  // Snapshot the drag set from the CURRENT selection (this runs before the click collapses a
  // multi-selection to the single clicked row), so dragging a group moves the whole group.
  const paths = (isExplorerPathSelected(entry.path)
    ? compactRecursiveExplorerSelection(selectedExplorerEntries()).map((item) => item.path)
    : [entry.path]
  ).filter(Boolean);
  if (!paths.length) return;
  explorerDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    paths,
    active: false,
    ghost: null,
    targetDir: ''
  };
  window.addEventListener('pointermove', onExplorerDragPointerMove);
  window.addEventListener('pointerup', onExplorerDragPointerUp);
  window.addEventListener('pointercancel', onExplorerDragPointerCancel);
  window.addEventListener('blur', endExplorerDragSession);
}

function onExplorerDragPointerMove(event: PointerEvent) {
  if (!explorerDrag || event.pointerId !== explorerDrag.pointerId) return;
  if (!explorerDrag.active) {
    const moved = Math.hypot(event.clientX - explorerDrag.startX, event.clientY - explorerDrag.startY);
    if (moved < EXPLORER_DRAG_THRESHOLD) return;
    explorerDrag.active = true;
    explorerDrag.ghost = createExplorerDragGhost(explorerDrag.paths);
  }
  event.preventDefault();
  moveExplorerDragGhost(explorerDrag.ghost, event.clientX, event.clientY);
  explorerDragAutoScroll(event.clientY);
  // clientX/clientY are CSS pixels already, so hit-test directly (no DPR conversion here).
  const dir = explorerDirForTargetElement(document.elementFromPoint(event.clientX, event.clientY)) || '';
  explorerDrag.targetDir = dir;
  setExplorerDropTargetDir(dir);
}

function onExplorerDragPointerUp(event: PointerEvent) {
  if (!explorerDrag || event.pointerId !== explorerDrag.pointerId) return;
  const active = explorerDrag.active;
  const paths = explorerDrag.paths;
  const targetDir = explorerDrag.targetDir;
  endExplorerDragSession();
  if (!active) return;
  explorerDragEndAt = Date.now(); // a drag occurred; suppress the trailing synthetic click
  if (targetDir) void moveExplorerPathsTo(paths, targetDir);
}

function onExplorerDragPointerCancel(event: PointerEvent) {
  if (!explorerDrag || event.pointerId !== explorerDrag.pointerId) return;
  endExplorerDragSession();
}

function endExplorerDragSession() {
  if (!explorerDrag) return;
  explorerDrag.ghost?.remove();
  explorerDrag = null;
  clearExplorerDropTarget();
  window.removeEventListener('pointermove', onExplorerDragPointerMove);
  window.removeEventListener('pointerup', onExplorerDragPointerUp);
  window.removeEventListener('pointercancel', onExplorerDragPointerCancel);
  window.removeEventListener('blur', endExplorerDragSession);
}

function createExplorerDragGhost(paths: string[]) {
  const ghost = document.createElement('div');
  ghost.textContent = paths.length === 1 ? pathBasename(paths[0], paths[0]) : `${paths.length} items`;
  ghost.setAttribute('style', [
    'position:fixed', 'left:0', 'top:0', 'z-index:9999', 'pointer-events:none',
    'padding:2px 8px', 'max-width:240px', 'overflow:hidden', 'white-space:nowrap',
    'text-overflow:ellipsis', 'border-radius:4px', 'font-size:12px', 'color:#fff',
    'background:rgba(32,32,36,0.92)', 'border:1px solid rgba(255,255,255,0.2)',
    'transform:translate(-2000px,-2000px)'
  ].join(';'));
  document.body.append(ghost);
  return ghost;
}

function moveExplorerDragGhost(ghost: HTMLElement | null, x: number, y: number) {
  if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 14}px)`;
}

function explorerDragAutoScroll(clientY: number) {
  const rect = el.fileList.getBoundingClientRect();
  const edge = 28;
  if (clientY < rect.top + edge) el.fileList.scrollTop -= 14;
  else if (clientY > rect.bottom - edge) el.fileList.scrollTop += 14;
}

async function moveExplorerPathsTo(paths: string[], targetDir: string) {
  if (!state.activeProfile || !state.workspaceOpen || !targetDir) return;
  const profileId = state.activeProfile.id;
  const targetKey = explorerPathKey(targetDir);
  const moves: { from: string; to: string }[] = [];
  let blocked = 0;
  for (const from of paths) {
    if (!from) continue;
    const fromKey = explorerPathKey(from);
    if (explorerPathKey(parentPath(from)) === targetKey) continue; // already in the target dir
    if (targetKey === fromKey || targetKey.startsWith(`${fromKey}/`)) {
      blocked++; // moving a folder into itself/its own descendant — skip, keep other valid moves
      continue;
    }
    moves.push({ from, to: joinExplorerPath(targetDir, pathBasename(from, from)) });
  }
  if (!moves.length) {
    if (blocked) setStatus('Cannot move a folder into itself', true);
    return;
  }
  const dirsToReload = new Set<string>([targetDir, ...moves.map((move) => parentPath(move.from))]);
  const failed: string[] = [];
  let moved = 0;
  setStatus(`Moving ${moves.length} item${moves.length === 1 ? '' : 's'}...`);
  // Move each item independently so one collision/failure doesn't abort the rest.
  for (const { from, to } of moves) {
    try {
      await api.renamePath(profileId, from, to);
    } catch {
      failed.push(pathBasename(from, from));
      continue;
    }
    invalidateTextFileCache(profileId, from);
    invalidateTextFileCache(profileId, to);
    invalidateExplorerParentDirectoryCache(profileId, from);
    invalidateExplorerParentDirectoryCache(profileId, to);
    invalidateExplorerDirectoryCache(profileId, from);
    invalidateExplorerDirectoryCache(profileId, to);
    moveExplorerChildCache(from, to);
    renameOpenReferences(from, to);
    moved++;
  }
  renderEditorTabs();
  renderEditor();
  for (const dir of dirsToReload) await reloadExplorerDirectory(dir).catch(() => undefined);
  if (moved) selectExplorerEntry(targetDir, false);
  if (failed.length) {
    const names = failed.slice(0, 3).join(', ') + (failed.length > 3 ? '…' : '');
    setStatus(`Moved ${moved}, failed ${failed.length}: ${names}`, true);
  } else {
    setStatus(`Moved ${moved} item${moved === 1 ? '' : 's'}`);
  }
}

function explorerDropTargetDirectory(position?: { x: number; y: number }) {
  return explorerDirForTargetElement(elementFromDragPosition(position));
}

// Resolve the explorer directory under a hit-tested element (shared by OS file drops and
// internal pointer-drag moves). Returns '' when the point is outside a droppable area.
function explorerDirForTargetElement(target: Element | null) {
  if (!state.workspaceOpen || !state.currentDir) return '';
  const explorer = getPanel('explorer');
  if (explorer.classList.contains('hidden')) return '';
  if (!target || !explorer.contains(target)) return '';

  const row = target.closest<HTMLElement>('.file-row');
  if (row?.dataset.path) {
    const entry = explorerEntryForRow(row);
    if (entry?.kind === 'dir') return entry.path;
    if (entry) return parentPath(entry.path);
  }
  return state.currentDir;
}

function elementFromDragPosition(position?: { x: number; y: number }) {
  if (!position) return null;
  const explorer = getPanel('explorer');
  const ratio = window.devicePixelRatio || 1;
  // Tauri drag-drop reports PHYSICAL pixels while document.elementFromPoint expects CSS pixels,
  // so on scaled displays (DPR != 1) the CSS-converted point is the correct one — prefer it.
  // (Previously the raw point was tried first and usually still landed inside the explorer on a
  // different row, so the highlighted folder didn't match the cursor.)
  const css = ratio === 1
    ? document.elementFromPoint(position.x, position.y)
    : document.elementFromPoint(position.x / ratio, position.y / ratio);
  if (css && explorer.contains(css)) return css;
  // Fallback for platforms that already report CSS pixels.
  const raw = ratio === 1 ? css : document.elementFromPoint(position.x, position.y);
  if (raw && explorer.contains(raw)) return raw;
  return css ?? raw;
}

async function toggleExplorerDirectory(entry: FileEntry) {
  if (!state.activeProfile || entry.kind !== 'dir') return;
  if (state.explorerExpanded.has(entry.path)) {
    state.explorerExpanded.delete(entry.path);
    renderExplorer();
    saveActiveWorkspaceSnapshot();
    return;
  }

  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  const cached = state.explorerChildren.get(entry.path) ?? cachedExplorerDirectory(profileId, entry.path, workspaceId);
  if (cached) {
    state.explorerChildren.set(entry.path, cached);
    markExplorerEntryLookupDirty();
    state.explorerSignatures.set(entry.path, explorerDirectorySignature(cached));
    state.explorerExpanded.add(entry.path);
    state.explorerLoading.delete(entry.path);
    renderExplorer();
    saveActiveWorkspaceSnapshot();
    scheduleCachedExplorerDirectoryRefresh(entry.path, profileId, workspaceId, { requireExpanded: true });
    return;
  }

  state.explorerExpanded.add(entry.path);
  state.explorerLoading.add(entry.path);
  renderExplorer();

  try {
    const children = await fetchExplorerDirectory(profileId, entry.path, workspaceId);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    state.explorerChildren.set(entry.path, children);
    markExplorerEntryLookupDirty();
    state.explorerSignatures.set(entry.path, explorerDirectorySignature(children));
    state.explorerExpanded.add(entry.path);
    queueVisibleExplorerDirectoryPrefetch(700);
    setStatus(`Expanded ${entry.name}`);
  } catch (error) {
    state.explorerExpanded.delete(entry.path);
    setStatus(String(error), true);
  } finally {
    state.explorerLoading.delete(entry.path);
    renderExplorer();
    saveActiveWorkspaceSnapshot();
  }
}

async function openExecutablePath(path: string) {
  if (!state.activeProfile) return;
  try {
    await api.openPath(state.activeProfile.id, path);
    setStatus(`Launched ${path}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

async function runPowerShellScriptAsAdmin(path: string) {
  if (!state.activeProfile) return;
  if (!canRunPowerShellScriptAsAdmin()) {
    setStatus('Admin PowerShell launch is only available for Windows/WSL files', true);
    return;
  }
  try {
    await api.runPowerShellScriptAsAdmin(state.activeProfile.id, path);
    setStatus(`Requested admin PowerShell: ${pathBasename(path, path)}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

function isWindowsExecutablePath(path: string) {
  return path.toLowerCase().endsWith('.exe');
}

function isPowerShellScriptPath(path: string) {
  return path.toLowerCase().endsWith('.ps1');
}

function canRunPowerShellScriptAsAdmin() {
  return state.activeProfile?.kind === 'windows' || state.activeProfile?.kind === 'wsl';
}

async function createExplorerItem(kind: 'file' | 'dir') {
  if (!state.activeProfile || !state.currentDir) return;
  const targetDir = await explorerCreateTargetDirectory();
  const siblings = await ensureExplorerDirectoryChildren(targetDir);
  const name = uniqueExplorerName(kind === 'file' ? 'new-file.txt' : 'New Folder', siblings);
  const path = joinExplorerPath(targetDir, name);

  try {
    if (kind === 'file') await api.createFile(state.activeProfile.id, path);
    else await api.createDirectory(state.activeProfile.id, path);
    if (kind === 'file') invalidateTextFileCache(state.activeProfile.id, path);
    invalidateExplorerDirectoryCache(state.activeProfile.id, targetDir);
    await reloadExplorerDirectory(targetDir);
    selectExplorerEntry(path);
    startInlineExplorerRename(path, { created: true });
    setStatus(`${kind === 'file' ? 'Created file' : 'Created folder'} - name it in Explorer`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renameSelectedExplorerEntry() {
  const entry = findExplorerEntry(state.explorerSelectedPath);
  if (!entry) {
    setStatus('Select an item to rename', true);
    return;
  }

  startInlineExplorerRename(entry.path);
}

async function finishInlineExplorerRename(input: HTMLInputElement, commit: boolean) {
  const active = activeExplorerRename;
  if (!active || input.dataset.finishing === 'true') return;
  input.dataset.finishing = 'true';
  const entry = findExplorerEntry(active.path);
  if (!entry || !state.activeProfile) {
    activeExplorerRename = null;
    renderExplorer();
    return;
  }

  const name = normalizeExplorerName(input.value);
  if (!commit || !name || name === active.originalName) {
    activeExplorerRename = null;
    renderExplorer();
    selectExplorerEntry(active.path);
    return;
  }

  const newPath = joinExplorerPath(parentPath(entry.path), name);
  try {
    await api.renamePath(state.activeProfile.id, entry.path, newPath);
    invalidateTextFileCache(state.activeProfile.id, entry.path);
    invalidateTextFileCache(state.activeProfile.id, newPath);
    invalidateExplorerParentDirectoryCache(state.activeProfile.id, entry.path);
    invalidateExplorerParentDirectoryCache(state.activeProfile.id, newPath);
    invalidateExplorerDirectoryCache(state.activeProfile.id, entry.path);
    invalidateExplorerDirectoryCache(state.activeProfile.id, newPath);
    moveExplorerChildCache(entry.path, newPath);
    renameOpenReferences(entry.path, newPath);
    renderEditorTabs();
    renderEditor();
    activeExplorerRename = null;
    await reloadExplorerDirectory(parentPath(entry.path));
    selectExplorerEntry(newPath);
    if (active.created && active.kind === 'file') await openFile(newPath);
    setStatus(`Renamed ${entry.name} to ${name}`);
  } catch (error) {
    setStatus(String(error), true);
    input.dataset.finishing = '';
    input.focus();
    input.select();
  }
}

function startInlineExplorerRename(path: string, options: { created?: boolean } = {}) {
  const entry = findExplorerEntry(path);
  if (!entry) return;

  activeExplorerRename = {
    path,
    originalName: entry.name,
    kind: entry.kind,
    created: Boolean(options.created)
  };
  selectExplorerEntry(path, false);
  renderExplorer();
}

function attachExplorerRenameInput(nameCell: HTMLElement, entry: FileEntry) {
  const input = document.createElement('input');
  input.className = 'file-rename-input';
  input.value = entry.name;
  input.spellcheck = false;
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void finishInlineExplorerRename(input, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void finishInlineExplorerRename(input, false);
    }
  });
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (input.isConnected && activeExplorerRename?.path === entry.path) input.focus();
    }, 0);
  });
  nameCell.append(input);
  window.setTimeout(() => {
    if (input.isConnected && activeExplorerRename?.path === entry.path) {
      input.focus();
      selectRenameText(input, entry.name, entry.kind);
    }
  }, 0);
}

function selectRenameText(input: HTMLInputElement, name: string, kind: FileEntry['kind']) {
  if (kind !== 'file') {
    input.select();
    return;
  }
  const dot = name.lastIndexOf('.');
  if (dot > 0) input.setSelectionRange(0, dot);
  else input.select();
}

function explorerRowForPath(path: string) {
  return explorerRenderedRowByPath.get(explorerPathKey(path)) ?? null;
}

function markExplorerEntryLookupDirty() {
  explorerEntryLookupDirty = true;
}

function ensureExplorerEntryLookup() {
  if (!explorerEntryLookupDirty) return;
  explorerEntryByPath.clear();
  rememberExplorerEntries(state.entries);
  for (const entries of state.explorerChildren.values()) rememberExplorerEntries(entries);
  explorerEntryLookupDirty = false;
}

function rememberExplorerEntries(entries: FileEntry[]) {
  for (const entry of entries) explorerEntryByPath.set(explorerPathKey(entry.path), entry);
}

function findExplorerEntry(path: string) {
  if (!path) return null;
  const pathKey = explorerPathKey(path);
  const visible = explorerVisibleEntryForPathKey(pathKey);
  if (visible) return visible;
  ensureExplorerEntryLookup();
  const cached = explorerEntryByPath.get(pathKey);
  if (cached) return cached;
  const found = findExplorerEntryIn(path, state.entries);
  if (found) explorerEntryByPath.set(pathKey, found);
  return found;
}

function findExplorerEntryIn(path: string, entries: FileEntry[]): FileEntry | null {
  for (const entry of entries) {
    if (sameExplorerPath(entry.path, path)) return entry;
    const found = findExplorerEntryIn(path, state.explorerChildren.get(entry.path) ?? []);
    if (found) return found;
  }
  return null;
}

async function explorerCreateTargetDirectory() {
  const selected = findExplorerEntry(state.explorerSelectedPath);
  if (selected?.kind === 'dir') return selected.path;
  if (selected) return parentPath(selected.path);
  return state.currentDir;
}

async function ensureExplorerDirectoryChildren(path: string) {
  if (!state.activeProfile) return [];
  if (path === state.currentDir) return state.entries;
  const cached = state.explorerChildren.get(path);
  if (cached) return cached;
  const children = await readExplorerDirectoryCached(state.activeProfile.id, path);
  state.explorerChildren.set(path, children);
  markExplorerEntryLookupDirty();
  state.explorerExpanded.add(path);
  return children;
}

async function reloadExplorerDirectory(path: string) {
  if (!state.activeProfile) return;
  await refreshExplorerDirectory(path, state.activeProfile.id, state.activeWorkspaceId, false, true);
}

async function refreshExplorerDirectory(
  path: string,
  profileId = state.activeProfile?.id ?? '',
  workspaceId = state.activeWorkspaceId,
  renderOnlyIfChanged = true,
  force = false
) {
  if (!profileId) return;
  const selected = state.explorerSelectedPath;
  const selectedPaths = new Set(state.explorerSelectedPaths);
  const selectionAnchor = state.explorerSelectionAnchorPath;
  const entries = await fetchExplorerDirectory(profileId, path, workspaceId, force);
  if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
  const signature = explorerDirectorySignature(entries);
  const previous = state.explorerSignatures.get(path);
  if (renderOnlyIfChanged && previous === signature) return;

  if (path === state.currentDir) {
    state.entries = entries;
    markExplorerEntryLookupDirty();
    state.explorerSignatures.set(path, signature);
    restoreExplorerSelection(selected, selectedPaths, selectionAnchor);
    renderExplorer();
    return;
  }

  state.explorerChildren.set(path, entries);
  markExplorerEntryLookupDirty();
  state.explorerSignatures.set(path, signature);
  state.explorerExpanded.add(path);
  restoreExplorerSelection(selected, selectedPaths, selectionAnchor);
  renderExplorer();
}

async function refreshExplorerTree(options: { manual?: boolean; silent?: boolean } = {}) {
  if (!state.activeProfile || !state.workspaceOpen || !state.currentDir) return;
  if (explorerWatchInFlight && !options.manual) return;

  const previousLabel = el.refreshExplorer.textContent;
  if (options.manual) {
    el.refreshExplorer.disabled = true;
    el.refreshExplorer.textContent = '...';
    if (!options.silent) setStatus('Refreshing Explorer...');
  }

  try {
    const changed = await pollExplorerDirectories({ manual: options.manual });
    if (options.manual && !options.silent) setStatus(changed ? 'Explorer refreshed' : 'Explorer already up to date');
    else if (changed && !options.silent) setStatus('Explorer updated');
  } catch (error) {
    if (options.manual) setStatus(`Explorer refresh failed: ${String(error)}`, true);
  } finally {
    if (options.manual) {
      el.refreshExplorer.textContent = previousLabel;
      el.refreshExplorer.disabled = !state.workspaceOpen;
    }
    scheduleExplorerWatch();
  }
}

function scheduleExplorerWatch(delayMs = explorerWatchInterval()) {
  if (explorerWatchTimer) window.clearTimeout(explorerWatchTimer);
  explorerWatchIdleToken += 1;
  if (!state.workspaceOpen || !state.activeProfile || !state.currentDir) return;
  explorerWatchTimer = window.setTimeout(() => void runExplorerWatch(), delayMs);
}

function stopExplorerWatch() {
  cancelExplorerWatchSchedule();
  explorerWatchInFlight = false;
}

function runExplorerWatch() {
  explorerWatchTimer = 0;
  if (!state.workspaceOpen || !state.activeProfile || !state.currentDir) return;
  if (document.hidden) {
    scheduleExplorerWatch(explorerWatchInterval() * EXPLORER_WATCH_HIDDEN_FACTOR);
    return;
  }
  const scrollPause = explorerScrollingUntil - Date.now();
  if (scrollPause > 0) {
    scheduleExplorerWatch(scrollPause + EXPLORER_SCROLL_IDLE_MS);
    return;
  }
  if (getPanel('explorer').classList.contains('hidden')) {
    scheduleExplorerWatch(explorerWatchInterval() * 2);
    return;
  }
  const token = ++explorerWatchIdleToken;
  runWhenUiIdle(() => void runExplorerWatchWhenIdle(token), explorerWatchIdleTimeout());
}

async function runExplorerWatchWhenIdle(token: number) {
  if (token !== explorerWatchIdleToken) return;
  if (!state.workspaceOpen || !state.activeProfile || !state.currentDir) return;
  if (document.hidden) {
    if (token === explorerWatchIdleToken) scheduleExplorerWatch(explorerWatchInterval() * EXPLORER_WATCH_HIDDEN_FACTOR);
    return;
  }
  const scrollPause = explorerScrollingUntil - Date.now();
  if (scrollPause > 0) {
    if (token === explorerWatchIdleToken) scheduleExplorerWatch(scrollPause + EXPLORER_SCROLL_IDLE_MS);
    return;
  }
  if (getPanel('explorer').classList.contains('hidden')) {
    if (token === explorerWatchIdleToken) scheduleExplorerWatch(explorerWatchInterval() * 2);
    return;
  }
  try {
    await pollExplorerDirectories();
  } catch {
    // Background Explorer watching must never interrupt terminal/editor work.
  } finally {
    if (token === explorerWatchIdleToken) scheduleExplorerWatch();
  }
}

async function pollExplorerDirectories(options: { manual?: boolean } = {}) {
  if (!state.activeProfile || explorerWatchInFlight) return false;
  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  explorerWatchInFlight = true;
  const startedAt = performance.now();
  let changed = false;
  const previousSelection = state.explorerSelectedPath;
  const previousSelectedPaths = new Set(state.explorerSelectedPaths);
  const previousSelectionAnchor = state.explorerSelectionAnchorPath;
  try {
    const paths = explorerWatchPaths(options.manual ? EXPLORER_WATCH_MAX_DIRS : explorerWatchPathLimit());
    const pathsNeedingListings = options.manual
      ? paths
      : await changedExplorerWatchPaths(profileId, paths, workspaceId);
    if (!pathsNeedingListings.length) return false;
    if (!options.manual && shouldPauseExplorerBackgroundWork()) return false;
    const listings = await fetchExplorerDirectories(profileId, pathsNeedingListings, workspaceId, Boolean(options.manual));
    for (const path of pathsNeedingListings) {
      if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) break;
      if (!options.manual && shouldPauseExplorerBackgroundWork()) break;
      const listing = listings.get(explorerPathKey(path));
      try {
        if (!listing) throw new Error('Directory listing was unavailable');
        if (listing.error) throw new Error(listing.error);
        const entries = listing.entries;
        if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) break;
        const signature = explorerDirectorySignature(entries);
        const previous = state.explorerSignatures.get(path);
        if (previous !== signature) {
          state.explorerSignatures.set(path, signature);
          if (path === state.currentDir) state.entries = entries;
          else state.explorerChildren.set(path, entries);
          markExplorerEntryLookupDirty();
          changed = true;
        }
      } catch (error) {
        if (sameExplorerPath(path, state.currentDir)) throw error;
        state.explorerExpanded.delete(path);
        state.explorerChildren.delete(path);
        markExplorerEntryLookupDirty();
        state.explorerSignatures.delete(path);
        changed = true;
      }
      if (!options.manual) {
        if (shouldPauseExplorerBackgroundWork()) break;
        await yieldToUi();
        if (!state.workspaceOpen || state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) break;
      }
    }
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return changed;
    if (changed) {
      restoreExplorerSelection(previousSelection, previousSelectedPaths, previousSelectionAnchor);
      if (!options.manual && shouldPauseExplorerBackgroundWork()) {
        explorerRenderDirty = true;
        return changed;
      }
      renderExplorer();
    }
  } finally {
    if (!options.manual) explorerWatchLastDurationMs = performance.now() - startedAt;
    explorerWatchInFlight = false;
  }
  return changed;
}

async function changedExplorerWatchPaths(profileId: string, paths: string[], workspaceId: string) {
  const changedPaths: string[] = [];
  const signaturePaths: string[] = [];
  for (const path of paths) {
    if (shouldPauseExplorerBackgroundWork()) return changedPaths;
    const cached = cachedFreshExplorerDirectory(profileId, path, workspaceId);
    if (cached) {
      const previous = state.explorerSignatures.get(path);
      if (previous !== explorerDirectorySignature(cached)) changedPaths.push(path);
      continue;
    }
    signaturePaths.push(path);
  }
  if (!signaturePaths.length) return changedPaths;
  if (shouldPauseExplorerBackgroundWork()) return changedPaths;

  const signatures = await api.directorySignatures(profileId, signaturePaths, state.showFileSizes);
  const signatureKeys: string[] = [];
  for (const result of signatures) signatureKeys.push(explorerPathKey(result.path));

  for (const path of signaturePaths) {
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) break;
    if (shouldPauseExplorerBackgroundWork()) break;
    const pathKey = explorerPathKey(path);
    let result: (typeof signatures)[number] | undefined;
    for (let index = 0; index < signatureKeys.length; index += 1) {
      if (signatureKeys[index] !== pathKey) continue;
      result = signatures[index];
      break;
    }
    try {
      if (!result) throw new Error('Directory signature was unavailable');
      if (result.error) throw new Error(result.error);
      const previous = state.explorerSignatures.get(path);
      if (previous !== result.signature) changedPaths.push(path);
    } catch (error) {
      if (sameExplorerPath(path, state.currentDir)) throw error;
      state.explorerExpanded.delete(path);
      state.explorerChildren.delete(path);
      markExplorerEntryLookupDirty();
      state.explorerSignatures.delete(path);
      changedPaths.push(path);
    }
    if (shouldPauseExplorerBackgroundWork()) break;
    await yieldToUi();
  }
  return changedPaths;
}

function shouldPauseExplorerBackgroundWork() {
  return document.hidden
    || getPanel('explorer').classList.contains('hidden')
    || Date.now() < explorerScrollingUntil
    || Boolean(workspaceDragState?.dragging)
    || uiInputPending();
}

function explorerWatchPaths(maxPaths = EXPLORER_WATCH_MAX_DIRS) {
  const paths: string[] = [];
  const keys: string[] = [];
  appendExplorerWatchPath(paths, keys, state.currentDir);
  for (const path of state.explorerExpanded) {
    if (paths.length >= maxPaths) break;
    if (path === state.currentDir || state.explorerChildren.has(path)) appendExplorerWatchPath(paths, keys, path);
  }
  return paths;
}

function appendExplorerWatchPath(paths: string[], keys: string[], path: string) {
  if (!path) return;
  const key = explorerPathKey(path);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) return;
  }
  keys.push(key);
  paths.push(path);
}

function explorerWatchPathLimit() {
  if (document.hidden) return 1;
  if (state.activeProfile?.kind === 'ssh') return 4;
  const slowPoll = explorerWatchLastDurationMs > EXPLORER_WATCH_SLOW_THRESHOLD_MS;
  if (state.activeProfile?.kind === 'wsl') return slowPoll ? 4 : 6;
  return slowPoll ? Math.max(4, Math.floor(EXPLORER_WATCH_LOCAL_DIRS / 2)) : EXPLORER_WATCH_LOCAL_DIRS;
}

function explorerWatchInterval() {
  const base = state.activeProfile?.kind === 'ssh'
    ? EXPLORER_WATCH_SSH_MS
    : state.activeProfile?.kind === 'wsl'
      ? EXPLORER_WATCH_WSL_MS
      : EXPLORER_WATCH_LOCAL_MS;
  return explorerWatchLastDurationMs > EXPLORER_WATCH_SLOW_THRESHOLD_MS
    ? base * EXPLORER_WATCH_SLOW_BACKOFF_FACTOR
    : base;
}

function explorerWatchIdleTimeout() {
  if (state.activeProfile?.kind === 'ssh') return 2500;
  if (state.activeProfile?.kind === 'wsl') return 1800;
  return 1100;
}

function explorerDirectorySignature(entries: FileEntry[]) {
  const cached = explorerDirectorySignatureCache.get(entries);
  if (cached) return cached;
  let hash = 2166136261;
  let totalNameLength = 0;
  let totalSize = 0;
  for (const entry of entries) {
    totalNameLength += entry.name.length;
    totalSize += entry.size || 0;
    hash = hashExplorerSignatureString(hash, entry.name);
    hash = hashExplorerSignatureString(hash, entry.kind);
    hash = hashExplorerSignatureNumber(hash, entry.size);
    hash = hashExplorerSignatureNumber(hash, entry.hidden ? 1 : 0);
  }
  const signature = `${entries.length}:${totalNameLength}:${totalSize}:${(hash >>> 0).toString(36)}`;
  explorerDirectorySignatureCache.set(entries, signature);
  return signature;
}

function hashExplorerSignatureString(hash: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= 31;
  return Math.imul(hash, 16777619);
}

function hashExplorerSignatureNumber(hash: number, value: number) {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : 0;
  hash ^= normalized & 0xffff;
  hash = Math.imul(hash, 16777619);
  hash ^= (normalized >>> 16) & 0xffff;
  return Math.imul(hash, 16777619);
}

function moveExplorerChildCache(oldPath: string, newPath: string) {
  const children = state.explorerChildren.get(oldPath);
  if (children) {
    state.explorerChildren.delete(oldPath);
    state.explorerChildren.set(newPath, children);
    markExplorerEntryLookupDirty();
  }
  const signature = state.explorerSignatures.get(oldPath);
  if (signature) {
    state.explorerSignatures.delete(oldPath);
    state.explorerSignatures.set(newPath, signature);
  }
  if (state.explorerExpanded.delete(oldPath)) state.explorerExpanded.add(newPath);
}

function renameOpenReferences(oldPath: string, newPath: string) {
  for (const tab of state.editorTabs) {
    if (tab.file?.path === oldPath) renameEditorTabPath(tab, newPath);
  }
  if (state.openFile?.path === oldPath) state.openFile.path = newPath;
  for (const tab of state.imageTabs) {
    if (tab.sourcePath === oldPath) {
      setImageTabSourcePath(tab, newPath);
      tab.label = tab.label.replace(oldPath, newPath);
    }
  }
}

function normalizeExplorerName(value: string | null) {
  const name = value?.trim() ?? '';
  if (!name || name === '.' || name === '..') return '';
  if (/[\\/]/.test(name) || name.includes('\0')) {
    setStatus('Name cannot contain path separators', true);
    return '';
  }
  return name;
}

function uniqueExplorerName(baseName: string, entries: FileEntry[] = state.entries) {
  const existing = new Set<string>();
  for (const entry of entries) existing.add(entry.name.toLocaleLowerCase());
  const baseNameKey = baseName.toLocaleLowerCase();
  if (!existing.has(baseNameKey)) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} ${index}${ext}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return baseName;
}

function selectExplorerEntry(path: string, scrollIntoView = true) {
  setExplorerSelection([path], path, path, scrollIntoView);
}

function setExplorerSelection(paths: Iterable<string>, activePath = '', anchorPath = activePath, scrollIntoView = true) {
  const next = new Set<string>();
  for (const path of paths) {
    if (path) next.add(path);
  }
  if (activePath && !next.has(activePath)) next.add(activePath);
  state.explorerSelectedPaths = next;
  state.explorerSelectedPath = activePath || next.values().next().value || '';
  state.explorerSelectionAnchorPath = anchorPath || state.explorerSelectedPath;
  updateExplorerSelection(scrollIntoView, true);
}

function resetExplorerSelection() {
  state.explorerSelectedPath = '';
  state.explorerSelectedPaths = new Set();
  state.explorerSelectionAnchorPath = '';
  explorerLastSelectedPath = '';
}

function restoreExplorerSelection(selectedPath: string, selectedPaths?: Set<string>, anchorPath = selectedPath) {
  state.explorerSelectedPath = selectedPath;
  state.explorerSelectedPaths = selectedPaths ?? new Set(selectedPath ? [selectedPath] : []);
  if (selectedPath && !state.explorerSelectedPaths.has(selectedPath)) state.explorerSelectedPaths.add(selectedPath);
  state.explorerSelectionAnchorPath = anchorPath || selectedPath;
}

function explorerSelectedPathKeys() {
  const keys = new Set<string>();
  for (const path of state.explorerSelectedPaths) keys.add(explorerPathKey(path));
  if (state.explorerSelectedPath) keys.add(explorerPathKey(state.explorerSelectedPath));
  return keys;
}

function selectedExplorerEntries() {
  const entries: FileEntry[] = [];
  const seen = new Set<string>();
  const paths = state.explorerSelectedPaths.size
    ? [...state.explorerSelectedPaths]
    : state.explorerSelectedPath ? [state.explorerSelectedPath] : [];
  for (const path of paths) {
    const entry = findExplorerEntry(path);
    if (!entry) continue;
    const key = explorerPathKey(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort((left, right) => {
    const leftIndex = explorerVisibleIndexByPath.get(explorerPathKey(left.path)) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = explorerVisibleIndexByPath.get(explorerPathKey(right.path)) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
  return entries;
}

function compactRecursiveExplorerSelection(entries: FileEntry[]) {
  return entries.filter((entry) => {
    const entryKey = explorerPathKey(entry.path);
    for (const candidate of entries) {
      if (candidate === entry || candidate.kind !== 'dir') continue;
      const parentKey = explorerPathKey(candidate.path);
      if (entryKey.startsWith(`${parentKey}/`)) return false;
    }
    return true;
  });
}

function isExplorerPathSelected(path: string) {
  if (!path) return false;
  const key = explorerPathKey(path);
  for (const selected of state.explorerSelectedPaths) {
    if (explorerPathKey(selected) === key) return true;
  }
  return explorerPathKey(state.explorerSelectedPath) === key;
}

function updateExplorerSelection(scrollIntoView = true, forceFull = false) {
  if (scrollIntoView) scrollExplorerPathIntoView(state.explorerSelectedPath);
  const selectedKeys = explorerSelectedPathKeys();

  explorerRenderedRowByPath.forEach((row) => {
    const key = row.dataset.pathKey || explorerPathKey(row.dataset.path ?? '');
    const selected = selectedKeys.has(key);
    toggleClassIfChanged(row, 'selected', selected);
    setAttributeIfChanged(row, 'aria-selected', String(selected));
  });
  explorerLastSelectedPath = state.explorerSelectedPath;
}

function scrollExplorerPathIntoView(path: string) {
  if (!path) return;
  const index = explorerVisibleIndexByPath.get(explorerPathKey(path));
  if (index === undefined) return;
  const top = index * EXPLORER_ROW_HEIGHT;
  const bottom = top + EXPLORER_ROW_HEIGHT;
  const currentTop = el.fileList.scrollTop;
  const viewportHeight = Math.max(explorerViewportHeight || el.fileList.clientHeight, EXPLORER_ROW_HEIGHT * 8);
  const currentBottom = currentTop + viewportHeight;
  let nextTop = currentTop;
  if (top < currentTop) nextTop = top;
  else if (bottom > currentBottom) nextTop = bottom - viewportHeight;
  if (nextTop === currentTop) return;
  renderVirtualExplorerRows(nextTop);
}

function scheduleTextFilePrefetch(entry: FileEntry, delay = 80) {
  if (!state.activeProfile || !shouldPrefetchTextFile(entry)) return;
  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  const key = textFileCacheKey(profileId, entry.path);
  if (textFileCache.has(key) || textFileReads.has(key)) return;
  const existing = textFilePrefetchTimers.get(key);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    textFilePrefetchTimers.delete(key);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    if (getPanel('explorer').classList.contains('hidden')) return;
    if (document.hidden) return;
    const scrollPause = explorerScrollingUntil - Date.now();
    if (scrollPause > 0) {
      scheduleTextFilePrefetch(entry, scrollPause + EXPLORER_SCROLL_IDLE_MS);
      return;
    }
    runWhenUiIdle(() => {
      if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
      if (getPanel('explorer').classList.contains('hidden') || document.hidden) return;
      if (textFileCache.has(key) || textFileReads.has(key)) return;
      const idleScrollPause = explorerScrollingUntil - Date.now();
      if (idleScrollPause > 0) {
        scheduleTextFilePrefetch(entry, idleScrollPause + EXPLORER_SCROLL_IDLE_MS);
        return;
      }
      void readTextFileCached(profileId, entry.path).catch(() => undefined);
    }, 500);
  }, delay);
  textFilePrefetchTimers.set(key, timer);
}

function shouldPrefetchTextFile(entry: FileEntry) {
  if (entry.kind !== 'file') return false;
  // When file sizes are hidden, directory listings intentionally skip backend
  // metadata calls and report size as 0. Avoid speculative reads in that mode
  // so a large log or bundle is not pulled into the UI just because the cursor
  // hovered over it.
  if (!state.showFileSizes) return false;
  if (entry.size > TEXT_FILE_PREFETCH_MAX_BYTES) return false;
  if (isImagePath(entry.path)) return false;
  if (shouldMaskFile(entry.path)) return false;
  return isLikelyTextPath(entry.path);
}

function scheduleExplorerDirectoryPrefetch(entry: FileEntry, delay = EXPLORER_DIRECTORY_PREFETCH_DELAY_MS) {
  if (!state.activeProfile || entry.kind !== 'dir') return;
  if (document.hidden) return;
  if (state.explorerChildren.has(entry.path) || state.explorerLoading.has(entry.path)) return;
  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  const key = explorerDirectoryCacheKey(profileId, entry.path, workspaceId);
  if (hasCachedExplorerDirectoryKey(key) || explorerDirectoryReads.has(key)) return;
  if (explorerDirectoryPrefetchPending.has(key)) return;
  const existing = explorerDirectoryPrefetchTimers.get(key);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    explorerDirectoryPrefetchTimers.delete(key);
    runExplorerDirectoryPrefetchWhenReady(profileId, workspaceId, entry, key);
  }, delay);
  explorerDirectoryPrefetchTimers.set(key, timer);
}

function runExplorerDirectoryPrefetchWhenReady(profileId: string, workspaceId: string, entry: FileEntry, key: string) {
  if (!canStartExplorerDirectoryPrefetch(profileId, workspaceId, entry, key)) return;
  const scrollPause = explorerScrollingUntil - Date.now();
  if (scrollPause > 0) {
    scheduleExplorerDirectoryPrefetch(entry, scrollPause + EXPLORER_SCROLL_IDLE_MS);
    return;
  }
  if (explorerDirectoryPrefetchActive >= explorerDirectoryPrefetchConcurrency()) {
    scheduleExplorerDirectoryPrefetch(entry, EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + 180);
    return;
  }
  if (explorerDirectoryPrefetchPending.has(key)) return;
  explorerDirectoryPrefetchPending.add(key);
  runWhenUiIdle(() => {
    explorerDirectoryPrefetchPending.delete(key);
    if (!canStartExplorerDirectoryPrefetch(profileId, workspaceId, entry, key)) return;
    const idleScrollPause = explorerScrollingUntil - Date.now();
    if (idleScrollPause > 0) {
      scheduleExplorerDirectoryPrefetch(entry, idleScrollPause + EXPLORER_SCROLL_IDLE_MS);
      return;
    }
    if (explorerDirectoryPrefetchActive >= explorerDirectoryPrefetchConcurrency()) {
      scheduleExplorerDirectoryPrefetch(entry, EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + 180);
      return;
    }
    explorerDirectoryPrefetchActive += 1;
    void fetchExplorerDirectory(profileId, entry.path, workspaceId)
      .catch(() => undefined)
      .finally(() => {
        explorerDirectoryPrefetchActive = Math.max(0, explorerDirectoryPrefetchActive - 1);
      });
  }, 650);
}

function canStartExplorerDirectoryPrefetch(profileId: string, workspaceId: string, entry: FileEntry, key: string) {
  if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return false;
  if (document.hidden || getPanel('explorer').classList.contains('hidden')) return false;
  if (entry.kind !== 'dir') return false;
  if (state.explorerChildren.has(entry.path) || state.explorerLoading.has(entry.path)) return false;
  return !hasCachedExplorerDirectoryKey(key) && !explorerDirectoryReads.has(key);
}

function scheduleVisibleExplorerDirectoryPrefetch() {
  if (!state.activeProfile || !state.workspaceOpen || document.hidden || getPanel('explorer').classList.contains('hidden')) return;
  if (Date.now() < explorerScrollingUntil) return;
  if (explorerDirectoryPrefetchActive > 0) {
    queueVisibleExplorerDirectoryPrefetch(EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + 420);
    return;
  }
  const limit = explorerDirectoryPrefetchLimit();
  let count = 0;
  const { start, end } = explorerVisibleDirectoryPrefetchRange();
  for (let index = start; index < end; index += 1) {
    const entry = explorerVisibleRows[index]?.entry;
    if (!entry) continue;
    if (count >= limit) break;
    if (entry.kind !== 'dir' || state.explorerExpanded.has(entry.path)) continue;
    scheduleExplorerDirectoryPrefetch(entry, EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + count * 90);
    count += 1;
  }
}

function explorerVisibleDirectoryPrefetchRange() {
  const total = explorerVisibleRows.length;
  if (!total) return { start: 0, end: 0 };
  const viewportHeight = Math.max(explorerViewportHeight || el.fileList.clientHeight, EXPLORER_ROW_HEIGHT * 8);
  const viewportStart = Math.floor(el.fileList.scrollTop / EXPLORER_ROW_HEIGHT);
  const viewportEnd = Math.ceil((el.fileList.scrollTop + viewportHeight) / EXPLORER_ROW_HEIGHT);
  const start = clamp(viewportStart - EXPLORER_VISIBLE_PREFETCH_ROW_PADDING, 0, total);
  const end = clamp(viewportEnd + EXPLORER_VISIBLE_PREFETCH_ROW_PADDING, start, total);
  return { start, end };
}

function queueVisibleExplorerDirectoryPrefetch(timeout = 900) {
  if (!state.activeProfile || !state.workspaceOpen || document.hidden || getPanel('explorer').classList.contains('hidden')) return;
  const effectiveTimeout = restoringWorkspace ? Math.max(timeout, WORKSPACE_RESTORE_BACKGROUND_DELAY_MS) : timeout;
  const dueAt = Date.now() + effectiveTimeout;
  if (explorerVisiblePrefetchTimer) {
    if (dueAt >= explorerVisiblePrefetchDueAt - 50) return;
    window.clearTimeout(explorerVisiblePrefetchTimer);
  }
  const token = ++explorerVisiblePrefetchToken;
  explorerVisiblePrefetchDueAt = dueAt;
  explorerVisiblePrefetchTimer = window.setTimeout(() => {
    explorerVisiblePrefetchTimer = 0;
    explorerVisiblePrefetchDueAt = 0;
    runWhenUiIdle(() => {
      if (token === explorerVisiblePrefetchToken) scheduleVisibleExplorerDirectoryPrefetch();
    }, 700);
  }, Math.max(0, effectiveTimeout));
}

function cancelVisibleExplorerDirectoryPrefetch() {
  explorerVisiblePrefetchToken += 1;
  explorerVisiblePrefetchDueAt = 0;
  if (!explorerVisiblePrefetchTimer) return;
  window.clearTimeout(explorerVisiblePrefetchTimer);
  explorerVisiblePrefetchTimer = 0;
}

function explorerDirectoryPrefetchLimit() {
  if (state.activeProfile?.kind === 'ssh') return 2;
  if (state.activeProfile?.kind === 'wsl') return Math.min(4, EXPLORER_DIRECTORY_PREFETCH_LIMIT);
  return EXPLORER_DIRECTORY_PREFETCH_LIMIT;
}

function explorerDirectoryPrefetchConcurrency() {
  if (state.activeProfile?.kind === 'ssh') return 1;
  if (state.activeProfile?.kind === 'wsl') return 2;
  return 3;
}

function isLikelyTextPath(path: string) {
  const name = pathBasename(path, path).toLowerCase();
  if (/^(readme|license|dockerfile|makefile|gemfile|rakefile|procfile|cargo\.toml|package\.json|tsconfig\.json)$/i.test(name)) return true;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (!extension) return true;
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function selectExplorerByTypeahead(key: string) {
  const now = Date.now();
  const previous = now - state.explorerTypeaheadAt <= EXPLORER_TYPEAHEAD_TIMEOUT_MS
    ? state.explorerTypeahead
    : '';
  let query = `${previous}${key}`.toLowerCase();
  let entry = findExplorerTypeaheadMatch(query);

  if (!entry && previous) {
    query = key.toLowerCase();
    entry = findExplorerTypeaheadMatch(query);
  }

  state.explorerTypeahead = query;
  state.explorerTypeaheadAt = now;
  if (entry) selectExplorerEntry(entry.path);
}

function findExplorerTypeaheadMatch(query: string) {
  ensureExplorerTypeaheadCandidates();
  const selectedKey = state.explorerSelectedPath ? explorerPathKey(state.explorerSelectedPath) : '';
  const candidates = explorerTypeaheadCandidates;
  if (!candidates.length) return null;
  const selectedIndex = selectedKey ? explorerTypeaheadIndexByPath.get(selectedKey) ?? -1 : -1;

  const start = query.length === 1 && selectedIndex >= 0 ? selectedIndex + 1 : 0;
  let wrappedMatch: FileEntry | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.nameKey.startsWith(query)) {
      if (index >= start) return candidate.entry;
      if (!wrappedMatch) wrappedMatch = candidate.entry;
    }
  }
  return wrappedMatch;
}

function ensureExplorerTypeaheadCandidates() {
  if (!explorerTypeaheadDirty) return;
  rebuildExplorerTypeaheadCandidates();
}

function moveExplorerSelection(direction: number, extend = false) {
  if (!explorerVisibleRows.length) return;
  const selectedIndex = explorerVisibleIndexByPath.get(explorerPathKey(state.explorerSelectedPath));
  let next = selectedIndex === undefined
    ? direction > 0 ? 0 : explorerVisibleRows.length - 1
    : selectedIndex;
  for (let offset = 0; offset < explorerVisibleRows.length; offset += 1) {
    next = (next + direction + explorerVisibleRows.length) % explorerVisibleRows.length;
    const entry = explorerVisibleRows[next]?.entry;
    if (entry) {
      if (extend) selectExplorerRange(entry.path);
      else selectExplorerEntry(entry.path);
      return;
    }
  }
}

function updateExplorerFileSizeMode() {
  const signature = state.showFileSizes ? '1' : '0';
  if (explorerFileSizeModeRenderSignature === signature) return;
  explorerFileSizeModeRenderSignature = signature;
  const explorer = getPanel('explorer');
  explorer.classList.toggle('hide-file-sizes', !state.showFileSizes);
  el.fileSizeToggle.classList.toggle('active', state.showFileSizes);
  el.fileSizeToggle.setAttribute('aria-pressed', String(state.showFileSizes));
}

function updateExplorerOpenMode() {
  const signature = state.explorerOpenMode;
  if (explorerOpenModeRenderSignature === signature) return;
  explorerOpenModeRenderSignature = signature;
  const single = state.explorerOpenMode === 'single';
  el.explorerOpenModeToggle.textContent = single ? 'Open: 1x' : 'Open: 2x';
  el.explorerOpenModeToggle.title = single ? 'Single click opens items' : 'Double click opens items';
  el.explorerOpenModeToggle.classList.toggle('active', !single);
  el.explorerOpenModeToggle.setAttribute('aria-pressed', String(!single));
}

async function goToParentDirectory() {
  const parent = parentPath(state.currentDir);
  if (parent === state.currentDir) return;
  await loadDirectory(parent);
}

function pathBadge(path: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'path-badge';
  span.textContent = path;
  return span;
}

function clearEditorTabLookup() {
  editorTabById.clear();
  editorTabByPath.clear();
  editorTabIndexByIdLookup.clear();
}

function rebuildEditorTabLookup() {
  clearEditorTabLookup();
  for (let index = 0; index < state.editorTabs.length; index += 1) {
    rememberEditorTab(state.editorTabs[index], index);
  }
}

function rememberEditorTab(tab: EditorTabState, index?: number) {
  editorTabById.set(tab.id, tab);
  const path = tab.file?.path;
  if (path && !editorTabByPath.has(path)) editorTabByPath.set(path, tab);
  if (index !== undefined) editorTabIndexByIdLookup.set(tab.id, index);
}

function forgetEditorTab(tab: EditorTabState) {
  editorTabById.delete(tab.id);
  editorTabIndexByIdLookup.delete(tab.id);
  const path = tab.file?.path;
  if (!path || editorTabByPath.get(path) !== tab) return;
  editorTabByPath.delete(path);
  for (let index = 0; index < state.editorTabs.length; index += 1) {
    const candidate = state.editorTabs[index];
    if (candidate === tab || candidate.file?.path !== path) continue;
    rememberEditorTab(candidate, index);
    return;
  }
}

function editorTabForId(id: string) {
  if (!id) return null;
  let tab = editorTabById.get(id) ?? null;
  if (!tab) {
    for (let index = 0; index < state.editorTabs.length; index += 1) {
      const candidate = state.editorTabs[index];
      if (candidate.id !== id) continue;
      tab = candidate;
      rememberEditorTab(tab, index);
      break;
    }
  }
  return tab;
}

function editorTabForPath(path: string) {
  if (!path) return null;
  let tab = editorTabByPath.get(path) ?? null;
  if (!tab) {
    for (let index = 0; index < state.editorTabs.length; index += 1) {
      const candidate = state.editorTabs[index];
      if (candidate.file?.path !== path) continue;
      tab = candidate;
      rememberEditorTab(tab, index);
      break;
    }
  }
  return tab;
}

function editorTabIndexById(id: string) {
  const cachedIndex = editorTabIndexByIdLookup.get(id);
  if (cachedIndex !== undefined && state.editorTabs[cachedIndex]?.id === id) return cachedIndex;
  for (let index = 0; index < state.editorTabs.length; index += 1) {
    const tab = state.editorTabs[index];
    if (tab.id !== id) continue;
    rememberEditorTab(tab, index);
    return index;
  }
  editorTabIndexByIdLookup.delete(id);
  return -1;
}

function refreshEditorTabIndexLookup(startIndex = 0) {
  const start = clamp(startIndex, 0, state.editorTabs.length);
  for (let index = start; index < state.editorTabs.length; index += 1) {
    editorTabIndexByIdLookup.set(state.editorTabs[index].id, index);
  }
}

function setEditorTabFile(tab: EditorTabState, file: OpenFileState | null) {
  const previousPath = tab.file?.path;
  if (previousPath && editorTabByPath.get(previousPath) === tab) editorTabByPath.delete(previousPath);
  tab.file = file;
  rememberEditorTab(tab);
  if (previousPath && previousPath !== file?.path && !editorTabByPath.has(previousPath)) {
    for (const candidate of state.editorTabs) {
      if (candidate === tab || candidate.file?.path !== previousPath) continue;
      editorTabByPath.set(previousPath, candidate);
      break;
    }
  }
}

function renameEditorTabPath(tab: EditorTabState, newPath: string) {
  if (!tab.file) return;
  const previousPath = tab.file.path;
  if (previousPath && editorTabByPath.get(previousPath) === tab) editorTabByPath.delete(previousPath);
  tab.file.path = newPath;
  if (!editorTabByPath.has(newPath)) editorTabByPath.set(newPath, tab);
  if (previousPath && previousPath !== newPath && !editorTabByPath.has(previousPath)) {
    for (const candidate of state.editorTabs) {
      if (candidate === tab || candidate.file?.path !== previousPath) continue;
      editorTabByPath.set(previousPath, candidate);
      break;
    }
  }
}

function ensureEditorTab() {
  return activeEditorTab();
}

function activeEditorTab() {
  let tab = editorTabForId(state.activeEditorTabId);
  if (!tab) tab = createEditorTab(null, false);
  return tab;
}

function createEditorTab(file: OpenFileState | null, activate = true, id: string = crypto.randomUUID()) {
  const tab = { id, file };
  const index = state.editorTabs.length;
  state.editorTabs.push(tab);
  rememberEditorTab(tab, index);
  if (!state.activeEditorTabId) state.activeEditorTabId = tab.id;
  if (activate) {
    syncActiveEditorTabFromView();
    state.activeEditorTabId = tab.id;
    state.openFile = tab.file;
    renderEditorTabs();
    renderEditor();
  }
  return tab;
}

function activateEditorTab(id: string) {
  syncActiveEditorTabFromView();
  const previousActiveId = state.activeEditorTabId;
  const tab = editorTabForId(id);
  if (!tab) return;
  state.activeEditorTabId = tab.id;
  state.openFile = tab.file;
  renderEditorTabActivation(previousActiveId, tab);
  if (previousActiveId !== tab.id) renderEditor();
  void hydrateVisibleEditorTab();
  if (previousActiveId !== tab.id) saveActiveWorkspaceSnapshot();
}

function closeEditorTab(id: string) {
  syncActiveEditorTabFromView();
  const index = editorTabIndexById(id);
  if (index < 0) return;
  const closingTab = state.editorTabs[index];
  forgetEditorTab(closingTab);
  state.editorTabs.splice(index, 1);
  refreshEditorTabIndexLookup(index);
  if (!state.editorTabs.length) createEditorTab(null, false);
  if (state.activeEditorTabId === id) {
    const next = state.editorTabs[index] ?? state.editorTabs[index - 1] ?? state.editorTabs[0];
    state.activeEditorTabId = next.id;
    state.openFile = next.file;
  }
  renderEditorTabs();
  renderEditor();
  saveActiveWorkspaceSnapshot();
}

function renderEditorTabs() {
  if (!isEditorPanelVisible()) return;
  const signature = editorTabsSignature();
  if (editorTabsRenderSignature === signature) return;
  const orderSignature = editorTabsOrderSignature();
  const sameOrder = editorTabsOrderRenderSignature === orderSignature
    && el.editorTabs.childElementCount === state.editorTabs.length;
  editorTabsRenderSignature = signature;
  setCheckedIfChanged(el.editorOpenNewTab, state.editorOpenInNewTab);
  setCheckedIfChanged(el.editorWordWrap, state.editorWordWrap);

  if (sameOrder) {
    for (const tab of state.editorTabs) {
      updateEditorTabElement(editorTabElement(tab.id), tab);
    }
    return;
  }

  editorTabsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const tab of state.editorTabs) {
    seen.add(tab.id);
    const item = editorTabElement(tab.id);
    updateEditorTabElement(item, tab);
    fragment.append(item);
  }
  el.editorTabs.replaceChildren(fragment);
  pruneEditorTabElementCache(seen);
}

function renderEditorTabActivation(previousActiveId: string, activeTab: EditorTabState) {
  if (!isEditorPanelVisible()) return;
  const orderSignature = editorTabsOrderSignature();
  const previousChanged = Boolean(previousActiveId && previousActiveId !== activeTab.id);
  const previousTab = previousChanged ? editorTabForId(previousActiveId) : null;
  const previousElement = previousChanged ? connectedEditorTabElement(previousActiveId) : null;
  const activeElement = connectedEditorTabElement(activeTab.id);
  if (
    editorTabsOrderRenderSignature !== orderSignature
    || el.editorTabs.childElementCount !== state.editorTabs.length
    || !activeElement
    || (previousChanged && (!previousTab || !previousElement))
  ) {
    renderEditorTabs();
    return;
  }
  if (previousTab && previousElement) updateEditorTabElement(previousElement, previousTab);
  updateEditorTabElement(activeElement, activeTab);
  editorTabsRenderSignature = editorTabsSignature();
}

function editorTabElement(id: string) {
  const cached = editorTabElementCache.get(id);
  if (cached) return cached;
  const item = document.createElement('div');
  item.className = 'widget-tab';
  const labelButton = document.createElement('button');
  labelButton.className = 'widget-tab-label';
  labelButton.type = 'button';
  labelButton.addEventListener('click', () => {
    const id = item.dataset.editorTabId ?? '';
    if (id) activateEditorTab(id);
  });
  const closeButton = document.createElement('button');
  closeButton.className = 'widget-tab-close';
  closeButton.type = 'button';
  closeButton.title = 'Close editor tab';
  closeButton.setAttribute('aria-label', 'Close editor tab');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = item.dataset.editorTabId ?? '';
    if (id) closeEditorTab(id);
  });
  item.append(labelButton, closeButton);
  editorTabElementCache.set(id, item);
  return item;
}

function connectedEditorTabElement(id: string) {
  const item = editorTabElementCache.get(id);
  return item?.isConnected ? item : null;
}

function updateEditorTabElement(item: HTMLElement, tab: EditorTabState) {
  const active = tab.id === state.activeEditorTabId;
  const label = editorTabLabel(tab);
  const title = tab.file?.path ?? tab.pendingPath ?? 'Empty editor';
  const signature = `${tab.id}\t${active ? '1' : '0'}\t${label}\t${title}`;
  item.dataset.editorTabId = tab.id;
  if (item.dataset.renderSignature === signature) return;
  item.dataset.renderSignature = signature;
  item.className = `widget-tab${active ? ' active' : ''}`;
  if (item.title !== title) item.title = title;
  setTextContentIfChanged(editorTabLabelButton(item), label);
}

function editorTabLabelButton(item: HTMLElement) {
  return item.firstElementChild as HTMLButtonElement;
}

function pruneEditorTabElementCache(seen: Set<string>) {
  for (const id of editorTabElementCache.keys()) {
    if (!seen.has(id)) editorTabElementCache.delete(id);
  }
}

function editorTabsSignature() {
  let signature = `${state.editorOpenInNewTab ? '1' : '0'}\n${state.editorWordWrap ? '1' : '0'}`;
  for (const tab of state.editorTabs) {
    signature += `\n${tab.id}\t${tab.id === state.activeEditorTabId ? '1' : '0'}\t${editorTabLabel(tab)}\t${tab.file?.path ?? tab.pendingPath ?? ''}\t${tab.file?.rawMode ? '1' : '0'}`;
  }
  return signature;
}

function editorTabsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.editorTabs.length; index += 1) {
    if (index) signature += '\n';
    signature += state.editorTabs[index].id;
  }
  return signature;
}

function editorTabLabel(tab: EditorTabState) {
  const path = tab.file?.path ?? tab.pendingPath;
  if (!path) return 'Empty';
  const name = pathBasename(path, path);
  const suffix = tab.file?.dirty ? ' *' : tab.loading ? ' ...' : '';
  return `${name}${suffix}`;
}

function syncActiveEditorTabFromView() {
  const tab = editorTabForId(state.activeEditorTabId);
  if (!tab?.file) return;
  if (codeView && codeViewFile === tab.file && state.openFile === tab.file && !(tab.file.masked && !tab.file.rawMode)) {
    tab.file.draftContent = codeView.state.doc.toString();
    tab.file.dirty = !sameEditorContent(tab.file.draftContent, tab.file.content);
  }
}

async function openFile(path: string): Promise<boolean> {
  const profile = state.activeProfile;
  if (!profile) return false;
  const openToken = ++fileOpenToken;
  if (isImagePath(path)) {
    return await openImageFile(path);
  }

  try {
    syncActiveEditorTabFromView();
    const existing = editorTabForPath(path);
    if (existing) {
      activateEditorTab(existing.id);
      setStatus('File opened');
      // Already-open files bypass the read path below, so an external edit would otherwise
      // keep showing stale content. Refresh non-dirty plain-text tabs from disk in the
      // background (fire-and-forget keeps reopen snappy).
      void refreshOpenTabFromDisk(existing, profile.id, openToken);
      return true;
    }

    const cancelLoading = scheduleEditorLoading(path);
    warmEditorForPath(path);
    const content = await readTextFileCached(profile.id, path);
    cancelLoading();
    if (openToken !== fileOpenToken || state.activeProfile?.id !== profile.id) return false;
    const masked = shouldMaskFile(path);
    const file = {
      path,
      content,
      masked,
      rawMode: false,
      lines: masked ? parseSecretLinesCached(content, path) : [],
      dirty: false
    };
    const tab = state.editorOpenInNewTab && activeEditorTab().file
      ? createEditorTab(file, true)
      : activeEditorTab();
    setEditorTabFile(tab, file);
    state.activeEditorTabId = tab.id;
    state.openFile = file;
    renderEditorTabs();
    renderEditor();
    setPanelVisible('editor', true);
    setStatus('File opened');
    saveActiveWorkspaceSnapshot();
    return true;
  } catch (error) {
    if (openToken !== fileOpenToken) return false;
    cancelPendingEditorLoading();
    renderEditor();
    setStatus(String(error), true);
    return false;
  }
}

async function refreshOpenTabFromDisk(tab: EditorTabState, profileId: string, openToken: number) {
  const current = tab.file;
  // Only refresh plain, saved text tabs: never clobber unsaved edits, and skip masked
  // (secret) views whose dirty/content tracking differs from the raw editor.
  if (!current || current.dirty || current.masked) return;
  const path = current.path;
  let content: string;
  try {
    content = await readTextFileCached(profileId, path);
  } catch {
    return;
  }
  if (openToken !== fileOpenToken) return;
  const live = editorTabForId(tab.id);
  // Bail if the tab was closed, replaced, edited, or renamed to a different path while we read.
  if (!live || live.file !== current || current.dirty || current.path !== path) return;
  if (sameEditorContent(content, current.content)) return;
  const refreshed: OpenFileState = {
    path: current.path,
    content,
    masked: false,
    rawMode: current.rawMode,
    lines: [],
    dirty: false,
    draftContent: undefined
  };
  setEditorTabFile(live, refreshed);
  if (state.activeEditorTabId === live.id) {
    state.openFile = refreshed;
    renderEditor();
  }
}

function scheduleEditorLoading(path: string) {
  setPanelVisible('editor', true, { skipSave: true });
  if (editorLoadingTimer) window.clearTimeout(editorLoadingTimer);
  const request = ++editorLoadingRequest;
  editorLoadingTimer = window.setTimeout(() => {
    editorLoadingTimer = 0;
    if (request === editorLoadingRequest) showEditorLoading(path);
  }, EDITOR_LOADING_DELAY_MS);
  return () => {
    if (request !== editorLoadingRequest) return;
    cancelPendingEditorLoading();
  };
}

function cancelPendingEditorLoading() {
  editorLoadingRequest += 1;
  if (editorLoadingTimer) window.clearTimeout(editorLoadingTimer);
  editorLoadingTimer = 0;
}

function showEditorLoading(path: string) {
  setStatus(`Opening ${path}...`);
  el.editorLabel.textContent = path;
  el.toggleRaw.classList.add('hidden');
  el.saveFile.disabled = true;
  el.editorBody.innerHTML = '';
  el.editorBody.classList.add('empty');
  el.editorBody.textContent = 'Opening file...';
}

function textFileCacheKey(profileId: string, path: string) {
  return `${profileId}\0${path}`;
}

async function readTextFileCached(profileId: string, path: string) {
  const key = textFileCacheKey(profileId, path);
  // If a fresh read is already in flight, reuse it: it returns current disk content, so this
  // is both correct and avoids a redundant signature stat when prefetch and open race.
  const inflight = textFileReads.get(key);
  if (inflight) return inflight;

  // Validate the cache against the file's live disk signature (mtime:size) before trusting
  // it. The cache is an LRU prefetch store keyed only by path, so without this check an
  // external edit (terminal/LLM, vim, another process) would keep serving stale content.
  // Fetch the signature BEFORE reading so any change during/after the read just forces a
  // harmless re-read next time rather than caching new content under an older signature.
  let signature: string | null = null;
  try {
    signature = await api.fileSignature(profileId, path);
  } catch {
    signature = null;
  }

  const cached = textFileCache.get(key);
  if (cached && signature !== null && cached.signature === signature) {
    textFileCache.delete(key);
    textFileCache.set(key, cached);
    return cached.content;
  }

  // A read may have started while we awaited the signature; reuse it instead of duplicating.
  const pending = textFileReads.get(key);
  if (pending) return pending;

  const read = api.readTextFile(profileId, path)
    .then((content) => {
      // Only cache when we have a signature to validate against; otherwise always re-read.
      if (signature !== null) cacheTextFile(profileId, path, content, signature);
      return content;
    })
    .finally(() => {
      textFileReads.delete(key);
    });
  textFileReads.set(key, read);
  return read;
}

function cacheTextFile(profileId: string, path: string, content: string, signature: string) {
  if (content.length > TEXT_FILE_PREFETCH_MAX_BYTES) return;
  const key = textFileCacheKey(profileId, path);
  textFileCache.delete(key);
  textFileCache.set(key, { content, signature, cachedAt: Date.now() });
  while (textFileCache.size > TEXT_FILE_CACHE_LIMIT) {
    const oldest = textFileCache.keys().next().value;
    if (!oldest) break;
    textFileCache.delete(oldest);
  }
}

function invalidateTextFileCache(profileId: string, path: string) {
  const key = textFileCacheKey(profileId, path);
  textFileCache.delete(key);
  textFileReads.delete(key);
  const timer = textFilePrefetchTimers.get(key);
  if (timer) window.clearTimeout(timer);
  textFilePrefetchTimers.delete(key);
}

function parseSecretLinesCached(content: string, path: string) {
  const key = `${path}\0${content.length}\0${hashText(content)}`;
  const cached = secretParseCache.get(key);
  if (cached) {
    secretParseCache.delete(key);
    secretParseCache.set(key, cached);
    return cloneSecretLines(cached);
  }

  const lines = parseSecretLines(content, path);
  secretParseCache.set(key, cloneSecretLines(lines));
  while (secretParseCache.size > SECRET_PARSE_CACHE_LIMIT) {
    const oldest = secretParseCache.keys().next().value;
    if (!oldest) break;
    secretParseCache.delete(oldest);
  }
  return lines;
}

function cloneSecretLines(lines: SecretLine[]) {
  return lines.map((line) => ({ ...line }));
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clearImageTabLookup() {
  imageTabById.clear();
  imageTabBySourcePath.clear();
  imageTabIndexByIdLookup.clear();
}

function rebuildImageTabLookup() {
  clearImageTabLookup();
  for (let index = 0; index < state.imageTabs.length; index += 1) {
    rememberImageTab(state.imageTabs[index], index);
  }
}

function rememberImageTab(tab: ImageTabState, index?: number) {
  imageTabById.set(tab.id, tab);
  if (tab.sourcePath && !imageTabBySourcePath.has(tab.sourcePath)) imageTabBySourcePath.set(tab.sourcePath, tab);
  if (index !== undefined) imageTabIndexByIdLookup.set(tab.id, index);
}

function forgetImageTab(tab: ImageTabState) {
  imageTabById.delete(tab.id);
  imageTabIndexByIdLookup.delete(tab.id);
  const path = tab.sourcePath;
  if (!path || imageTabBySourcePath.get(path) !== tab) return;
  imageTabBySourcePath.delete(path);
  for (let index = 0; index < state.imageTabs.length; index += 1) {
    const candidate = state.imageTabs[index];
    if (candidate === tab || candidate.sourcePath !== path) continue;
    rememberImageTab(candidate, index);
    return;
  }
}

function imageTabForId(id: string) {
  if (!id) return null;
  let tab = imageTabById.get(id) ?? null;
  if (!tab) {
    for (let index = 0; index < state.imageTabs.length; index += 1) {
      const candidate = state.imageTabs[index];
      if (candidate.id !== id) continue;
      tab = candidate;
      rememberImageTab(tab, index);
      break;
    }
  }
  return tab;
}

function imageTabForSourcePath(path: string) {
  if (!path) return null;
  let tab = imageTabBySourcePath.get(path) ?? null;
  if (!tab) {
    for (let index = 0; index < state.imageTabs.length; index += 1) {
      const candidate = state.imageTabs[index];
      if (candidate.sourcePath !== path) continue;
      tab = candidate;
      rememberImageTab(tab, index);
      break;
    }
  }
  return tab;
}

function imageTabIndexById(id: string) {
  const cachedIndex = imageTabIndexByIdLookup.get(id);
  if (cachedIndex !== undefined && state.imageTabs[cachedIndex]?.id === id) return cachedIndex;
  for (let index = 0; index < state.imageTabs.length; index += 1) {
    const tab = state.imageTabs[index];
    if (tab.id !== id) continue;
    rememberImageTab(tab, index);
    return index;
  }
  imageTabIndexByIdLookup.delete(id);
  return -1;
}

function refreshImageTabIndexLookup(startIndex = 0) {
  const start = clamp(startIndex, 0, state.imageTabs.length);
  for (let index = start; index < state.imageTabs.length; index += 1) {
    imageTabIndexByIdLookup.set(state.imageTabs[index].id, index);
  }
}

function setImageTabSourcePath(tab: ImageTabState, sourcePath: string | undefined) {
  const previousPath = tab.sourcePath;
  if (previousPath && imageTabBySourcePath.get(previousPath) === tab) imageTabBySourcePath.delete(previousPath);
  tab.sourcePath = sourcePath;
  rememberImageTab(tab);
  if (previousPath && previousPath !== sourcePath && !imageTabBySourcePath.has(previousPath)) {
    for (const candidate of state.imageTabs) {
      if (candidate === tab || candidate.sourcePath !== previousPath) continue;
      imageTabBySourcePath.set(previousPath, candidate);
      break;
    }
  }
}

function ensureImageTab() {
  return activeImageTab();
}

function activeImageTab() {
  let tab = imageTabForId(state.activeImageTabId);
  if (!tab) tab = createImageTab(undefined, false);
  return tab;
}

function createImageTab(seed?: Partial<ImageTabState>, activate = true, id: string = crypto.randomUUID()) {
  syncActiveImageTabFromState();
  const tab: ImageTabState = {
    id,
    sourcePath: seed?.sourcePath,
    dataUrl: seed?.dataUrl ?? '',
    label: seed?.label ?? 'No image selected',
    history: seed?.history ?? [],
    historyVisible: seed?.historyVisible ?? false,
    zoom: normalizedImageZoom(seed?.zoom),
    offsetX: finiteNumber(seed?.offsetX, 0),
    offsetY: finiteNumber(seed?.offsetY, 0)
  };
  const index = state.imageTabs.length;
  state.imageTabs.push(tab);
  rememberImageTab(tab, index);
  if (!state.activeImageTabId) state.activeImageTabId = tab.id;
  if (activate) {
    state.activeImageTabId = tab.id;
    syncImageStateFromActiveTab();
    renderImageTabs();
    renderImagePreview();
    renderImageHistory();
    saveActiveWorkspaceSnapshot();
  }
  return tab;
}

function activateImageTab(id: string) {
  syncActiveImageTabFromState();
  const previousActiveId = state.activeImageTabId;
  const tab = imageTabForId(id);
  if (!tab) return;
  state.activeImageTabId = tab.id;
  syncImageStateFromActiveTab();
  renderImageTabActivation(previousActiveId, tab);
  if (previousActiveId !== tab.id) {
    renderImagePreview();
    renderImageHistory();
    saveActiveWorkspaceSnapshot();
  }
}

function closeImageTab(id: string) {
  syncActiveImageTabFromState();
  const index = imageTabIndexById(id);
  if (index < 0) return;
  const closingTab = state.imageTabs[index];
  forgetImageTab(closingTab);
  state.imageTabs.splice(index, 1);
  refreshImageTabIndexLookup(index);
  if (!state.imageTabs.length) createImageTab(undefined, false);
  if (state.activeImageTabId === id) {
    const next = state.imageTabs[index] ?? state.imageTabs[index - 1] ?? state.imageTabs[0];
    state.activeImageTabId = next.id;
  }
  syncImageStateFromActiveTab();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
  saveActiveWorkspaceSnapshot();
}

function renderImageTabs() {
  if (getPanel('image').classList.contains('hidden')) return;
  const signature = imageTabsSignature();
  if (imageTabsRenderSignature === signature) return;
  const orderSignature = imageTabsOrderSignature();
  const sameOrder = imageTabsOrderRenderSignature === orderSignature
    && el.imageTabs.childElementCount === state.imageTabs.length;
  imageTabsRenderSignature = signature;
  setCheckedIfChanged(el.imageOpenNewTab, state.imageOpenInNewTab);

  if (sameOrder) {
    for (const tab of state.imageTabs) {
      updateImageTabElement(imageTabElement(tab.id), tab);
    }
    return;
  }

  imageTabsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const tab of state.imageTabs) {
    seen.add(tab.id);
    const item = imageTabElement(tab.id);
    updateImageTabElement(item, tab);
    fragment.append(item);
  }
  el.imageTabs.replaceChildren(fragment);
  pruneImageTabElementCache(seen);
}

function renderImageTabActivation(previousActiveId: string, activeTab: ImageTabState) {
  if (getPanel('image').classList.contains('hidden')) return;
  const orderSignature = imageTabsOrderSignature();
  const previousChanged = Boolean(previousActiveId && previousActiveId !== activeTab.id);
  const previousTab = previousChanged ? imageTabForId(previousActiveId) : null;
  const previousElement = previousChanged ? connectedImageTabElement(previousActiveId) : null;
  const activeElement = connectedImageTabElement(activeTab.id);
  if (
    imageTabsOrderRenderSignature !== orderSignature
    || el.imageTabs.childElementCount !== state.imageTabs.length
    || !activeElement
    || (previousChanged && (!previousTab || !previousElement))
  ) {
    renderImageTabs();
    return;
  }
  if (previousTab && previousElement) updateImageTabElement(previousElement, previousTab);
  updateImageTabElement(activeElement, activeTab);
  imageTabsRenderSignature = imageTabsSignature();
}

function imageTabElement(id: string) {
  const cached = imageTabElementCache.get(id);
  if (cached) return cached;
  const item = document.createElement('div');
  item.className = 'widget-tab';
  const labelButton = document.createElement('button');
  labelButton.className = 'widget-tab-label';
  labelButton.type = 'button';
  labelButton.addEventListener('click', () => {
    const id = item.dataset.imageTabId ?? '';
    if (id) activateImageTab(id);
  });
  const closeButton = document.createElement('button');
  closeButton.className = 'widget-tab-close';
  closeButton.type = 'button';
  closeButton.title = 'Close image tab';
  closeButton.setAttribute('aria-label', 'Close image tab');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = item.dataset.imageTabId ?? '';
    if (id) closeImageTab(id);
  });
  item.append(labelButton, closeButton);
  imageTabElementCache.set(id, item);
  return item;
}

function connectedImageTabElement(id: string) {
  const item = imageTabElementCache.get(id);
  return item?.isConnected ? item : null;
}

function updateImageTabElement(item: HTMLElement, tab: ImageTabState) {
  const active = tab.id === state.activeImageTabId;
  const label = imageTabLabel(tab);
  const title = tab.sourcePath ?? tab.label;
  const signature = `${tab.id}\t${active ? '1' : '0'}\t${label}\t${title}\t${tab.dataUrl ? '1' : '0'}`;
  item.dataset.imageTabId = tab.id;
  if (item.dataset.renderSignature === signature) return;
  item.dataset.renderSignature = signature;
  item.className = `widget-tab${active ? ' active' : ''}`;
  if (item.title !== title) item.title = title;
  setTextContentIfChanged(imageTabLabelButton(item), label);
}

function imageTabLabelButton(item: HTMLElement) {
  return item.firstElementChild as HTMLButtonElement;
}

function pruneImageTabElementCache(seen: Set<string>) {
  for (const id of imageTabElementCache.keys()) {
    if (!seen.has(id)) imageTabElementCache.delete(id);
  }
}

function imageTabsSignature() {
  let signature = state.imageOpenInNewTab ? '1' : '0';
  for (const tab of state.imageTabs) {
    signature += `\n${tab.id}\t${tab.id === state.activeImageTabId ? '1' : '0'}\t${imageTabLabel(tab)}\t${tab.sourcePath ?? ''}\t${tab.dataUrl ? '1' : '0'}`;
  }
  return signature;
}

function imageTabsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.imageTabs.length; index += 1) {
    if (index) signature += '\n';
    signature += state.imageTabs[index].id;
  }
  return signature;
}

function imageTabLabel(tab: ImageTabState) {
  if (tab.sourcePath) return pathBasename(tab.sourcePath, tab.sourcePath);
  if (tab.dataUrl) return 'Pasted image';
  return 'Empty';
}

function syncImageStateFromActiveTab() {
  const tab = activeImageTab();
  state.imagePreviewDataUrl = tab.dataUrl;
  state.imagePreviewLabel = tab.label;
  state.imageHistory = tab.history;
  state.imageHistoryVisible = tab.historyVisible;
  state.imagePreviewZoom = normalizedImageZoom(tab.zoom);
  state.imagePreviewOffsetX = tab.offsetX;
  state.imagePreviewOffsetY = tab.offsetY;
}

function syncActiveImageTabFromState() {
  const tab = imageTabForId(state.activeImageTabId);
  if (!tab) return;
  tab.dataUrl = state.imagePreviewDataUrl;
  tab.label = state.imagePreviewLabel;
  tab.history = state.imageHistory;
  tab.historyVisible = state.imageHistoryVisible;
  tab.zoom = normalizedImageZoom(state.imagePreviewZoom);
  tab.offsetX = state.imagePreviewOffsetX;
  tab.offsetY = state.imagePreviewOffsetY;
}

async function openImageFile(path: string): Promise<boolean> {
  if (!state.activeProfile) return false;
  setStatus(`Opening image ${path}...`);
  try {
    const existing = imageTabForSourcePath(path);
    if (existing) {
      activateImageTab(existing.id);
      setPanelVisible('image', true);
      setStatus('Image opened');
      return true;
    }

    const dataUrl = await api.readFileDataUrl(state.activeProfile.id, path);
    const tab = state.imageOpenInNewTab && activeImageTab().dataUrl
      ? createImageTab(undefined, true)
      : activeImageTab();
    setImageTabSourcePath(tab, path);
    tab.dataUrl = dataUrl;
    tab.label = `Image selected: ${path}`;
    resetImageTabView(tab);
    state.activeImageTabId = tab.id;
    syncImageStateFromActiveTab();
    renderImageTabs();
    renderImagePreview();
    setPanelVisible('image', true);
    setStatus('Image opened');
    saveActiveWorkspaceSnapshot();
    return true;
  } catch (error) {
    setStatus(String(error), true);
    return false;
  }
}

function renderEditor() {
  if (codeView) syncActiveEditorTabFromView();
  const activeTab = activeEditorTab();
  state.openFile = activeTab.file;
  const file = state.openFile;
  el.editorBody.classList.remove('empty');
  el.toggleRaw.classList.toggle('hidden', !file?.masked);
  el.saveFile.disabled = !file;

  if (!file) {
    editorRenderToken += 1;
    destroyCodeEditorView();
    el.editorBody.innerHTML = '';
    el.editorLabel.textContent = activeTab.pendingPath ?? 'Editor';
    el.editorBody.textContent = activeTab.pendingPath ? 'Opening file...' : 'Open a file from Explorer.';
    el.editorBody.classList.add('empty');
    renderEditorTabs();
    return;
  }

  el.editorLabel.textContent = `${file.masked ? '🔒 ' : ''}${file.path}${file.dirty ? ' *' : ''}`;
  el.toggleRaw.textContent = file.rawMode ? 'Secure form' : 'Raw reveal';
  renderEditorTabs();

  if (file.masked && !file.rawMode) {
    editorRenderToken += 1;
    destroyCodeEditorView();
    el.editorBody.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'secure-form';
    const banner = document.createElement('div');
    banner.className = 'secure-banner';
    banner.textContent = 'Private file: values are hidden by default. Use each eye button to reveal only that item.';
    form.append(banner);
    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index];
      if (line.kind === 'kv') {
        appendSecureKeyRow(form, line);
      } else {
        const start = index;
        while (index + 1 < file.lines.length && file.lines[index + 1].kind === 'raw') index += 1;
        appendSecureRawBlock(form, file, start, index + 1);
      }
    }
    appendSecureAddKeyForm(form, file);
    el.editorBody.append(form);
    return;
  }

  const viewSignature = editorCodeViewSignature(file);
  if (
    codeView
    && codeViewFile === file
    && codeViewRenderSignature === viewSignature
    && el.editorBody.querySelector('.code-mount')
  ) {
    requestCodeEditorMeasure();
    return;
  }

  const renderToken = ++editorRenderToken;
  destroyCodeEditorView();
  el.editorBody.innerHTML = '';
  const mount = document.createElement('div');
  mount.className = 'code-mount';
  el.editorBody.append(mount);
  void mountCodeEditor(file, mount, renderToken, viewSignature);
}

function editorCodeViewSignature(file: OpenFileState) {
  return `${file.path}\t${file.masked ? '1' : '0'}\t${file.rawMode ? '1' : '0'}\t${state.editorWordWrap ? '1' : '0'}`;
}

function appendSecureKeyRow(form: HTMLElement, line: SecretLine) {
  const row = document.createElement('div');
  row.className = 'secure-row';
  const key = document.createElement('code');
  key.textContent = line.prefix ?? '';
  const input = document.createElement('input');
  input.type = line.reveal ? 'text' : 'password';
  input.value = line.value ?? '';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    line.value = input.value;
    markDirty();
  });
  const reveal = document.createElement('button');
  reveal.textContent = line.reveal ? 'Hide' : 'Show';
  reveal.title = line.reveal ? 'Hide value' : 'Reveal value';
  reveal.addEventListener('click', () => {
    line.reveal = !line.reveal;
    input.type = line.reveal ? 'text' : 'password';
    reveal.textContent = line.reveal ? 'Hide' : 'Show';
    reveal.title = line.reveal ? 'Hide value' : 'Reveal value';
  });
  row.append(key, input, reveal);
  form.append(row);
}

function appendSecureRawBlock(form: HTMLElement, file: OpenFileState, start: number, end: number) {
  const firstId = file.lines[start]?.id ?? crypto.randomUUID();
  const raw = document.createElement('textarea');
  raw.className = 'secure-raw-block';
  raw.spellcheck = false;
  raw.value = file.lines.slice(start, end).map((line) => line.original).join('\n');
  raw.rows = Math.max(1, Math.min(10, end - start));

  const syncLines = () => {
    const currentStart = file.lines.findIndex((line) => line.id === firstId);
    if (currentStart < 0) return;
    let currentLength = 0;
    while (file.lines[currentStart + currentLength]?.kind === 'raw') currentLength += 1;
    const existing = file.lines.slice(currentStart, currentStart + currentLength);
    const nextLines = raw.value.split('\n').map((original, index): SecretLine => ({
      id: existing[index]?.id ?? crypto.randomUUID(),
      kind: 'raw',
      original
    }));
    file.lines.splice(currentStart, currentLength, ...nextLines);
    markDirty();
  };

  raw.addEventListener('input', () => {
    syncLines();
    resizeSecureRawBlock(raw);
  });
  requestAnimationFrame(() => resizeSecureRawBlock(raw));
  form.append(raw);
}

function resizeSecureRawBlock(raw: HTMLTextAreaElement) {
  raw.style.height = 'auto';
  raw.style.height = `${Math.max(24, raw.scrollHeight)}px`;
}

function appendSecureAddKeyForm(form: HTMLElement, file: OpenFileState) {
  const add = document.createElement('form');
  add.className = 'secure-add-row';

  const keyInput = document.createElement('input');
  keyInput.className = 'secure-add-key';
  keyInput.placeholder = 'NEW_KEY';
  keyInput.spellcheck = false;
  keyInput.autocomplete = 'off';

  const valueInput = document.createElement('input');
  valueInput.className = 'secure-add-value';
  valueInput.type = 'password';
  valueInput.placeholder = 'value';
  valueInput.spellcheck = false;
  valueInput.autocomplete = 'new-password';

  const addButton = document.createElement('button');
  addButton.type = 'submit';
  addButton.textContent = 'Add key';

  add.append(keyInput, valueInput, addButton);
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = normalizeEnvKey(keyInput.value);
    if (!key) {
      setStatus('Use a valid env key name', true);
      keyInput.focus();
      return;
    }
    if (secureKeyExists(file, key)) {
      setStatus(`Key already exists: ${key}`, true);
      keyInput.focus();
      keyInput.select();
      return;
    }

    insertSecureKey(file, key, valueInput.value);
    markDirty();
    setStatus(`Added ${key}`);
    renderEditor();
  });

  form.append(add);
}

function normalizeEnvKey(value: string) {
  const key = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return '';
  return key;
}

function secureKeyExists(file: OpenFileState, key: string) {
  return file.lines.some((line) => line.kind === 'kv' && line.key?.toLocaleLowerCase() === key.toLocaleLowerCase());
}

function insertSecureKey(file: OpenFileState, key: string, value: string) {
  const line: SecretLine = {
    id: crypto.randomUUID(),
    kind: 'kv',
    original: `${key}=`,
    prefix: `${key}=`,
    key,
    value,
    reveal: false
  };
  const trailingEmpty = file.lines.length - 1;
  if (trailingEmpty >= 0) {
    const last = file.lines[trailingEmpty];
    if (last.kind === 'raw' && last.original === '') {
      file.lines.splice(trailingEmpty, 0, line);
      return;
    }
  }
  file.lines.push(line);
}

async function mountCodeEditor(file: OpenFileState, mount: HTMLElement, renderToken: number, viewSignature: string) {
  const runtime = await ensureEditorRuntime();
  if (renderToken !== editorRenderToken || state.openFile !== file) return;

  codeView = new runtime.EditorView({
    state: runtime.EditorState.create({
      doc: editorDocumentText(file),
      extensions: editorExtensions(file.path, runtime)
    }),
    parent: mount
  });
  codeViewFile = file;
  codeViewRenderSignature = viewSignature;
  void hydrateEditorLanguage(file.path, renderToken, runtime);
}

function editorDocumentText(file: OpenFileState) {
  if (file.masked && !file.rawMode) return serializeSecretLines(file.lines);
  return file.draftContent ?? file.content;
}

function editorExtensions(path: string, runtime: EditorRuntime): Extension[] {
  return [
    runtime.lineNumbers(),
    runtime.highlightActiveLine(),
    runtime.highlightSelectionMatches(),
    ...(state.editorWordWrap ? [runtime.EditorView.lineWrapping] : []),
    editorCodeMirrorTheme(runtime),
    runtime.syntaxHighlighting(editorHighlightStyle(runtime)),
    runtime.history(),
    runtime.keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { void saveOpenFile(); return true; } },
      runtime.indentWithTab,
      ...runtime.historyKeymap,
      ...runtime.defaultKeymap,
      ...runtime.searchKeymap
    ]),
    runtime.languageCompartment.of([]),
    runtime.EditorView.updateListener.of((update) => {
      if (update.docChanged && state.openFile) {
        markOpenFileDirtyFromEditorEdit();
      }
    })
  ];
}

function editorCodeMirrorTheme(runtime: EditorRuntime): Extension {
  return runtime.EditorView.theme({
    '&': {
      backgroundColor: 'var(--cm-bg)',
      color: 'var(--cm-text)'
    },
    '.cm-content': {
      caretColor: 'var(--cm-caret)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--mono-font)',
      fontSize: 'var(--editor-font-size)'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--cm-gutter-bg)',
      borderRightColor: 'var(--cm-border)',
      color: 'var(--cm-gutter-text)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--cm-active-gutter-bg)',
      color: 'var(--cm-active-gutter-text)'
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--cm-active-line)'
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--cm-caret)',
      borderLeftWidth: '2px'
    },
    '&.cm-focused': {
      outline: '1px solid var(--cm-focus)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--cm-selection)'
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(255, 209, 102, 0.22)',
      outline: '1px solid rgba(255, 209, 102, 0.48)'
    }
  }, { dark: true });
}

function editorHighlightStyle(runtime: EditorRuntime) {
  const tags = runtime.tags;
  return runtime.HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
    { tag: tags.docComment, color: 'var(--cm-comment)', fontStyle: 'italic' },
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier, tags.self], color: 'var(--cm-keyword)' },
    { tag: [tags.atom, tags.bool, tags.null, tags.unit, tags.constant(tags.variableName), tags.constant(tags.name)], color: 'var(--cm-constant)' },
    { tag: [tags.string, tags.docString, tags.character, tags.attributeValue], color: 'var(--cm-string)' },
    { tag: [tags.regexp, tags.special(tags.string)], color: 'var(--cm-regexp)' },
    { tag: [tags.escape, tags.color, tags.url], color: 'var(--cm-escape)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--cm-number)' },
    { tag: [tags.variableName, tags.name, tags.labelName], color: 'var(--cm-variable)' },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--cm-definition)' },
    { tag: [tags.className, tags.definition(tags.typeName), tags.definition(tags.className)], color: 'var(--cm-type)' },
    { tag: [tags.typeName, tags.namespace, tags.macroName], color: 'var(--cm-type)' },
    { tag: [tags.propertyName, tags.attributeName, tags.tagName], color: 'var(--cm-property)' },
    { tag: [tags.operator, tags.operatorKeyword, tags.arithmeticOperator, tags.logicOperator, tags.compareOperator, tags.definitionOperator, tags.derefOperator, tags.typeOperator], color: 'var(--cm-operator)' },
    { tag: [tags.meta, tags.documentMeta, tags.annotation, tags.processingInstruction], color: 'var(--cm-meta)' },
    { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: 'var(--cm-heading)', fontWeight: '700' },
    { tag: tags.link, color: 'var(--cm-link)', textDecoration: 'underline' },
    { tag: tags.monospace, color: 'var(--cm-string)' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.inserted, color: 'var(--cm-inserted)' },
    { tag: tags.deleted, color: 'var(--cm-deleted)' },
    { tag: [tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren, tags.brace], color: 'var(--cm-punctuation)' },
    { tag: tags.invalid, color: 'var(--cm-invalid)', textDecoration: 'underline wavy var(--cm-invalid)' }
  ], { themeType: 'dark' });
}

async function ensureEditorRuntime() {
  editorRuntimePromise ??= Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    import('@codemirror/language'),
    import('@lezer/highlight')
  ]).then(([stateModule, viewModule, commandsModule, searchModule, languageModule, highlightModule]) => ({
    EditorState: stateModule.EditorState,
    EditorView: viewModule.EditorView,
    lineNumbers: viewModule.lineNumbers,
    highlightActiveLine: viewModule.highlightActiveLine,
    keymap: viewModule.keymap,
    defaultKeymap: commandsModule.defaultKeymap,
    history: commandsModule.history,
    historyKeymap: commandsModule.historyKeymap,
    indentWithTab: commandsModule.indentWithTab,
    highlightSelectionMatches: searchModule.highlightSelectionMatches,
    searchKeymap: searchModule.searchKeymap,
    syntaxHighlighting: languageModule.syntaxHighlighting,
    defaultHighlightStyle: languageModule.defaultHighlightStyle,
    HighlightStyle: languageModule.HighlightStyle,
    tags: highlightModule.tags,
    languageCompartment: new stateModule.Compartment()
  }));
  return editorRuntimePromise;
}

function scheduleEditorRuntimeWarmup() {
  const warm = () => {
    void ensureEditorRuntime().catch(() => undefined);
  };
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(warm, { timeout: 1500 });
  else window.setTimeout(warm, 350);
}

function ensureTerminalRuntime() {
  terminalRuntimePromise ??= Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-unicode11')
  ]).then(([terminalModule, fitModule, unicodeModule]) => ({
    Terminal: terminalModule.Terminal,
    FitAddon: fitModule.FitAddon,
    Unicode11Addon: unicodeModule.Unicode11Addon
  }));
  return terminalRuntimePromise;
}

function scheduleTerminalRuntimeWarmup() {
  runWhenUiIdle(() => {
    void ensureTerminalRuntime().catch(() => undefined);
  }, 1400);
}

function warmEditorForPath(path: string) {
  void ensureEditorRuntime()
    .then(() => languageFor(path))
    .catch(() => undefined);
}

async function hydrateEditorLanguage(path: string, renderToken: number, runtime: EditorRuntime) {
  const language = await languageFor(path);
  if (renderToken !== editorRenderToken || !codeView) return;
  codeView.dispatch({
    effects: runtime.languageCompartment.reconfigure(language)
  });
}

async function languageFor(path: string): Promise<Extension> {
  const key = editorLanguageKey(path);
  if (!key) return [];
  const cached = editorLanguageCache.get(key);
  if (cached) return cached;
  const load = loadEditorLanguage(key);
  editorLanguageCache.set(key, load);
  return load;
}

function editorLanguageKey(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  return '';
}

async function loadEditorLanguage(key: string): Promise<Extension> {
  if (key === 'ts' || key === 'tsx') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ typescript: true, jsx: key === 'tsx' });
  }
  if (key === 'js' || key === 'jsx') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: key === 'jsx' });
  }
  if (key === 'json') {
    const { json } = await import('@codemirror/lang-json');
    return json();
  }
  if (key === 'css') {
    const { css } = await import('@codemirror/lang-css');
    return css();
  }
  if (key === 'html') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  if (key === 'markdown') {
    const { markdown } = await import('@codemirror/lang-markdown');
    return markdown();
  }
  if (key === 'python') {
    const { python } = await import('@codemirror/lang-python');
    return python();
  }
  if (key === 'rust') {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  }
  if (key === 'yaml') {
    const { yaml } = await import('@codemirror/lang-yaml');
    return yaml();
  }
  return [];
}

function markDirty() {
  if (!state.openFile) return;
  const current = state.openFile.masked && !state.openFile.rawMode
    ? serializeSecretLines(state.openFile.lines)
    : codeView?.state.doc.toString() ?? state.openFile.draftContent ?? state.openFile.content;
  setEditorDirtyFromContent(current);
}

function markOpenFileDirtyFromEditorEdit() {
  const file = state.openFile;
  if (!file) return;
  file.dirty = true;
  file.draftContent = undefined;
  updateEditorLabel();
  renderEditorTabs();
  el.saveFile.disabled = false;
}

function setEditorDirtyFromContent(currentContent: string) {
  if (!state.openFile) return;
  state.openFile.dirty = !sameEditorContent(currentContent, state.openFile.content);
  updateEditorLabel();
  renderEditorTabs();
  el.saveFile.disabled = false;
}

function sameEditorContent(left: string, right: string) {
  if (left === right) return true;
  if (!left.includes('\r') && !right.includes('\r')) return false;
  return normalizeEditorContent(left) === normalizeEditorContent(right);
}

function normalizeEditorContent(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

function updateEditorLabel() {
  const file = state.openFile;
  if (!file) {
    setTextContentIfChanged(el.editorLabel, 'Editor');
    return;
  }
  setTextContentIfChanged(el.editorLabel, `${file.masked ? '🔒 ' : ''}${file.path}${file.dirty ? ' *' : ''}`);
}

async function saveOpenFile() {
  const file = state.openFile;
  const profile = state.activeProfile;
  if (!file || !profile) return;
  const content = file.masked && !file.rawMode
    ? serializeSecretLines(file.lines)
    : codeView?.state.doc.toString() ?? file.draftContent ?? file.content;
  try {
    await api.writeTextFile(profile.id, file.path, content);
    // Drop any cached copy so a later reopen re-reads from disk (picks up this save and any
    // external edit that may have raced it) instead of serving a stale signature match.
    invalidateTextFileCache(profile.id, file.path);
    invalidateExplorerParentDirectoryCache(profile.id, file.path);
    file.content = content;
    file.draftContent = undefined;
    file.lines = file.masked ? parseSecretLinesCached(content, file.path) : [];
    file.dirty = false;
    setStatus('Saved');
    renderEditor();
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function toggleRawMode() {
  if (!state.openFile?.masked) return;
  if (!state.openFile.rawMode) {
    state.openFile.draftContent = serializeSecretLines(state.openFile.lines);
  } else if (codeView) {
    state.openFile.draftContent = codeView.state.doc.toString();
    state.openFile.lines = parseSecretLinesCached(state.openFile.draftContent, state.openFile.path);
    state.openFile.dirty = !sameEditorContent(state.openFile.draftContent, state.openFile.content);
  }
  state.openFile.rawMode = !state.openFile.rawMode;
  renderEditor();
}

async function createTerminal(
  command: string | null,
  title: string,
  options: CreateTerminalOptions = {}
): Promise<TerminalWidget | null> {
  const terminalProfile = options.profile ?? state.activeProfile;
  if (!terminalProfile) return null;
  const terminalCwd = options.cwd ?? workspaceShellCwd();
  const widget = createTerminalWidget(title, terminalCwd, options);
  await createTerminalTab(widget, command, title, {
    ...options,
    profile: terminalProfile,
    cwd: terminalCwd
  });
  return widget;
}

function createTerminalWidget(title: string, cwd: string, options: CreateTerminalOptions = {}) {
  const widgetId = crypto.randomUUID();
  const workspaceId = state.activeWorkspaceId || 'workspace';
  const card = document.createElement('section');
  card.className = 'terminal-card panel';
  card.dataset.widgetId = widgetId;

  const titlebar = document.createElement('div');
  titlebar.className = 'terminal-title panel-drag-handle';
  const focusDot = document.createElement('button');
  focusDot.className = 'focus-dot';
  focusDot.type = 'button';
  focusDot.title = 'Active prompt target';
  const titleEl = document.createElement('strong');
  titleEl.className = 'terminal-widget-title';
  titleEl.textContent = title;
  const cwdEl = document.createElement('span');
  cwdEl.className = 'muted terminal-widget-cwd';
  cwdEl.textContent = cwd;
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const closeButton = document.createElement('button');
  closeButton.className = 'close-pane';
  closeButton.type = 'button';
  closeButton.title = 'Close shell widget';
  closeButton.setAttribute('aria-label', 'Close shell widget');
  closeButton.textContent = 'x';
  titlebar.append(focusDot, titleEl, cwdEl, spacer, closeButton);

  const tabbar = document.createElement('div');
  tabbar.className = 'terminal-widget-tabbar';
  const tabList = document.createElement('div');
  tabList.className = 'terminal-tab-list widget-tabs';
  const newTabButton = document.createElement('button');
  newTabButton.className = 'terminal-new-tab tab-add';
  newTabButton.type = 'button';
  newTabButton.title = 'New tab in this shell';
  newTabButton.setAttribute('aria-label', 'New tab in this shell');
  newTabButton.textContent = '+';
  tabbar.append(tabList, newTabButton);

  const hostStack = document.createElement('div');
  hostStack.className = 'terminal-host-stack';
  card.append(titlebar, tabbar, hostStack);
  el.mainGrid.append(card);
  const grips = ensureResizeGrips(card, 'terminal');
  if (options.rect) applyLayoutRatio(card, options.rect);
  else placeTerminalCard(card, options);

  const widget: TerminalWidget = {
    widgetId,
    workspaceId,
    element: card,
    title: titleEl,
    cwd: cwdEl,
    tabList,
    hostStack,
    activePaneId: ''
  };
  state.terminalWidgets.push(widget);
  terminalWidgetById.set(widget.widgetId, widget);
  terminalWidgetByElement.set(widget.element, widget);
  if (workspaceId === state.activeWorkspaceId) visibleTerminalWorkspaceId = workspaceId;

  card.addEventListener('pointerdown', () => {
    const pane = activePaneForWidget(widget);
    if (pane) setActivePane(pane.paneId);
    bringPanelToFront(card);
  });
  titlebar.addEventListener('pointerdown', (event) => startPanelDrag(event, card));
  grips.forEach((grip) => {
    grip.addEventListener('pointerdown', (event) => {
      startPanelResize(event, card, grip);
      scheduleFitTerminalWidget(widget);
    });
  });
  closeButton.addEventListener('click', () => void closeTerminalWidget(widget.widgetId));
  newTabButton.addEventListener('click', (event) => {
    event.stopPropagation();
    void createShellTabInWidget(widget);
  });

  return widget;
}

async function createTerminalTab(
  widget: TerminalWidget,
  command: string | null,
  title: string,
  options: CreateTerminalOptions = {}
) {
  const terminalProfile = options.profile ?? profileForTerminalWidget(widget) ?? state.activeProfile;
  if (!terminalProfile) return null;
  const terminalCwd = options.cwd ?? activePaneForWidget(widget)?.cwd ?? workspaceShellCwd();
  const paneId = crypto.randomUUID();
  const host = document.createElement('div');
  host.className = 'terminal-host hidden';
  host.dataset.paneId = paneId;
  widget.hostStack.append(host);
  const runtime = await ensureTerminalRuntime();

  const term = new runtime.Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    convertEol: true,
    fontFamily: fontChoice(MONO_FONT_CHOICES, state.ideSettings.monoFont).stack,
    fontSize: terminalFontSize,
    theme: { background: '#080b10', foreground: '#d8e0ea' }
  });
  const fit = new runtime.FitAddon();
  const unicode11 = new runtime.Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = '11';
  term.loadAddon(fit);
  term.open(host);

  const pane: TerminalPane = {
    paneId,
    widgetId: widget.widgetId,
    workspaceId: widget.workspaceId,
    title,
    command,
    profileId: terminalProfile.id,
    cwd: terminalCwd,
    term,
    fit,
    element: widget.element,
    host,
    outputBuffer: '',
    writeBuffer: '',
    backendOutputChars: 0,
    cwdOutputBuffer: '',
    inputBuffer: '',
    inputWriteBuffer: '',
    seenPorts: new Set(),
    lastRows: term.rows,
    lastCols: term.cols
  };
  state.terminals.push(pane);
  terminalPaneById.set(pane.paneId, pane);
  rememberTerminalPane(pane);
  registerTerminalFileLinks(pane);
  if (options.focus !== false) {
    setActivePane(paneId);
    bringPanelToFront(widget.element);
  } else {
    if (!widget.activePaneId) widget.activePaneId = paneId;
    syncActivePaneClass();
  }
  renderTerminalWidgetTabs(widget);
  if (pane.paneId === widget.activePaneId) scheduleFitTerminal(pane);

  term.attachCustomKeyEventHandler((event) => handleTerminalKey(event, pane));
  term.onData((data) => {
    const inputData = filterTerminalInputData(pane, data);
    if (!inputData) return;
    markTerminalUserInput(pane);
    trackTerminalCwdFromInput(pane, inputData);
    if (terminalInputShouldSendImmediately(inputData)) {
      void sendTerminalInputNow(pane, inputData).catch((error) => {
        setStatus(`Failed to write terminal input: ${String(error)}`, true);
      });
    } else {
      queueTerminalInput(pane, inputData);
    }
  });
  host.addEventListener('paste', (event) => handleTerminalPaste(event, pane), true);
  bindTerminalImeCompositionGuard(pane);

  pane.resizeObserver = new ResizeObserver(() => {
    if (terminalPaneCanFit(pane)) scheduleFitTerminal(pane);
  });
  pane.resizeObserver.observe(host);

  try {
    const initiallyVisible = isTerminalPaneVisible(pane);
    if (initiallyVisible) await settleTerminalInitialFit(pane);
    if (terminalProfile.kind === 'windows') {
      const spawnCwd = await usableTerminalCwd(terminalProfile, pane.cwd);
      if (spawnCwd !== pane.cwd) {
        pane.cwd = spawnCwd;
        updateTerminalWidgetTitle(widget);
      }
    }
    const backendId = await api.spawnTerminal(terminalProfile.id, pane.cwd, command, term.rows, term.cols, widget.workspaceId, title);
    setTerminalBackendId(pane, backendId);
    if (options.focus !== false) {
      queueTerminalFitBurst(pane);
      bringPanelToFront(widget.element);
      term.focus();
    }
    setStatus(`Terminal started: ${title}`);
    if (!options.skipSnapshotSave) saveActiveWorkspaceSnapshot();
  } catch (error) {
    term.write(`\r\nFailed to start terminal: ${String(error)}\r\n`);
    setStatus(String(error), true);
  }
  return pane;
}

async function closeTerminalPane(paneId: string, options: CloseTerminalOptions = {}) {
  const pane = terminalPaneById.get(paneId) ?? state.terminals.find((item) => item.paneId === paneId);
  if (!pane) return;
  const widget = terminalWidgetForPane(pane);
  const backendClose = closeTerminalBackend(pane);
  if (options.backgroundKill) void backendClose;
  else await backendClose;
  setTerminalBackendId(pane, undefined);
  terminalPaneById.delete(pane.paneId);
  forgetTerminalPane(pane);
  cleanupTerminalWriteBuffer(pane);
  if (pane.fitFrame) cancelAnimationFrame(pane.fitFrame);
  pane.resizeObserver?.disconnect();
  pane.term.dispose();
  const terminalIndex = state.terminals.findIndex((item) => item.paneId === paneId);
  if (terminalIndex >= 0) state.terminals.splice(terminalIndex, 1);
  pane.host.remove();
  const nextInWidget = widget ? firstTerminalPaneForWidget(widget) : null;
  if (widget && !nextInWidget) {
    const widgetIndex = state.terminalWidgets.findIndex((item) => item.widgetId === widget.widgetId);
    if (widgetIndex >= 0) state.terminalWidgets.splice(widgetIndex, 1);
    forgetTerminalWidget(widget);
    widget.element.remove();
  } else if (widget && widget.activePaneId === paneId) {
    widget.activePaneId = nextInWidget?.paneId ?? '';
  }

  if (state.activePaneId === paneId) {
    const next = nextInWidget ?? firstActiveWorkspaceTerminalPane();
    state.activePaneId = '';
    if (next) setActivePane(next.paneId);
    else setKeyboardResizeTarget({ kind: 'ide' });
  }
  syncActivePaneClass();
  if (options.renderShellTabs !== false) renderShellTabs();
  if (options.saveSnapshot !== false) saveActiveWorkspaceSnapshot();
}

function closeTerminalBackend(pane: TerminalPane) {
  const backendId = pane.backendId;
  if (!backendId) return Promise.resolve();
  return flushTerminalInput(pane)
    .catch(() => undefined)
    .then(() => api.killTerminal(backendId))
    .catch(() => undefined);
}

async function closeTerminalWidget(widgetId: string, options: CloseTerminalOptions = {}) {
  const paneIds: string[] = [];
  for (const pane of terminalPanesForWidgetId(widgetId)) paneIds.push(pane.paneId);
  for (const paneId of paneIds) {
    await closeTerminalPane(paneId, options);
  }
}

function renderShellTabs() {
  const signature = shellTabsSignature();
  if (shellTabsRenderSignature === signature) return;
  shellTabsRenderSignature = signature;
  el.shellTabs.classList.add('hidden');
  el.shellTabList.replaceChildren();
  forEachActiveWorkspaceTerminalWidget(renderTerminalWidgetTabs);
}

function shellTabsSignature() {
  let signature = '';
  let count = 0;
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId !== state.activeWorkspaceId) continue;
    if (count) signature += '\n';
    signature += `${widget.widgetId}\t${widget.activePaneId}`;
    count += 1;
  }
  return signature;
}

function renderTerminalWidgetTabs(widget: TerminalWidget) {
  const panes = terminalPanesForWidget(widget);
  const renderState = terminalWidgetTabsRenderState(widget, panes);
  if (terminalWidgetTabsRenderSignatures.get(widget) === renderState.signature) {
    updateTerminalWidgetTitle(widget);
    return;
  }
  terminalWidgetTabsRenderSignatures.set(widget, renderState.signature);
  const sameOrder = terminalWidgetTabsOrderRenderSignatures.get(widget) === renderState.orderSignature
    && widget.tabList.childElementCount === renderState.count;

  if (sameOrder) {
    for (const pane of panes) {
      updateTerminalWidgetTabElement(terminalWidgetTabElement(widget, pane.paneId), widget, pane);
    }
    updateTerminalWidgetTitle(widget);
    return;
  }

  terminalWidgetTabsOrderRenderSignatures.set(widget, renderState.orderSignature);
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const pane of panes) {
    seen.add(pane.paneId);
    const item = terminalWidgetTabElement(widget, pane.paneId);
    updateTerminalWidgetTabElement(item, widget, pane);
    fragment.append(item);
  }
  widget.tabList.replaceChildren(fragment);
  pruneTerminalWidgetTabElementCache(widget, seen);
  updateTerminalWidgetTitle(widget);
}

function terminalWidgetTabElement(widget: TerminalWidget, paneId: string) {
  const cache = terminalWidgetTabCache(widget);
  const cached = cache.get(paneId);
  if (cached) return cached;
  const item = document.createElement('div');
  item.className = 'widget-tab';
  const labelButton = document.createElement('button');
  labelButton.className = 'widget-tab-label';
  labelButton.type = 'button';
  labelButton.addEventListener('click', () => {
    const pane = terminalPaneById.get(item.dataset.paneId ?? '');
    if (!pane) return;
    setActivePane(pane.paneId);
    bringPanelToFront(pane.element);
    pane.term.focus();
  });
  const closeButton = document.createElement('button');
  closeButton.className = 'widget-tab-close';
  closeButton.type = 'button';
  closeButton.title = 'Close shell';
  closeButton.setAttribute('aria-label', 'Close shell');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const paneId = item.dataset.paneId ?? '';
    if (paneId) void closeTerminalPane(paneId);
  });
  item.append(labelButton, closeButton);
  cache.set(paneId, item);
  return item;
}

function terminalWidgetTabCache(widget: TerminalWidget) {
  let cache = terminalWidgetTabElementCaches.get(widget);
  if (!cache) {
    cache = new Map<string, HTMLElement>();
    terminalWidgetTabElementCaches.set(widget, cache);
  }
  return cache;
}

function updateTerminalWidgetTabElement(item: HTMLElement, widget: TerminalWidget, pane: TerminalPane) {
  const active = pane.paneId === widget.activePaneId;
  const signature = `${pane.paneId}\t${active ? '1' : '0'}\t${pane.title}\t${pane.command ?? ''}`;
  item.dataset.paneId = pane.paneId;
  if (item.dataset.renderSignature === signature) return;
  item.dataset.renderSignature = signature;
  item.className = `widget-tab${active ? ' active' : ''}`;
  item.title = pane.command || pane.title;
  setTextContentIfChanged(terminalWidgetTabLabelButton(item), pane.title);
}

function terminalWidgetTabLabelButton(item: HTMLElement) {
  return item.firstElementChild as HTMLButtonElement;
}

function pruneTerminalWidgetTabElementCache(widget: TerminalWidget, seen: Set<string>) {
  const cache = terminalWidgetTabElementCaches.get(widget);
  if (!cache) return;
  for (const paneId of cache.keys()) {
    if (!seen.has(paneId)) cache.delete(paneId);
  }
}

function terminalWidgetTabsRenderState(widget: TerminalWidget, panes = terminalPanesForWidget(widget)) {
  let signature = '';
  let orderSignature = '';
  let count = 0;
  for (const pane of panes) {
    if (count) {
      signature += '\n';
      orderSignature += '\n';
    }
    signature += `${pane.paneId}\t${pane.paneId === widget.activePaneId ? '1' : '0'}\t${pane.title}\t${pane.command ?? ''}`;
    orderSignature += pane.paneId;
    count += 1;
  }
  return { signature, orderSignature, count };
}

function rememberTerminalPane(pane: TerminalPane) {
  let panes = terminalPanesByWidgetId.get(pane.widgetId);
  if (!panes) {
    panes = [];
    terminalPanesByWidgetId.set(pane.widgetId, panes);
  }
  if (!panes.includes(pane)) panes.push(pane);
}

function forgetTerminalPane(pane: TerminalPane) {
  const panes = terminalPanesByWidgetId.get(pane.widgetId);
  if (!panes) return;
  const index = panes.indexOf(pane);
  if (index >= 0) panes.splice(index, 1);
  if (!panes.length) terminalPanesByWidgetId.delete(pane.widgetId);
}

function terminalPanesForWidget(widget: TerminalWidget) {
  return terminalPanesForWidgetId(widget.widgetId);
}

function terminalPanesForWidgetId(widgetId: string) {
  const panes = terminalPanesByWidgetId.get(widgetId);
  if (panes) return panes;
  const rebuilt: TerminalPane[] = [];
  for (const pane of state.terminals) {
    if (pane.widgetId === widgetId) rebuilt.push(pane);
  }
  if (rebuilt.length) terminalPanesByWidgetId.set(widgetId, rebuilt);
  return rebuilt;
}

function firstTerminalPaneForWidget(widget: TerminalWidget) {
  return terminalPanesForWidget(widget)[0] ?? null;
}

function forEachActiveWorkspaceTerminalWidget(callback: (widget: TerminalWidget) => void) {
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId === state.activeWorkspaceId) callback(widget);
  }
}

function firstActiveWorkspaceTerminalWidget() {
  for (const widget of state.terminalWidgets) {
    if (widget.workspaceId === state.activeWorkspaceId) return widget;
  }
  return null;
}

function hasActiveWorkspaceTerminalPane() {
  for (const pane of state.terminals) {
    if (pane.workspaceId === state.activeWorkspaceId) return true;
  }
  return false;
}

function firstActiveWorkspaceTerminalPane() {
  for (const pane of state.terminals) {
    if (pane.workspaceId === state.activeWorkspaceId) return pane;
  }
  return null;
}

function activeWorkspaceTerminalPaneAtClamped(index: number) {
  const targetIndex = Math.max(0, index);
  let activeIndex = 0;
  let selected: TerminalPane | null = null;
  let last: TerminalPane | null = null;
  for (const pane of state.terminals) {
    if (pane.workspaceId !== state.activeWorkspaceId) continue;
    if (activeIndex === targetIndex) selected = pane;
    last = pane;
    activeIndex += 1;
  }
  return selected ?? last;
}

function forgetTerminalWidget(widget: TerminalWidget) {
  terminalWidgetById.delete(widget.widgetId);
  terminalWidgetByElement.delete(widget.element);
}

function terminalWidgetForPane(pane: TerminalPane) {
  let widget = terminalWidgetById.get(pane.widgetId) ?? null;
  if (!widget) {
    widget = state.terminalWidgets.find((item) => item.widgetId === pane.widgetId) ?? null;
    if (widget) terminalWidgetById.set(widget.widgetId, widget);
  }
  return widget;
}

function terminalWidgetForElement(element: HTMLElement) {
  let widget = terminalWidgetByElement.get(element) ?? null;
  if (!widget) {
    widget = state.terminalWidgets.find((item) => item.element === element) ?? null;
    if (widget) terminalWidgetByElement.set(widget.element, widget);
  }
  return widget;
}

function activePaneForWidget(widget: TerminalWidget) {
  const pane = terminalPaneById.get(widget.activePaneId);
  return pane?.widgetId === widget.widgetId ? pane : firstTerminalPaneForWidget(widget);
}

function activeTerminalWidget() {
  const pane = terminalPaneById.get(state.activePaneId);
  if (pane?.workspaceId !== state.activeWorkspaceId) {
    return firstActiveWorkspaceTerminalWidget();
  }
  return pane ? terminalWidgetForPane(pane) : firstActiveWorkspaceTerminalWidget();
}

function activePaneForElement(element: HTMLElement) {
  const widget = terminalWidgetForElement(element);
  return widget ? activePaneForWidget(widget) : null;
}

function profileForTerminalWidget(widget: TerminalWidget) {
  const pane = activePaneForWidget(widget);
  if (!pane) return null;
  return profileForIdWithWindowsFallback(pane.profileId);
}

function windowsLocalProfileFallback(): ConnectionProfile {
  return {
    id: 'windows-local',
    label: 'Windows Local',
    kind: 'windows',
    root: 'C:\\Windows\\Temp\\simple-vibe-ide-shell',
    shell: 'powershell.exe -NoLogo -NoProfile'
  };
}

async function createShellTabInWidget(widget: TerminalWidget) {
  const active = activePaneForWidget(widget);
  const profile = profileForTerminalWidget(widget) ?? state.activeProfile;
  const cwd = active?.cwd ?? workspaceShellCwd();
  await createTerminalTab(widget, null, 'shell', { profile: profile ?? undefined, cwd });
}

function workspaceShellCwd() {
  return state.workspaceRoot || state.currentDir || state.activeProfile?.root || '.';
}

async function usableTerminalCwd(profile: ConnectionProfile, requestedCwd: string) {
  const candidates = [
    requestedCwd,
    state.currentDir,
    state.workspaceRoot,
    profile.root,
    profile.kind === 'windows' ? '' : '~'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await api.listDirectory(profile.id, candidate, false);
      return candidate;
    } catch {
      // Try the next likely folder without surfacing private paths.
    }
  }
  return profile.kind === 'windows' ? '' : '~';
}

function updateTerminalWidgetTitle(widget: TerminalWidget, options: { force?: boolean } = {}) {
  const pane = activePaneForWidget(widget);
  widget.activePaneId = pane?.paneId ?? '';
  if (!options.force && widget.element.classList.contains('hidden')) return;
  setTextContentIfChanged(widget.title, pane?.title ?? 'shell');
  setTextContentIfChanged(widget.cwd, pane?.cwd ?? '');
}

function bindTerminalImeCompositionGuard(pane: TerminalPane, attempts = 0) {
  const textarea = pane.host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
  if (!textarea) {
    if (attempts < 6) window.setTimeout(() => bindTerminalImeCompositionGuard(pane, attempts + 1), 25);
    return;
  }

  textarea.addEventListener('compositionstart', () => beginTerminalImeCompositionGuard(pane));
  textarea.addEventListener('compositionupdate', () => beginTerminalImeCompositionGuard(pane));
  textarea.addEventListener('compositionend', () => finishTerminalImeCompositionGuard(pane));
  // No 'blur' -> finish handler on purpose: a transient blur mid-composition would schedule a
  // refocus right across xterm's compositionend finalization window (it re-reads the textarea on a
  // setTimeout(0)) and drop the last Hangul syllable. The fallback timer already releases a stuck
  // composition, so blur-based release is both redundant and harmful.
}

function beginTerminalImeCompositionGuard(pane: TerminalPane) {
  pane.imeComposing = true;
  markTerminalUserInput(pane);
  if (pane.imeReleaseTimer) {
    window.clearTimeout(pane.imeReleaseTimer);
    pane.imeReleaseTimer = undefined;
  }
  if (pane.imeFallbackTimer) window.clearTimeout(pane.imeFallbackTimer);
  pane.imeFallbackTimer = window.setTimeout(() => finishTerminalImeCompositionGuard(pane), TERMINAL_IME_COMPOSITION_FALLBACK_MS);
}

function finishTerminalImeCompositionGuard(pane: TerminalPane) {
  if (pane.imeFallbackTimer) {
    window.clearTimeout(pane.imeFallbackTimer);
    pane.imeFallbackTimer = undefined;
  }
  if (!pane.imeComposing) return;
  if (pane.imeReleaseTimer) window.clearTimeout(pane.imeReleaseTimer);
  pane.imeReleaseTimer = window.setTimeout(() => {
    pane.imeReleaseTimer = undefined;
    pane.imeComposing = false;
    // The DOM renderer can leave stale/blank cells after a mixed-width (Hangul + ASCII) input line
    // is redrawn through IME composition, so previously-visible glyphs appear to vanish. Force a
    // full repaint of the viewport on release; the buffer is correct, only the render is stale.
    pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
    scheduleFitTerminal(pane);
    // Only reclaim focus if composition actually lost it; refocusing while xterm still holds focus
    // is needless churn that can disturb IME state mid-commit.
    if (!terminalPaneHasFocus(pane)) focusTerminalPaneWhenReady(pane);
  }, TERMINAL_IME_RELEASE_DEFER_MS);
}

function registerTerminalFileLinks(pane: TerminalPane) {
  pane.term.registerLinkProvider({
    provideLinks: (bufferLineNumber: number, callback: (links: XTermLink[] | undefined) => void) => {
      const line = pane.term.buffer.active.getLine(Math.max(0, bufferLineNumber - 1))
        ?? pane.term.buffer.active.getLine(bufferLineNumber);
      const links = line ? terminalFileLinksForLine(pane, line, bufferLineNumber) : [];
      callback(links.length ? links : undefined);
    }
  });
}

function terminalFileLinksForLine(pane: TerminalPane, line: IBufferLine, y: number) {
  const links: XTermLink[] = [];
  const { text, cells } = terminalLineTextAndCells(line);
  TERMINAL_FILE_LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERMINAL_FILE_LINK_PATTERN.exec(text))) {
    const captured = match[1] ?? '';
    const rawText = trimTerminalFileLinkText(captured);
    if (!rawText || terminalFileLinkLooksLikeUrl(rawText)) continue;
    const capturedStart = (match.index ?? 0) + Math.max(0, match[0].indexOf(captured || rawText));
    const rawStart = capturedStart + Math.max(0, captured.indexOf(rawText));
    const range = terminalFileLinkRange(cells, rawStart, rawStart + rawText.length, y);
    if (!range) continue;
    links.push({
      range,
      text: rawText,
      decorations: { pointerCursor: true, underline: true },
      activate: (event, text) => {
        if (!event.ctrlKey && !event.metaKey) {
          setStatus('Ctrl+click a terminal file link to open it');
          return;
        }
        void openTerminalFileLink(pane, text);
      },
      hover: () => {
        setStatus('Ctrl+click to open file');
      }
    });
  }
  return links;
}

function terminalLineTextAndCells(line: IBufferLine) {
  const translated = line.translateToString(true);
  const cells: number[] = [];
  let text = '';
  for (let x = 0; x < line.length && text.length < translated.length; x += 1) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars() || ' ';
    for (let index = 0; index < chars.length; index += 1) {
      cells[text.length + index] = x + 1;
    }
    text += chars;
  }
  if (text !== translated) {
    for (let index = 0; index < translated.length; index += 1) {
      if (!cells[index]) cells[index] = index + 1;
    }
  }
  return { text: translated, cells };
}

function terminalFileLinkRange(cells: number[], start: number, endExclusive: number, y: number) {
  if (endExclusive <= start) return null;
  const startX = cells[start] ?? start + 1;
  const endX = cells[endExclusive - 1] ?? endExclusive;
  if (!Number.isFinite(startX) || !Number.isFinite(endX) || endX < startX) return null;
  return {
    start: { x: startX, y },
    end: { x: endX, y }
  };
}

function trimTerminalFileLinkText(text: string) {
  let value = text.trim();
  value = value.replace(/^[<"'`]+/, '');
  while (/[),.;\]"'`>]+$/.test(value)) value = value.slice(0, -1);
  return value;
}

function terminalFileLinkLooksLikeUrl(text: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
}

async function openTerminalFileLink(pane: TerminalPane, text: string) {
  const path = resolveTerminalFileLinkPath(pane, text);
  if (!path) {
    setStatus('Could not resolve terminal file link', true);
    return;
  }
  try {
    const opened = await openFile(path);
    if (opened) setStatus(`Opened ${pathBasename(path, path)}`);
  } catch (error) {
    setStatus(`Failed to open terminal file link: ${String(error)}`, true);
  }
}

function resolveTerminalFileLinkPath(pane: TerminalPane, text: string) {
  const withoutLine = text.replace(/(?::|#)\d+(?::\d+)?$/, '').replace(/^@(?=(?:\.{1,2}[\\/]|[~\\/]|[A-Za-z]:[\\/]|\\\\|[^@\s]+[\\/]))/, '');
  const decoded = decodeTerminalPath(withoutLine);
  if (!decoded) return '';
  const profile = profileForIdWithWindowsFallback(pane.profileId) ?? state.activeProfile;
  const windows = profile?.kind === 'windows' || isWindowsPath(decoded);
  if (isAbsoluteTerminalFilePath(decoded, windows) || decoded.startsWith('~')) {
    return windows ? normalizeWindowsTerminalPath(decoded) : normalizePosixTerminalPath(decoded);
  }
  const base = pane.cwd || state.currentDir || state.workspaceRoot || profile?.root || '.';
  return joinTerminalFilePath(base, decoded, windows);
}

function isAbsoluteTerminalFilePath(path: string, windows: boolean) {
  if (windows) return isWindowsPath(path) || path.startsWith('\\\\');
  return path.startsWith('/');
}

function joinTerminalFilePath(base: string, relative: string, windows: boolean) {
  const separator = windows ? '\\' : '/';
  const normalizedRelative = relative.replace(/[\\/]+/g, separator);
  const joined = `${base.replace(/[\\/]+$/, '')}${separator}${normalizedRelative}`;
  return windows ? normalizeWindowsTerminalPath(joined) : normalizePosixTerminalPath(joined);
}

function markTerminalUserInput(pane: TerminalPane) {
  pane.lastUserInputAt = performance.now();
}

function scheduleFitTerminalWidget(widget: TerminalWidget, options: { activeOnly?: boolean } = {}) {
  if (options.activeOnly) {
    const pane = activePaneForWidget(widget);
    if (pane) scheduleFitTerminal(pane);
    return;
  }
  for (const pane of terminalPanesForWidget(widget)) scheduleFitTerminal(pane);
}

function handleTerminalKey(event: KeyboardEvent, pane: TerminalPane) {
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    return true;
  }
  if (event.type === 'keydown') markTerminalUserInput(pane);

  if (isWidgetFocusShortcut(event)) {
    if (terminalUsesAlternateBuffer(pane)) return true;
    event.preventDefault();
    event.stopPropagation();
    cycleWidgetFocus(event.shiftKey ? -1 : 1, pane.paneId);
    return false;
  }

  if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || event.altKey) return true;
  const key = event.key.toLowerCase();
  if (key === 'v' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    void pasteTerminalText(pane);
    return false;
  }
  if (key !== 'c') return true;
  if (!pane.term.hasSelection()) return true;

  void copyTerminalSelection(pane);
  return false;
}

function terminalUsesAlternateBuffer(pane: TerminalPane) {
  return (pane.term.buffer.active as { type?: string }).type === 'alternate';
}

async function copyTerminalSelection(pane: TerminalPane) {
  const selection = pane.term.getSelection();
  if (!selection) return;
  try {
    await writeText(selection);
    pane.term.clearSelection();
    setStatus('Copied terminal selection');
  } catch (error) {
    setStatus(`Failed to copy terminal selection: ${String(error)}`, true);
  }
}

function handleTerminalPaste(event: ClipboardEvent, pane: TerminalPane) {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text) return;

  event.preventDefault();
  event.stopPropagation();
  void pasteTerminalText(pane, text);
}

async function pasteTerminalText(pane: TerminalPane, text?: string) {
  try {
    const value = normalizeTerminalPasteText(text ?? await readText());
    if (!value) return;
    markTerminalUserInput(pane);
    await sendTerminalInputNow(pane, terminalPastePayload(value));
  } catch (error) {
    setStatus(`Failed to paste terminal text: ${String(error)}`, true);
  }
}

function terminalPastePayload(value: string) {
  return /\r|\n/.test(value) ? `\x1b[200~${value}\x1b[201~` : value;
}

function normalizeTerminalPasteText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function placeTerminalCard(card: HTMLElement, options: CreateTerminalOptions = {}) {
  const workspaceRect = el.mainGrid.getBoundingClientRect();
  const guideRect = el.terminalGrid.getBoundingClientRect();
  const index = state.terminalWidgets.length;
  const rememberedSize = rememberedTerminalSpawnSize();
  const width = clamp((rememberedSize?.width ?? guideRect.width) || 620, terminalMinWidth(), Math.max(terminalMinWidth(), el.mainGrid.clientWidth - 16));
  const preferredHeight = rememberedSize?.height ?? options.initialHeight ?? 340;
  const height = clamp(preferredHeight, terminalMinHeight(), Math.max(terminalMinHeight(), el.mainGrid.clientHeight - 16));
  const offset = index * 22;
  const rect = clampPanelRect(card, {
    left: guideRect.left - workspaceRect.left + offset,
    top: guideRect.top - workspaceRect.top + offset,
    width,
    height
  });
  applyPanelRect(card, rect);
}

function rememberedTerminalSpawnSize() {
  const ratio = activeWorkspaceSnapshot()?.terminalSpawnRect;
  if (!ratio || !el.mainGrid.clientWidth || !el.mainGrid.clientHeight) return null;
  return {
    width: ratio.width * el.mainGrid.clientWidth,
    height: ratio.height * el.mainGrid.clientHeight
  };
}

function scheduleFitTerminal(pane: TerminalPane) {
  if (!terminalPaneCanFit(pane)) return;
  if (terminalImeCompositionGuardActive(pane)) return;
  if (pane.fitFrame) return;
  pane.fitFrame = requestAnimationFrame(() => {
    pane.fitFrame = undefined;
    fitTerminal(pane);
  });
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function settleTerminalInitialFit(pane: TerminalPane) {
  await nextFrame();
  await nextFrame();
  fitTerminal(pane);
}

function queueTerminalFitBurst(pane: TerminalPane) {
  scheduleFitTerminal(pane);
  window.setTimeout(() => scheduleFitTerminal(pane), 50);
  window.setTimeout(() => scheduleFitTerminal(pane), 160);
}

function terminalPaneCanFit(pane: TerminalPane) {
  return pane.workspaceId === state.activeWorkspaceId
    && !pane.element.classList.contains('hidden')
    && !pane.host.classList.contains('hidden');
}

function fitTerminal(pane: TerminalPane) {
  if (!terminalPaneCanFit(pane)) return;
  if (terminalImeCompositionGuardActive(pane)) return;
  try {
    pane.fit.fit();
    if (pane.lastRows === pane.term.rows && pane.lastCols === pane.term.cols) return;
    pane.lastRows = pane.term.rows;
    pane.lastCols = pane.term.cols;
    if (pane.backendId) void api.resizeTerminal(pane.backendId, pane.term.rows, pane.term.cols);
  } catch {
    // xterm can throw while hidden or before first layout; safe to ignore.
  }
}

function terminalPaneCanReceiveFocus(pane: TerminalPane) {
  return pane.workspaceId === state.activeWorkspaceId
    && pane.paneId === state.activePaneId
    && !pane.element.classList.contains('hidden')
    && !pane.host.classList.contains('hidden');
}

function terminalPaneTextarea(pane: TerminalPane) {
  return pane.term.textarea ?? pane.host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
}

function terminalPaneHasFocus(pane: TerminalPane) {
  const textarea = terminalPaneTextarea(pane);
  return Boolean(textarea && document.activeElement === textarea);
}

function focusTerminalPaneWhenReady(pane: TerminalPane) {
  if (!terminalPaneCanReceiveFocus(pane)) return;
  if (pane.focusFrame) return;
  pane.focusFrame = requestAnimationFrame(() => {
    pane.focusFrame = undefined;
    focusTerminalPaneNow(pane);
    if (pane.focusRetryTimer) window.clearTimeout(pane.focusRetryTimer);
    pane.focusRetryTimer = window.setTimeout(() => {
      pane.focusRetryTimer = undefined;
      if (!terminalPaneHasFocus(pane)) focusTerminalPaneNow(pane);
    }, TERMINAL_FOCUS_RETRY_MS);
  });
}

function focusTerminalPaneNow(pane: TerminalPane) {
  if (!terminalPaneCanReceiveFocus(pane)) return;
  if (terminalPaneHasFocus(pane)) return;
  try {
    pane.term.focus();
  } catch {
    // xterm can reject focus while its host is being detached or disposed.
  }
}

function activeTerminalPane() {
  return state.activePaneId ? terminalPaneById.get(state.activePaneId) ?? null : null;
}

function focusActiveTerminalPaneWhenItOwnsKeyboard() {
  const pane = activeTerminalPane();
  if (!pane) return;
  if (keyboardResizeTarget.kind !== 'terminal' || keyboardResizeTarget.paneId !== pane.paneId) return;
  focusTerminalPaneWhenReady(pane);
}

function setActivePane(paneId: string) {
  const pane = terminalPaneById.get(paneId);
  if (!pane) return;
  if (pane.workspaceId !== state.activeWorkspaceId) return;
  const previousPaneId = state.activePaneId;
  const widget = terminalWidgetForPane(pane);
  if (previousPaneId === paneId) {
    setKeyboardResizeTarget({ kind: 'terminal', paneId });
    flushTerminalWriteBuffer(pane);
    scheduleFitTerminal(pane);
    focusTerminalPaneWhenReady(pane);
    return;
  }
  const previousPane = previousPaneId ? terminalPaneById.get(previousPaneId) ?? null : null;
  const previousWidget = previousPane ? terminalWidgetForPane(previousPane) : null;
  if (widget) widget.activePaneId = paneId;
  state.activePaneId = paneId;
  setKeyboardResizeTarget({ kind: 'terminal', paneId });
  if (previousWidget && previousWidget !== widget) {
    syncTerminalWidgetActiveState(previousWidget);
    renderTerminalWidgetTabs(previousWidget);
  }
  if (widget) {
    syncTerminalWidgetActiveState(widget);
    renderTerminalWidgetTabs(widget);
  }
  shellTabsRenderSignature = shellTabsSignature();
  flushTerminalWriteBuffer(pane);
  scheduleFitTerminal(pane);
  focusTerminalPaneWhenReady(pane);
  saveActiveWorkspaceSnapshot();
}

function syncActivePaneClass(options: { workspaceId?: string } = {}) {
  const workspaceId = options.workspaceId ?? state.activeWorkspaceId;
  for (const widget of state.terminalWidgets) {
    if (workspaceId && widget.workspaceId !== workspaceId) continue;
    syncTerminalWidgetActiveState(widget);
  }
}

function syncTerminalWidgetActiveState(widget: TerminalWidget) {
  const current = terminalPaneById.get(widget.activePaneId);
  const activePane = current?.widgetId === widget.widgetId ? current : firstTerminalPaneForWidget(widget);
  widget.activePaneId = activePane?.paneId ?? '';
  toggleClassIfChanged(
    widget.element,
    'active',
    widget.workspaceId === state.activeWorkspaceId && widget.activePaneId === state.activePaneId
  );
  if (widget.element.classList.contains('hidden')) {
    updateTerminalWidgetTitle(widget);
    return;
  }
  for (const pane of terminalPanesForWidget(widget)) {
    toggleClassIfChanged(pane.host, 'hidden', pane.paneId !== widget.activePaneId);
  }
  updateTerminalWidgetTitle(widget);
}

async function handlePaste(event: ClipboardEvent) {
  if (!state.activeProfile || !state.workspaceOpen) return;
  if (isExplorerClipboardTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    await pasteClipboardIntoExplorer(event);
    return;
  }

  const eventDataUrl = await imageDataUrlFromClipboardEvent(event);
  const shouldTryNativeImage = !eventDataUrl && clipboardEventMayContainImage(event);
  if (!eventDataUrl && !shouldTryNativeImage) return;

  event.preventDefault();
  try {
    const dataUrl = eventDataUrl ?? await nativeClipboardImageToDataUrl();
    const pasteToShell = isInsideImagePanel(event.target) || state.autoPasteImageTagToShell;
    await savePastedImage(dataUrl, pasteToShell);
  } catch (error) {
    setStatus(`Failed to paste image: ${String(error)}`, true);
  }
}

async function pasteClipboardIntoExplorer(event: ClipboardEvent) {
  if (!state.activeProfile || !state.currentDir) return;

  try {
    const sourcePaths = await api.readClipboardFilePaths();
    if (sourcePaths.length > 0) {
      setStatus(`Pasting ${sourcePaths.length} file${sourcePaths.length === 1 ? '' : 's'} into Explorer...`);
      const copied = await api.copyDroppedFiles(state.activeProfile.id, state.currentDir, sourcePaths);
      invalidateExplorerDirectoryCache(state.activeProfile.id, state.currentDir);
      await reloadExplorerDirectory(state.currentDir);
      setStatus(`Pasted ${copied} file${copied === 1 ? '' : 's'} into Explorer`);
      return;
    }

    const eventDataUrl = await imageDataUrlFromClipboardEvent(event);
    const shouldTryNativeImage = !eventDataUrl && clipboardEventMayContainImage(event);
    if (!eventDataUrl && !shouldTryNativeImage) {
      setStatus('Clipboard has no files to paste into Explorer', true);
      return;
    }

    const dataUrl = eventDataUrl ?? await nativeClipboardImageToDataUrl();
    const savedPath = await api.saveClipboardImageFile(
      state.activeProfile.id,
      state.currentDir,
      nextImageName(),
      dataUrl
    );
    invalidateExplorerDirectoryCache(state.activeProfile.id, state.currentDir);
    await reloadExplorerDirectory(state.currentDir);
    selectExplorerEntry(savedPath);
    setStatus(`Pasted image file into Explorer`);
  } catch (error) {
    setStatus(`Failed to paste into Explorer: ${String(error)}`, true);
  }
}

function isExplorerClipboardTarget(target: EventTarget | null) {
  const explorer = getPanel('explorer');
  if (explorer.classList.contains('hidden')) return false;
  if (target instanceof Element && target.closest('input, textarea, select, .terminal-card, .cm-editor')) {
    return false;
  }
  return keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'explorer'
    || target instanceof Node && explorer.contains(target);
}

function handleImageClipboardShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  if (key !== 'c' && key !== 'v') return;
  if (!isImagePanelClipboardTarget(event.target)) return;

  event.preventDefault();
  event.stopPropagation();
  if (key === 'c') void copyCurrentPreviewImage();
  else void pasteImageFromNativeClipboard();
}

function isImagePanelClipboardTarget(target: EventTarget | null) {
  if (target instanceof Element && target.closest('input, textarea, select, .terminal-card, .cm-editor')) {
    return false;
  }
  return keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'image'
    || isInsideImagePanel(target);
}

function isInsideImagePanel(target: EventTarget | null) {
  const imagePanel = getPanel('image');
  return target instanceof Node && imagePanel.contains(target);
}

async function copyCurrentPreviewImage() {
  if (!state.imagePreviewDataUrl) {
    setStatus('No image preview to copy', true);
    return;
  }
  try {
    await writePreviewDataUrlToClipboard(state.imagePreviewDataUrl);
    setStatus('Copied image preview');
  } catch (error) {
    setStatus(`Failed to copy image preview: ${String(error)}`, true);
  }
}

async function writePreviewDataUrlToClipboard(dataUrl: string) {
  const image = await dataUrlToTauriImage(dataUrl);
  try {
    await writeImage(image);
  } finally {
    await image.close().catch(() => undefined);
  }
}

async function dataUrlToTauriImage(dataUrl: string) {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d');
  if (!context || canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('could not decode image preview');
  }
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return TauriImage.new(new Uint8Array(rgba), canvas.width, canvas.height);
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not load image preview'));
    image.src = dataUrl;
  });
}

async function pasteImageFromNativeClipboard() {
  if (!state.activeProfile || !state.workspaceOpen) return;
  try {
    await savePastedImage(await nativeClipboardImageToDataUrl(), true);
  } catch (error) {
    setStatus(`Failed to paste image: ${String(error)}`, true);
  }
}

async function imageDataUrlFromClipboardEvent(event: ClipboardEvent) {
  const file = firstImageClipboardFile(event.clipboardData);
  return file ? blobToDataUrl(file) : null;
}

function clipboardEventMayContainImage(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) return true;
  if (clipboardItemsMayContainImage(data.items)) return true;
  if (clipboardFilesMayContainImage(data.files)) return true;
  if (clipboardTypesContainFiles(data.types)) return true;
  const html = data.getData('text/html');
  if (/<img\b|data:image\//i.test(html)) return true;
  return data.types.length === 0 && !data.getData('text/plain');
}

function firstImageClipboardFile(data: DataTransfer | null) {
  if (!data) return null;
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  for (let index = 0; index < data.files.length; index += 1) {
    const file = data.files[index];
    if (file.type.startsWith('image/') || isImagePath(file.name)) return file;
  }
  return null;
}

function clipboardItemsMayContainImage(items: DataTransferItemList) {
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].type.startsWith('image/')) return true;
  }
  return false;
}

function clipboardFilesMayContainImage(files: FileList) {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file.type.startsWith('image/') || isImagePath(file.name)) return true;
  }
  return false;
}

function clipboardTypesContainFiles(types: readonly string[]) {
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === 'Files') return true;
  }
  return false;
}

async function nativeClipboardImageToDataUrl() {
  const image = await readImage();
  try {
    const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas 2D context is unavailable');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    await image.close().catch(() => undefined);
  }
}

async function savePastedImage(dataUrl: string, pasteToShell = state.autoPasteImageTagToShell) {
  if (!state.activeProfile) return;
  const targetTab = state.imageOpenInNewTab && activeImageTab().dataUrl
    ? createImageTab(undefined, true)
    : activeImageTab();
  state.activeImageTabId = targetTab.id;
  const result = await api.saveAttachment(
    state.activeProfile.id,
    state.currentDir,
    state.attachmentSession,
    nextImageName(),
    dataUrl
  );
  invalidateExplorerDirectoryCache(state.activeProfile.id, state.currentDir);
  const item: PastedImageItem = {
    id: crypto.randomUUID(),
    path: result.path,
    tag: result.tag,
    dataUrl,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  state.imageHistory = [item, ...state.imageHistory].slice(0, 24);
  state.imagePreviewDataUrl = dataUrl;
  setImageTabSourcePath(targetTab, result.path);
  const pasted = pasteToShell ? await pasteImageTagToActiveTerminal(result.tag) : false;
  state.imagePreviewLabel = pasted ? `${result.tag} copied into active prompt` : `${result.tag} saved`;
  state.imagePreviewZoom = 1;
  state.imagePreviewOffsetX = 0;
  state.imagePreviewOffsetY = 0;
  syncActiveImageTabFromState();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
  setStatus(pasted ? `Saved and pasted ${result.path}` : `Saved ${result.path}`);
  saveActiveWorkspaceSnapshot();
}

function renderImagePreview() {
  const label = state.imagePreviewLabel;
  const dataUrl = state.imagePreviewDataUrl;
  const visible = Boolean(dataUrl);
  const transformSignature = imagePreviewTransformSignature();
  const labelChanged = imagePreviewRenderedLabel !== label;
  const dataChanged = imagePreviewRenderedDataUrl !== dataUrl;
  const transformChanged = imagePreviewRenderedTransform !== transformSignature;
  const visibleChanged = el.imagePreview.classList.contains('visible') !== visible;
  if (!labelChanged && !dataChanged && !transformChanged && !visibleChanged) return;

  imagePreviewRenderedLabel = label;
  imagePreviewRenderedDataUrl = dataUrl;
  if (labelChanged) setTextContentIfChanged(el.imageLabel, label);
  if (dataChanged) {
    if (dataUrl) el.imagePreview.src = dataUrl;
    else if (el.imagePreview.hasAttribute('src')) el.imagePreview.removeAttribute('src');
  }
  if (visibleChanged) el.imagePreview.classList.toggle('visible', visible);
  applyImagePreviewTransform();
}

function normalizedImageZoom(value: unknown) {
  const zoom = Number(value);
  return clamp(Number.isFinite(zoom) ? zoom : 1, IMAGE_PREVIEW_MIN_ZOOM, IMAGE_PREVIEW_MAX_ZOOM);
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function imagePreviewTransformSignature() {
  return `${normalizedImageZoom(state.imagePreviewZoom).toFixed(4)}:${Math.round(state.imagePreviewOffsetX)}:${Math.round(state.imagePreviewOffsetY)}`;
}

function resetImageTabView(tab: ImageTabState) {
  tab.zoom = 1;
  tab.offsetX = 0;
  tab.offsetY = 0;
}

function fitActiveImagePreview() {
  state.imagePreviewZoom = 1;
  state.imagePreviewOffsetX = 0;
  state.imagePreviewOffsetY = 0;
  syncActiveImageTabFromState();
  renderImagePreview();
  saveActiveWorkspaceSnapshot();
}

// Fit the image so the chosen axis fills the stage. The base render is object-fit:contain
// (zoom 1 = whole image fits), so a width/height fit is just a zoom relative to that contain
// scale: when the other axis overflows, the existing pan machinery (enabled at zoom > 1) lets
// the user drag along it.
function fitImagePreviewToAxis(axis: 'width' | 'height') {
  if (!state.imagePreviewDataUrl) return;
  const rect = el.imagePreviewStage.getBoundingClientRect();
  const imgW = el.imagePreview.naturalWidth;
  const imgH = el.imagePreview.naturalHeight;
  if (!rect.width || !rect.height || !imgW || !imgH) return;
  const containScale = Math.min(rect.width / imgW, rect.height / imgH);
  if (!(containScale > 0)) return;
  const targetScale = axis === 'width' ? rect.width / imgW : rect.height / imgH;
  state.imagePreviewZoom = normalizedImageZoom(targetScale / containScale);
  state.imagePreviewOffsetX = 0;
  state.imagePreviewOffsetY = 0;
  clampImagePreviewPan();
  syncActiveImageTabFromState();
  renderImagePreview();
  saveActiveWorkspaceSnapshot();
}

function handleImagePreviewWheel(event: WheelEvent) {
  if (!state.imagePreviewDataUrl) return;
  if (event.ctrlKey) {
    event.preventDefault();
    event.stopPropagation();
    const oldZoom = normalizedImageZoom(state.imagePreviewZoom);
    const factor = event.deltaY < 0 ? IMAGE_PREVIEW_WHEEL_FACTOR : 1 / IMAGE_PREVIEW_WHEEL_FACTOR;
    const nextZoom = normalizedImageZoom(oldZoom * factor);
    if (Math.abs(nextZoom - oldZoom) < 0.0001) return;
    zoomImagePreviewAt(event.clientX, event.clientY, oldZoom, nextZoom);
    return;
  }
  // Plain wheel pans the zoomed image. A single drag stroke can't always reach
  // an edge on a small panel (the WebView may drop pointer capture once the
  // cursor leaves the stage), so wheel panning is the reliable way to reach the
  // top/bottom of a tall image. clampImagePreviewPan keeps it within bounds.
  if (normalizedImageZoom(state.imagePreviewZoom) <= 1) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.shiftKey) {
    state.imagePreviewOffsetX -= event.deltaY || event.deltaX;
  } else {
    state.imagePreviewOffsetX -= event.deltaX;
    state.imagePreviewOffsetY -= event.deltaY;
  }
  clampImagePreviewPan();
  syncActiveImageTabFromState();
  applyImagePreviewTransform();
  saveActiveWorkspaceSnapshot();
}

function zoomImagePreviewAt(clientX: number, clientY: number, oldZoom: number, nextZoom: number) {
  const rect = el.imagePreviewStage.getBoundingClientRect();
  const anchorX = clientX - rect.left - rect.width / 2;
  const anchorY = clientY - rect.top - rect.height / 2;
  const ratio = nextZoom / oldZoom;
  state.imagePreviewZoom = nextZoom;
  state.imagePreviewOffsetX = (state.imagePreviewOffsetX - anchorX) * ratio + anchorX;
  state.imagePreviewOffsetY = (state.imagePreviewOffsetY - anchorY) * ratio + anchorY;
  clampImagePreviewPan();
  syncActiveImageTabFromState();
  renderImagePreview();
  saveActiveWorkspaceSnapshot();
}

function startImagePreviewDrag(event: PointerEvent) {
  if (!state.imagePreviewDataUrl || normalizedImageZoom(state.imagePreviewZoom) <= 1) return;
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  imagePreviewDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: state.imagePreviewOffsetX,
    offsetY: state.imagePreviewOffsetY
  };
  el.imagePreviewStage.classList.add('dragging');
  bindImagePreviewDragDocumentListeners();
  try {
    el.imagePreviewStage.setPointerCapture(event.pointerId);
  } catch {
    // Some WebView builds can refuse capture after native image handling starts.
  }
}

function moveImagePreviewDrag(event: PointerEvent) {
  if (!imagePreviewDrag || imagePreviewDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  state.imagePreviewOffsetX = imagePreviewDrag.offsetX + event.clientX - imagePreviewDrag.startX;
  state.imagePreviewOffsetY = imagePreviewDrag.offsetY + event.clientY - imagePreviewDrag.startY;
  clampImagePreviewPan();
  syncActiveImageTabFromState();
  applyImagePreviewTransform();
}

function finishImagePreviewDrag(event: PointerEvent) {
  if (!imagePreviewDrag || imagePreviewDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  endImagePreviewDrag(event.pointerId, { save: true });
}

function bindImagePreviewDragDocumentListeners() {
  if (imagePreviewDragDocumentBound) return;
  imagePreviewDragDocumentBound = true;
  document.addEventListener('pointermove', moveImagePreviewDrag, true);
  document.addEventListener('pointerup', finishImagePreviewDrag, true);
  document.addEventListener('pointercancel', finishImagePreviewDrag, true);
  window.addEventListener('blur', cancelImagePreviewDrag);
}

function unbindImagePreviewDragDocumentListeners() {
  if (!imagePreviewDragDocumentBound) return;
  imagePreviewDragDocumentBound = false;
  document.removeEventListener('pointermove', moveImagePreviewDrag, true);
  document.removeEventListener('pointerup', finishImagePreviewDrag, true);
  document.removeEventListener('pointercancel', finishImagePreviewDrag, true);
  window.removeEventListener('blur', cancelImagePreviewDrag);
}

function cancelImagePreviewDrag() {
  if (!imagePreviewDrag) return;
  endImagePreviewDrag(imagePreviewDrag.pointerId, { save: false });
}

function endImagePreviewDrag(pointerId: number, options: { save: boolean }) {
  if (el.imagePreviewStage.hasPointerCapture(pointerId)) {
    try {
      el.imagePreviewStage.releasePointerCapture(pointerId);
    } catch {
      // Capture may already be gone when the pointer leaves the WebView.
    }
  }
  imagePreviewDrag = null;
  unbindImagePreviewDragDocumentListeners();
  el.imagePreviewStage.classList.remove('dragging');
  clampImagePreviewPan();
  syncActiveImageTabFromState();
  applyImagePreviewTransform();
  if (options.save) saveActiveWorkspaceSnapshot();
}

function clampImagePreviewPan() {
  const zoom = normalizedImageZoom(state.imagePreviewZoom);
  state.imagePreviewZoom = zoom;
  if (zoom <= 1 || !el.imagePreview.naturalWidth || !el.imagePreview.naturalHeight) {
    state.imagePreviewOffsetX = 0;
    state.imagePreviewOffsetY = 0;
    return;
  }
  const rect = el.imagePreviewStage.getBoundingClientRect();
  const fitScale = Math.min(rect.width / el.imagePreview.naturalWidth, rect.height / el.imagePreview.naturalHeight);
  const renderedWidth = el.imagePreview.naturalWidth * fitScale * zoom;
  const renderedHeight = el.imagePreview.naturalHeight * fitScale * zoom;
  const maxX = Math.max(0, (renderedWidth - rect.width) / 2);
  const maxY = Math.max(0, (renderedHeight - rect.height) / 2);
  state.imagePreviewOffsetX = clamp(state.imagePreviewOffsetX, -maxX, maxX);
  state.imagePreviewOffsetY = clamp(state.imagePreviewOffsetY, -maxY, maxY);
}

function applyImagePreviewTransform() {
  clampImagePreviewPan();
  const zoom = normalizedImageZoom(state.imagePreviewZoom);
  imagePreviewRenderedTransform = imagePreviewTransformSignature();
  const transform = `translate3d(${state.imagePreviewOffsetX.toFixed(1)}px, ${state.imagePreviewOffsetY.toFixed(1)}px, 0) scale(${zoom.toFixed(4)})`;
  if (el.imagePreview.style.transform !== transform) el.imagePreview.style.transform = transform;
  toggleClassIfChanged(el.imagePreviewStage, 'zoomed', zoom > 1 && Boolean(state.imagePreviewDataUrl));
  el.imageFit.disabled = !state.imagePreviewDataUrl || (zoom === 1 && state.imagePreviewOffsetX === 0 && state.imagePreviewOffsetY === 0);
  el.imageFitWidth.disabled = !state.imagePreviewDataUrl;
  el.imageFitHeight.disabled = !state.imagePreviewDataUrl;
}

function renderImageHistory() {
  el.imageHistoryToggle.classList.toggle('active', state.imageHistoryVisible);
  el.imageHistoryToggle.setAttribute('aria-pressed', String(state.imageHistoryVisible));
  el.imageHistoryClear.disabled = state.imageHistory.length === 0;
  el.imageHistory.classList.toggle('hidden', !state.imageHistoryVisible);
  if (!state.imageHistoryVisible) return;
  const signature = imageHistorySignature();
  if (imageHistoryRenderSignature === signature) return;
  imageHistoryRenderSignature = signature;

  if (state.imageHistory.length === 0) {
    imageHistoryOrderRenderSignature = 'empty';
    const empty = document.createElement('div');
    empty.className = 'image-history-empty';
    empty.textContent = 'No pasted images yet.';
    el.imageHistory.replaceChildren(empty);
    imageHistoryElementCache.clear();
    return;
  }

  const orderSignature = imageHistoryOrderSignature();
  const sameOrder = imageHistoryOrderRenderSignature === orderSignature
    && el.imageHistory.childElementCount === state.imageHistory.length;

  if (sameOrder) {
    for (const item of state.imageHistory) {
      updateImageHistoryElement(imageHistoryElement(item.id), item);
    }
    return;
  }

  imageHistoryOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const item of state.imageHistory) {
    seen.add(item.id);
    const row = imageHistoryElement(item.id);
    updateImageHistoryElement(row, item);
    fragment.append(row);
  }
  el.imageHistory.replaceChildren(fragment);
  pruneImageHistoryElementCache(seen);
}

function imageHistoryElement(id: string) {
  const cached = imageHistoryElementCache.get(id);
  if (cached) return cached;
  const row = document.createElement('div');
  row.className = 'image-history-row';
  row.dataset.imageHistoryId = id;

  const preview = document.createElement('button');
  preview.className = 'image-history-preview';
  preview.title = 'Preview image';
  const image = document.createElement('img');
  image.alt = '';
  preview.append(image);
  preview.addEventListener('click', () => {
    const item = imageHistoryItemForRow(row);
    if (item) previewImageHistoryItem(item);
  });

  const meta = document.createElement('button');
  meta.className = 'image-history-meta';
  meta.title = 'Preview image';
  const path = document.createElement('span');
  const createdAt = document.createElement('small');
  meta.append(path, createdAt);
  meta.addEventListener('click', () => {
    const item = imageHistoryItemForRow(row);
    if (item) previewImageHistoryItem(item);
  });

  const paste = document.createElement('button');
  paste.className = 'image-history-paste';
  paste.textContent = 'Paste';
  paste.title = 'Paste tag to active shell';
  paste.addEventListener('click', () => {
    const item = imageHistoryItemForRow(row);
    if (item) void pasteImageTagToActiveTerminal(item.tag);
  });

  row.append(preview, meta, paste);
  imageHistoryPartCache.set(row, { image, path, createdAt });
  imageHistoryElementCache.set(id, row);
  return row;
}

function imageHistoryParts(row: HTMLElement) {
  const cached = imageHistoryPartCache.get(row);
  if (cached) return cached;
  const meta = row.querySelector<HTMLElement>('.image-history-meta')!;
  const parts = {
    image: row.querySelector<HTMLImageElement>('.image-history-preview img')!,
    path: meta.querySelector<HTMLElement>('span')!,
    createdAt: meta.querySelector<HTMLElement>('small')!
  };
  imageHistoryPartCache.set(row, parts);
  return parts;
}

function updateImageHistoryElement(row: HTMLElement, item: PastedImageItem) {
  const signature = `${item.id}\t${item.path}\t${item.tag}\t${item.createdAt}\t${item.dataUrl.length}`;
  row.dataset.imageHistoryId = item.id;
  if (row.dataset.renderSignature === signature) return;
  row.dataset.renderSignature = signature;
  row.className = 'image-history-row';
  const parts = imageHistoryParts(row);
  const image = parts.image;
  if (image.src !== item.dataUrl) image.src = item.dataUrl;
  setTextContentIfChanged(parts.path, item.path);
  setTextContentIfChanged(parts.createdAt, item.createdAt);
}

function imageHistoryItemForRow(row: HTMLElement) {
  const id = row.dataset.imageHistoryId ?? '';
  return state.imageHistory.find((item) => item.id === id) ?? null;
}

function pruneImageHistoryElementCache(seen: Set<string>) {
  for (const id of imageHistoryElementCache.keys()) {
    if (!seen.has(id)) imageHistoryElementCache.delete(id);
  }
}

function imageHistoryOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.imageHistory.length; index += 1) {
    if (index) signature += '\n';
    signature += state.imageHistory[index].id;
  }
  return signature;
}

function imageHistorySignature() {
  let signature = '';
  for (let index = 0; index < state.imageHistory.length; index += 1) {
    const item = state.imageHistory[index];
    if (index) signature += '\n';
    signature += `${item.id}\t${item.path}\t${item.createdAt}\t${item.dataUrl.length}`;
  }
  return signature;
}

function previewImageHistoryItem(item: PastedImageItem) {
  state.imagePreviewDataUrl = item.dataUrl;
  state.imagePreviewLabel = item.tag;
  state.imagePreviewZoom = 1;
  state.imagePreviewOffsetX = 0;
  state.imagePreviewOffsetY = 0;
  syncActiveImageTabFromState();
  renderImagePreview();
  renderImageTabs();
  saveActiveWorkspaceSnapshot();
}

async function pasteImageTagToActiveTerminal(tag: string) {
  const active = terminalPaneById.get(state.activePaneId);
  if (!active?.backendId) {
    setStatus('No active shell for image tag paste', true);
    return false;
  }
  await api.writeTerminal(active.backendId, tag);
  setStatus(`Pasted ${tag}`);
  return true;
}

function clearForwardLookup() {
  forwardById.clear();
  forwardByRemotePort.clear();
}

function rememberForward(forward: PortForwardResult) {
  forwardById.set(forward.id, forward);
  if (!forwardByRemotePort.has(forward.remotePort)) forwardByRemotePort.set(forward.remotePort, forward);
}

function forgetForward(forward: PortForwardResult) {
  forwardById.delete(forward.id);
  if (forwardByRemotePort.get(forward.remotePort) !== forward) return;
  forwardByRemotePort.delete(forward.remotePort);
  for (const candidate of state.forwards) {
    if (candidate === forward || candidate.remotePort !== forward.remotePort) continue;
    forwardByRemotePort.set(candidate.remotePort, candidate);
    return;
  }
}

function addForward(forward: PortForwardResult) {
  state.forwards.push(forward);
  rememberForward(forward);
}

function forwardForId(id: string) {
  if (!id) return null;
  let forward = forwardById.get(id) ?? null;
  if (!forward) {
    forward = state.forwards.find((item) => item.id === id) ?? null;
    if (forward) rememberForward(forward);
  }
  return forward;
}

function forwardForRemotePort(port: number) {
  let forward = forwardByRemotePort.get(port) ?? null;
  if (!forward) {
    forward = state.forwards.find((item) => item.remotePort === port) ?? null;
    if (forward) rememberForward(forward);
  }
  return forward;
}

function removeForwardById(id: string) {
  const forward = forwardForId(id);
  let index = forward ? state.forwards.indexOf(forward) : -1;
  if (index < 0) index = state.forwards.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const removed = state.forwards[index];
  forgetForward(removed);
  state.forwards.splice(index, 1);
  return removed;
}

function clearDetectedPortLookup() {
  detectedPortById.clear();
}

function rememberDetectedPort(port: DetectedPortItem) {
  detectedPortById.set(port.id, port);
}

function forgetDetectedPort(port: DetectedPortItem) {
  detectedPortById.delete(port.id);
}

function detectedPortForId(id: string) {
  if (!id) return null;
  let port = detectedPortById.get(id) ?? null;
  if (!port) {
    port = state.detectedPorts.find((item) => item.id === id) ?? null;
    if (port) rememberDetectedPort(port);
  }
  return port;
}

function addDetectedPort(port: DetectedPortItem) {
  state.detectedPorts.push(port);
  rememberDetectedPort(port);
}

function removeDetectedPortById(id: string) {
  const port = detectedPortForId(id);
  let index = port ? state.detectedPorts.indexOf(port) : -1;
  if (index < 0) index = state.detectedPorts.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const removed = state.detectedPorts[index];
  forgetDetectedPort(removed);
  state.detectedPorts.splice(index, 1);
  return removed;
}

async function startForward() {
  if (!state.activeProfile) return;
  const remotePort = Number(el.remotePort.value);
  const localPort = Number(el.localPort.value || remotePort);
  if (!Number.isInteger(remotePort) || remotePort <= 0) {
    setStatus('Enter a valid remote port', true);
    return;
  }
  try {
    const forward = await api.startPortForward(state.activeProfile.id, remotePort, localPort);
    addForward(forward);
    removeDetectedPortById(detectedPortId(state.activeProfile.id, remotePort));
    renderForwards();
    await openLocalBrowserTab(forward.url, portTabLabel(forward.localPort));
    setStatus(`Forwarding ${forward.localPort} -> ${forward.targetHost}:${forward.remotePort}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

async function openPreviewValue(value: string) {
  const normalized = normalizeBrowserAddressValue(value);
  if (!normalized) return;
  rememberBrowserAddress(normalized);
  hideBrowserAddressSuggestions();
  const localUrl = parseLocalPreviewUrl(normalized);
  if (localUrl) {
    await openLocalPreviewUrl(localUrl);
    return;
  }
  const port = parsePreviewPort(normalized);
  if (port) {
    await openPort(port, 'manual');
    return;
  }
  openBrowserTab(normalized);
}

async function openLocalPreviewUrl(url: URL) {
  const port = Number(url.port);
  if (!isPreviewPort(port)) return;
  const suffix = `${url.pathname}${url.search}${url.hash}`;
  const directUrl = `http://127.0.0.1:${port}${suffix}`;
  if (!state.activeProfile || state.activeProfile.kind === 'windows') {
    await openLocalBrowserTab(directUrl, browserTabLabel(url.toString()));
    return;
  }

  if (await canUseDirectLocalPreview(directUrl)) {
    await openLocalBrowserTab(directUrl, browserTabLabel(url.toString()));
    setStatus(`Previewing local :${port}`);
    return;
  }

  const existing = forwardForRemotePort(port);
  if (existing) {
    await openLocalBrowserTab(`${existing.url}${suffix}`, browserTabLabel(url.toString()));
    return;
  }

  const forward = await startForwardForPort(port, 'manual');
  addForward(forward);
  removeDetectedPortById(detectedPortId(state.activeProfile.id, port));
  renderForwards();
  await openLocalBrowserTab(`${forward.url}${suffix}`, browserTabLabel(url.toString()));
  setStatus(`Forwarding ${forward.localPort} -> ${forward.targetHost}:${forward.remotePort}`);
}

async function canUseDirectLocalPreview(url: string) {
  try {
    return await api.probeLocalHttpUrl(url);
  } catch {
    return false;
  }
}

function handleTerminalData(pane: TerminalPane, data: string) {
  pane.backendOutputChars += data.length;
  const visibility = enqueueTerminalWrite(pane, data);
  if (data.includes('\x1b]7;')) {
    const oscCwd = extractOsc7Cwd(data);
    if (oscCwd) updateTerminalCwd(pane, oscCwd);
  }

  const shouldTrackPromptCwd = terminalDataMayContainPromptCwdHint(pane, data, visibility);
  const shouldScanPorts = visibility !== 'background'
    && (Boolean(pane.portScanTimer) || terminalDataMayContainPortHint(pane, data, visibility));
  if (!shouldTrackPromptCwd && !shouldScanPorts) return;

  if (shouldTrackPromptCwd) trackTerminalPromptCwdFromOutput(pane, data);
  if (shouldScanPorts) scanTerminalOutputForPorts(pane, data);
}

function handleTerminalSnapshotData(pane: TerminalPane, output: string) {
  if (!output) return;
  const alreadyWritten = pane.backendOutputChars;
  if (alreadyWritten > 0) {
    if (output.length <= alreadyWritten) return;
    handleTerminalData(pane, output.slice(alreadyWritten));
    return;
  }
  handleTerminalData(pane, output);
}

function enqueueTerminalWrite(pane: TerminalPane, data: string) {
  pane.writeBuffer += data;

  const visibility = terminalPaneVisibility(pane);
  if (visibility === 'visible') {
    if (pane.writeTimer) {
      window.clearTimeout(pane.writeTimer);
      pane.writeTimer = undefined;
    }
    if (pane.writeBuffer.length >= TERMINAL_WRITE_FORCE_FLUSH_CHARS) {
      flushTerminalWriteBuffer(pane);
      return visibility;
    }
    if (pane.writeFrame) return visibility;
    pane.writeFrame = window.requestAnimationFrame(() => {
      pane.writeFrame = undefined;
      flushTerminalWriteBuffer(pane);
    });
    return visibility;
  }

  if (pane.writeFrame) {
    window.cancelAnimationFrame(pane.writeFrame);
    pane.writeFrame = undefined;
  }
  if (visibility === 'background' && pane.writeBuffer.length < TERMINAL_WRITE_FORCE_FLUSH_CHARS) return visibility;
  if (pane.writeTimer) return visibility;
  const delay = visibility === 'inactive'
    ? TERMINAL_INACTIVE_WRITE_BATCH_MS
    : TERMINAL_BACKGROUND_WRITE_BATCH_MS;
  pane.writeTimer = window.setTimeout(() => {
    pane.writeTimer = undefined;
    flushTerminalWriteBufferWhenReady(pane, delay);
  }, delay);
  return visibility;
}

function flushTerminalWriteBufferWhenReady(pane: TerminalPane, timeout = TERMINAL_BACKGROUND_WRITE_BATCH_MS) {
  if (terminalPaneVisibility(pane) === 'visible') {
    flushTerminalWriteBuffer(pane);
    return;
  }
  runWhenUiIdle(() => flushTerminalWriteBuffer(pane), timeout);
}

function terminalPaneVisibility(pane: TerminalPane): TerminalVisibility {
  if (document.hidden || pane.workspaceId !== state.activeWorkspaceId) return 'background';
  if (!pane.element.classList.contains('hidden') && !pane.host.classList.contains('hidden')) return 'visible';
  return 'inactive';
}

function isTerminalPaneVisible(pane: TerminalPane) {
  return terminalPaneVisibility(pane) === 'visible';
}

function terminalImeCompositionGuardActive(pane: TerminalPane) {
  return Boolean(pane.imeComposing) && terminalPaneVisibility(pane) === 'visible';
}

function flushTerminalWriteBuffer(pane: TerminalPane) {
  if (pane.writeFrame) {
    window.cancelAnimationFrame(pane.writeFrame);
    pane.writeFrame = undefined;
  }
  if (pane.writeTimer) {
    window.clearTimeout(pane.writeTimer);
    pane.writeTimer = undefined;
  }
  if (!pane.writeBuffer) return;
  const visibility = terminalPaneVisibility(pane);
  const chunkSize = terminalWriteChunkSize(pane, visibility);
  const end = pane.writeBuffer.length > chunkSize
    ? surrogateSafeChunkEnd(pane.writeBuffer, chunkSize)
    : pane.writeBuffer.length;
  const output = end === pane.writeBuffer.length ? pane.writeBuffer : pane.writeBuffer.slice(0, end);
  pane.writeBuffer = end === pane.writeBuffer.length ? '' : pane.writeBuffer.slice(end);
  pane.term.write(output);
  scheduleTerminalWriteContinuation(pane, visibility);
}

function surrogateSafeChunkEnd(text: string, desiredEnd: number) {
  if (desiredEnd <= 0) return 0;
  if (desiredEnd >= text.length) return text.length;
  const code = text.charCodeAt(desiredEnd - 1);
  if (code >= 0xd800 && code <= 0xdbff) return desiredEnd - 1;
  return desiredEnd;
}

function terminalWriteChunkSize(pane: TerminalPane, visibility: TerminalVisibility) {
  if (visibility === 'visible' && terminalHasRecentUserInput(pane)) {
    return TERMINAL_RECENT_INPUT_WRITE_CHUNK_CHARS;
  }
  return visibility === 'visible'
    ? TERMINAL_VISIBLE_WRITE_CHUNK_CHARS
    : TERMINAL_HIDDEN_WRITE_CHUNK_CHARS;
}

function terminalHasRecentUserInput(pane: TerminalPane) {
  return performance.now() - (pane.lastUserInputAt ?? 0) < TERMINAL_RECENT_INPUT_WINDOW_MS;
}

function scheduleTerminalWriteContinuation(pane: TerminalPane, visibility = terminalPaneVisibility(pane)) {
  if (!pane.writeBuffer) return;
  if (visibility === 'visible') {
    if (pane.writeFrame) return;
    pane.writeFrame = window.requestAnimationFrame(() => {
      pane.writeFrame = undefined;
      flushTerminalWriteBuffer(pane);
    });
    return;
  }
  if (pane.writeTimer) return;
  const delay = visibility === 'inactive'
    ? TERMINAL_INACTIVE_WRITE_BATCH_MS
    : TERMINAL_BACKGROUND_WRITE_BATCH_MS;
  pane.writeTimer = window.setTimeout(() => {
    pane.writeTimer = undefined;
    flushTerminalWriteBufferWhenReady(pane, delay);
  }, delay);
}

function cleanupTerminalWriteBuffer(pane: TerminalPane) {
  if (pane.writeFrame) window.cancelAnimationFrame(pane.writeFrame);
  if (pane.focusFrame) window.cancelAnimationFrame(pane.focusFrame);
  if (pane.writeTimer) window.clearTimeout(pane.writeTimer);
  if (pane.focusRetryTimer) window.clearTimeout(pane.focusRetryTimer);
  if (pane.portScanTimer) window.clearTimeout(pane.portScanTimer);
  if (pane.cwdScanTimer) window.clearTimeout(pane.cwdScanTimer);
  if (pane.inputFlushTimer) window.clearTimeout(pane.inputFlushTimer);
  if (pane.imeFallbackTimer) window.clearTimeout(pane.imeFallbackTimer);
  if (pane.imeReleaseTimer) window.clearTimeout(pane.imeReleaseTimer);
  pane.writeFrame = undefined;
  pane.focusFrame = undefined;
  pane.writeTimer = undefined;
  pane.focusRetryTimer = undefined;
  pane.portScanTimer = undefined;
  pane.cwdScanTimer = undefined;
  pane.inputFlushTimer = undefined;
  pane.imeFallbackTimer = undefined;
  pane.imeReleaseTimer = undefined;
  pane.inputBuffer = '';
  pane.inputWritePromise = undefined;
  pane.imeComposing = false;
  pane.writeBuffer = '';
}

function terminalDataMayContainPromptCwdHint(pane: TerminalPane, data: string, visibility = terminalPaneVisibility(pane)) {
  if (pane.command) return false;
  if (visibility === 'background') return false;
  if (terminalOutputMayContainPromptCwdHint(data)) return true;
  if (!pane.cwdOutputBuffer || data.length > TERMINAL_CWD_CONTINUATION_TAIL_LIMIT) return false;
  const tail = terminalPromptCwdContinuationTail(pane.cwdOutputBuffer);
  return tail ? terminalOutputMayContainPromptCwdHint(`${tail}${data}`) : false;
}

function terminalDataMayContainPortHint(pane: TerminalPane, data: string, visibility = terminalPaneVisibility(pane)) {
  if (visibility === 'background') return false;
  if (pane.workspaceId !== state.activeWorkspaceId) return false;
  if (!state.activeProfile) return false;
  return terminalOutputMayContainPreviewPortHint(data);
}

function scanTerminalOutputForPorts(pane: TerminalPane, data: string) {
  if (pane.workspaceId !== state.activeWorkspaceId) return;
  if (!state.activeProfile) return;
  pane.outputBuffer = appendLimitedTextBuffer(pane.outputBuffer, data, TERMINAL_PORT_SCAN_LIMIT);
  scheduleTerminalPortScan(pane);
}

function scheduleTerminalPortScan(pane: TerminalPane) {
  if (pane.portScanTimer) return;
  const delay = terminalScanDelay(pane, TERMINAL_PORT_SCAN_DEBOUNCE_MS);
  pane.portScanTimer = window.setTimeout(() => {
    pane.portScanTimer = undefined;
    runTerminalScanWhenReady(pane, () => runTerminalPortScan(pane));
  }, delay);
}

function runTerminalScanWhenReady(pane: TerminalPane, scan: () => void) {
  if (terminalPaneVisibility(pane) === 'visible') {
    scan();
    return;
  }
  runWhenUiIdle(scan, terminalScanDelay(pane, TERMINAL_BACKGROUND_SCAN_BATCH_MS));
}

function runTerminalPortScan(pane: TerminalPane) {
  if (pane.workspaceId !== state.activeWorkspaceId) return;
  if (!state.activeProfile) return;
  if (!terminalOutputMayContainPreviewPortHint(pane.outputBuffer)) return;
  const cleanOutput = cleanTerminalMetadataBuffer(pane.outputBuffer);
  if (!terminalOutputMayContainPreviewPortHint(cleanOutput)) return;
  const found = detectNewLocalServerPorts(cleanOutput, pane.seenPorts, queueDetectedPort);
  if (found) pane.outputBuffer = '';
}

function terminalOutputMayContainPreviewPortHint(text: string) {
  if (!text) return false;
  if (!text.includes(':') && !TERMINAL_PREVIEW_PORT_KEYWORD_PATTERN.test(text)) return false;
  return TERMINAL_PREVIEW_PORT_HINT_PATTERN.test(text);
}

const TERMINAL_PREVIEW_PORT_KEYWORD_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\b(?:listening|running|available|started|serving|server|port)\b/i;

function terminalOutputMayContainPromptCwdHint(text: string) {
  if (!text) return false;
  if (text.length <= 256) return TERMINAL_PROMPT_SHORT_HINT_PATTERN.test(text);
  return TERMINAL_PROMPT_CWD_HINT_PATTERN.test(text);
}

function trackTerminalPromptCwdFromOutput(pane: TerminalPane, data: string) {
  pane.cwdOutputBuffer = appendLimitedTextBuffer(pane.cwdOutputBuffer, data, TERMINAL_CWD_SCAN_LIMIT);
  scheduleTerminalPromptCwdScan(pane);
}

function scheduleTerminalPromptCwdScan(pane: TerminalPane) {
  if (pane.cwdScanTimer) return;
  pane.cwdScanTimer = window.setTimeout(() => {
    pane.cwdScanTimer = undefined;
    runTerminalScanWhenReady(pane, () => runTerminalPromptCwdScan(pane));
  }, terminalScanDelay(pane, TERMINAL_CWD_SCAN_DEBOUNCE_MS));
}

function terminalScanDelay(pane: TerminalPane, visibleDelay: number) {
  const visibility = terminalPaneVisibility(pane);
  if (visibility === 'visible') return visibleDelay;
  if (visibility === 'inactive') return Math.max(visibleDelay * 3, TERMINAL_INACTIVE_WRITE_BATCH_MS);
  return TERMINAL_BACKGROUND_SCAN_BATCH_MS;
}

function runTerminalPromptCwdScan(pane: TerminalPane) {
  if (pane.command) return;
  const promptCwd = extractPromptCwd(cleanTerminalMetadataBuffer(pane.cwdOutputBuffer), pane);
  if (promptCwd) {
    pane.cwdOutputBuffer = '';
    updateTerminalCwd(pane, promptCwd);
    return;
  }
  pane.cwdOutputBuffer = terminalPromptCwdContinuationTail(pane.cwdOutputBuffer);
}

function cleanTerminalMetadataBuffer(value: string) {
  return stripAnsi(value).replace(/\r/g, '\n');
}

function trackTerminalCwdFromInput(pane: TerminalPane, data: string) {
  if (pane.command) return;
  for (const char of data) {
    if (char === '\r' || char === '\n') {
      updateTerminalCwdFromCommand(pane, pane.inputBuffer);
      pane.inputBuffer = '';
    } else if (char === '\u007f' || char === '\b') {
      pane.inputBuffer = pane.inputBuffer.slice(0, -1);
    } else if (char >= ' ' && char !== '\x7f') {
      pane.inputBuffer = `${pane.inputBuffer}${char}`.slice(-1000);
    }
  }
}

function updateTerminalCwdFromCommand(pane: TerminalPane, command: string) {
  const target = parseCdTarget(command);
  if (target === null) return;
  const next = resolveTerminalCdTarget(pane, target);
  if (next) updateTerminalCwd(pane, next);
}

function parseCdTarget(command: string) {
  const cleaned = command
    .replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '')
    .trim();
  const match = cleaned.match(/^(?:builtin\s+)?(?:cd|chdir|pushd)(?:\s+(.+?))?\s*(?:&&|;|$)/);
  if (!match) return null;
  const raw = (match[1] ?? '').trim();
  if (!raw) return '~';
  if (raw === '-') return null;
  return unquoteShellToken(raw);
}

function unquoteShellToken(value: string) {
  const token = value.trim().match(/^("(?:\\.|[^"])*"|'[^']*'|[^\s;&|]+)/)?.[1] ?? '';
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token.replace(/\\ /g, ' ');
}

function resolveTerminalCdTarget(pane: TerminalPane, target: string) {
  const profile = profileForId(pane.profileId) ?? state.activeProfile;
  if (isWindowsPath(pane.cwd) || profile?.kind === 'windows') {
    return normalizeWindowsTerminalPath(resolveWindowsCdTarget(pane.cwd, target, profile?.root));
  }
  return normalizePosixTerminalPath(resolvePosixCdTarget(pane.cwd, target, profile?.root));
}

function resolvePosixCdTarget(cwd: string, target: string, root = '~') {
  if (!target || target === '~') return expandTildeTerminalPath(root || '~', cwd);
  if (target.startsWith('~/') || target === '~') return expandTildeTerminalPath(target, cwd);
  if (target.startsWith('/')) return target;
  const base = cwd || root || '~';
  if (base.endsWith('/')) return `${base}${target}`;
  return `${base}/${target}`;
}

function resolveWindowsCdTarget(cwd: string, target: string, root = '') {
  if (!target || target === '~') return root || cwd;
  if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\')) return target;
  const base = cwd || root || '';
  return `${base.replace(/[\\/]+$/, '')}\\${target}`;
}

function extractOsc7Cwd(data: string) {
  let found = '';
  TERMINAL_OSC7_CWD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERMINAL_OSC7_CWD_PATTERN.exec(data))) {
    found = decodeTerminalPath(match[1]);
  }
  return found;
}

function extractPromptCwd(buffer: string, pane: TerminalPane) {
  let end = buffer.length;
  for (let scanned = 0; end >= 0 && scanned < 40; scanned += 1) {
    const lineStart = buffer.lastIndexOf('\n', end - 1);
    const line = buffer.slice(lineStart + 1, end).trimEnd();
    const powershell = TERMINAL_POWERSHELL_PROMPT_CWD_PATTERN.exec(line);
    if (powershell) return normalizeWindowsTerminalPath(powershell[1]);

    const bash = TERMINAL_BASH_PROMPT_CWD_PATTERN.exec(line);
    if (bash) return normalizePosixTerminalPath(expandTildeTerminalPath(bash[1].trim(), pane.cwd));
    if (lineStart < 0) break;
    end = lineStart;
  }
  return '';
}

function expandTildeTerminalPath(path: string, currentCwd: string) {
  if (!path.startsWith('~')) return path;
  const tail = path === '~' ? '' : path.slice(2);
  if (!tail) {
    for (let index = 0; index < 4; index += 1) {
      const candidate = terminalCwdCandidateAt(index, currentCwd);
      if (!candidate.startsWith('/')) continue;
      return terminalHomeFromCandidate(candidate) || path;
    }
    return path;
  }
  const slashIndex = tail.indexOf('/');
  const first = slashIndex >= 0 ? tail.slice(0, slashIndex) : tail;
  const marker = `/${first}`;
  for (let index = 0; index < 4; index += 1) {
    const candidate = terminalCwdCandidateAt(index, currentCwd);
    if (!candidate.startsWith('/')) continue;
    const markerIndex = candidate.indexOf(marker);
    if (markerIndex > 0) return `${candidate.slice(0, markerIndex)}/${tail}`;
  }
  return path;
}

function terminalCwdCandidateAt(index: number, currentCwd: string) {
  if (index === 0) return currentCwd;
  if (index === 1) return state.workspaceRoot;
  if (index === 2) return state.currentDir;
  return state.activeProfile?.root ?? '';
}

function terminalHomeFromCandidate(candidate: string) {
  if (candidate.startsWith('/home/')) {
    if (candidate.length <= 6) return '';
    const end = candidate.indexOf('/', 6);
    return end > 6 ? candidate.slice(0, end) : candidate;
  }
  if (candidate.startsWith('/Users/')) {
    if (candidate.length <= 7) return '';
    const end = candidate.indexOf('/', 7);
    return end > 7 ? candidate.slice(0, end) : candidate;
  }
  return '';
}

function updateTerminalCwd(pane: TerminalPane, cwd: string) {
  const normalized = isWindowsPath(cwd) ? normalizeWindowsTerminalPath(cwd) : normalizePosixTerminalPath(cwd);
  if (normalized.startsWith('~')) return;
  if (!normalized || normalized === pane.cwd) return;
  pane.cwd = normalized;
  const widget = terminalWidgetForPane(pane);
  if (widget) updateTerminalWidgetTitle(widget);
  scheduleTerminalCwdSnapshotSave(pane);
}

function normalizePosixTerminalPath(path: string) {
  const absoluteLike = path.startsWith('/') || path.startsWith('~');
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  if (path.startsWith('~/')) return `~/${parts.slice(1).join('/')}`;
  if (path === '~') return '~';
  return absoluteLike ? `/${parts.join('/')}` : parts.join('/');
}

function normalizeWindowsTerminalPath(path: string) {
  const normalized = path.replace(/\//g, '\\');
  const prefix = normalized.match(/^[A-Za-z]:/)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of normalized.replace(/^[A-Za-z]:\\?/, '').split('\\')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return prefix ? `${prefix}\\${parts.join('\\')}` : parts.join('\\');
}

function isWindowsPath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function decodeTerminalPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function terminalPromptCwdContinuationTail(value: string) {
  if (!value) return '';
  const tail = value.slice(-TERMINAL_CWD_CONTINUATION_TAIL_LIMIT);
  const lineStart = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r'));
  const line = lineStart >= 0 ? tail.slice(lineStart + 1) : tail;
  if (!line || line.length > TERMINAL_CWD_CONTINUATION_TAIL_LIMIT) return '';
  return TERMINAL_PROMPT_CONTINUATION_HINT_PATTERN.test(line) ? line : '';
}

function trimTerminalCwdBuffer(value: string) {
  return trimLimitedTextBuffer(value, TERMINAL_CWD_SCAN_LIMIT);
}

function scheduleTerminalCwdSnapshotSave(pane?: TerminalPane) {
  if (restoringWorkspace || !state.workspaceOpen) return;
  if (pane && pane.workspaceId !== state.activeWorkspaceId) return;
  const delay = pane && terminalPaneVisibility(pane) === 'background'
    ? TERMINAL_BACKGROUND_CWD_SAVE_DELAY_MS
    : 150;
  if (terminalCwdSaveTimer) window.clearTimeout(terminalCwdSaveTimer);
  terminalCwdSaveTimer = window.setTimeout(() => {
    terminalCwdSaveTimer = 0;
    saveActiveWorkspaceSnapshot();
  }, delay);
}

function flushTerminalCwdSnapshotSave() {
  if (terminalCwdSaveTimer) {
    window.clearTimeout(terminalCwdSaveTimer);
    terminalCwdSaveTimer = 0;
  }
  saveActiveWorkspaceSnapshot({ immediate: true });
}

async function openPort(port: number, source: 'manual' | 'auto') {
  if (!state.activeProfile || !isPreviewPort(port)) return;
  const profile = state.activeProfile;
  const key = `${profile.id}:${port}`;
  const existing = forwardForRemotePort(port);
  if (existing) {
    removeDetectedPortById(detectedPortId(profile.id, port));
    renderForwards();
    await openLocalBrowserTab(existing.url, portTabLabel(existing.localPort));
    if (source === 'auto') setStatus(`Detected port ${port}; using ${existing.url}`);
    return;
  }

  if (profile.kind === 'windows') {
    const url = `http://127.0.0.1:${port}`;
    removeDetectedPortById(detectedPortId(profile.id, port));
    renderForwards();
    await openLocalBrowserTab(url, portTabLabel(port));
    setStatus(source === 'auto' ? `Detected local server on ${url}` : `Previewing ${url}`);
    return;
  }

  if (autoForwardingPorts.has(key)) return;
  autoForwardingPorts.add(key);
  try {
    const forward = await startForwardForPort(port, source);
    addForward(forward);
    removeDetectedPortById(detectedPortId(profile.id, port));
    renderForwards();
    await openLocalBrowserTab(forward.url, portTabLabel(forward.localPort));
    setStatus(source === 'auto'
      ? `Detected port ${port}; forwarding ${forward.url}`
      : `Forwarding ${forward.localPort} -> ${forward.targetHost}:${forward.remotePort}`);
  } catch (error) {
    if (source === 'manual') {
      setStatus(String(error), true);
    } else {
      setStatus(`Detected port ${port}, but auto forward failed: ${String(error)}`, true);
    }
  } finally {
    autoForwardingPorts.delete(key);
  }
}

function queueDetectedPort(port: number) {
  if (!state.activeProfile || !isPreviewPort(port)) return;
  if (isPreviewProxyLocalPort(port)) return;
  const profile = state.activeProfile;
  const id = detectedPortId(profile.id, port);
  const url = `http://127.0.0.1:${port}`;
  if (detectedPortForId(id)) return;
  if (browserTabForUrl(url)) return;

  addDetectedPort({ id, profileId: profile.id, port, url });
  renderForwards();
  logBrowserConsole('info', `Detected local server on ${url}`);
  setStatus(isBrowserPanelHidden()
    ? `Detected local server on :${port}; open Browser to preview`
    : `Detected local server on :${port}`);
}

function detectedPortId(profileId: string, port: number) {
  return `${profileId}:${port}`;
}

async function startForwardForPort(port: number, source: 'manual' | 'auto') {
  if (!state.activeProfile) throw new Error('No active profile');
  try {
    return await api.startPortForward(state.activeProfile.id, port, port);
  } catch (error) {
    if (state.activeProfile.kind === 'windows') throw error;
    return api.startPortForward(state.activeProfile.id, port, 0);
  }
}

function renderForwards() {
  if (isBrowserPanelHidden()) return;
  const signature = forwardsSignature();
  if (forwardsRenderSignature === signature) return;
  const activeProfileId = state.activeProfile?.id;
  const rowCount = forwardRowRenderCount(activeProfileId);
  const orderSignature = forwardRowsOrderSignature(activeProfileId);
  const sameOrder = forwardsOrderRenderSignature === orderSignature
    && el.forwardList.childElementCount === rowCount;
  forwardsRenderSignature = signature;

  if (sameOrder) {
    forEachForwardRenderRow(activeProfileId, (key, kind, className, actionLabel, detail, stopLabel, id, port, url, localPort) => {
      updateForwardRowElement(forwardRowElement(key), kind, className, actionLabel, detail, stopLabel, id, port, url, localPort);
    });
    return;
  }

  forwardsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  forEachForwardRenderRow(activeProfileId, (key, kind, className, actionLabel, detail, stopLabel, id, port, url, localPort) => {
    seen.add(key);
    const element = forwardRowElement(key);
    updateForwardRowElement(element, kind, className, actionLabel, detail, stopLabel, id, port, url, localPort);
    fragment.append(element);
  });
  el.forwardList.replaceChildren(fragment);
  pruneForwardRowElementCache(seen);
}

function forEachForwardRenderRow(
  activeProfileId: string | undefined,
  callback: (
    key: string,
    kind: ForwardRenderKind,
    className: string,
    actionLabel: string,
    detail: string,
    stopLabel: string,
    id?: string,
    port?: number,
    url?: string,
    localPort?: number
  ) => void
) {
  let emitted = false;
  for (const item of state.detectedPorts) {
    if (item.profileId !== activeProfileId) continue;
    emitted = true;
    callback(
      `detected:${item.id}`,
      'detected',
      'forward-row pending',
      'Open',
      `Detected :${item.port}`,
      'Ignore',
      item.id,
      item.port
    );
  }
  for (const forward of state.forwards) {
    if (isPreviewProxyLocalPort(forward.localPort)) continue;
    emitted = true;
    callback(
      `forward:${forward.id}`,
      'forward',
      'forward-row',
      `:${forward.localPort}`,
      `Forwarded to ${forward.targetHost}:${forward.remotePort}`,
      'Stop',
      forward.id,
      undefined,
      forward.url,
      forward.localPort
    );
  }
  if (!emitted) callback('empty', 'empty', 'forward-row empty', '', 'No active manual forwards.', '');
}

function forwardRowRenderCount(activeProfileId: string | undefined) {
  let count = 0;
  for (const item of state.detectedPorts) {
    if (item.profileId === activeProfileId) count += 1;
  }
  for (const forward of state.forwards) {
    if (!isPreviewProxyLocalPort(forward.localPort)) count += 1;
  }
  return count || 1;
}

function forwardRowElement(key: string) {
  const cached = forwardRowElementCache.get(key);
  if (cached) return cached;
  const row = document.createElement('div');
  row.dataset.forwardRowKey = key;
  forwardRowElementCache.set(key, row);
  return row;
}

function updateForwardRowElement(
  row: HTMLElement,
  kind: ForwardRenderKind,
  className: string,
  actionLabel: string,
  detail: string,
  stopLabel: string,
  id = '',
  port?: number,
  url = '',
  localPort?: number
) {
  const signature = `${kind}\t${className}\t${actionLabel}\t${detail}\t${stopLabel}\t${id}\t${port ?? ''}\t${url}\t${localPort ?? ''}`;
  row.dataset.forwardKind = kind;
  if (row.dataset.renderSignature === signature) return;
  row.dataset.renderSignature = signature;
  row.className = className;

  if (kind === 'empty') {
    delete row.dataset.forwardId;
    delete row.dataset.port;
    delete row.dataset.url;
    delete row.dataset.localPort;
    forwardRowPartCache.delete(row);
    row.replaceChildren(detail);
    return;
  }

  row.dataset.forwardId = id;
  row.dataset.port = port === undefined ? '' : String(port);
  row.dataset.url = url;
  row.dataset.localPort = localPort === undefined ? '' : String(localPort);
  let parts = forwardRowPartCache.get(row);
  if (!parts) {
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'load';
    load.addEventListener('click', () => {
      if (row.dataset.forwardKind === 'detected') {
        const port = Number(row.dataset.port);
        if (Number.isFinite(port)) void openPort(port, 'manual');
        return;
      }
      const url = row.dataset.url ?? '';
      const localPort = Number(row.dataset.localPort);
      if (url) void openLocalBrowserTab(url, portTabLabel(localPort));
    });
    const detail = document.createElement('span');
    detail.className = 'forward-detail';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'stop';
    stop.addEventListener('click', () => {
      const id = row.dataset.forwardId ?? '';
      if (!id) return;
      if (row.dataset.forwardKind === 'detected') {
        removeDetectedPortById(id);
        renderForwards();
        return;
      }
      void (async () => {
        await api.stopPortForward(id).catch((error) => setStatus(String(error), true));
        removeForwardById(id);
        renderForwards();
      })();
    });
    row.replaceChildren(load, detail, stop);
    parts = { load, detail, stop };
    forwardRowPartCache.set(row, parts);
  }
  setTextContentIfChanged(parts.load, actionLabel);
  setTextContentIfChanged(parts.detail, detail);
  setTextContentIfChanged(parts.stop, stopLabel);
}

function pruneForwardRowElementCache(seen: Set<string>) {
  for (const key of forwardRowElementCache.keys()) {
    if (!seen.has(key)) forwardRowElementCache.delete(key);
  }
}

function forwardRowsOrderSignature(activeProfileId: string | undefined) {
  let signature = '';
  let count = 0;
  for (const item of state.detectedPorts) {
    if (item.profileId !== activeProfileId) continue;
    if (count) signature += '\n';
    signature += `detected:${item.id}`;
    count += 1;
  }
  for (const forward of state.forwards) {
    if (isPreviewProxyLocalPort(forward.localPort)) continue;
    if (count) signature += '\n';
    signature += `forward:${forward.id}`;
    count += 1;
  }
  return count ? signature : 'empty';
}

function forwardsSignature() {
  const activeProfileId = state.activeProfile?.id ?? '';
  let detected = '';
  let detectedCount = 0;
  for (const port of state.detectedPorts) {
    if (port.profileId !== activeProfileId) continue;
    if (detectedCount) detected += ',';
    detected += `${port.id}:${port.port}`;
    detectedCount += 1;
  }
  let forwards = '';
  let forwardCount = 0;
  for (const forward of state.forwards) {
    if (isPreviewProxyLocalPort(forward.localPort)) continue;
    if (forwardCount) forwards += ',';
    forwards += `${forward.id}:${forward.localPort}:${forward.targetHost}:${forward.remotePort}`;
    forwardCount += 1;
  }
  return `${activeProfileId}\n${detected}\n${forwards}`;
}

function loadPreview(url: string) {
  openBrowserTab(url);
}

function forEachPreviewFrame(
  workspaceId: string | undefined,
  callback: (frame: HTMLIFrameElement) => void
) {
  if (workspaceId) {
    const workspaceFrames = browserFramesByWorkspaceId.get(workspaceId);
    if (!workspaceFrames?.size) return;
    for (const frame of workspaceFrames) {
      if (frame.isConnected) callback(frame);
      else forgetBrowserFrame(frame);
    }
    return;
  }
  for (const frame of browserFrameByTabId.values()) {
    if (frame.isConnected) callback(frame);
    else forgetBrowserFrame(frame);
  }
}

function hasBrowserFramesForWorkspace(workspaceId: string) {
  const frames = browserFramesByWorkspaceId.get(workspaceId);
  if (!frames?.size) return false;
  for (const frame of frames) {
    if (frame.isConnected) return true;
    forgetBrowserFrame(frame);
  }
  return false;
}

function indexBrowserFrame(frame: HTMLIFrameElement) {
  const workspaceId = frame.dataset.browserWorkspaceId;
  if (!workspaceId) return;
  let frames = browserFramesByWorkspaceId.get(workspaceId);
  if (!frames) {
    frames = new Set();
    browserFramesByWorkspaceId.set(workspaceId, frames);
  }
  frames.add(frame);
}

function unindexBrowserFrame(frame: HTMLIFrameElement) {
  const workspaceId = frame.dataset.browserWorkspaceId;
  if (!workspaceId) return;
  const frames = browserFramesByWorkspaceId.get(workspaceId);
  if (!frames) return;
  frames.delete(frame);
  if (!frames.size) browserFramesByWorkspaceId.delete(workspaceId);
}

function forgetBrowserFrame(frame: HTMLIFrameElement) {
  const tabId = frame.dataset.browserTabId ?? '';
  if (tabId && browserFrameByTabId.get(tabId) === frame) browserFrameByTabId.delete(tabId);
  unindexBrowserFrame(frame);
}

function browserFrameForTab(id: string, workspaceId = state.activeWorkspaceId) {
  const frame = browserFrameByTabId.get(id) ?? null;
  if (!frame?.isConnected) {
    if (frame) forgetBrowserFrame(frame);
    return null;
  }
  return frame.dataset.browserWorkspaceId === workspaceId ? frame : null;
}

function activeBrowserFrame() {
  return browserFrameForTab(state.activeBrowserTabId);
}

function browserTabFrameReady(tab: BrowserTab) {
  const frame = browserFrameForTab(tab.id);
  if (!frame) return false;
  const frameUrl = tab.frameUrl ?? tab.url;
  return Boolean(frameUrl) && frame.dataset.loadedUrl === frameUrl;
}

function cancelBrowserFrameSuspend() {
  if (browserInactiveFrameSuspendTimer) window.clearTimeout(browserInactiveFrameSuspendTimer);
  browserInactiveFrameSuspendTimer = 0;
  cancelScheduledBrowserWorkspaceFrameSuspend(state.activeWorkspaceId);
}

function cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId?: string) {
  if (!workspaceId) return;
  const timer = browserWorkspaceSuspendTimers.get(workspaceId);
  if (!timer) return;
  window.clearTimeout(timer);
  browserWorkspaceSuspendTimers.delete(workspaceId);
}

function suspendBrowserFramesForAllWorkspaces() {
  for (const workspaceId of browserFramesByWorkspaceId.keys()) {
    cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
    suspendBrowserFramesForWorkspace(workspaceId, { includeActive: true });
  }
}

function scheduleBrowserWorkspaceFrameSuspend(
  workspaceId: string,
  options: { includeActive?: boolean; delayMs?: number } = {}
) {
  if (!workspaceId) return;
  cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
  const delayMs = options.delayMs ?? BROWSER_WORKSPACE_SWITCH_FRAME_SUSPEND_DELAY_MS;
  const timer = window.setTimeout(() => {
    browserWorkspaceSuspendTimers.delete(workspaceId);
    runWhenUiIdle(() => {
      const activeAndVisible = workspaceId === state.activeWorkspaceId && !document.hidden && !isBrowserPanelHidden();
      if (activeAndVisible) return;
      suspendBrowserFramesForWorkspace(workspaceId, { includeActive: options.includeActive });
    }, BROWSER_FRAME_SUSPEND_IDLE_MS);
  }, delayMs);
  browserWorkspaceSuspendTimers.set(workspaceId, timer);
}

function scheduleInactiveBrowserFrameSuspend(delayMs = BROWSER_INACTIVE_FRAME_SUSPEND_DELAY_MS) {
  if (browserInactiveFrameSuspendTimer) window.clearTimeout(browserInactiveFrameSuspendTimer);
  browserInactiveFrameSuspendTimer = 0;
  void delayMs;
}

function suspendBrowserFrame(frame: HTMLIFrameElement, options: { affectsActiveWorkspace?: boolean } = {}) {
  const tabId = frame.dataset.browserTabId ?? '';
  const loadedUrl = frame.dataset.loadedUrl || frame.getAttribute('src') || '';
  if (!loadedUrl || loadedUrl === 'about:blank') return false;
  setBrowserFrameConsoleDetailed(frame, false);
  frame.dataset.suspended = 'true';
  frame.dataset.suspendedUrl = loadedUrl;
  delete frame.dataset.loadedUrl;
  toggleClassIfChanged(frame, 'hidden', true);
  toggleClassIfChanged(frame, 'active', false);
  frame.src = 'about:blank';
  if (options.affectsActiveWorkspace && activeBrowserFrameId === tabId) activeBrowserFrameId = '';
  return true;
}

function suspendBrowserFramesForWorkspace(workspaceId = state.activeWorkspaceId, options: { includeActive?: boolean } = {}) {
  if (!workspaceId) return;
  let suspendedActive = false;
  const affectsActiveWorkspace = workspaceId === state.activeWorkspaceId;
  forEachPreviewFrame(workspaceId, (frame) => {
    const tabId = frame.dataset.browserTabId ?? '';
    if (!options.includeActive && tabId === state.activeBrowserTabId) return;
    const wasActive = tabId === activeBrowserFrameId || frame.classList.contains('active');
    const suspended = suspendBrowserFrame(frame, { affectsActiveWorkspace });
    suspendedActive = suspendedActive || (suspended && wasActive);
  });
  if (affectsActiveWorkspace && (options.includeActive || suspendedActive)) {
    activeBrowserFrameId = '';
    toggleClassIfChanged(el.browserShell, 'has-preview', false);
  }
  if (affectsActiveWorkspace && options.includeActive && activeEdgeCdp) {
    disconnectActiveEdgeCdp();
    setEdgePreviewVisible(false);
  }
}

function ensureBrowserFrame(tab: BrowserTab) {
  const workspaceId = state.activeWorkspaceId || 'workspace';
  let frame = browserFrameForTab(tab.id);
  if (frame) return frame;

  frame = el.previewFrame.dataset.browserTabId || el.previewFrame.dataset.browserWorkspaceId
    ? document.createElement('iframe')
    : el.previewFrame;
  frame.classList.add('preview-frame', 'hidden');
  frame.dataset.browserTabId = tab.id;
  frame.dataset.browserWorkspaceId = workspaceId;
  frame.dataset.displayUrl = tab.url;
  browserFrameByTabId.set(tab.id, frame);
  indexBrowserFrame(frame);
  frame.title = tab.label;
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.allow = [
    'clipboard-read',
    'clipboard-write',
    'fullscreen',
    'microphone',
    'camera',
    'display-capture'
  ].join('; ');
  bindBrowserFrameEvents(frame);
  if (!frame.parentElement) el.browserShell.append(frame);
  applyBrowserFrameSizing(frame);
  return frame;
}

function bindBrowserFrameEvents(frame: HTMLIFrameElement) {
  if (frame.dataset.browserFrameBound === 'true') return;
  frame.dataset.browserFrameBound = 'true';
  frame.addEventListener('pointerdown', activateBrowserPanel);
  frame.addEventListener('focus', activateBrowserPanel);
  frame.addEventListener('load', () => {
    if (frame.dataset.suspended === 'true') return;
    const logicalUrl = frame.dataset.loadingUrl;
    if (logicalUrl) {
      frame.dataset.loadedUrl = logicalUrl;
      delete frame.dataset.loadingUrl;
      delete frame.dataset.loadingSrc;
    }
    if (!browserFrameIsActiveVisible(frame)) {
      setBrowserFrameConsoleDetailed(frame, false);
      return;
    }
    logBrowserConsole('info', `Loaded ${frame.dataset.displayUrl || state.previewUrl}`);
    syncBrowserConsoleCaptureForFrame(frame);
  });
  frame.addEventListener('error', () => {
    if (browserFrameIsActiveVisible(frame)) {
      logBrowserConsole('error', `Failed to load ${frame.dataset.displayUrl || state.previewUrl}`);
    }
  });
}

function hideBrowserFrameElement(frame: HTMLIFrameElement) {
  setBrowserFrameConsoleDetailed(frame, false);
  toggleClassIfChanged(frame, 'hidden', true);
  toggleClassIfChanged(frame, 'active', false);
}

function showBrowserFrame(tab: BrowserTab) {
  const frame = ensureBrowserFrame(tab);
  applyBrowserFrameSizing(frame);
  const title = browserFrameTitle(tab);
  if (frame.title !== title) frame.title = title;
  const workspaceId = frame.dataset.browserWorkspaceId || state.activeWorkspaceId;
  cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
  if (activeBrowserFrameId === tab.id && frame.classList.contains('active') && !frame.classList.contains('hidden')) {
    toggleClassIfChanged(el.browserShell, 'has-preview', true);
    return frame;
  }

  const previousActiveFrame = activeBrowserFrameId && activeBrowserFrameId !== tab.id
    ? browserFrameForTab(activeBrowserFrameId, workspaceId)
    : null;
  if (previousActiveFrame && previousActiveFrame !== frame) {
    hideBrowserFrameElement(previousActiveFrame);
  } else if (!activeBrowserFrameId || (activeBrowserFrameId !== tab.id && !previousActiveFrame)) {
    forEachPreviewFrame(workspaceId, (item) => {
      if (item !== frame && (!item.classList.contains('hidden') || item.classList.contains('active'))) {
        hideBrowserFrameElement(item);
      }
    });
  }

  toggleClassIfChanged(frame, 'hidden', false);
  toggleClassIfChanged(frame, 'active', true);
  activeBrowserFrameId = tab.id;
  toggleClassIfChanged(el.browserShell, 'has-preview', true);
  syncBrowserConsoleCaptureForFrame(frame);
  scheduleInactiveBrowserFrameSuspend();
  return frame;
}

function loadBrowserFrame(tab: BrowserTab, options: { hard?: boolean; reload?: boolean } = {}) {
  if (!USE_PREVIEW_PROXY_BROWSER && !USE_EDGE_CDP_BROWSER) {
    tab.frameUrl = tab.url;
  }
  const frame = showBrowserFrame(tab);
  const frameUrl = tab.frameUrl ?? tab.url;
  frame.dataset.displayUrl = tab.url;
  if (!options.hard && !options.reload && frame.dataset.loadedUrl === frameUrl) return frame;
  delete frame.dataset.suspended;
  delete frame.dataset.suspendedUrl;
  if (options.reload && !options.hard && frame.dataset.loadedUrl === frameUrl) {
    try {
      frame.contentWindow?.location.reload();
      return frame;
    } catch {
      // Cross-origin frames cannot always be reloaded through contentWindow.
    }
  }
  const src = options.hard ? withPreviewCacheBuster(frameUrl) : frameUrl;
  frame.dataset.loadingUrl = frameUrl;
  frame.dataset.loadingSrc = src;
  delete frame.dataset.loadedUrl;
  frame.src = src;
  return frame;
}

function removeBrowserFrame(id: string) {
  const frame = browserFrameForTab(id);
  cancelBrowserAssetRecovery(id);
  browserLoadRequestByTabId.delete(id);
  if (!frame) return;
  forgetBrowserFrame(frame);
  if (activeBrowserFrameId === id) activeBrowserFrameId = '';
  if (frame === el.previewFrame) {
    frame.removeAttribute('src');
    delete frame.dataset.browserTabId;
    delete frame.dataset.browserWorkspaceId;
    delete frame.dataset.loadedUrl;
    delete frame.dataset.loadingUrl;
    delete frame.dataset.loadingSrc;
    delete frame.dataset.suspended;
    delete frame.dataset.suspendedUrl;
    frame.classList.add('hidden');
    frame.classList.remove('active');
    return;
  }
  frame.remove();
}

function clearBrowserFrames(workspaceId = state.activeWorkspaceId) {
  cancelScheduledBrowserWorkspaceFrameSuspend(workspaceId);
  forEachPreviewFrame(workspaceId, (frame) => {
    const tabId = frame.dataset.browserTabId ?? '';
    if (tabId) {
      cancelBrowserAssetRecovery(tabId);
      browserLoadRequestByTabId.delete(tabId);
    }
    forgetBrowserFrame(frame);
    if (activeBrowserFrameId === tabId) activeBrowserFrameId = '';
    if (frame === el.previewFrame) {
      frame.removeAttribute('src');
      delete frame.dataset.browserTabId;
      delete frame.dataset.browserWorkspaceId;
      delete frame.dataset.loadedUrl;
      delete frame.dataset.loadingUrl;
      delete frame.dataset.loadingSrc;
      delete frame.dataset.suspended;
      delete frame.dataset.suspendedUrl;
      frame.classList.add('hidden');
      frame.classList.remove('active');
    } else {
      frame.remove();
    }
  });
}

function hideBrowserFramesForWorkspace(workspaceId: string) {
  forEachPreviewFrame(workspaceId, (frame) => {
    hideBrowserFrameElement(frame);
    if (activeBrowserFrameId === frame.dataset.browserTabId) activeBrowserFrameId = '';
  });
}

function hideAllBrowserFrames() {
  forEachPreviewFrame(undefined, (frame) => {
    hideBrowserFrameElement(frame);
  });
  activeBrowserFrameId = '';
}

function browserConsoleDetailedForFrame(frame: HTMLIFrameElement) {
  return state.browserConsoleVisible
    && browserFrameIsActiveVisible(frame);
}

function browserFrameIsActiveVisible(frame: HTMLIFrameElement) {
  return !isBrowserPanelHidden()
    && !frame.classList.contains('hidden')
    && frame.dataset.browserWorkspaceId === state.activeWorkspaceId
    && frame.dataset.browserTabId === state.activeBrowserTabId;
}

function setBrowserFrameConsoleDetailed(frame: HTMLIFrameElement, detailed: boolean) {
  const next = detailed ? 'true' : 'false';
  if (frame.dataset.consoleDetailed === next) return;
  frame.dataset.consoleDetailed = next;
  try {
    frame.contentWindow?.postMessage({ __simpleVibeConsoleDetailed: detailed }, '*');
  } catch {
    // Frame may be navigating or cross-origin; console capture mode is best-effort.
  }
}

function syncBrowserConsoleCaptureForFrame(frame: HTMLIFrameElement) {
  setBrowserFrameConsoleDetailed(frame, browserConsoleDetailedForFrame(frame));
}

function syncBrowserConsoleCaptureForActiveFrame() {
  const frame = activeBrowserFrame();
  if (frame) syncBrowserConsoleCaptureForFrame(frame);
}

function loadBrowserTabFallback(tab: BrowserTab) {
  disconnectActiveEdgeCdp();
  setEdgePreviewVisible(false);
  if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(tab.url)) {
    loadBrowserTabThroughPreviewProxy(tab);
  } else {
    loadBrowserFrame(tab);
  }
}

function loadBrowserTabThroughPreviewProxy(tab: BrowserTab, options: { hard?: boolean; reload?: boolean; clearCache?: boolean } = {}) {
  prepareBrowserProxyPendingFrame(tab);
  if (options.clearCache) clearPreviewProxyForBrowserTab(tab);
  const requestId = ++browserLoadRequestSeq;
  browserLoadRequestByTabId.set(tab.id, requestId);
  void previewFrameUrl(tab.url, { forceProbe: Boolean(options.hard || options.clearCache) }).then((frameUrl) => {
    if (browserLoadRequestByTabId.get(tab.id) !== requestId) return;
    if (tab.frameUrl !== frameUrl) {
      tab.frameUrl = frameUrl;
      const frame = browserFrameForTab(tab.id);
      if (frame) delete frame.dataset.loadedUrl;
    }
    if (state.activeBrowserTabId === tab.id) loadBrowserFrame(tab, { hard: options.hard, reload: options.reload });
  }).catch((error) => setStatus(`Preview proxy failed: ${String(error)}`, true));
}

function clearPreviewProxyForBrowserTab(tab: BrowserTab) {
  const parsed = localHttpPreviewUrl(tab.url);
  if (!parsed) return false;
  const targetOrigin = normalizedLocalPreviewOrigin(parsed);
  const proxy = previewProxyForTargetOrigin(targetOrigin);
  if (!proxy) return false;
  removePreviewProxy(proxy);
  previewProxyProbeAt.delete(proxy.id);
  void api.stopPortForward(proxy.id).catch(() => undefined);
  if (tab.frameUrl === proxy.url || tab.frameUrl?.startsWith(`${proxy.url}/`)) {
    tab.frameUrl = tab.url;
  }
  const frame = browserFrameForTab(tab.id);
  if (frame) {
    frame.src = 'about:blank';
    delete frame.dataset.loadedUrl;
    delete frame.dataset.loadingUrl;
    delete frame.dataset.loadingSrc;
    delete frame.dataset.suspended;
    delete frame.dataset.suspendedUrl;
  }
  return true;
}

function prepareBrowserProxyPendingFrame(tab: BrowserTab) {
  const existing = browserFrameForTab(tab.id);
  if (existing) {
    showBrowserFrame(tab);
    return;
  }
  hideBrowserFramesForWorkspace(state.activeWorkspaceId);
  activeBrowserFrameId = '';
  toggleClassIfChanged(el.browserShell, 'has-preview', false);
  setEdgePreviewVisible(false);
}

async function loadEdgeBrowserTab(tab: BrowserTab) {
  setEdgePreviewVisible(true);
  showEdgePreviewStatus('Starting Edge browser...');
  await yieldToUi();
  const session = await withTimeout(ensureEdgeDevtoolsSession(), EDGE_START_TIMEOUT_MS, 'Starting Edge browser');
  if (tab.edge && tab.edge.sessionId === session.id) {
    try {
      await withTimeout(api.edgeDevtoolsActivatePage(tab.edge.sessionId, tab.edge.targetId), EDGE_PAGE_TIMEOUT_MS, 'Activating Edge tab');
    } catch {
      tab.edge = undefined;
    }
  } else if (tab.edge) {
    closeEdgeBrowserTab(tab);
  }

  if (!tab.edge) {
    showEdgePreviewStatus('Opening Edge tab...');
    const page = await withTimeout(api.edgeDevtoolsNewPage(session.id, tab.url), EDGE_PAGE_TIMEOUT_MS, 'Opening Edge tab');
    tab.edge = {
      sessionId: session.id,
      targetId: page.id,
      webSocketDebuggerUrl: page.webSocketDebuggerUrl
    };
    logBrowserConsole('info', `Edge opened ${tab.url}`);
  }

  if (state.activeBrowserTabId !== tab.id) return;
  await withTimeout(connectEdgeCdp(tab), EDGE_CDP_CONNECT_TIMEOUT_MS, 'Connecting Edge DevTools');
  await withTimeout(api.edgeDevtoolsActivatePage(tab.edge.sessionId, tab.edge.targetId), EDGE_PAGE_TIMEOUT_MS, 'Activating Edge tab').catch(() => undefined);
  saveActiveWorkspaceSnapshot();
}

async function ensureEdgeDevtoolsSession() {
  const workspaceId = state.activeWorkspaceId || 'workspace';
  const existing = edgeDevtoolsSessions.get(workspaceId);
  if (existing) return existing;
  const session = await api.startEdgeDevtoolsSession(workspaceId);
  edgeDevtoolsSessions.set(workspaceId, session);
  return session;
}

function closeEdgeBrowserTab(tab: BrowserTab) {
  if (!tab.edge) return;
  const { sessionId, targetId } = tab.edge;
  if (activeEdgeCdp?.tabId === tab.id) disconnectActiveEdgeCdp();
  void api.edgeDevtoolsClosePage(sessionId, targetId).catch(() => undefined);
  tab.edge = undefined;
}

function stopEdgeDevtoolsForWorkspace(workspaceId: string) {
  const session = edgeDevtoolsSessions.get(workspaceId);
  if (!session) return;
  if (activeEdgeCdp?.sessionId === session.id) disconnectActiveEdgeCdp();
  edgeDevtoolsSessions.delete(workspaceId);
  void api.stopEdgeDevtoolsSession(session.id).catch(() => undefined);
}

function stopAllEdgeDevtoolsSessions() {
  disconnectActiveEdgeCdp();
  for (const session of edgeDevtoolsSessions.values()) {
    void api.stopEdgeDevtoolsSession(session.id).catch(() => undefined);
  }
  edgeDevtoolsSessions.clear();
}

function setEdgePreviewVisible(visible: boolean) {
  toggleClassIfChanged(el.edgePreviewCanvas, 'hidden', !visible);
  toggleClassIfChanged(el.browserShell, 'edge-preview-active', visible);
  if (visible) {
    hideAllBrowserFrames();
    toggleClassIfChanged(el.browserShell, 'has-preview', true);
    applyEdgePreviewSizing();
    return;
  }
  toggleClassIfChanged(el.edgePreviewStatus, 'hidden', true);
  toggleClassIfChanged(el.browserShell, 'edge-preview-active', false);
}

function showEdgePreviewStatus(message: string) {
  el.edgePreviewStatus.textContent = message;
  el.edgePreviewStatus.classList.remove('hidden');
}

function connectEdgeCdp(tab: BrowserTab) {
  const target = tab.edge;
  if (!target) return Promise.reject(new Error('Edge target is not ready'));
  if (
    activeEdgeCdp?.tabId === tab.id
    && activeEdgeCdp.socket.readyState === WebSocket.OPEN
  ) {
    return configureEdgeViewport(activeEdgeCdp);
  }

  disconnectActiveEdgeCdp();
  showEdgePreviewStatus('Connecting to Edge DevTools...');

  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const cdp: EdgeCdpState = {
      tabId: tab.id,
      sessionId: target.sessionId,
      socket,
      seq: 0,
      pending: new Map(),
      viewportWidth: 0,
      viewportHeight: 0,
      frameWidth: 0,
      frameHeight: 0,
      screencastLatest: null,
      screencastDrawPending: false,
      screencastLastDrawAt: 0
    };
    let opened = false;
    let settled = false;
    activeEdgeCdp = cdp;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(connectTimer);
      resolve();
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(connectTimer);
      reject(error);
    };
    const connectTimer = window.setTimeout(() => {
      if (activeEdgeCdp === cdp) activeEdgeCdp = null;
      rejectEdgePending(cdp, new Error('Edge DevTools connection timed out'));
      try {
        socket.close();
      } catch {
        // Best-effort cleanup only.
      }
      settleReject(new Error('Edge DevTools connection timed out'));
    }, EDGE_CDP_CONNECT_TIMEOUT_MS);

    socket.addEventListener('open', async () => {
      opened = true;
      try {
        await edgeCdpSend('Page.enable', {}, cdp);
        await Promise.all([
          edgeCdpSend('Runtime.enable', {}, cdp),
          edgeCdpSend('Log.enable', {}, cdp),
          edgeCdpSend('Network.enable', {}, cdp)
        ]);
        await edgeCdpSend('Page.bringToFront', {}, cdp).catch(() => undefined);
        await configureEdgeViewport(cdp);
        showEdgePreviewStatus('Edge preview connected');
        settleResolve();
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.addEventListener('message', (event) => handleEdgeCdpMessage(cdp, event.data));
    socket.addEventListener('error', () => {
      const error = new Error('Edge DevTools websocket error');
      if (!opened) settleReject(error);
      logBrowserConsole('error', error.message);
    });
    socket.addEventListener('close', () => {
      rejectEdgePending(cdp, new Error('Edge DevTools websocket closed'));
      if (!settled && !opened) settleReject(new Error('Edge DevTools websocket closed'));
      if (activeEdgeCdp === cdp) {
        activeEdgeCdp = null;
        showEdgePreviewStatus('Edge preview disconnected');
      }
    });
  });
}

function disconnectActiveEdgeCdp() {
  const cdp = activeEdgeCdp;
  if (!cdp) return;
  activeEdgeCdp = null;
  rejectEdgePending(cdp, new Error('Edge DevTools disconnected'));
  try {
    cdp.socket.close();
  } catch {
    // Best-effort cleanup only.
  }
}

function rejectEdgePending(cdp: EdgeCdpState, error: Error) {
  for (const pending of cdp.pending.values()) {
    window.clearTimeout(pending.timer);
    pending.reject(error);
  }
  cdp.pending.clear();
}

function edgeCdpSend(method: string, params: Record<string, unknown> = {}, cdp = activeEdgeCdp): Promise<unknown> {
  if (!cdp || cdp.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Edge DevTools is not connected'));
  }
  const id = ++cdp.seq;
  const payload = { id, method, params };
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cdp.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, EDGE_CDP_COMMAND_TIMEOUT_MS);
    cdp.pending.set(id, { resolve, reject, timer });
    try {
      cdp.socket.send(JSON.stringify(payload));
    } catch (error) {
      window.clearTimeout(timer);
      cdp.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function handleEdgeCdpMessage(cdp: EdgeCdpState, data: unknown) {
  const raw = typeof data === 'string' ? data : '';
  if (!raw) return;
  let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (typeof message.id === 'number') {
    const pending = cdp.pending.get(message.id);
    if (!pending) return;
    cdp.pending.delete(message.id);
    window.clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'DevTools command failed'));
    else pending.resolve(message.result);
    return;
  }

  const params = asRecord(message.params);
  if (!message.method || !params) return;
  if (message.method === 'Page.screencastFrame') {
    const sessionId = params.sessionId;
    if (typeof sessionId === 'number') {
      void edgeCdpSend('Page.screencastFrameAck', { sessionId }, cdp).catch(() => undefined);
    }
    if (typeof params.data === 'string') queueEdgeScreencastFrame(cdp, params.data, asRecord(params.metadata));
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const level = edgeConsoleLevel(String(params.type || 'log'));
    const args = Array.isArray(params.args) ? params.args : [];
    const text = args.map(formatEdgeRemoteObject).join(' ').trim();
    if (text) logBrowserConsole(level, text);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = asRecord(params.exceptionDetails);
    const text = typeof details?.text === 'string' ? details.text : 'JavaScript exception';
    logBrowserConsole('error', text);
    return;
  }
  if (message.method === 'Log.entryAdded') {
    const entry = asRecord(params.entry);
    const text = typeof entry?.text === 'string' ? entry.text : '';
    if (text) logBrowserConsole(edgeConsoleLevel(String(entry?.level || 'info')), text);
    return;
  }
  if (message.method === 'Network.loadingFailed') {
    const errorText = typeof params.errorText === 'string' ? params.errorText : '';
    const blockedReason = typeof params.blockedReason === 'string' ? ` (${params.blockedReason})` : '';
    if (errorText) logBrowserConsole('warn', `Network request failed: ${errorText}${blockedReason}`);
    return;
  }
  if (message.method === 'Page.frameNavigated') {
    updateEdgeTabUrl(cdp.tabId, params);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function edgeConsoleLevel(level: string): BrowserConsoleLog['level'] {
  if (level === 'error' || level === 'severe') return 'error';
  if (level === 'warning' || level === 'warn') return 'warn';
  return 'info';
}

function formatEdgeRemoteObject(value: unknown) {
  const record = asRecord(value);
  if (!record) return formatConsoleValue(value);
  if ('value' in record) return formatConsoleValue(record.value);
  if (typeof record.description === 'string') return record.description;
  if (typeof record.unserializableValue === 'string') return record.unserializableValue;
  return formatConsoleValue(value);
}

function updateEdgeTabUrl(tabId: string, params: Record<string, unknown>) {
  const frame = asRecord(params.frame);
  const url = typeof frame?.url === 'string' ? frame.url : '';
  if (!url || url === 'about:blank' || typeof frame?.parentId === 'string') return;
  const tab = browserTabForId(tabId);
  if (!tab || tab.url === url) return;
  updateBrowserTabUrl(tab, url);
  tab.label = browserTabLabel(url);
  if (state.activeBrowserTabId === tabId) {
    state.previewUrl = url;
    setInputValueIfChanged(el.previewUrl, url);
  }
  renderBrowserTabs();
  saveActiveWorkspaceSnapshot();
}

function queueEdgeScreencastFrame(cdp: EdgeCdpState, base64Data: string, metadata: Record<string, unknown> | null) {
  cdp.screencastLatest = { base64Data, metadata };
  if (cdp.screencastDrawPending) return;
  scheduleEdgeScreencastDraw(cdp);
}

function scheduleEdgeScreencastDraw(cdp: EdgeCdpState) {
  if (activeEdgeCdp !== cdp || !cdp.screencastLatest) {
    cdp.screencastDrawPending = false;
    return;
  }

  cdp.screencastDrawPending = true;
  const waitMs = Math.max(0, EDGE_SCREENCAST_MIN_DRAW_INTERVAL_MS - (performance.now() - cdp.screencastLastDrawAt));
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      if (activeEdgeCdp !== cdp) {
        cdp.screencastDrawPending = false;
        return;
      }
      const frame = cdp.screencastLatest;
      cdp.screencastLatest = null;
      if (!frame) {
        cdp.screencastDrawPending = false;
        return;
      }
      drawEdgeScreencastFrame(cdp, frame.base64Data, frame.metadata, () => {
        cdp.screencastLastDrawAt = performance.now();
        cdp.screencastDrawPending = false;
        if (cdp.screencastLatest) scheduleEdgeScreencastDraw(cdp);
      });
    });
  }, waitMs);
}

function drawEdgeScreencastFrame(
  cdp: EdgeCdpState,
  base64Data: string,
  metadata: Record<string, unknown> | null,
  done: () => void
) {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    try {
      if (activeEdgeCdp !== cdp) return;
      const width = Math.max(1, Math.round(Number(metadata?.deviceWidth) || cdp.viewportWidth || image.width));
      const height = Math.max(1, Math.round(Number(metadata?.deviceHeight) || cdp.viewportHeight || image.height));
      if (el.edgePreviewCanvas.width !== width || el.edgePreviewCanvas.height !== height) {
        el.edgePreviewCanvas.width = width;
        el.edgePreviewCanvas.height = height;
      }
      cdp.frameWidth = width;
      cdp.frameHeight = height;
      const context = el.edgePreviewCanvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      el.edgePreviewStatus.classList.add('hidden');
    } finally {
      done();
    }
  };
  image.onerror = done;
  image.src = `data:image/jpeg;base64,${base64Data}`;
}

function scheduleConfigureEdgeViewport() {
  if (!activeEdgeCdp) return;
  if (edgeViewportFrame) cancelAnimationFrame(edgeViewportFrame);
  edgeViewportFrame = requestAnimationFrame(() => {
    edgeViewportFrame = 0;
    void configureEdgeViewport().catch((error) => logBrowserConsole('warn', `Edge viewport update failed: ${String(error)}`));
  });
}

async function configureEdgeViewport(cdp = activeEdgeCdp) {
  if (!cdp || cdp.socket.readyState !== WebSocket.OPEN) return;
  const size = edgePreviewViewportSize();
  cdp.viewportWidth = size.width;
  cdp.viewportHeight = size.height;
  applyEdgePreviewSizing();
  if (el.edgePreviewCanvas.width !== size.width) el.edgePreviewCanvas.width = size.width;
  if (el.edgePreviewCanvas.height !== size.height) el.edgePreviewCanvas.height = size.height;

  if (el.browserShell.classList.contains('device')) {
    const preset = browserDevicePreset();
    await edgeCdpSend('Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: preset.kind === 'phone' ? 2 : 1.5,
      mobile: preset.kind === 'phone',
      screenWidth: size.width,
      screenHeight: size.height
    }, cdp);
  } else {
    await edgeCdpSend('Emulation.clearDeviceMetricsOverride', {}, cdp).catch(() => undefined);
  }

  await edgeCdpSend('Page.stopScreencast', {}, cdp).catch(() => undefined);
  await edgeCdpSend('Page.startScreencast', {
    format: 'jpeg',
    quality: EDGE_SCREENCAST_QUALITY,
    everyNthFrame: EDGE_SCREENCAST_EVERY_NTH_FRAME,
    maxWidth: size.width,
    maxHeight: size.height
  }, cdp);
}

function edgePreviewViewportSize() {
  if (el.browserShell.classList.contains('device')) {
    const preset = browserDevicePreset();
    const portrait = state.browserOrientation === 'portrait';
    return {
      width: portrait ? preset.width : preset.height,
      height: portrait ? preset.height : preset.width
    };
  }
  return {
    width: Math.max(320, Math.floor(el.browserShell.clientWidth - 16) || 960),
    height: Math.max(240, Math.floor(el.browserShell.clientHeight - 16) || 640)
  };
}

function applyEdgePreviewSizing() {
  if (el.browserShell.classList.contains('desktop')) {
    el.edgePreviewCanvas.style.width = '';
    el.edgePreviewCanvas.style.height = '';
    return;
  }
  const { width, height } = edgePreviewViewportSize();
  const zoom = normalizedBrowserZoom(state.browserZoom);
  el.edgePreviewCanvas.style.width = `${Math.max(1, Math.round(width / zoom))}px`;
  el.edgePreviewCanvas.style.height = `${Math.max(1, Math.round(height / zoom))}px`;
}

function bindEdgePreviewInput() {
  el.edgePreviewCanvas.addEventListener('pointerdown', (event) => {
    if (!activeEdgeCdp) return;
    event.preventDefault();
    event.stopPropagation();
    activateBrowserPanel();
    el.edgePreviewCanvas.focus();
    el.edgePreviewCanvas.setPointerCapture(event.pointerId);
    dispatchEdgeMouseEvent(event, 'mousePressed');
  });
  el.edgePreviewCanvas.addEventListener('pointermove', (event) => {
    if (!activeEdgeCdp) return;
    dispatchEdgeMouseEvent(event, 'mouseMoved');
  });
  el.edgePreviewCanvas.addEventListener('pointerup', (event) => {
    if (!activeEdgeCdp) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchEdgeMouseEvent(event, 'mouseReleased');
    if (el.edgePreviewCanvas.hasPointerCapture(event.pointerId)) {
      el.edgePreviewCanvas.releasePointerCapture(event.pointerId);
    }
  });
  el.edgePreviewCanvas.addEventListener('wheel', (event) => {
    if (!activeEdgeCdp) return;
    event.preventDefault();
    event.stopPropagation();
    const point = edgeCanvasPoint(event);
    void edgeCdpSend('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: edgeInputModifiers(event)
    }).catch(() => undefined);
  }, { passive: false });
  el.edgePreviewCanvas.addEventListener('keydown', (event) => dispatchEdgeKeyEvent(event, 'keyDown'));
  el.edgePreviewCanvas.addEventListener('keyup', (event) => dispatchEdgeKeyEvent(event, 'keyUp'));
  el.edgePreviewCanvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, browserContextMenuItems());
  });
  edgePreviewResizeObserver = new ResizeObserver(scheduleConfigureEdgeViewport);
  edgePreviewResizeObserver.observe(el.browserShell);
}

function dispatchEdgeMouseEvent(event: PointerEvent, type: 'mousePressed' | 'mouseReleased' | 'mouseMoved') {
  const point = edgeCanvasPoint(event);
  const params: Record<string, unknown> = {
    type,
    x: point.x,
    y: point.y,
    modifiers: edgeInputModifiers(event)
  };
  if (type !== 'mouseMoved') {
    params.button = edgeMouseButton(event.button);
    params.clickCount = 1;
  } else {
    params.button = event.buttons ? edgeMouseButton(event.button) : 'none';
  }
  void edgeCdpSend('Input.dispatchMouseEvent', params).catch(() => undefined);
}

function edgeCanvasPoint(event: MouseEvent) {
  const cdp = activeEdgeCdp;
  const rect = el.edgePreviewCanvas.getBoundingClientRect();
  const width = cdp?.frameWidth || cdp?.viewportWidth || el.edgePreviewCanvas.width || 1;
  const height = cdp?.frameHeight || cdp?.viewportHeight || el.edgePreviewCanvas.height || 1;
  return {
    x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width),
    y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height)
  };
}

function edgeMouseButton(button: number) {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  if (button === 0) return 'left';
  return 'none';
}

function dispatchEdgeKeyEvent(event: KeyboardEvent, type: 'keyDown' | 'keyUp') {
  if (!activeEdgeCdp) return;
  event.preventDefault();
  event.stopPropagation();
  const printable = type === 'keyDown'
    && event.key.length === 1
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey;
  const params: Record<string, unknown> = {
    type: type === 'keyUp' ? 'keyUp' : printable ? 'keyDown' : 'rawKeyDown',
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: edgeVirtualKey(event),
    nativeVirtualKeyCode: edgeVirtualKey(event),
    modifiers: edgeInputModifiers(event),
    isKeypad: event.location === KeyboardEvent.DOM_KEY_LOCATION_NUMPAD
  };
  if (printable) {
    params.text = event.key;
    params.unmodifiedText = event.key;
  }
  void edgeCdpSend('Input.dispatchKeyEvent', params).catch(() => undefined);
}

function edgeInputModifiers(event: MouseEvent | KeyboardEvent) {
  return (event.altKey ? 1 : 0)
    | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0)
    | (event.shiftKey ? 8 : 0);
}

function edgeVirtualKey(event: KeyboardEvent) {
  if (event.key.length === 1) return event.key.toUpperCase().charCodeAt(0);
  if (/^F\d{1,2}$/.test(event.key)) return 111 + Number(event.key.slice(1));
  const map: Record<string, number> = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Pause: 19,
    CapsLock: 20,
    Escape: 27,
    ' ': 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Insert: 45,
    Delete: 46
  };
  return map[event.key] ?? 0;
}

async function openLocalBrowserTab(url: string, label = browserTabLabel(url)) {
  if (USE_EDGE_CDP_BROWSER) {
    openBrowserTab(url, label, url);
    return;
  }
  if (!USE_PREVIEW_PROXY_BROWSER) {
    openBrowserTab(url, label, url);
    return;
  }
  const existing = localHttpPreviewUrl(url)
    ? browserTabForUrl(url)
    : null;
  openBrowserTab(url, label, existing?.frameUrl ?? url);
}

async function previewFrameUrl(url: string, options: { forceProbe?: boolean } = {}) {
  const parsed = localHttpPreviewUrl(url);
  if (!parsed) return url;
  const origin = normalizedLocalPreviewOrigin(parsed);
  const proxy = await ensurePreviewProxy(origin, options);
  return `${proxy.url}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function ensurePreviewProxy(targetOrigin: string, options: { forceProbe?: boolean } = {}) {
  const existing = previewProxyForTargetOrigin(targetOrigin);
  if (existing) {
    const lastProbe = previewProxyProbeAt.get(existing.id) ?? 0;
    const shouldProbe = Boolean(options.forceProbe) || (lastProbe > 0 && Date.now() - lastProbe > PREVIEW_PROXY_PROBE_TTL_MS);
    if (!shouldProbe) return existing;
    try {
      if (await api.probeLocalHttpUrl(existing.url)) {
        previewProxyProbeAt.set(existing.id, Date.now());
        return existing;
      }
    } catch {
      // Treat probe failures as stale proxy state and recreate below.
    }
    removePreviewProxy(existing);
    previewProxyProbeAt.delete(existing.id);
    void api.stopPortForward(existing.id).catch(() => undefined);
    logBrowserConsole('warn', `Preview proxy ${existing.url} was stale; reopening ${targetOrigin}`);
  }
  const pending = previewProxyStarts.get(targetOrigin);
  if (pending) return pending;

  const started = api.startPreviewProxy(targetOrigin)
    .then((proxy) => {
      removePreviewProxiesForTargetOrigin(targetOrigin);
      state.previewProxies.push(proxy);
      rememberPreviewProxy(proxy);
      previewProxyProbeAt.set(proxy.id, Date.now());
      logBrowserConsole('info', `Preview proxy ${proxy.url} -> ${targetOrigin}`);
      return proxy;
    })
    .finally(() => {
      if (previewProxyStarts.get(targetOrigin) === started) previewProxyStarts.delete(targetOrigin);
    });
  previewProxyStarts.set(targetOrigin, started);
  return started;
}

function localHttpPreviewUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !parsed.port) return null;
    return isLocalPreviewHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedLocalPreviewOrigin(url: URL) {
  const host = url.hostname === 'localhost' || url.hostname === '0.0.0.0' || url.hostname === '[::1]'
    ? '127.0.0.1'
    : url.hostname;
  return `http://${host}:${url.port}`;
}

function clearPreviewProxyLookup() {
  previewProxyByTargetOrigin.clear();
  previewProxyByLocalPort.clear();
  previewProxyLocalPortMisses.clear();
}

function rebuildPreviewProxyLookup() {
  clearPreviewProxyLookup();
  for (const proxy of state.previewProxies) rememberPreviewProxy(proxy);
}

function rememberPreviewProxy(proxy: PortForwardResult) {
  previewProxyLocalPortMisses.delete(proxy.localPort);
  if (!previewProxyByTargetOrigin.has(proxy.targetHost)) {
    previewProxyByTargetOrigin.set(proxy.targetHost, proxy);
  }
  if (!previewProxyByLocalPort.has(proxy.localPort)) {
    previewProxyByLocalPort.set(proxy.localPort, proxy);
  }
}

function forgetPreviewProxy(proxy: PortForwardResult) {
  if (previewProxyByTargetOrigin.get(proxy.targetHost) === proxy) {
    previewProxyByTargetOrigin.delete(proxy.targetHost);
    for (const candidate of state.previewProxies) {
      if (candidate.targetHost !== proxy.targetHost) continue;
      previewProxyByTargetOrigin.set(candidate.targetHost, candidate);
      break;
    }
  }
  if (previewProxyByLocalPort.get(proxy.localPort) !== proxy) return;
  previewProxyByLocalPort.delete(proxy.localPort);
  previewProxyLocalPortMisses.delete(proxy.localPort);
  for (const candidate of state.previewProxies) {
    if (candidate.localPort !== proxy.localPort) continue;
    previewProxyByLocalPort.set(candidate.localPort, candidate);
    break;
  }
}

function previewProxyForTargetOrigin(targetOrigin: string) {
  let proxy = previewProxyByTargetOrigin.get(targetOrigin) ?? null;
  if (!proxy) {
    proxy = state.previewProxies.find((item) => item.targetHost === targetOrigin) ?? null;
    if (proxy) rememberPreviewProxy(proxy);
  }
  return proxy;
}

function removePreviewProxy(proxy: PortForwardResult) {
  const index = state.previewProxies.indexOf(proxy);
  if (index >= 0) state.previewProxies.splice(index, 1);
  else {
    const fallbackIndex = state.previewProxies.findIndex((item) => item.id === proxy.id);
    if (fallbackIndex >= 0) state.previewProxies.splice(fallbackIndex, 1);
  }
  forgetPreviewProxy(proxy);
}

function removePreviewProxiesForTargetOrigin(targetOrigin: string) {
  for (let index = state.previewProxies.length - 1; index >= 0; index -= 1) {
    const proxy = state.previewProxies[index];
    if (proxy.targetHost !== targetOrigin) continue;
    state.previewProxies.splice(index, 1);
    forgetPreviewProxy(proxy);
  }
}

function isPreviewProxyLocalPort(port: number) {
  if (previewProxyByLocalPort.has(port)) return true;
  if (previewProxyLocalPortMisses.has(port)) return false;
  const proxy = state.previewProxies.find((item) => item.localPort === port) ?? null;
  if (!proxy) {
    rememberPreviewProxyLocalPortMiss(port);
    return false;
  }
  rememberPreviewProxy(proxy);
  return true;
}

function rememberPreviewProxyLocalPortMiss(port: number) {
  previewProxyLocalPortMisses.add(port);
  if (previewProxyLocalPortMisses.size <= 512) return;
  const oldest = previewProxyLocalPortMisses.values().next().value;
  if (oldest !== undefined) previewProxyLocalPortMisses.delete(oldest);
}

function ensureActiveBrowserFrame() {
  if (isBrowserPanelHidden()) return false;
  const active = browserTabForId(state.activeBrowserTabId) ?? state.browserTabs[0];
  if (!active) return false;
  if (!USE_EDGE_CDP_BROWSER && browserTabFrameReady(active)) {
    showBrowserFrame(active);
    renderBrowserTabs();
    return true;
  }
  activateBrowserTab(active.id);
  return true;
}

function openBrowserTab(url: string, label = browserTabLabel(url), frameUrl = url) {
  if (!url) return;
  const existing = browserTabForUrl(url);
  setPanelVisible('browser', true);
  if (existing) {
    const changed = existing.frameUrl !== frameUrl || existing.label !== label;
    existing.frameUrl = frameUrl;
    existing.label = label;
    activateBrowserTab(existing.id, { forceSave: changed });
    return;
  }

  const tab: BrowserTab = {
    id: makeBrowserTabId(),
    url,
    label,
    deviceId: state.browserDeviceId,
    orientation: state.browserOrientation,
    zoom: state.browserZoom,
    frameUrl
  };
  const index = state.browserTabs.length;
  state.browserTabs.push(tab);
  rememberBrowserTab(tab, index);
  logBrowserConsole('info', `Opened preview tab ${url}`);
  activateBrowserTab(tab.id, { forceSave: true });
}

function rememberBrowserAddress(url: string) {
  const normalized = normalizeBrowserHistoryUrl(url);
  if (!normalized) return;
  const history = state.browserHistory.filter((item) => item !== normalized);
  history.unshift(normalized);
  state.browserHistory = history.slice(0, BROWSER_ADDRESS_HISTORY_LIMIT);
  browserAddressSuggestionSignature = '\0';
  if (document.activeElement === el.previewUrl) renderBrowserAddressSuggestions(true);
  saveActiveWorkspaceSnapshot();
}

function renderBrowserAddressSuggestions(force = false) {
  if (!force && document.activeElement !== el.previewUrl) return;
  const suggestions = browserAddressSuggestionsForInput();
  const signature = `${state.activeWorkspaceId}\t${el.previewUrl.value}\t${suggestions.join('\t')}`;
  if (browserAddressSuggestionSignature === signature) return;
  browserAddressSuggestionSignature = signature;
  if (!suggestions.length) {
    el.browserAddressSuggestions.replaceChildren();
    toggleClassIfChanged(el.browserAddressSuggestions, 'hidden', true);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const url of suggestions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'browser-address-suggestion';
    button.dataset.url = url;
    button.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = url;
    button.append(label);
    fragment.append(button);
  }
  el.browserAddressSuggestions.replaceChildren(fragment);
  toggleClassIfChanged(el.browserAddressSuggestions, 'hidden', false);
}

function browserAddressSuggestionsForInput() {
  const query = el.previewUrl.value.trim().toLowerCase();
  const suggestions: string[] = [];
  for (const url of state.browserHistory) {
    if (query && !url.toLowerCase().includes(query)) continue;
    suggestions.push(url);
    if (suggestions.length >= BROWSER_ADDRESS_SUGGESTION_LIMIT) break;
  }
  return suggestions;
}

function hideBrowserAddressSuggestions() {
  browserAddressSuggestionSignature = '\0';
  el.browserAddressSuggestions.replaceChildren();
  toggleClassIfChanged(el.browserAddressSuggestions, 'hidden', true);
}

function activateBrowserTab(id: string, options: { forceSave?: boolean } = {}) {
  const tab = browserTabForId(id);
  if (!tab) return;
  const previousActiveId = state.activeBrowserTabId;
  const alreadyActive = previousActiveId === tab.id;
  const shouldSave = options.forceSave || !alreadyActive;
  state.activeBrowserTabId = tab.id;
  state.previewUrl = tab.url;
  applyBrowserViewportFromTab(tab);
  setInputValueIfChanged(el.previewUrl, tab.url);
  if (isBrowserPanelHidden()) {
    if (!alreadyActive) logBrowserConsole('info', `Selected tab ${tab.url}; Browser panel is hidden`);
    if (shouldSave) saveActiveWorkspaceSnapshot();
    return;
  }
  if (!USE_EDGE_CDP_BROWSER && browserTabFrameReady(tab)) {
    showBrowserFrame(tab);
    renderBrowserTabActivation(previousActiveId, tab);
    if (!alreadyActive) logBrowserConsole('info', `Activated tab ${tab.url}`);
    if (shouldSave) saveActiveWorkspaceSnapshot();
    return;
  }
  if (USE_EDGE_CDP_BROWSER) {
    renderBrowserTabActivation(previousActiveId, tab);
    setEdgePreviewVisible(true);
    void loadEdgeBrowserTab(tab).catch((error) => {
      logBrowserConsole('error', `Edge preview failed: ${String(error)}`);
      setStatus(`Edge preview failed: ${String(error)}`, true);
      loadBrowserTabFallback(tab);
    });
    if (!alreadyActive) logBrowserConsole('info', `Activated tab ${tab.url}`);
    if (shouldSave) saveActiveWorkspaceSnapshot();
    return;
  }
  if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(tab.url)) {
    loadBrowserTabThroughPreviewProxy(tab);
  } else {
    loadBrowserFrame(tab);
  }
  renderBrowserTabActivation(previousActiveId, tab);
  if (!alreadyActive) logBrowserConsole('info', `Activated tab ${tab.url}`);
  if (shouldSave) saveActiveWorkspaceSnapshot();
}

function closeBrowserTab(id: string) {
  const index = browserTabIndexById(id);
  if (index < 0) return;
  const wasActive = state.activeBrowserTabId === id;
  const closedTab = state.browserTabs[index];
  const closedUrl = closedTab.url;
  closeEdgeBrowserTab(closedTab);
  state.browserTabs.splice(index, 1);
  forgetBrowserTab(closedTab);
  refreshBrowserTabIndexLookup(index);
  removeBrowserFrame(id);
  logBrowserConsole('info', `Closed tab ${closedUrl}`);
  if (wasActive) {
    const next = state.browserTabs[index] ?? state.browserTabs[index - 1];
    if (next) {
      activateBrowserTab(next.id);
    } else {
      state.activeBrowserTabId = '';
      state.previewUrl = '';
      setInputValueIfChanged(el.previewUrl, '');
      clearBrowserFrames();
      toggleClassIfChanged(el.browserShell, 'has-preview', false);
      disconnectActiveEdgeCdp();
      setEdgePreviewVisible(false);
      renderBrowserTabs();
    }
  } else {
    renderBrowserTabs();
  }
  saveActiveWorkspaceSnapshot();
}

function renderBrowserTabs() {
  if (isBrowserPanelHidden()) return;
  const signature = browserTabsSignature();
  if (browserTabsRenderSignature === signature) return;
  const orderSignature = browserTabsOrderSignature();
  const sameOrder = browserTabsOrderRenderSignature === orderSignature
    && el.browserTabs.childElementCount === state.browserTabs.length;
  browserTabsRenderSignature = signature;

  if (sameOrder) {
    for (const tab of state.browserTabs) {
      updateBrowserTabElement(browserTabElement(tab.id), tab);
    }
    return;
  }

  browserTabsOrderRenderSignature = orderSignature;
  const fragment = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const tab of state.browserTabs) {
    seen.add(tab.id);
    const item = browserTabElement(tab.id);
    updateBrowserTabElement(item, tab);
    fragment.append(item);
  }
  el.browserTabs.replaceChildren(fragment);
  pruneBrowserTabElementCache(seen);
}

function renderBrowserTabActivation(previousActiveId: string, activeTab: BrowserTab) {
  if (isBrowserPanelHidden()) return;
  const orderSignature = browserTabsOrderSignature();
  const previousChanged = Boolean(previousActiveId && previousActiveId !== activeTab.id);
  const previousTab = previousChanged
    ? browserTabForId(previousActiveId)
    : null;
  const previousElement = previousChanged ? connectedBrowserTabElement(previousActiveId) : null;
  const activeElement = connectedBrowserTabElement(activeTab.id);
  if (
    browserTabsOrderRenderSignature !== orderSignature
    || el.browserTabs.childElementCount !== state.browserTabs.length
    || !activeElement
    || (previousChanged && (!previousTab || !previousElement))
  ) {
    renderBrowserTabs();
    return;
  }
  if (previousTab && previousElement) updateBrowserTabElement(previousElement, previousTab);
  updateBrowserTabElement(activeElement, activeTab);
  browserTabsRenderSignature = browserTabsSignature();
}

function browserTabElement(id: string) {
  const cached = browserTabElementCache.get(id);
  if (cached) return cached;
  const item = document.createElement('div');
  item.className = 'browser-tab';
  const labelButton = document.createElement('button');
  labelButton.className = 'tab-label';
  labelButton.type = 'button';
  labelButton.addEventListener('click', () => {
    const id = item.dataset.browserTabId ?? '';
    if (id) activateBrowserTab(id);
  });
  const closeButton = document.createElement('button');
  closeButton.className = 'tab-close';
  closeButton.type = 'button';
  closeButton.title = 'Close tab';
  closeButton.setAttribute('aria-label', 'Close tab');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = item.dataset.browserTabId ?? '';
    if (id) closeBrowserTab(id);
  });
  item.append(labelButton, closeButton);
  browserTabElementCache.set(id, item);
  return item;
}

function connectedBrowserTabElement(id: string) {
  const item = browserTabElementCache.get(id);
  return item?.isConnected ? item : null;
}

function updateBrowserTabElement(item: HTMLElement, tab: BrowserTab) {
  const active = tab.id === state.activeBrowserTabId;
  const signature = `${tab.id}\t${active ? '1' : '0'}\t${tab.label}\t${tab.url}`;
  item.dataset.browserTabId = tab.id;
  if (item.dataset.renderSignature === signature) return;
  item.dataset.renderSignature = signature;
  item.className = `browser-tab${active ? ' active' : ''}`;
  if (item.title !== tab.url) item.title = tab.url;
  setTextContentIfChanged(browserTabLabelButton(item), tab.label);
}

function browserTabLabelButton(item: HTMLElement) {
  return item.firstElementChild as HTMLButtonElement;
}

function pruneBrowserTabElementCache(seen: Set<string>) {
  for (const id of browserTabElementCache.keys()) {
    if (!seen.has(id)) browserTabElementCache.delete(id);
  }
}

function clearBrowserTabLookup() {
  browserTabById.clear();
  browserTabByUrl.clear();
  browserTabIndexByIdLookup.clear();
}

function rebuildBrowserTabLookup() {
  clearBrowserTabLookup();
  for (let index = 0; index < state.browserTabs.length; index += 1) {
    rememberBrowserTab(state.browserTabs[index], index);
  }
}

function rememberBrowserTab(tab: BrowserTab, index?: number) {
  browserTabById.set(tab.id, tab);
  if (!browserTabByUrl.has(tab.url)) browserTabByUrl.set(tab.url, tab);
  if (index !== undefined) browserTabIndexByIdLookup.set(tab.id, index);
}

function forgetBrowserTab(tab: BrowserTab) {
  browserTabById.delete(tab.id);
  browserTabIndexByIdLookup.delete(tab.id);
  if (browserTabByUrl.get(tab.url) !== tab) return;
  browserTabByUrl.delete(tab.url);
  for (let index = 0; index < state.browserTabs.length; index += 1) {
    const candidate = state.browserTabs[index];
    if (candidate.url !== tab.url) continue;
    rememberBrowserTab(candidate, index);
    return;
  }
}

function browserTabForId(id: string) {
  if (!id) return null;
  let tab = browserTabById.get(id) ?? null;
  if (!tab) {
    for (let index = 0; index < state.browserTabs.length; index += 1) {
      const candidate = state.browserTabs[index];
      if (candidate.id !== id) continue;
      tab = candidate;
      rememberBrowserTab(tab, index);
      break;
    }
  }
  return tab;
}

function browserTabForUrl(url: string) {
  if (!url) return null;
  let tab = browserTabByUrl.get(url) ?? null;
  if (!tab) {
    for (let index = 0; index < state.browserTabs.length; index += 1) {
      const candidate = state.browserTabs[index];
      if (candidate.url !== url) continue;
      tab = candidate;
      rememberBrowserTab(tab, index);
      break;
    }
  }
  return tab;
}

function browserTabIndexById(id: string) {
  const cachedIndex = browserTabIndexByIdLookup.get(id);
  if (cachedIndex !== undefined && state.browserTabs[cachedIndex]?.id === id) return cachedIndex;
  for (let index = 0; index < state.browserTabs.length; index += 1) {
    const tab = state.browserTabs[index];
    if (tab.id !== id) continue;
    rememberBrowserTab(tab, index);
    return index;
  }
  browserTabIndexByIdLookup.delete(id);
  return -1;
}

function refreshBrowserTabIndexLookup(startIndex = 0) {
  const start = clamp(startIndex, 0, state.browserTabs.length);
  for (let index = start; index < state.browserTabs.length; index += 1) {
    browserTabIndexByIdLookup.set(state.browserTabs[index].id, index);
  }
}

function updateBrowserTabUrl(tab: BrowserTab, url: string) {
  if (tab.url === url) return;
  if (browserTabByUrl.get(tab.url) === tab) browserTabByUrl.delete(tab.url);
  tab.url = url;
  if (!browserTabByUrl.has(url)) browserTabByUrl.set(url, tab);
}

function browserTabsSignature() {
  let signature = '';
  for (let index = 0; index < state.browserTabs.length; index += 1) {
    const tab = state.browserTabs[index];
    if (index) signature += '\n';
    signature += `${tab.id}\t${tab.id === state.activeBrowserTabId ? '1' : '0'}\t${tab.label}\t${tab.url}`;
  }
  return signature;
}

function browserTabsOrderSignature() {
  let signature = '';
  for (let index = 0; index < state.browserTabs.length; index += 1) {
    if (index) signature += '\n';
    signature += state.browserTabs[index].id;
  }
  return signature;
}

function setBrowserConsoleVisible(
  visible: boolean,
  options: { skipFrameSync?: boolean; skipRender?: boolean; skipSave?: boolean; deferHiddenFlush?: boolean } = {}
) {
  const changed = state.browserConsoleVisible !== visible
    || el.browserWorkspace.classList.contains('console-visible') !== visible
    || el.browserConsole.classList.contains('hidden') === visible
    || el.browserConsoleToggle.classList.contains('active') !== visible
    || el.browserConsoleToggle.getAttribute('aria-pressed') !== String(visible);
  state.browserConsoleVisible = visible;
  if (changed) {
    toggleClassIfChanged(el.browserWorkspace, 'console-visible', visible);
    toggleClassIfChanged(el.browserConsole, 'hidden', !visible);
    toggleClassIfChanged(el.browserConsoleToggle, 'active', visible);
    setAttributeIfChanged(el.browserConsoleToggle, 'aria-pressed', String(visible));
  }
  applyBrowserConsoleSize();
  if (changed && !options.skipFrameSync) syncBrowserConsoleCaptureForActiveFrame();
  if (visible && browserConsoleHiddenPayloadQueue.length) {
    if (options.deferHiddenFlush) scheduleBrowserConsoleHiddenPayloadFlush();
    else flushBrowserConsoleHiddenPayloadQueue();
  }
  if (visible && !options.skipRender) renderBrowserConsole();
  if (changed && !options.skipSave) saveActiveWorkspaceSnapshot();
}

function setBrowserConsolePosition(
  position: BrowserConsolePosition,
  options: { skipLog?: boolean; skipSave?: boolean } = {}
) {
  if (!['bottom', 'right', 'top', 'left'].includes(position)) return;
  const className = `console-${position}`;
  const changed = state.browserConsolePosition !== position
    || el.browserConsolePosition.value !== position
    || !el.browserWorkspace.classList.contains(className);
  state.browserConsolePosition = position;
  if (changed) {
    setInputValueIfChanged(el.browserConsolePosition, position);
    setBrowserConsolePositionClass(className);
  }
  applyBrowserConsoleSize();
  if (changed && state.browserConsoleVisible && !options.skipLog) logBrowserConsole('info', `Console moved to ${position}`);
  if (changed && !options.skipSave) saveActiveWorkspaceSnapshot();
}

function setBrowserConsolePositionClass(className: string) {
  if (
    el.browserWorkspace.dataset.browserConsolePositionClass === className
    && el.browserWorkspace.classList.contains(className)
  ) {
    return;
  }
  el.browserWorkspace.classList.remove('console-bottom', 'console-right', 'console-top', 'console-left');
  el.browserWorkspace.classList.add(className);
  el.browserWorkspace.dataset.browserConsolePositionClass = className;
}

function applyBrowserConsoleSize() {
  state.browserConsoleSize = clamp(state.browserConsoleSize || 0.34, 0.18, 0.72);
  const value = `${(state.browserConsoleSize * 100).toFixed(2)}%`;
  if (el.browserWorkspace.style.getPropertyValue('--browser-console-size') !== value) {
    el.browserWorkspace.style.setProperty('--browser-console-size', value);
  }
}

function applyVisibleBrowserLayout() {
  setBrowserConsolePosition(state.browserConsolePosition, { skipLog: true, skipSave: true });
  setBrowserConsoleVisible(state.browserConsoleVisible, { deferHiddenFlush: true, skipRender: true, skipSave: true });
  if (state.browserDeviceId === 'desktop') {
    setBrowserMode('desktop', { skipSave: true });
  } else {
    setBrowserDevice(state.browserDeviceId || DEFAULT_BROWSER_DEVICE_ID, { skipSave: true });
  }
}

function startBrowserConsoleResize(event: PointerEvent) {
  if (event.button !== 0 || !state.browserConsoleVisible) return;
  event.preventDefault();
  event.stopPropagation();
  activateBrowserPanel();
  el.browserConsoleResizer.setPointerCapture(event.pointerId);
  const rect = el.browserWorkspace.getBoundingClientRect();
  const workspaceWidth = Math.max(1, rect.width);
  const workspaceHeight = Math.max(1, rect.height);
  const position = state.browserConsolePosition;
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    const raw = position === 'bottom'
      ? (rect.bottom - moveEvent.clientY) / workspaceHeight
      : position === 'top'
        ? (moveEvent.clientY - rect.top) / workspaceHeight
        : position === 'right'
          ? (rect.right - moveEvent.clientX) / workspaceWidth
          : (moveEvent.clientX - rect.left) / workspaceWidth;
    state.browserConsoleSize = clamp(raw, 0.18, 0.72);
    applyBrowserConsoleSize();
  };
  const up = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== event.pointerId) return;
    if (el.browserConsoleResizer.hasPointerCapture(event.pointerId)) {
      el.browserConsoleResizer.releasePointerCapture(event.pointerId);
    }
    el.browserConsoleResizer.removeEventListener('pointermove', move);
    el.browserConsoleResizer.removeEventListener('pointerup', up);
    el.browserConsoleResizer.removeEventListener('pointercancel', up);
    saveActiveWorkspaceSnapshot();
  };
  el.browserConsoleResizer.addEventListener('pointermove', move);
  el.browserConsoleResizer.addEventListener('pointerup', up);
  el.browserConsoleResizer.addEventListener('pointercancel', up);
}

function logBrowserConsole(
  level: BrowserConsoleLog['level'],
  message: string,
  options: { scanForLocalPorts?: boolean } = {}
) {
  appendBrowserConsoleLogEntry(makeBrowserConsoleLogEntry(level, message), {
    scanForLocalPorts: options.scanForLocalPorts
  });
}

function makeBrowserConsoleLogEntry(
  level: BrowserConsoleLog['level'],
  message: string,
  time = browserConsoleTimeText()
): BrowserConsoleLog {
  return {
    id: makeBrowserConsoleLogId(),
    time,
    level,
    message: truncateConsoleMessage(message)
  };
}

function appendBrowserConsoleLogEntry(
  entry: BrowserConsoleLog,
  options: { scanForLocalPorts?: boolean } = {}
) {
  const visible = browserConsoleActuallyVisible();
  const limit = browserConsoleRuntimeLogLimit(visible);
  state.browserConsoleLogs.push(entry);
  trimBrowserConsoleLogs(limit);
  markBrowserConsoleLogsChanged();
  if (visible) scheduleBrowserConsoleRender();
  if (options.scanForLocalPorts && shouldScanBrowserConsoleForLocalPorts()) {
    scanBrowserConsoleLogForLocalPorts(entry, { immediate: visible });
  }
}

function appendBrowserConsoleLogBatch(
  entries: BrowserConsoleLog[],
  options: { scanForLocalPorts?: boolean } = {}
) {
  if (!entries.length) return;
  const visible = browserConsoleActuallyVisible();
  const limit = browserConsoleRuntimeLogLimit(visible);
  if (entries.length >= limit) {
    state.browserConsoleLogs = browserConsoleLogTail(entries, limit);
    clearBrowserConsoleRowElementCache();
  } else {
    appendBrowserConsoleLogEntries(state.browserConsoleLogs, entries);
    trimBrowserConsoleLogs(limit);
  }
  markBrowserConsoleLogsChanged();
  if (visible) scheduleBrowserConsoleRender();
  if (options.scanForLocalPorts && shouldScanBrowserConsoleForLocalPorts()) {
    for (const entry of entries) scanBrowserConsoleLogForLocalPorts(entry, { immediate: visible });
  }
}

function browserConsoleActuallyVisible() {
  return state.browserConsoleVisible && !isBrowserPanelHidden();
}

function trimBrowserConsoleLogs(limit = browserConsoleRuntimeLogLimit()) {
  if (state.browserConsoleLogs.length > limit) {
    const removeCount = state.browserConsoleLogs.length - limit;
    for (let index = 0; index < removeCount; index += 1) {
      browserConsoleRowElementCache.delete(state.browserConsoleLogs[index].id);
    }
    if (browserConsoleLastRenderedLogIndex >= removeCount) {
      browserConsoleLastRenderedLogIndex -= removeCount;
    } else {
      browserConsoleLastRenderedLogIndex = -1;
    }
    state.browserConsoleLogs.splice(0, removeCount);
  }
}

function scanBrowserConsoleLogForLocalPorts(
  entry: BrowserConsoleLog,
  options: { immediate?: boolean } = {}
) {
  if (!browserConsoleMayContainLocalPreviewPort(entry.message)) return;
  if (options.immediate) {
    maybeAutoForwardBrowserLocalUrl(entry.message);
    return;
  }
  queueBrowserConsoleLocalPortScan(entry.message);
}

function queueBrowserConsoleLocalPortScan(message: string) {
  browserConsolePortScanQueue.push(message);
  pruneBrowserConsoleLocalPortScanQueue();
  scheduleBrowserConsoleLocalPortScan();
}

function pruneBrowserConsoleLocalPortScanQueue() {
  if (browserConsolePortScanQueue.length > BROWSER_CONSOLE_HIDDEN_LOG_LIMIT + BROWSER_CONSOLE_PORT_SCAN_QUEUE_PRUNE_BATCH) {
    browserConsolePortScanQueue.splice(0, browserConsolePortScanQueue.length - BROWSER_CONSOLE_HIDDEN_LOG_LIMIT);
  }
}

function clearBrowserConsoleLocalPortScanQueue() {
  browserConsolePortScanQueue = [];
  if (browserConsolePortScanTimer) window.clearTimeout(browserConsolePortScanTimer);
  browserConsolePortScanTimer = 0;
}

function queueBrowserConsoleHiddenPayloads(payloads: unknown[]) {
  const limit = browserConsoleRuntimeLogLimit(false);
  let accepted = 0;
  for (let index = 0; index < payloads.length; index += 1) {
    if (appendBrowserConsoleHiddenPayload(payloads[index])) accepted += 1;
  }
  if (!accepted) return;
  pruneBrowserConsoleHiddenPayloadQueue(limit, accepted >= limit);
  scheduleBrowserConsoleHiddenPayloadFlush();
}

function queueBrowserConsoleHiddenPayload(payload: unknown) {
  if (!appendBrowserConsoleHiddenPayload(payload)) return;
  pruneBrowserConsoleHiddenPayloadQueue();
  scheduleBrowserConsoleHiddenPayloadFlush();
}

function appendBrowserConsoleHiddenPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  browserConsoleHiddenPayloadQueue.push(payload);
  return true;
}

function pruneBrowserConsoleHiddenPayloadQueue(limit = browserConsoleRuntimeLogLimit(false), force = false) {
  const max = force ? limit : limit + BROWSER_CONSOLE_PORT_SCAN_QUEUE_PRUNE_BATCH;
  if (browserConsoleHiddenPayloadQueue.length <= max) return;
  browserConsoleHiddenPayloadQueue.splice(0, browserConsoleHiddenPayloadQueue.length - limit);
}

function scheduleBrowserConsoleHiddenPayloadFlush() {
  if (browserConsoleHiddenPayloadTimer) return;
  browserConsoleHiddenPayloadTimer = window.setTimeout(() => {
    browserConsoleHiddenPayloadTimer = 0;
    runWhenUiIdle(flushBrowserConsoleHiddenPayloadQueue, BROWSER_CONSOLE_HIDDEN_FLUSH_IDLE_MS);
  }, BROWSER_CONSOLE_HIDDEN_FLUSH_DEBOUNCE_MS);
}

function flushBrowserConsoleHiddenPayloadQueue() {
  if (browserConsoleHiddenPayloadTimer) {
    window.clearTimeout(browserConsoleHiddenPayloadTimer);
    browserConsoleHiddenPayloadTimer = 0;
  }
  if (!browserConsoleHiddenPayloadQueue.length) return;
  const payloads = browserConsoleHiddenPayloadQueue;
  browserConsoleHiddenPayloadQueue = [];
  const entries: BrowserConsoleLog[] = [];
  const time = browserConsoleTimeText();
  const formatter = formatConsoleValueCompact;
  const limit = browserConsoleRuntimeLogLimit(false);
  const start = Math.max(0, payloads.length - limit);
  for (let index = start; index < payloads.length; index += 1) {
    const entry = browserConsoleLogEntryFromPayload(payloads[index], time, formatter);
    if (entry) entries.push(entry);
  }
  appendBrowserConsoleLogBatch(entries, { scanForLocalPorts: true });
}

function clearBrowserConsoleHiddenPayloadQueue() {
  browserConsoleHiddenPayloadQueue = [];
  if (browserConsoleHiddenPayloadTimer) window.clearTimeout(browserConsoleHiddenPayloadTimer);
  browserConsoleHiddenPayloadTimer = 0;
}

function scheduleBrowserConsoleLocalPortScan() {
  if (browserConsolePortScanTimer) return;
  browserConsolePortScanTimer = window.setTimeout(() => {
    browserConsolePortScanTimer = 0;
    runWhenUiIdle(flushBrowserConsoleLocalPortScan, 900);
  }, 320);
}

function flushBrowserConsoleLocalPortScan() {
  if (!shouldScanBrowserConsoleForLocalPorts()) {
    browserConsolePortScanQueue = [];
    return;
  }
  const count = Math.min(16, browserConsolePortScanQueue.length);
  for (let index = 0; index < count; index += 1) {
    maybeAutoForwardBrowserLocalUrl(browserConsolePortScanQueue[index]);
  }
  browserConsolePortScanQueue.splice(0, count);
  if (browserConsolePortScanQueue.length) scheduleBrowserConsoleLocalPortScan();
}

function shouldScanBrowserConsoleForLocalPorts() {
  return Boolean(state.activeProfile && state.activeProfile.kind !== 'windows');
}

function makeBrowserConsoleLogId() {
  browserConsoleLogSequence = (browserConsoleLogSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `log-${browserConsoleLogSequence.toString(36)}`;
}

function browserConsoleTimeText(now = Date.now()) {
  const second = Math.floor(now / 1000);
  if (second === browserConsoleLastTimeSecond) return browserConsoleLastTimeText;
  browserConsoleLastTimeSecond = second;
  browserConsoleLastTimeText = new Date(now).toTimeString().slice(0, 8);
  return browserConsoleLastTimeText;
}

function markBrowserConsoleLogsChanged() {
  browserConsoleLogVersion += 1;
}

function scheduleBrowserConsoleRender() {
  if (!state.browserConsoleVisible || isBrowserPanelHidden() || browserConsoleRenderFrame) return;
  browserConsoleRenderFrame = window.requestAnimationFrame(() => {
    browserConsoleRenderFrame = 0;
    if (browserConsoleActuallyVisible()) renderBrowserConsole();
  });
}

function renderBrowserConsole() {
  if (!state.browserConsoleVisible || isBrowserPanelHidden()) return;
  if (browserConsoleRenderFrame) {
    window.cancelAnimationFrame(browserConsoleRenderFrame);
    browserConsoleRenderFrame = 0;
  }
  const logs = state.browserConsoleLogs;
  const start = Math.max(0, logs.length - BROWSER_CONSOLE_RENDER_LIMIT);
  const renderCount = logs.length - start;
  const signature = browserConsoleSignature(renderCount);
  if (browserConsoleRenderSignature === signature) return;
  if (!logs.length) {
    browserConsoleRenderSignature = signature;
    browserConsoleLastRenderedLogId = '';
    browserConsoleLastRenderedLogIndex = -1;
    clearBrowserConsoleRowElementCache();
    const empty = document.createElement('div');
    empty.className = 'browser-console-empty';
    empty.textContent = 'No console events yet';
    el.browserConsoleLog.replaceChildren(empty);
    return;
  }

  let lastRenderedIndex = -1;
  if (
    browserConsoleLastRenderedLogIndex >= start
    && logs[browserConsoleLastRenderedLogIndex]?.id === browserConsoleLastRenderedLogId
  ) {
    lastRenderedIndex = browserConsoleLastRenderedLogIndex;
  } else {
    for (let index = start; index < logs.length; index += 1) {
      if (logs[index].id === browserConsoleLastRenderedLogId) {
        lastRenderedIndex = index;
        break;
      }
    }
  }
  const canAppend = lastRenderedIndex >= 0
    && el.browserConsoleLog.childElementCount > 0
    && !el.browserConsoleLog.firstElementChild?.classList.contains('browser-console-empty');

  if (canAppend) {
    const firstNewIndex = lastRenderedIndex + 1;
    const newCount = logs.length - firstNewIndex;
    if (newCount === 1) {
      el.browserConsoleLog.append(browserConsoleRowElement(logs[firstNewIndex]));
    } else if (newCount > 1) {
      const fragment = document.createDocumentFragment();
      for (let index = firstNewIndex; index < logs.length; index += 1) {
        fragment.append(browserConsoleRowElement(logs[index]));
      }
      el.browserConsoleLog.append(fragment);
    }
    while (el.browserConsoleLog.childElementCount > renderCount) {
      el.browserConsoleLog.firstElementChild?.remove();
    }
  } else {
    const fragment = document.createDocumentFragment();
    for (let index = start; index < logs.length; index += 1) {
      fragment.append(browserConsoleRowElement(logs[index]));
    }
    el.browserConsoleLog.replaceChildren(fragment);
  }

  browserConsoleRenderSignature = signature;
  browserConsoleLastRenderedLogId = logs[logs.length - 1]?.id ?? '';
  browserConsoleLastRenderedLogIndex = logs.length - 1;
  el.browserConsoleLog.scrollTop = el.browserConsoleLog.scrollHeight;
}

function clearBrowserConsoleRowElementCache() {
  browserConsoleRowElementCache.clear();
  browserConsoleLastRenderedLogId = '';
  browserConsoleLastRenderedLogIndex = -1;
}

function browserConsoleRowElement(entry: BrowserConsoleLog) {
  const cached = browserConsoleRowElementCache.get(entry.id);
  if (cached) return cached;
  const row = document.createElement('div');
  row.dataset.browserConsoleLogId = entry.id;
  row.className = `browser-console-line ${entry.level}`;
  const time = document.createElement('span');
  time.className = 'browser-console-time';
  time.textContent = entry.time;
  const level = document.createElement('span');
  level.className = 'browser-console-level';
  level.textContent = entry.level;
  const message = document.createElement('span');
  message.className = 'browser-console-message';
  message.textContent = entry.message;
  row.append(time, level, message);
  browserConsoleRowElementCache.set(entry.id, row);
  return row;
}

function browserConsoleSignature(renderCount = Math.min(state.browserConsoleLogs.length, BROWSER_CONSOLE_RENDER_LIMIT)) {
  const last = state.browserConsoleLogs[state.browserConsoleLogs.length - 1];
  return `${browserConsoleLogVersion}\t${renderCount}\t${last?.id ?? ''}`;
}

function activeBrowserFrameForMessage(event: MessageEvent) {
  if (isBrowserPanelHidden()) return null;
  const frame = activeBrowserFrame();
  if (!frame || frame.contentWindow !== event.source) return null;
  if (frame.classList.contains('hidden')) return null;
  if (frame.dataset.browserTabId !== state.activeBrowserTabId) return null;
  return frame;
}

function handleBrowserConsoleMessage(event: MessageEvent) {
  if (isBrowserPanelHidden()) return;
  const frame = activeBrowserFrameForMessage(event);
  if (!frame) return;
  const data = browserFrameMessagePayload(event.data);
  if (!data) return;
  const openUrl = data.__simpleVibeOpenUrl;
  if (typeof openUrl === 'string' && openUrl.trim()) {
    void openPreviewValue(openUrl.trim());
    return;
  }
  const refresh = data.__simpleVibeRefresh;
  if (refresh && typeof refresh === 'object') {
    refreshPreview(Boolean((refresh as { hard?: unknown }).hard));
    return;
  }
  const zoom = data.__simpleVibeZoom;
  if (zoom && typeof zoom === 'object') {
    const payload = zoom as { direction?: unknown; reset?: unknown };
    if (payload.reset) resetBrowserZoom();
    else {
      const direction = Number(payload.direction);
      if (direction) resizeBrowserZoom(direction > 0 ? 1 : -1);
    }
    return;
  }
  const contextMenu = data.__simpleVibeContextMenu;
  if (contextMenu && typeof contextMenu === 'object') {
    const payload = contextMenu as { x?: unknown; y?: unknown };
    showBrowserContextMenuFromFrame(Number(payload.x), Number(payload.y));
    return;
  }
  const assetFailure = data.__simpleVibePreviewAssetFailure;
  if (assetFailure && typeof assetFailure === 'object') {
    handleBrowserPreviewAssetFailure(frame, assetFailure as BrowserPreviewAssetFailurePayload);
    return;
  }
  const batch = data.__simpleVibeConsoleBatch;
  if (Array.isArray(batch)) {
    handleBrowserConsoleBatch(batch);
    return;
  }
  const payload = data.simpleVibeConsole ?? data.__simpleVibeConsole;
  handleBrowserConsoleRecord(payload);
}

function browserFrameMessagePayload(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const record = data as {
    __simpleVibeOpenUrl?: unknown;
    __simpleVibeRefresh?: unknown;
    __simpleVibeZoom?: unknown;
    __simpleVibeContextMenu?: unknown;
    __simpleVibePreviewAssetFailure?: unknown;
    __simpleVibeConsoleBatch?: unknown;
    simpleVibeConsole?: unknown;
    __simpleVibeConsole?: unknown;
  };
  if (
    !('__simpleVibeOpenUrl' in record)
    && !('__simpleVibeRefresh' in record)
    && !('__simpleVibeZoom' in record)
    && !('__simpleVibeContextMenu' in record)
    && !('__simpleVibePreviewAssetFailure' in record)
    && !('__simpleVibeConsoleBatch' in record)
    && !('simpleVibeConsole' in record)
    && !('__simpleVibeConsole' in record)
  ) {
    return null;
  }
  return record;
}

function handleBrowserPreviewAssetFailure(frame: HTMLIFrameElement, payload: BrowserPreviewAssetFailurePayload) {
  const tabId = frame.dataset.browserTabId ?? '';
  const tab = tabId ? browserTabForId(tabId) : null;
  if (!tab || tab.id !== state.activeBrowserTabId) return;
  const kind = typeof payload.kind === 'string' ? payload.kind : 'asset';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'resource';
  const url = typeof payload.url === 'string' ? payload.url : tab.url;
  logBrowserConsole('warn', `Preview ${tag} load issue (${kind}): ${url}`);
  scheduleBrowserAssetRecovery(tab);
}

// A dev server (Flutter/webpack/vite) may not be serving every asset the instant the proxy comes
// up, so give the page a few escalating retries before giving up. Persistent failures (e.g. a
// cross-origin sub-resource on another port) still stop after the cap so we don't reload forever.
const BROWSER_ASSET_RECOVERY_MAX_ATTEMPTS = 3;
const BROWSER_ASSET_RECOVERY_WINDOW_MS = 45_000;
const BROWSER_ASSET_RECOVERY_DELAYS_MS = [600, 1400, 2800];

function scheduleBrowserAssetRecovery(tab: BrowserTab) {
  const existingTimer = browserAssetRecoveryTimers.get(tab.id);
  if (existingTimer) return;
  const now = Date.now();
  const previous = browserAssetRecoveryByTabId.get(tab.id);
  const sameUrl = previous?.url === tab.url && now - previous.at < BROWSER_ASSET_RECOVERY_WINDOW_MS;
  const count = sameUrl ? previous.count + 1 : 1;
  browserAssetRecoveryByTabId.set(tab.id, { url: tab.url, count, at: now });
  if (count > BROWSER_ASSET_RECOVERY_MAX_ATTEMPTS) {
    logBrowserConsole('warn', `Preview asset recovery stopped after repeated failures for ${tab.url}`);
    return;
  }
  const delay = BROWSER_ASSET_RECOVERY_DELAYS_MS[Math.min(count, BROWSER_ASSET_RECOVERY_DELAYS_MS.length) - 1];
  const timer = window.setTimeout(() => {
    browserAssetRecoveryTimers.delete(tab.id);
    const current = browserTabForId(tab.id);
    if (!current || current.id !== state.activeBrowserTabId || current.url !== tab.url) return;
    logBrowserConsole('info', `Retrying preview load after asset failure (${count}/${BROWSER_ASSET_RECOVERY_MAX_ATTEMPTS})`);
    if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(current.url)) {
      loadBrowserTabThroughPreviewProxy(current, { hard: true, reload: true, clearCache: count > 1 });
    } else {
      loadBrowserFrame(current, { hard: true, reload: true });
    }
  }, delay);
  browserAssetRecoveryTimers.set(tab.id, timer);
}

function cancelBrowserAssetRecovery(tabId: string) {
  const timer = browserAssetRecoveryTimers.get(tabId);
  if (timer) window.clearTimeout(timer);
  browserAssetRecoveryTimers.delete(tabId);
  browserAssetRecoveryByTabId.delete(tabId);
}

function handleBrowserConsoleRecord(payload: unknown) {
  if (!browserConsoleActuallyVisible()) {
    queueBrowserConsoleHiddenPayload(payload);
    return;
  }
  const entry = browserConsoleLogEntryFromPayload(payload);
  if (entry) appendBrowserConsoleLogEntry(entry, { scanForLocalPorts: true });
}

function handleBrowserConsoleBatch(batch: unknown[]) {
  if (!browserConsoleActuallyVisible()) {
    queueBrowserConsoleHiddenPayloads(batch);
    return;
  }
  const entries: BrowserConsoleLog[] = [];
  const time = browserConsoleTimeText();
  const formatter = browserConsoleValueFormatter();
  const limit = browserConsoleRuntimeLogLimit();
  const start = Math.max(0, batch.length - limit);
  for (let index = start; index < batch.length; index += 1) {
    const entry = browserConsoleLogEntryFromPayload(batch[index], time, formatter);
    if (entry) entries.push(entry);
  }
  appendBrowserConsoleLogBatch(entries, { scanForLocalPorts: true });
}

function browserConsoleLogEntryFromPayload(
  payload: unknown,
  time = browserConsoleTimeText(),
  formatter = browserConsoleValueFormatter()
) {
  if (!payload || typeof payload !== 'object') return;
  const record = payload as { level?: string; message?: unknown; args?: unknown[]; argCount?: unknown };
  const level = record.level === 'warn' || record.level === 'error' ? record.level : 'info';
  const message = formatConsoleMessage(record, formatter);
  return message ? makeBrowserConsoleLogEntry(level, message, time) : null;
}

function browserConsoleValueFormatter() {
  const detailed = browserConsoleActuallyVisible();
  return detailed ? formatConsoleValue : formatConsoleValueCompact;
}

function formatConsoleMessage(record: { message?: unknown; args?: unknown[]; argCount?: unknown }, formatter = browserConsoleValueFormatter()) {
  if (Array.isArray(record.args)) {
    const limit = Math.min(record.args.length, BROWSER_CONSOLE_ARG_LIMIT);
    const totalArgs = Number.isFinite(Number(record.argCount))
      ? Math.max(record.args.length, Math.trunc(Number(record.argCount)))
      : record.args.length;
    let message = '';
    for (let index = 0; index < limit; index += 1) {
      if (index) message += ' ';
      message += formatter(record.args[index]);
    }
    if (totalArgs > BROWSER_CONSOLE_ARG_LIMIT) {
      if (message) message += ' ';
      message += `... +${totalArgs - BROWSER_CONSOLE_ARG_LIMIT} more`;
    }
    return truncateConsoleMessage(message);
  }
  return truncateConsoleMessage(formatter(record.message ?? ''));
}

function truncateConsoleMessage(message: string) {
  if (message.length <= BROWSER_CONSOLE_MESSAGE_MAX_CHARS) return message;
  return `${message.slice(0, BROWSER_CONSOLE_MESSAGE_MAX_CHARS)} ...[truncated ${message.length - BROWSER_CONSOLE_MESSAGE_MAX_CHARS} chars]`;
}

function formatConsoleValueCompact(value: unknown) {
  if (typeof value === 'string') return truncateConsoleMessage(value);
  if (value == null) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (typeof value === 'object') {
    let text = '{';
    let count = 0;
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (count) text += ',';
      text += key;
      count += 1;
      if (count >= 6) break;
    }
    return count ? `${text}}` : '{}';
  }
  return String(value);
}

function maybeAutoForwardBrowserLocalUrl(message: string) {
  const profile = state.activeProfile;
  if (!profile || profile.kind === 'windows') return;
  const profileId = profile.id;
  BROWSER_CONSOLE_LOCAL_URL_PORT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BROWSER_CONSOLE_LOCAL_URL_PORT_PATTERN.exec(message))) {
    const port = Number(match[1]);
    if (!isPreviewPort(port)) continue;
    if (isPreviewProxyLocalPort(port)) continue;
    if (forwardForRemotePort(port)) continue;
    const key = `browser-dep:${profileId}:${port}`;
    if (autoForwardingPorts.has(key)) continue;
    autoForwardingPorts.add(key);
    void startForwardForPort(port, 'auto')
      .then((forward) => {
        addForward(forward);
        renderForwards();
        logBrowserConsole('info', `Auto forwarded browser dependency port ${port}`);
      })
      .catch((error) => logBrowserConsole('warn', `Auto forward for browser dependency port ${port} failed: ${String(error)}`))
      .finally(() => autoForwardingPorts.delete(key));
  }
}

function browserConsoleMayContainLocalPreviewPort(message: string) {
  return message.includes(':')
    && (message.includes('localhost:')
    || message.includes('127.0.0.1:')
    || message.includes('0.0.0.0:')
    || message.includes('[::1]:')
    || message.includes('://localhost')
    || message.includes('://127.0.0.1')
    || message.includes('://0.0.0.0')
    || message.includes('://[::1]'));
}

function showBrowserContextMenuFromFrame(x: number, y: number) {
  if (activeEdgeCdp) {
    showContextMenu(Number.isFinite(x) ? x : 16, Number.isFinite(y) ? y : 16, browserContextMenuItems());
    return;
  }
  const frame = activeBrowserFrame();
  if (!frame) return;
  const rect = frame.getBoundingClientRect();
  const clientX = Number.isFinite(x) ? rect.left + x : rect.left + 16;
  const clientY = Number.isFinite(y) ? rect.top + y : rect.top + 16;
  showContextMenu(clientX, clientY, browserContextMenuItems());
}

function formatConsoleValue(value: unknown) {
  if (typeof value === 'string') return truncateConsoleMessage(value);
  if (value == null) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return String(value);
  return truncateConsoleMessage(formatConsoleStructuredValue(value, 0, new WeakSet<object>()));
}

function formatConsoleStructuredValue(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (typeof value === 'string') return JSON.stringify(truncateConsoleMessage(value));
  if (value == null) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return Array.isArray(value)
      ? formatConsoleArrayValue(value, depth, seen)
      : formatConsoleObjectValue(value as Record<string, unknown>, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function formatConsoleArrayValue(value: unknown[], depth: number, seen: WeakSet<object>) {
  if (depth >= BROWSER_CONSOLE_DETAIL_DEPTH_LIMIT) return `[Array(${value.length})]`;
  const limit = Math.min(value.length, BROWSER_CONSOLE_ARRAY_DETAIL_LIMIT);
  let text = '[';
  for (let index = 0; index < limit; index += 1) {
    if (index) text += ',';
    text += formatConsoleStructuredValue(value[index], depth + 1, seen);
    if (text.length >= BROWSER_CONSOLE_STRUCTURED_VALUE_MAX_CHARS) {
      if (index + 1 < value.length) text += ',...';
      return `${text}]`;
    }
  }
  if (value.length > limit) {
    if (limit) text += ',';
    text += `... +${value.length - limit} more`;
  }
  return `${text}]`;
}

function formatConsoleObjectValue(value: Record<string, unknown>, depth: number, seen: WeakSet<object>) {
  if (depth >= BROWSER_CONSOLE_DETAIL_DEPTH_LIMIT) return formatConsoleValueCompact(value);
  let text = '{';
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (count >= BROWSER_CONSOLE_OBJECT_DETAIL_KEY_LIMIT) {
      if (count) text += ',';
      text += '...';
      return `${text}}`;
    }
    if (count) text += ',';
    text += `${JSON.stringify(key)}:${formatConsoleStructuredValue(value[key], depth + 1, seen)}`;
    count += 1;
    if (text.length >= BROWSER_CONSOLE_STRUCTURED_VALUE_MAX_CHARS) {
      text += ',...';
      return `${text}}`;
    }
  }
  return count ? `${text}}` : '{}';
}

function currentBrowserTab() {
  return browserTabForId(state.activeBrowserTabId);
}

function navigateBrowserHistory(delta: -1 | 1) {
  if (activeEdgeCdp) {
    void edgeCdpSend('Runtime.evaluate', {
      expression: delta < 0 ? 'history.back()' : 'history.forward()',
      userGesture: true
    }).then(() => {
      activateBrowserPanel();
      logBrowserConsole('info', delta < 0 ? 'Browser back' : 'Browser forward');
    }).catch((error) => setStatus(`Browser history navigation failed: ${String(error)}`, true));
    return;
  }
  const frame = activeBrowserFrame();
  if (!frame?.contentWindow) {
    setStatus('No active browser tab', true);
    return;
  }
  try {
    frame.contentWindow.history.go(delta);
    activateBrowserPanel();
    logBrowserConsole('info', delta < 0 ? 'Browser back' : 'Browser forward');
  } catch (error) {
    setStatus(`Browser history navigation failed: ${String(error)}`, true);
  }
}

function handleBrowserRefreshShortcut(event: KeyboardEvent) {
  if (event.key !== 'F5') return;
  const target = event.target instanceof Element ? event.target : null;
  const browserFocused = keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === 'browser';
  if (!target?.closest('.browser-panel') && !browserFocused) return;
  event.preventDefault();
  event.stopPropagation();
  refreshPreview(event.ctrlKey || event.shiftKey);
}

function refreshPreview(hard: boolean) {
  const tab = currentBrowserTab();
  if (!tab) {
    setStatus('No preview URL to refresh', true);
    return;
  }

  if (activeEdgeCdp && tab.edge && activeEdgeCdp.tabId === tab.id) {
    void edgeCdpSend('Page.reload', { ignoreCache: hard }).then(() => {
      state.previewUrl = tab.url;
      setInputValueIfChanged(el.previewUrl, tab.url);
      logBrowserConsole('info', hard ? `Hard refresh ${tab.url}` : `Reload ${tab.url}`);
      setStatus(hard ? `Hard refreshed ${tab.url}` : `Reloaded ${tab.url}`);
    }).catch((error) => setStatus(`Browser reload failed: ${String(error)}`, true));
    return;
  }

  if (USE_EDGE_CDP_BROWSER) {
    activateBrowserTab(tab.id);
    return;
  }

  if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(tab.url)) {
    loadBrowserTabThroughPreviewProxy(tab, { hard, reload: true });
  } else {
    loadBrowserFrame(tab, { hard, reload: true });
  }
  state.previewUrl = tab.url;
  setInputValueIfChanged(el.previewUrl, tab.url);
  logBrowserConsole('info', hard ? `Hard refresh ${tab.url}` : `Reload ${tab.url}`);
  setStatus(hard ? `Hard refreshed ${tab.url}` : `Reloaded ${tab.url}`);
}

async function clearBrowserCacheAndReload() {
  const tab = currentBrowserTab();
  if (!tab) {
    setStatus('No browser tab to clear', true);
    return;
  }

  if (activeEdgeCdp && tab.edge && activeEdgeCdp.tabId === tab.id) {
    await edgeCdpSend('Network.clearBrowserCache', {}).catch(() => undefined);
    await edgeCdpSend('Page.reload', { ignoreCache: true }).then(() => {
      state.previewUrl = tab.url;
      setInputValueIfChanged(el.previewUrl, tab.url);
      logBrowserConsole('info', `Cleared browser cache and reloaded ${tab.url}`);
      setStatus(`Cleared cache for ${tab.url}`);
    }).catch((error) => setStatus(`Browser cache clear failed: ${String(error)}`, true));
    return;
  }

  const localUrl = localHttpPreviewUrl(tab.url);
  if (USE_PREVIEW_PROXY_BROWSER && localUrl) {
    clearPreviewProxyForBrowserTab(tab);
    loadBrowserTabThroughPreviewProxy(tab, { hard: true, reload: true, clearCache: true });
  } else {
    const frame = browserFrameForTab(tab.id);
    if (frame) {
      frame.src = 'about:blank';
      delete frame.dataset.loadedUrl;
      delete frame.dataset.loadingUrl;
      delete frame.dataset.loadingSrc;
    }
    loadBrowserFrame(tab, { hard: true, reload: true });
  }
  state.previewUrl = tab.url;
  setInputValueIfChanged(el.previewUrl, tab.url);
  logBrowserConsole('info', `Cleared preview cache and reloaded ${tab.url}`);
  setStatus(`Cleared cache for ${tab.url}`);
}

function makeBrowserTabId() {
  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function browserTabLabel(url: string) {
  try {
    const parsed = new URL(url);
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port) {
      return portTabLabel(Number(parsed.port));
    }
    return parsed.host || parsed.pathname || 'Preview';
  } catch {
    return url;
  }
}

function portTabLabel(port: number) {
  return Number.isInteger(port) ? `:${port}` : 'Preview';
}

function withPreviewCacheBuster(url: string) {
  const stamp = Date.now().toString(36);
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('__svide_hard_reload', stamp);
    return parsed.toString();
  } catch {
    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}__svide_hard_reload=${stamp}${hash}`;
  }
}

function normalizeBrowserAddressValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeBrowserHistoryUrl(trimmed);
}

function normalizePreviewUrl(value: string) {
  const localPortUrl = normalizeLocalPortShorthandUrl(value);
  if (localPortUrl) return localPortUrl;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `http://${value}`;
}

function normalizeLocalPortShorthandUrl(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^:?(?<port>\d{1,5})(?<suffix>(?:[/?#].*)?)$/);
  if (!match?.groups) return '';
  const port = Number(match.groups.port);
  if (!isPreviewPort(port)) return '';
  return `http://127.0.0.1:${port}${match.groups.suffix || ''}`;
}

function normalizeBrowserHistoryUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(normalizePreviewUrl(trimmed));
    const base = `${parsed.protocol}//${parsed.host}`;
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) return base;
    return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return normalizePreviewUrl(trimmed);
  }
}

function parseLocalPreviewUrl(value: string) {
  const trimmed = value.trim();
  if (!/[/?#]/.test(trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))) return null;
  try {
    const url = new URL(normalizePreviewUrl(trimmed));
    if (!isLocalPreviewHost(url.hostname)) return null;
    return url.port ? url : null;
  } catch {
    return null;
  }
}

function isLocalPreviewHost(hostname: string) {
  return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(hostname);
}

function parsePreviewPort(value: string) {
  const trimmed = value.trim();
  if (/^\d{2,5}$/.test(trimmed)) {
    const port = Number(trimmed);
    return isPreviewPort(port) ? port : null;
  }
  const match = trimmed.match(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(?:[/?#].*)?$/i);
  if (!match) return null;
  const port = Number(match[1]);
  return isPreviewPort(port) ? port : null;
}

function detectNewLocalServerPorts(text: string, seenPorts: Set<number>, onPort: (port: number) => void) {
  let found = 0;
  LOCAL_PREVIEW_URL_PORT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LOCAL_PREVIEW_URL_PORT_PATTERN.exec(text))) {
    const port = Number(match[1]);
    if (!isPreviewPort(port) || seenPorts.has(port)) continue;
    seenPorts.add(port);
    found += 1;
    onPort(port);
  }

  LOCAL_PREVIEW_LISTENING_PORT_PATTERN.lastIndex = 0;
  while ((match = LOCAL_PREVIEW_LISTENING_PORT_PATTERN.exec(text))) {
    const port = Number(match[1]);
    if (!isPreviewPort(port) || seenPorts.has(port)) continue;
    seenPorts.add(port);
    found += 1;
    onPort(port);
  }
  return found;
}

function isPreviewPort(port: number) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function trimPortScanBuffer(value: string) {
  return trimLimitedTextBuffer(value, TERMINAL_PORT_SCAN_LIMIT);
}

function appendLimitedTextBuffer(buffer: string, data: string, limit: number) {
  if (!data) return buffer;
  if (data.length >= limit) return data.slice(data.length - limit);
  const overflow = buffer.length + data.length - limit;
  return overflow > 0 ? `${buffer.slice(overflow)}${data}` : `${buffer}${data}`;
}

function trimLimitedTextBuffer(value: string, limit: number) {
  return value.length > limit ? value.slice(value.length - limit) : value;
}

function renderBrowserDeviceOptions() {
  const signature = browserDeviceOptionsSignature();
  if (browserDeviceOptionsRenderSignature === signature && el.deviceSelect.childElementCount > 0) {
    const value = normalizedBrowserDeviceId(state.browserDeviceId);
    if (el.deviceSelect.value !== value) el.deviceSelect.value = value;
    return;
  }
  browserDeviceOptionsRenderSignature = signature;
  el.deviceSelect.innerHTML = '';
  const desktop = document.createElement('option');
  desktop.value = 'desktop';
  desktop.textContent = 'Desktop';
  el.deviceSelect.append(desktop);
  for (const kind of ['phone', 'tablet'] as const) {
    const group = document.createElement('optgroup');
    group.label = kind === 'phone' ? 'Phones' : 'Tablets';
    for (const preset of BROWSER_DEVICE_PRESETS) {
      if (preset.kind !== kind) continue;
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.label} (${preset.width} x ${preset.height})`;
      group.append(option);
    }
    el.deviceSelect.append(group);
  }
  el.deviceSelect.value = normalizedBrowserDeviceId(state.browserDeviceId);
}

function browserDeviceOptionsSignature() {
  let signature = 'desktop\tDesktop';
  for (const preset of BROWSER_DEVICE_PRESETS) {
    signature += `\n${preset.kind}\t${preset.id}\t${preset.label}\t${preset.width}\t${preset.height}`;
  }
  return signature;
}

function browserDevicePreset(id = state.browserDeviceId) {
  return BROWSER_DEVICE_PRESET_BY_ID.get(id) ?? BROWSER_DEVICE_PRESETS[0];
}

function applyBrowserViewportFromTab(tab: BrowserTab | null | undefined, options: { skipFrameSizing?: boolean } = {}) {
  state.browserDeviceId = normalizedBrowserDeviceId(tab?.deviceId ?? state.browserDeviceId);
  state.browserOrientation = normalizedBrowserOrientation(tab?.orientation ?? state.browserOrientation);
  state.browserZoom = normalizedBrowserZoom(tab?.zoom ?? state.browserZoom);
  if (tab) {
    tab.deviceId = state.browserDeviceId;
    tab.orientation = state.browserOrientation;
    tab.zoom = state.browserZoom;
  }
  applyBrowserZoom();
  if (state.browserDeviceId === 'desktop') {
    setBrowserMode('desktop', { skipFrameSizing: options.skipFrameSizing, skipSave: true });
  } else {
    setBrowserDevice(state.browserDeviceId, { skipFrameSizing: options.skipFrameSizing, skipSave: true });
  }
}

function syncActiveBrowserTabViewport() {
  const tab = currentBrowserTab();
  if (!tab) return;
  tab.deviceId = state.browserDeviceId;
  tab.orientation = state.browserOrientation;
  tab.zoom = state.browserZoom;
}

function setBrowserMode(mode: 'desktop' | 'device', options: { skipFrameSizing?: boolean; skipSave?: boolean } = {}) {
  const isDesktop = mode === 'desktop';
  if (isDesktop) state.browserDeviceId = 'desktop';
  if (!options.skipSave) syncActiveBrowserTabViewport();
  toggleClassIfChanged(el.browserShell, 'device', !isDesktop);
  toggleClassIfChanged(el.browserShell, 'desktop', isDesktop);
  if (el.desktopSize) toggleClassIfChanged(el.desktopSize, 'active', isDesktop);
  toggleClassIfChanged(el.deviceSelect, 'active', !isDesktop);
  setDisabledIfChanged(el.rotateDevice, isDesktop);

  if (isDesktop) {
    if (el.deviceSelect.value !== 'desktop') el.deviceSelect.value = 'desktop';
    if (!options.skipFrameSizing) applyBrowserFrameSizingForActiveFrame();
    setDatasetValueIfChanged(el.browserShell, 'device', 'Desktop');
    setElementTextIfChanged(el.rotateDevice, 'Rotate');
    if (!options.skipFrameSizing) {
      applyEdgePreviewSizing();
      scheduleConfigureEdgeViewport();
    }
    if (!options.skipSave) saveActiveWorkspaceSnapshot();
    return;
  }

  applyBrowserDevice({ skipFrameSizing: options.skipFrameSizing });
  if (!options.skipSave) saveActiveWorkspaceSnapshot();
}

function setBrowserDevice(id: string, options: { skipFrameSizing?: boolean; skipSave?: boolean } = {}) {
  if (!BROWSER_DEVICE_PRESET_BY_ID.has(id)) return;
  state.browserDeviceId = id;
  if (!options.skipSave) syncActiveBrowserTabViewport();
  if (el.deviceSelect.value !== id) el.deviceSelect.value = id;
  setBrowserMode('device', options);
}

function rotateBrowserDevice() {
  state.browserOrientation = state.browserOrientation === 'portrait' ? 'landscape' : 'portrait';
  syncActiveBrowserTabViewport();
  setBrowserMode('device');
}

function applyBrowserDevice(options: { skipFrameSizing?: boolean } = {}) {
  const preset = browserDevicePreset();
  const portrait = state.browserOrientation === 'portrait';
  const width = portrait ? preset.width : preset.height;
  const height = portrait ? preset.height : preset.width;
  if (!options.skipFrameSizing) {
    applyBrowserFrameSizingForActiveFrame();
  }
  setDatasetValueIfChanged(el.browserShell, 'device', `${preset.label} ${width} x ${height}`);
  setElementTextIfChanged(el.rotateDevice, portrait ? 'Rotate' : 'Portrait');
  if (!options.skipFrameSizing) {
    applyEdgePreviewSizing();
    scheduleConfigureEdgeViewport();
  }
}

function applyBrowserFrameSizing(frame: HTMLIFrameElement) {
  const signature = browserFrameSizingSignature();
  if (frame.dataset.browserSizingSignature === signature) return;
  frame.dataset.browserSizingSignature = signature;
  if (el.browserShell.classList.contains('desktop')) {
    if (frame.style.width) frame.style.width = '';
    if (frame.style.height) frame.style.height = '';
    return;
  }
  const preset = browserDevicePreset();
  const portrait = state.browserOrientation === 'portrait';
  const zoom = normalizedBrowserZoom(state.browserZoom);
  const width = `${Math.max(1, Math.round((portrait ? preset.width : preset.height) / zoom))}px`;
  const height = `${Math.max(1, Math.round((portrait ? preset.height : preset.width) / zoom))}px`;
  if (frame.style.width !== width) frame.style.width = width;
  if (frame.style.height !== height) frame.style.height = height;
}

function applyBrowserFrameSizingForActiveFrame() {
  const frame = activeBrowserFrame();
  if (!frame) return;
  applyBrowserFrameSizing(frame);
  const tab = currentBrowserTab();
  const title = tab ? browserFrameTitle(tab) : 'local preview';
  if (frame.title !== title) frame.title = title;
}

function browserFrameTitle(tab: BrowserTab) {
  if (el.browserShell.classList.contains('desktop')) return tab.label || browserTabLabel(tab.url);
  const preset = browserDevicePreset();
  const portrait = state.browserOrientation === 'portrait';
  const width = portrait ? preset.width : preset.height;
  const height = portrait ? preset.height : preset.width;
  return `${preset.label} ${width} x ${height}`;
}

function browserFrameSizingSignature() {
  if (el.browserShell.classList.contains('desktop')) return `desktop:${state.browserZoom.toFixed(2)}`;
  return `${state.browserDeviceId}:${state.browserOrientation}:${state.browserZoom.toFixed(2)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function nextImageName(): string {
  const index = state.imageCounter++;
  if (index === 0) return 'image.png';
  return `image${String(index).padStart(2, '0')}.png`;
}

function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '/' || /^[A-Za-z]:$/.test(trimmed)) return path;
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx <= 0) return path.startsWith('/') ? '/' : path;
  const parent = trimmed.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || (path.startsWith('/') ? '/' : path);
}

function joinExplorerPath(base: string, name: string): string {
  const separator = base.includes('\\') ? '\\' : '/';
  const trimmed = base.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '/') return `/${name}`;
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\${name}`;
  return `${trimmed}${separator}${name}`;
}

function sameExplorerPath(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  return explorerPathKey(a) === explorerPathKey(b);
}

function explorerPathKey(path: string): string {
  const cached = explorerPathKeyCache.get(path);
  if (cached) return cached;
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const key = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLocaleLowerCase()
    : normalized;
  explorerPathKeyCache.set(path, key);
  pruneExplorerPathKeyCache();
  return key;
}

function pruneExplorerPathKeyCache() {
  if (explorerPathKeyCache.size <= EXPLORER_PATH_KEY_CACHE_LIMIT + EXPLORER_PATH_KEY_CACHE_PRUNE_BATCH) return;
  if (explorerCachePruneBusy()) {
    scheduleExplorerPathKeyCachePrune();
    if (explorerPathKeyCache.size <= EXPLORER_PATH_KEY_CACHE_BUSY_LIMIT) return;
    pruneExplorerPathKeyCacheEntries(EXPLORER_PATH_KEY_CACHE_PRUNE_BATCH);
    return;
  }
  pruneExplorerPathKeyCacheEntries();
}

function pruneExplorerPathKeyCacheEntries(maxDeletes = Number.POSITIVE_INFINITY) {
  let deleted = 0;
  while (explorerPathKeyCache.size > EXPLORER_PATH_KEY_CACHE_LIMIT && deleted < maxDeletes) {
    const oldest = explorerPathKeyCache.keys().next().value;
    if (oldest === undefined) break;
    explorerPathKeyCache.delete(oldest);
    deleted += 1;
  }
}

function scheduleExplorerPathKeyCachePrune() {
  if (explorerPathKeyCachePruneTimer) return;
  const delay = Math.max(120, explorerScrollingUntil - Date.now() + EXPLORER_SCROLL_IDLE_MS);
  explorerPathKeyCachePruneTimer = window.setTimeout(() => {
    explorerPathKeyCachePruneTimer = 0;
    runWhenUiIdle(pruneExplorerPathKeyCache, 620);
  }, delay);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

init().catch((error) => setStatus(String(error), true));
