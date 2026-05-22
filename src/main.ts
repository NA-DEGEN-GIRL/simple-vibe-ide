import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image as TauriImage } from '@tauri-apps/api/image';
import type { Extension } from '@codemirror/state';
import type { EditorView as CodeMirrorView } from '@codemirror/view';
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { api } from './api';
import type { ConnectionProfile, EdgeDevtoolsSession, ExportJobStatus, ExportProgressEvent, FileEntry, PortForwardResult, TerminalDataEvent, TerminalExitEvent } from './types';
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
  term: Terminal;
  fit: FitAddon;
  element: HTMLElement;
  host: HTMLElement;
  outputBuffer: string;
  cwdOutputBuffer: string;
  inputBuffer: string;
  seenPorts: Set<number>;
  fitFrame?: number;
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
  frameUrl?: string;
  edge?: EdgeBrowserTarget;
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
}

interface TextFileCacheEntry {
  content: string;
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
}

interface NoteTabState {
  id: string;
  path: string;
  title: string;
  theme: NoteThemeId;
  content: string;
  dirty: boolean;
  saving: boolean;
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
}

interface NoteTabSnapshot {
  id: string;
  path: string;
  title: string;
  theme?: NoteThemeId;
}

interface WorkspaceSnapshot {
  id: string;
  label: string;
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

interface WorkspaceRuntimeCache {
  editorTabs: EditorTabState[];
  activeEditorTabId: string;
  explorer?: ExplorerRuntimeCache;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string;
  previewUrl: string;
  previewProxies: PortForwardResult[];
  browserConsoleLogs: BrowserConsoleLog[];
}

interface ExplorerRuntimeCache {
  currentDir: string;
  entries: FileEntry[];
  expanded: string[];
  children: Array<[string, FileEntry[]]>;
  signatures: Array<[string, string]>;
  selectedPath: string;
}

interface ExplorerVisibleRow {
  entry: FileEntry | null;
  path: string;
  depth: number;
  loading: boolean;
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

type FloatingPanelId = 'explorer' | 'editor' | 'image' | 'browser' | 'notes' | 'calculator' | 'settings';
type PanelRect = { left: number; top: number; width: number; height: number };
type ExplorerOpenMode = 'single' | 'double';
type BrowserOrientation = 'portrait' | 'landscape';
type BrowserConsolePosition = 'bottom' | 'right' | 'top' | 'left';
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
};

type LlmLauncherFlag = {
  bashPattern: string;
  powershellPattern: string;
  args: string[];
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
        bashPattern: '*--dangerously-skip-permissions*',
        powershellPattern: '--dangerously-skip-permissions',
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
const MARKET_TICKER_STORE_KEY = 'simple-vibe-ide.marketTicker.v1';
const IDE_SETTINGS_KEY = 'simple-vibe-ide.settings.v1';
const NOTES_DIR = '.vibe-ide-temp/notes';
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
const EXPLORER_TYPEAHEAD_TIMEOUT_MS = 900;
const EXPLORER_WATCH_LOCAL_MS = 2500;
const EXPLORER_WATCH_WSL_MS = 3500;
const EXPLORER_WATCH_SSH_MS = 7000;
const EXPLORER_WATCH_MAX_DIRS = 12;
const EXPLORER_DIRECTORY_CACHE_LIMIT = 48;
const NOTES_AUTOSAVE_DELAY_MS = 1800;
const TEXT_FILE_CACHE_LIMIT = 64;
const TEXT_FILE_PREFETCH_MAX_BYTES = 512 * 1024;
const SECRET_PARSE_CACHE_LIMIT = 32;
const EDITOR_LOADING_DELAY_MS = 180;
const EXPLORER_ROW_HEIGHT = 32;
const EXPLORER_VIRTUAL_OVERSCAN = 12;
const EXPLORER_SCROLL_IDLE_MS = 180;
const EXPLORER_HOVER_PREFETCH_DELAY_MS = 180;
const EXPLORER_DIRECTORY_PREFETCH_DELAY_MS = 120;
const EXPLORER_DIRECTORY_PREFETCH_LIMIT = 6;
const DEFAULT_BROWSER_DEVICE_ID = 'iphone-15';
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
const DEFAULT_MARKET_TICKERS: MarketTickerConfig[] = [
  { id: 'btc', label: 'BTC', symbol: 'BTCUSDT' },
  { id: 'nas100', label: 'NAS100', symbol: 'QQQUSDT' }
];
const MARKET_TICKER_WS_URL = 'wss://fstream.binance.com/market/stream?streams=';
const MARKET_TICKER_REST_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=';
const MARKET_TICKER_BOOT_DELAY_MS = 1200;
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
  browserTabs: [] as BrowserTab[],
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
  showFileSizes: true
};

let codeView: CodeMirrorView | null = null;
let editorRenderToken = 0;
let editorRuntimePromise: Promise<EditorRuntime> | null = null;
let panelZ = 20;
let keyboardResizeTarget: ResizeTarget = { kind: 'ide' };
let ideScale = 1;
let editorFontSize = 13;
let terminalFontSize = 13;
let noteFontSize = 14;
let noteOpacity = 100;
let calculatorFontSize = 15;
let restoringWorkspace = false;
const layoutRatios = new WeakMap<HTMLElement, LayoutRatio>();
const autoForwardingPorts = new Set<string>();
const textFileCache = new Map<string, TextFileCacheEntry>();
const textFileReads = new Map<string, Promise<string>>();
const textFilePrefetchTimers = new Map<string, number>();
const secretParseCache = new Map<string, SecretLine[]>();
const explorerDirectoryCache = new Map<string, { entries: FileEntry[]; cachedAt: number }>();
const explorerDirectoryReads = new Map<string, Promise<FileEntry[]>>();
const explorerDirectoryPrefetchTimers = new Map<string, number>();
const workspaceRuntimeCache = new Map<string, WorkspaceRuntimeCache>();
const edgeDevtoolsSessions = new Map<string, EdgeDevtoolsSession>();
const noteSaveTimers = new Map<string, number>();
const explorerVisibleEntryByPath = new Map<string, FileEntry>();
let explorerVisibleRows: ExplorerVisibleRow[] = [];
let explorerRenderedStart = 0;
let explorerRenderedEnd = 0;
let explorerRenderFrame = 0;
let explorerScrollIdleTimer = 0;
let explorerScrollingUntil = 0;
let explorerHoverPrefetchTimer = 0;
let explorerHoverPrefetchPath = '';
let explorerResizeObserver: ResizeObserver | null = null;
let explorerWatchTimer = 0;
let explorerWatchInFlight = false;
let terminalCwdSaveTimer = 0;
let marketTickerSocket: WebSocket | null = null;
let marketTickerReconnectTimer = 0;
let marketTickerFallbackTimer = 0;
let marketTickerRenderFrame = 0;
let marketTickerReconnectAttempt = 0;
let workspaceDragState: WorkspaceDragState | null = null;
let suppressWorkspaceTabClick = false;
let fileOpenToken = 0;
let editorLoadingTimer = 0;
let editorLoadingRequest = 0;
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
          <button id="toggle-file-sizes" class="panel-mode active" title="Toggle file sizes" aria-pressed="true">Size</button>
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
          <button id="toggle-image-history" class="panel-mode" title="Toggle pasted image history" aria-pressed="false">History</button>
          <button id="clear-image-history" class="panel-mode" title="Clear pasted image history">Clear</button>
        </div>
        <div id="image-history" class="image-history hidden"></div>
        <img id="image-preview" alt="pasted preview" />
        <p class="hint">Pasted images are saved in the current folder under .vibe-ide-temp/attachments. Auto paste applies to images pasted from outside the preview.</p>
      </section>
      <section class="panel browser-panel floating-panel hidden" data-panel="browser">
        <div class="panel-title panel-drag-handle">
          <span>Browser</span>
          <span class="spacer"></span>
          <button class="panel-close" data-close-panel="browser" title="Close Browser" aria-label="Close Browser">x</button>
        </div>
        <div class="browser-form">
          <button id="browser-back" title="Back">Back</button>
          <button id="browser-forward" title="Forward">Forward</button>
          <input id="preview-url" placeholder="3000 or http://127.0.0.1:3000" />
          <button id="load-preview">Go</button>
          <button id="reload-preview" title="Reload preview">Reload</button>
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
  titleContext: document.querySelector<HTMLSpanElement>('#title-context')!,
  status: document.querySelector<HTMLDivElement>('#status')!,
  appClock: document.querySelector<HTMLDivElement>('#app-clock')!,
  captureFreezeFrame: document.querySelector<HTMLDivElement>('#capture-freeze-frame')!,
  workspaceTabs: document.querySelector<HTMLDivElement>('#workspace-tabs')!,
  newWorkspaceTab: document.querySelector<HTMLButtonElement>('#new-workspace-tab')!,
  profileSelect: document.querySelector<HTMLSelectElement>('#profile-select')!,
  rootInput: document.querySelector<HTMLInputElement>('#root-input')!,
  openRoot: document.querySelector<HTMLButtonElement>('#open-root')!,
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
  imagePreview: document.querySelector<HTMLImageElement>('#image-preview')!,
  imageLabel: document.querySelector<HTMLDivElement>('#image-label')!,
  autoPasteImageTag: document.querySelector<HTMLInputElement>('#auto-paste-image-tag')!,
  imageHistoryToggle: document.querySelector<HTMLButtonElement>('#toggle-image-history')!,
  imageHistoryClear: document.querySelector<HTMLButtonElement>('#clear-image-history')!,
  imageHistory: document.querySelector<HTMLDivElement>('#image-history')!,
  remotePort: document.querySelector<HTMLInputElement>('#remote-port')!,
  localPort: document.querySelector<HTMLInputElement>('#local-port')!,
  startForward: document.querySelector<HTMLButtonElement>('#start-forward')!,
  previewUrl: document.querySelector<HTMLInputElement>('#preview-url')!,
  loadPreview: document.querySelector<HTMLButtonElement>('#load-preview')!,
  browserBack: document.querySelector<HTMLButtonElement>('#browser-back')!,
  browserForward: document.querySelector<HTMLButtonElement>('#browser-forward')!,
  reloadPreview: document.querySelector<HTMLButtonElement>('#reload-preview')!,
  hardRefreshPreview: document.querySelector<HTMLButtonElement>('#hard-refresh-preview')!,
  browserTabs: document.querySelector<HTMLDivElement>('#browser-tabs')!,
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

function setStatus(message: string, danger = false) {
  el.status.textContent = message;
  el.status.classList.toggle('danger', danger);
}

function startAppClock() {
  renderAppClock();
  window.setInterval(renderAppClock, 1000);
}

function renderAppClock() {
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (value: number) => String(value).padStart(2, '0');
  el.appClock.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function refreshTitle() {
  const profile = state.activeProfile;
  const location = profile ? `${profile.label} ${state.currentDir || state.workspaceRoot}` : 'no profile';
  el.titleContext.textContent = location;
  document.title = `Simple Vibe IDE — ${location}`;
}

async function init() {
  await listen<TerminalDataEvent>('terminal-data', (event) => {
    const pane = state.terminals.find((item) => item.backendId === event.payload.id);
    if (!pane) return;
    pane.term.write(event.payload.data);
    trackTerminalCwdFromOutput(pane, event.payload.data);
    void scanTerminalOutputForPorts(pane, event.payload.data);
  });
  await listen<TerminalExitEvent>('terminal-exit', (event) => {
    const pane = state.terminals.find((item) => item.backendId === event.payload.id);
    if (pane) {
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

  state.profiles = await api.listProfiles();
  loadIdeSettings();
  loadWorkspaceStore();
  loadMarketTickerConfig();
  ensureEditorTab();
  ensureImageTab();
  renderProfiles();
  renderWorkspaceTabs();
  renderEditorTabs();
  renderImageTabs();
  renderNoteThemeOptions();
  renderNoteTabs();
  renderNotes();
  renderNotePin();
  renderShellTabs();
  renderBrowserDeviceOptions();
  renderCalculatorKeys();
  renderCalculator();
  renderSettings();
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
  bindEvents();
  startAppClock();
  selectProfile('');
  setWorkspaceOpen(false);
  setStatus('Ready');
  window.setTimeout(startMarketTicker, MARKET_TICKER_BOOT_DELAY_MS);
  void loadWslProfilesInBackground();
}

function renderProfiles() {
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

async function loadWslProfilesInBackground() {
  setStatus('Ready - loading WSL profiles...');
  try {
    const wslProfiles = await api.listWslProfiles();
    const existing = new Map(state.profiles.map((profile) => [profile.id, profile]));
    for (const profile of wslProfiles) existing.set(profile.id, profile);
    state.profiles = [...existing.values()];
    const selected = el.profileSelect.value;
    renderProfiles();
    el.profileSelect.value = selected;
    setStatus('Ready');
  } catch (error) {
    setStatus(`Ready - WSL profile scan failed: ${String(error)}`, true);
  }
}

function loadWorkspaceStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_STORE_KEY) ?? '') as Partial<WorkspaceStore>;
    state.workspaceSnapshots = Array.isArray(parsed.workspaces) ? parsed.workspaces.filter(isWorkspaceSnapshot) : [];
    state.activeWorkspaceId = '';
  } catch {
    state.workspaceSnapshots = [];
    state.activeWorkspaceId = '';
  }
}

function persistWorkspaceStore() {
  const store: WorkspaceStore = {
    version: 1,
    activeId: state.activeWorkspaceId,
    workspaces: state.workspaceSnapshots.slice(0, 24)
  };
  localStorage.setItem(WORKSPACE_STORE_KEY, JSON.stringify(store));
  renderWorkspaceTabs();
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
  el.settingsMaskPatterns.value = state.ideSettings.extraMaskPatterns.join('\n');
}

function renderFontOptions(select: HTMLSelectElement, choices: FontChoice[], activeId: string) {
  renderChoiceOptions(select, choices, activeId);
}

function renderChoiceOptions(select: HTMLSelectElement, choices: Array<{ id: string; label: string }>, activeId: string) {
  select.innerHTML = '';
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.id;
    option.textContent = choice.label;
    select.append(option);
  }
  select.value = choices.some((choice) => choice.id === activeId) ? activeId : choices[0].id;
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
  document.documentElement.style.setProperty('--ui-font', uiFont);
  document.documentElement.style.setProperty('--mono-font', monoFont);
  applyEditorTheme(state.ideSettings.editorTheme);
  configurePrivacyPolicy(state.ideSettings.extraMaskPatterns);
  for (const pane of state.terminals) {
    pane.term.options.fontFamily = monoFont;
    pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
    scheduleFitTerminal(pane);
  }
  codeView?.requestMeasure();
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
  document.documentElement.dataset.editorTheme = theme.id;
  for (const [name, value] of Object.entries(theme.vars)) {
    document.documentElement.style.setProperty(name, value);
  }
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
  const custom = state.marketTickers
    .filter((ticker) => ticker.removable)
    .map((ticker) => ticker.symbol)
    .slice(0, MARKET_TICKER_MAX_CUSTOM);
  localStorage.setItem(MARKET_TICKER_STORE_KEY, JSON.stringify({ custom }));
}

function renderMarketTicker() {
  el.marketTickerList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const ticker of state.marketTickers) {
    const quote = state.marketQuotes.get(ticker.symbol) ?? {
      symbol: ticker.symbol,
      price: null,
      changePercent: null,
      updatedAt: 0,
      status: 'loading' as const
    };
    const item = document.createElement('div');
    item.className = `market-chip ${marketTrendClass(quote)}`;
    item.title = marketTickerTitle(ticker, quote);

    const label = document.createElement('span');
    label.className = 'market-label';
    label.textContent = ticker.label;

    const price = document.createElement('span');
    price.className = 'market-price';
    price.textContent = formatMarketPrice(quote.price);

    const change = document.createElement('span');
    change.className = 'market-change';
    change.textContent = formatMarketChange(quote.changePercent);

    item.append(label, price, change);
    if (ticker.removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'market-remove';
      remove.title = `Remove ${ticker.symbol}`;
      remove.textContent = 'x';
      remove.addEventListener('click', () => removeMarketTicker(ticker.symbol));
      item.append(remove);
    }
    fragment.append(item);
  }
  el.marketTickerList.append(fragment);

  const customCount = state.marketTickers.filter((ticker) => ticker.removable).length;
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
  if (marketTickerRenderFrame) return;
  marketTickerRenderFrame = window.requestAnimationFrame(() => {
    marketTickerRenderFrame = 0;
    renderMarketTicker();
  });
}

function startMarketTicker() {
  fetchMarketTickerSnapshot();
  connectMarketTickerSocket();
}

function restartMarketTicker() {
  if (marketTickerReconnectTimer) window.clearTimeout(marketTickerReconnectTimer);
  if (marketTickerSocket) marketTickerSocket.close();
  marketTickerSocket = null;
  marketTickerReconnectAttempt = 0;
  startMarketTicker();
}

function connectMarketTickerSocket() {
  const streams = state.marketTickers
    .map((ticker) => `${ticker.symbol.toLowerCase()}@ticker`)
    .join('/');
  if (!streams) return;
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
  if (marketTickerReconnectTimer) window.clearTimeout(marketTickerReconnectTimer);
  const delay = Math.min(60000, 2500 * 2 ** Math.min(marketTickerReconnectAttempt, 5));
  marketTickerReconnectAttempt += 1;
  marketTickerReconnectTimer = window.setTimeout(connectMarketTickerSocket, delay);
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
  if (marketTickerFallbackTimer) window.clearTimeout(marketTickerFallbackTimer);
  const tickers = state.marketTickers.slice();
  await Promise.allSettled(tickers.map(async (ticker) => {
    try {
      const response = await fetch(`${MARKET_TICKER_REST_URL}${encodeURIComponent(ticker.symbol)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { lastPrice?: string; priceChangePercent?: string };
      updateMarketQuote(ticker.symbol, Number(data.lastPrice), Number(data.priceChangePercent), state.marketTickerConnected ? 'live' : 'stale');
    } catch (error) {
      markMarketQuoteError(ticker.symbol, String(error));
    }
  }));
  marketTickerFallbackTimer = window.setTimeout(fetchMarketTickerSnapshot, MARKET_TICKER_FALLBACK_MS);
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
  if (state.marketTickers.filter((ticker) => ticker.removable).length >= MARKET_TICKER_MAX_CUSTOM) return;
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

function renderWorkspaceTabs() {
  el.workspaceTabs.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const workspace of state.workspaceSnapshots) {
    const tab = document.createElement('div');
    const protectedWorkspace = Boolean(workspace.captureProtected);
    tab.className = `workspace-tab${workspace.id === state.activeWorkspaceId ? ' active' : ''}${protectedWorkspace ? ' protected' : ''}`;
    tab.draggable = false;
    tab.dataset.workspaceId = workspace.id;
    tab.title = `${workspace.label} - ${workspace.root}${protectedWorkspace ? ' - capture blocked when active' : ''}`;
    const securityTitle = protectedWorkspace ? 'Disable capture block' : 'Block capture while this workspace is active';
    tab.innerHTML = `
      <button class="workspace-tab-label" type="button">${escapeHtml(workspace.label)}</button>
      <button class="workspace-tab-security${protectedWorkspace ? ' active' : ''}" type="button" title="${securityTitle}" aria-label="${securityTitle}" aria-pressed="${String(protectedWorkspace)}">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 7V5a3 3 0 0 1 6 0v2"></path>
          <rect x="3.5" y="7" width="9" height="7" rx="1.5"></rect>
        </svg>
      </button>
      <button class="workspace-tab-copy" type="button" title="Copy workspace" aria-label="Copy workspace">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5" y="3" width="8" height="10" rx="1.5"></rect>
          <path d="M3 11V5.5A1.5 1.5 0 0 1 4.5 4H10"></path>
        </svg>
      </button>
      <button class="workspace-tab-close" type="button" title="Close workspace" aria-label="Close workspace">x</button>
    `;
    tab.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.draggable = false;
    });
    tab.querySelector<HTMLButtonElement>('.workspace-tab-label')!.addEventListener('click', (event) => {
      if (suppressWorkspaceTabClick) {
        event.preventDefault();
        return;
      }
      void activateWorkspaceTab(workspace.id);
    });
    tab.querySelector<HTMLButtonElement>('.workspace-tab-security')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleWorkspaceCaptureProtection(workspace.id);
    });
    tab.querySelector<HTMLButtonElement>('.workspace-tab-copy')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void copyWorkspaceTab(workspace.id);
    });
    tab.querySelector<HTMLButtonElement>('.workspace-tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void closeWorkspaceTab(workspace.id);
    });
    tab.addEventListener('pointerdown', (event) => startWorkspaceTabPointerDrag(event, workspace.id, tab));
    tab.addEventListener('pointermove', (event) => updateWorkspaceTabPointerDrag(event, tab));
    tab.addEventListener('pointerup', (event) => finishWorkspaceTabPointerDrag(event, tab, true));
    tab.addEventListener('pointercancel', (event) => finishWorkspaceTabPointerDrag(event, tab, false));
    fragment.append(tab);
  }
  el.workspaceTabs.append(fragment);
}

function startWorkspaceTabPointerDrag(event: PointerEvent, id: string, tab: HTMLElement) {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.workspace-tab-security, .workspace-tab-copy, .workspace-tab-close')) return;
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

  const tabs = Array.from(el.workspaceTabs.querySelectorAll<HTMLElement>('.workspace-tab'))
    .filter((tab) => tab.dataset.workspaceId && tab.dataset.workspaceId !== sourceId);
  if (!tabs.length) return null;

  let best: { tab: HTMLElement; score: number } | null = null;
  for (const tab of tabs) {
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
  const tab = Array.from(el.workspaceTabs.querySelectorAll<HTMLElement>('.workspace-tab'))
    .find((item) => item.dataset.workspaceId === target.targetId);
  tab?.classList.toggle('drop-before', target.position === 'before');
  tab?.classList.toggle('drop-after', target.position === 'after');
}

function clearWorkspaceDropMarkers() {
  el.workspaceTabs.querySelectorAll<HTMLElement>('.workspace-tab').forEach((tab) => {
    tab.classList.remove('drop-before', 'drop-after');
  });
}

function reorderWorkspaceTab(sourceId: string, targetId: string, position: 'before' | 'after' = 'before') {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = state.workspaceSnapshots.findIndex((workspace) => workspace.id === sourceId);
  if (sourceIndex < 0) return;
  const [item] = state.workspaceSnapshots.splice(sourceIndex, 1);
  const targetIndex = state.workspaceSnapshots.findIndex((workspace) => workspace.id === targetId);
  if (targetIndex < 0) {
    state.workspaceSnapshots.push(item);
  } else {
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    state.workspaceSnapshots.splice(insertIndex, 0, item);
  }
  persistWorkspaceStore();
  renderWorkspaceTabs();
}

async function toggleWorkspaceCaptureProtection(id: string) {
  const snapshot = state.workspaceSnapshots.find((workspace) => workspace.id === id);
  if (!snapshot) return;

  const enabled = !snapshot.captureProtected;
  snapshot.captureProtected = enabled;
  if (id === state.activeWorkspaceId) {
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

async function primeCaptureFreezeFrame() {
  document.body.classList.add('capture-freeze-visible');
  el.captureFreezeFrame.setAttribute('aria-hidden', 'false');
  await nextAnimationFrame();
  await nextAnimationFrame();
  await delay(520);
}

function hideCaptureFreezeFrameSoon() {
  window.setTimeout(hideCaptureFreezeFrame, 260);
}

function hideCaptureFreezeFrame() {
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
  saveActiveWorkspaceSnapshot();
  saveActiveWorkspaceRuntimeCache();
  const previousId = state.activeWorkspaceId;
  const id = crypto.randomUUID();
  const insertIndex = previousId
    ? state.workspaceSnapshots.findIndex((workspace) => workspace.id === previousId) + 1
    : state.workspaceSnapshots.length;
  state.workspaceCaptureProtected = false;
  state.workspaceSnapshots.splice(clamp(insertIndex, 0, state.workspaceSnapshots.length), 0, blankWorkspaceSnapshot(id));
  state.activeWorkspaceId = id;
  await closeWorkspace();
  persistWorkspaceStore();
  setStatus('New empty workspace');
}

async function copyWorkspaceTab(id: string) {
  await saveAllDirtyNotes();
  if (id === state.activeWorkspaceId) {
    saveActiveWorkspaceSnapshot();
    saveActiveWorkspaceRuntimeCache();
  }
  const sourceIndex = state.workspaceSnapshots.findIndex((workspace) => workspace.id === id);
  if (sourceIndex < 0) return;
  const clone = cloneWorkspaceSnapshotForCopy(state.workspaceSnapshots[sourceIndex]);
  state.workspaceSnapshots.splice(sourceIndex + 1, 0, clone);
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
  setStatus(`Workspace copied: ${clone.label}`);
}

function cloneWorkspaceSnapshotForCopy(source: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...source,
    id: crypto.randomUUID(),
    label: `${source.label} copy`,
    updatedAt: new Date().toISOString(),
    panels: cloneJson(source.panels),
    terminalSpawnRect: source.terminalSpawnRect ? { ...source.terminalSpawnRect } : undefined,
    terminals: source.terminals.map((terminal) => ({ ...terminal, rect: terminal.rect ? { ...terminal.rect } : undefined })),
    editorTabs: source.editorTabs.map((tab) => ({ ...tab })),
    imageTabs: source.imageTabs.map((tab) => ({
      ...tab,
      history: tab.history.map((item) => ({ ...item }))
    })),
    noteTabs: source.noteTabs.map((tab) => ({ ...tab })),
    browserTabs: source.browserTabs.map((tab) => ({ ...tab })),
    calculatorHistory: source.calculatorHistory?.map((item) => ({ ...item })) ?? []
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function closeWorkspaceTab(id: string) {
  const wasActive = state.activeWorkspaceId === id;
  if (wasActive) saveActiveWorkspaceRuntimeCache();
  await closeTerminalsForWorkspace(id);
  removeWorkspaceRuntimeCache(id);
  state.workspaceSnapshots = state.workspaceSnapshots.filter((workspace) => workspace.id !== id);
  if (wasActive) {
    const next = state.workspaceSnapshots[0];
    if (next) {
      state.activeWorkspaceId = next.id;
      persistWorkspaceStore();
      if (!next.profileId) {
        await closeWorkspace();
        state.workspaceCaptureProtected = Boolean(next.captureProtected);
        await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });
        renderWorkspaceTabs();
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
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot();
  saveActiveWorkspaceRuntimeCache();
  const snapshot = state.workspaceSnapshots.find((workspace) => workspace.id === id);
  if (!snapshot) return;
  state.activeWorkspaceId = id;
  persistWorkspaceStore();
  if (!snapshot.profileId) {
    await closeWorkspace();
    state.workspaceCaptureProtected = Boolean(snapshot.captureProtected);
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });
    renderWorkspaceTabs();
    setStatus('Empty workspace');
    return;
  }
  await restoreWorkspaceSnapshot(snapshot);
}

function blankWorkspaceSnapshot(id: string): WorkspaceSnapshot {
  return {
    id,
    label: 'New Workspace',
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
    showFileSizes: true,
    editorFontSize: 13,
    terminalFontSize: 13,
    noteFontSize: 14,
    calculatorFontSize: 15,
    ideScale: 1
  };
}

function saveActiveWorkspaceSnapshot() {
  if (restoringWorkspace) return;
  if (!state.activeWorkspaceId || !state.activeProfile || !state.workspaceOpen) {
    persistWorkspaceStore();
    return;
  }

  syncActiveEditorTabFromView();
  syncActiveImageTabFromState();
  const snapshot = createCurrentWorkspaceSnapshot(state.activeWorkspaceId);
  const index = state.workspaceSnapshots.findIndex((workspace) => workspace.id === snapshot.id);
  if (index >= 0) state.workspaceSnapshots[index] = snapshot;
  else state.workspaceSnapshots.unshift(snapshot);
  persistWorkspaceStore();
}

function createCurrentWorkspaceSnapshot(id: string = crypto.randomUUID()): WorkspaceSnapshot {
  const profile = state.activeProfile!;
  const workspaceTerminals = activeWorkspaceTerminalPanes();
  const activeTerminalIndex = Math.max(0, workspaceTerminals.findIndex((pane) => pane.paneId === state.activePaneId));
  const editorTabs = state.editorTabs
    .map((tab) => {
      const path = tab.file?.path ?? tab.pendingPath;
      if (!path) return null;
      return {
        id: tab.id,
        path,
        rawMode: tab.file?.rawMode ?? Boolean(tab.pendingRawMode)
      };
    })
    .filter((tab): tab is EditorTabSnapshot => Boolean(tab));
  return {
    id,
    label: workspaceLabel(profile, state.workspaceRoot || state.currentDir || profile.root),
    profileId: profile.id,
    root: state.workspaceRoot,
    currentDir: state.currentDir || state.workspaceRoot,
    workspaceOpen: state.workspaceOpen,
    captureProtected: state.workspaceCaptureProtected,
    updatedAt: new Date().toISOString(),
    panels: snapshotPanels(),
    terminalSpawnRect: currentTerminalSpawnRect(),
    terminals: workspaceTerminals.map((pane) => ({
      title: pane.title.replace(/\s+\(exited\)$/i, ''),
      command: pane.command,
      widgetId: pane.widgetId,
      profileId: pane.profileId,
      cwd: pane.cwd,
      rect: elementLayoutRatio(pane.element)
    })),
    activeTerminalIndex,
    editorTabs,
    activeEditorTabId: state.activeEditorTabId,
    editorOpenInNewTab: state.editorOpenInNewTab,
    editorWordWrap: state.editorWordWrap,
    imageTabs: state.imageTabs
      .filter((tab) => tab.dataUrl || tab.sourcePath)
      .map((tab) => ({
        id: tab.id,
        sourcePath: tab.sourcePath,
        dataUrl: tab.dataUrl,
        label: tab.label,
        history: tab.history.slice(0, 24),
        historyVisible: tab.historyVisible
      })),
    activeImageTabId: state.activeImageTabId,
    imageOpenInNewTab: state.imageOpenInNewTab,
    noteTabs: state.noteTabs.map((tab) => ({ id: tab.id, path: tab.path, title: tab.title, theme: tab.theme })),
    activeNoteTabId: state.activeNoteTabId,
    notePinned: state.notePinned,
    noteOpacity,
    browserTabs: state.browserTabs.map((tab) => ({ id: tab.id, url: tab.url, label: tab.label })),
    activeBrowserTabId: state.activeBrowserTabId,
    browserDeviceId: el.browserShell.classList.contains('desktop') ? 'desktop' : state.browserDeviceId,
    browserOrientation: state.browserOrientation,
    browserConsoleVisible: state.browserConsoleVisible,
    browserConsolePosition: state.browserConsolePosition,
    browserConsoleSize: state.browserConsoleSize,
    browserZoom: state.browserZoom,
    calculatorExpression: state.calculatorExpression,
    calculatorHistory: state.calculatorHistory.slice(0, 20),
    explorerOpenMode: state.explorerOpenMode,
    showFileSizes: state.showFileSizes,
    editorFontSize,
    terminalFontSize,
    noteFontSize,
    calculatorFontSize,
    ideScale
  };
}

function snapshotPanels() {
  const panels: Partial<Record<FloatingPanelId, WorkspacePanelSnapshot>> = {};
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    panels[id] = {
      visible: !panel.classList.contains('hidden'),
      rect: elementLayoutRatio(panel)
    };
  }
  return panels;
}

function currentTerminalSpawnRect() {
  const widget = activeTerminalWidget();
  return widget ? elementLayoutRatio(widget.element) : activeWorkspaceSnapshot()?.terminalSpawnRect;
}

function activeWorkspaceSnapshot() {
  return state.workspaceSnapshots.find((workspace) => workspace.id === state.activeWorkspaceId);
}

function saveActiveWorkspaceRuntimeCache() {
  if (!state.activeWorkspaceId || !state.workspaceOpen) return;
  syncActiveEditorTabFromView();
  workspaceRuntimeCache.set(state.activeWorkspaceId, {
    editorTabs: cloneEditorTabs(state.editorTabs),
    activeEditorTabId: state.activeEditorTabId,
    explorer: cloneExplorerRuntimeCache(),
    browserTabs: state.browserTabs.map((tab) => normalizeBrowserTabForCurrentMode(tab)),
    activeBrowserTabId: state.activeBrowserTabId,
    previewUrl: state.previewUrl,
    previewProxies: USE_PREVIEW_PROXY_BROWSER ? state.previewProxies.map((proxy) => ({ ...proxy })) : [],
    browserConsoleLogs: state.browserConsoleLogs.slice(-200).map((log) => ({ ...log }))
  });
  hideBrowserFramesForWorkspace(state.activeWorkspaceId);
  if (activeEdgeCdp && state.browserTabs.some((tab) => tab.id === activeEdgeCdp?.tabId)) {
    disconnectActiveEdgeCdp();
    setEdgePreviewVisible(false);
  }
}

function restoreWorkspaceRuntimeCache(workspaceId: string) {
  return workspaceRuntimeCache.get(workspaceId) ?? null;
}

function removeWorkspaceRuntimeCache(workspaceId: string) {
  const cached = workspaceRuntimeCache.get(workspaceId);
  if (cached) {
    for (const proxy of cached.previewProxies) {
      void api.stopPortForward(proxy.id).catch(() => undefined);
    }
  }
  stopEdgeDevtoolsForWorkspace(workspaceId);
  workspaceRuntimeCache.delete(workspaceId);
  clearBrowserFrames(workspaceId);
}

function cloneEditorTabs(tabs: EditorTabState[]) {
  return tabs.map((tab) => ({
    id: tab.id,
    file: tab.file ? cloneOpenFile(tab.file) : null,
    pendingPath: tab.pendingPath,
    pendingRawMode: tab.pendingRawMode,
    pendingProfileId: tab.pendingProfileId,
    loading: false
  }));
}

function cloneOpenFile(file: OpenFileState): OpenFileState {
  return {
    path: file.path,
    content: file.content,
    draftContent: file.draftContent,
    masked: file.masked,
    rawMode: file.rawMode,
    lines: file.lines.map((line) => ({ ...line })),
    dirty: file.dirty
  };
}

function cloneExplorerRuntimeCache(): ExplorerRuntimeCache {
  return {
    currentDir: state.currentDir,
    entries: cloneExplorerEntries(state.entries),
    expanded: Array.from(state.explorerExpanded),
    children: Array.from(state.explorerChildren.entries())
      .map(([path, entries]) => [path, cloneExplorerEntries(entries)]),
    signatures: Array.from(state.explorerSignatures.entries()),
    selectedPath: state.explorerSelectedPath
  };
}

function restoreExplorerRuntimeCache(workspaceId: string, currentDir: string) {
  const cached = restoreWorkspaceRuntimeCache(workspaceId)?.explorer;
  if (!cached || !sameExplorerPath(cached.currentDir, currentDir)) return false;
  state.entries = cloneExplorerEntries(cached.entries);
  state.currentDir = cached.currentDir;
  state.explorerExpanded = new Set(cached.expanded);
  state.explorerChildren = new Map(cached.children.map(([path, entries]) => [path, cloneExplorerEntries(entries)]));
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map(cached.signatures);
  state.explorerSelectedPath = cached.selectedPath;
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  renderExplorer();
  refreshTitle();
  void refreshExplorerDirectory(currentDir, state.activeProfile?.id ?? '', state.activeWorkspaceId, true, true)
    .catch(() => undefined);
  return true;
}

async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  const profile = state.profiles.find((item) => item.id === snapshot.profileId) ?? null;
  if (!profile) {
    setStatus(`Workspace profile is unavailable: ${snapshot.label}`, true);
    return;
  }

  restoringWorkspace = true;
  try {
    hideAllTerminalWidgets();
    clearWorkspacePanels();
    state.activeProfile = profile;
    state.workspaceRoot = snapshot.root || profile.root;
    state.currentDir = snapshot.currentDir || state.workspaceRoot;
    state.workspaceOpen = true;
    state.workspaceCaptureProtected = Boolean(snapshot.captureProtected);
    state.explorerOpenMode = snapshot.explorerOpenMode ?? 'single';
    state.showFileSizes = snapshot.showFileSizes ?? true;
    state.editorOpenInNewTab = Boolean(snapshot.editorOpenInNewTab);
    state.editorWordWrap = Boolean(snapshot.editorWordWrap);
    state.imageOpenInNewTab = Boolean(snapshot.imageOpenInNewTab);
    state.notePinned = Boolean(snapshot.notePinned);
    noteOpacity = clamp(snapshot.noteOpacity || 100, 45, 100);
    state.browserConsoleSize = clamp(snapshot.browserConsoleSize || 0.34, 0.18, 0.72);
    state.browserZoom = clamp(snapshot.browserZoom || 1, 0.5, 2);
    state.calculatorExpression = snapshot.calculatorExpression || '';
    state.calculatorHistory = Array.isArray(snapshot.calculatorHistory) ? snapshot.calculatorHistory.slice(0, 20) : [];
    state.calculatorResult = '';
    editorFontSize = clamp(snapshot.editorFontSize || 13, 10, 24);
    terminalFontSize = clamp(snapshot.terminalFontSize || 13, 9, 24);
    noteFontSize = clamp(snapshot.noteFontSize || 14, 10, 28);
    calculatorFontSize = clamp(snapshot.calculatorFontSize || 15, 10, 28);
    ideScale = clamp(snapshot.ideScale || 1, 0.72, 1.45);
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
    document.documentElement.style.setProperty('--ide-scale', ideScale.toFixed(3));
    applyNoteFontSize();
    applyNoteOpacity();
    applyCalculatorFontSize();
    applyBrowserConsoleSize();
    applyBrowserZoom();
    el.profileSelect.value = profile.id;
    el.rootInput.value = state.workspaceRoot;
    el.rootInput.placeholder = profile.kind === 'ssh' ? 'remote working directory' : 'working directory';
    el.editorOpenNewTab.checked = state.editorOpenInNewTab;
    el.editorWordWrap.checked = state.editorWordWrap;
    el.imageOpenNewTab.checked = state.imageOpenInNewTab;
    updateExplorerOpenMode();
    updateExplorerFileSizeMode();
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });

    setWorkspaceOpen(true, { preserveVisibility: true });
    restorePanelSnapshots(snapshot.panels);
    renderCalculator();
    refreshTitle();

    const hasLiveTerminals = state.terminals.some((pane) => pane.workspaceId === snapshot.id);
    if (hasLiveTerminals) {
      await restoreWorkspaceTerminals(snapshot, profile);
      await nextAnimationFrame();
    }

    if (!restoreExplorerRuntimeCache(snapshot.id, state.currentDir)) {
      await openWorkspace(state.currentDir);
    }
    await restoreEditorTabs(snapshot);
    restoreImageTabs(snapshot);
    await restoreNoteTabs(snapshot);
    restoreBrowserState(snapshot);

    if (!hasLiveTerminals) await restoreWorkspaceTerminals(snapshot, profile);
    refreshTitle();
    setStatus(`Workspace loaded: ${snapshot.label}`);
  } finally {
    restoringWorkspace = false;
    saveActiveWorkspaceSnapshot();
  }
}

function restorePanelSnapshots(panels: WorkspaceSnapshot['panels']) {
  for (const id of FLOATING_PANELS) {
    const panel = getPanel(id);
    const snapshot = panels?.[id];
    if (snapshot?.rect) applyLayoutRatio(panel, snapshot.rect);
    setPanelVisible(id, snapshot?.visible ?? DEFAULT_PANEL_VISIBILITY[id], { skipSave: true });
  }
}

async function restoreWorkspaceTerminals(snapshot: WorkspaceSnapshot, profile: ConnectionProfile) {
  showTerminalWidgetsForWorkspace(snapshot.id);
  const livePanes = activeWorkspaceTerminalPanes();
  if (!livePanes.length) {
    const terminalSnapshots = (snapshot.terminals ?? []).length
      ? snapshot.terminals
      : [{ title: 'shell', command: null, rect: undefined }];
    const widgetsBySnapshotId = new Map<string, TerminalWidget>();
    for (const terminal of terminalSnapshots) {
      const terminalProfile = state.profiles.find((item) => item.id === terminal.profileId) ?? profile;
      const widgetKey = terminal.widgetId || crypto.randomUUID();
      const existingWidget = widgetsBySnapshotId.get(widgetKey);
      if (existingWidget) {
        await createTerminalTab(existingWidget, terminal.command, terminal.title || 'shell', {
          focus: false,
          profile: terminalProfile,
          cwd: terminal.cwd || workspaceShellCwd()
        });
      } else {
        const widget = await createTerminal(terminal.command, terminal.title || 'shell', {
          rect: terminal.rect,
          focus: false,
          profile: terminalProfile,
          cwd: terminal.cwd || workspaceShellCwd()
        });
        if (widget) widgetsBySnapshotId.set(widgetKey, widget);
      }
    }
  }

  const panes = activeWorkspaceTerminalPanes();
  const active = panes[clamp(snapshot.activeTerminalIndex || 0, 0, Math.max(0, panes.length - 1))];
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
    state.editorTabs = cloneEditorTabs(runtime.editorTabs);
    state.activeEditorTabId = state.editorTabs.some((tab) => tab.id === runtime.activeEditorTabId)
      ? runtime.activeEditorTabId
      : state.editorTabs[0].id;
    state.openFile = activeEditorTab().file;
    renderEditorTabs();
    renderEditor();
    return;
  }

  state.editorTabs = (snapshot.editorTabs ?? []).map((tab) => ({
    id: tab.id || crypto.randomUUID(),
    file: null,
    pendingPath: tab.path,
    pendingRawMode: tab.rawMode,
    pendingProfileId: snapshot.profileId,
    loading: false
  }));
  if (!state.editorTabs.length) createEditorTab(null, false);
  state.activeEditorTabId = state.editorTabs.some((tab) => tab.id === snapshot.activeEditorTabId)
    ? snapshot.activeEditorTabId
    : state.editorTabs[0].id;
  state.openFile = activeEditorTab().file;
  renderEditorTabs();
  renderEditor();
  void hydrateVisibleEditorTab();
  window.setTimeout(() => hydrateInactiveEditorTabs(), 80);
}

async function hydrateVisibleEditorTab() {
  const tab = activeEditorTab();
  await hydrateEditorTab(tab, true);
}

function hydrateInactiveEditorTabs() {
  for (const tab of state.editorTabs) {
    if (tab.id !== state.activeEditorTabId) void hydrateEditorTab(tab, false);
  }
}

async function hydrateEditorTab(tab: EditorTabState, renderWhenDone: boolean) {
  if (!tab.pendingPath || !tab.pendingProfileId || tab.loading) return;
  const workspaceId = state.activeWorkspaceId;
  const path = tab.pendingPath;
  const rawMode = Boolean(tab.pendingRawMode);
  const profileId = tab.pendingProfileId;
  tab.loading = true;
  renderEditorTabs();
  try {
    const content = await readTextFileCached(profileId, path);
    if (state.activeWorkspaceId !== workspaceId) return;
    const liveTab = state.editorTabs.find((item) => item.id === tab.id);
    if (!liveTab || liveTab.pendingPath !== path) return;
    const masked = shouldMaskFile(path);
    liveTab.file = {
      path,
      content,
      masked,
      rawMode,
      lines: masked ? parseSecretLinesCached(content, path) : [],
      dirty: false
    };
    liveTab.pendingPath = undefined;
    liveTab.pendingRawMode = undefined;
    liveTab.pendingProfileId = undefined;
    liveTab.loading = false;
    if (renderWhenDone && state.activeEditorTabId === liveTab.id) {
      state.openFile = liveTab.file;
      renderEditor();
    } else {
      renderEditorTabs();
    }
    saveActiveWorkspaceSnapshot();
  } catch {
    if (state.activeWorkspaceId !== workspaceId) return;
    const liveTab = state.editorTabs.find((item) => item.id === tab.id);
    if (liveTab) {
      liveTab.loading = false;
      if (renderWhenDone && state.activeEditorTabId === liveTab.id) renderEditor();
      else renderEditorTabs();
    }
  }
}

function restoreImageTabs(snapshot: WorkspaceSnapshot) {
  state.imageTabs = (snapshot.imageTabs ?? []).map((tab) => ({
    id: tab.id || crypto.randomUUID(),
    sourcePath: tab.sourcePath,
    dataUrl: tab.dataUrl || '',
    label: tab.label || 'No image selected',
    history: Array.isArray(tab.history) ? tab.history : [],
    historyVisible: Boolean(tab.historyVisible)
  }));
  if (!state.imageTabs.length) createImageTab(undefined, false);
  state.activeImageTabId = state.imageTabs.some((tab) => tab.id === snapshot.activeImageTabId)
    ? snapshot.activeImageTabId
    : state.imageTabs[0].id;
  syncImageStateFromActiveTab();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
}

async function restoreNoteTabs(snapshot: WorkspaceSnapshot) {
  state.noteTabs = await Promise.all((snapshot.noteTabs ?? [])
    .filter((tab) => Boolean(tab.path))
    .map(async (tab) => {
      let content = '';
      try {
        content = await api.readTextFile(snapshot.profileId, tab.path);
      } catch {
        content = '';
      }
      return {
        id: tab.id || crypto.randomUUID(),
        path: tab.path,
        title: tab.title || noteTitleFromPath(tab.path),
        theme: normalizeNoteTheme(tab.theme),
        content,
        dirty: false,
        saving: false,
        lastSavedAt: Date.now()
      };
    }));
  state.activeNoteTabId = state.noteTabs.some((tab) => tab.id === snapshot.activeNoteTabId)
    ? snapshot.activeNoteTabId
    : state.noteTabs[0]?.id ?? '';
  renderNoteTabs();
  renderNotes();
  if (!getPanel('notes').classList.contains('hidden') && !state.noteTabs.length) {
    await createNoteTab({ focus: false });
  }
}

async function ensureNotesReady() {
  if (!state.workspaceOpen || !state.activeProfile) return;
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
  state.noteTabs.push(tab);
  state.activeNoteTabId = tab.id;
  renderNoteTabs();
  renderNotes();
  scheduleNoteSave(tab, 0);
  saveActiveWorkspaceSnapshot();
  if (options.focus !== false) el.notesBody.focus();
  return tab;
}

function activeNoteTab() {
  return state.noteTabs.find((tab) => tab.id === state.activeNoteTabId) ?? null;
}

function activateNoteTab(id: string) {
  void saveActiveNoteNow();
  state.activeNoteTabId = id;
  renderNoteTabs();
  renderNotes();
  saveActiveWorkspaceSnapshot();
  el.notesBody.focus();
}

function closeNoteTab(id: string) {
  const tab = state.noteTabs.find((item) => item.id === id);
  if (tab) void saveNoteTabNow(tab);
  const timer = noteSaveTimers.get(id);
  if (timer) window.clearTimeout(timer);
  noteSaveTimers.delete(id);
  state.noteTabs = state.noteTabs.filter((item) => item.id !== id);
  if (state.activeNoteTabId === id) state.activeNoteTabId = state.noteTabs[0]?.id ?? '';
  renderNoteTabs();
  renderNotes();
  saveActiveWorkspaceSnapshot();
}

function renderNoteTabs() {
  el.notesTabs.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const tab of state.noteTabs) {
    const row = document.createElement('div');
    row.className = `widget-tab note-tab note-tab-${tab.theme}${tab.id === state.activeNoteTabId ? ' active' : ''}`;
    const label = document.createElement('button');
    label.className = 'widget-tab-label';
    label.title = tab.path;
    label.textContent = `${noteTabLabel(tab)}${tab.dirty ? ' *' : ''}`;
    label.addEventListener('click', () => activateNoteTab(tab.id));
    const close = document.createElement('button');
    close.className = 'widget-tab-close';
    close.textContent = 'x';
    close.title = 'Close note tab';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeNoteTab(tab.id);
    });
    row.append(label, close);
    fragment.append(row);
  }
  el.notesTabs.append(fragment);
}

function renderNotes() {
  const tab = activeNoteTab();
  el.notesBody.disabled = !tab;
  el.notesBody.value = tab?.content ?? '';
  el.notesTheme.disabled = !tab;
  el.notesTheme.value = tab?.theme ?? 'default';
  el.notesPath.textContent = tab ? noteRelativePath(tab.path) : 'Notes are saved under .vibe-ide-temp/notes in this workspace.';
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
  const panel = getPanel('notes');
  for (const item of NOTE_THEMES) panel.classList.remove(`note-theme-${item.id}`);
  panel.classList.add(`note-theme-${normalizeNoteTheme(theme)}`);
}

function toggleNotePin() {
  state.notePinned = !state.notePinned;
  renderNotePin();
  saveActiveWorkspaceSnapshot();
}

function renderNotePin() {
  const panel = getPanel('notes');
  panel.classList.toggle('pinned', state.notePinned);
  el.notesPin.classList.toggle('active', state.notePinned);
  el.notesPin.setAttribute('aria-pressed', String(state.notePinned));
  el.notesPin.title = state.notePinned ? 'Unpin Notes' : 'Keep Notes above other widgets';
  if (state.notePinned && !panel.classList.contains('hidden')) bringPanelToFront(panel);
}

function handleNoteInput() {
  const tab = activeNoteTab();
  if (!tab) return;
  const previousTitle = tab.title;
  tab.content = el.notesBody.value;
  tab.dirty = true;
  tab.title = noteTabLabel(tab);
  if (tab.title !== previousTitle) renderNoteTabs();
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
  if (tab) await saveNoteTabNow(tab);
}

async function saveAllDirtyNotes() {
  await Promise.all(state.noteTabs.map((tab) => saveNoteTabNow(tab)));
}

async function saveNoteTabNow(tab: NoteTabState) {
  const timer = noteSaveTimers.get(tab.id);
  if (timer) window.clearTimeout(timer);
  noteSaveTimers.delete(tab.id);
  if (!state.activeProfile || !tab.dirty && tab.lastSavedAt) return;
  const content = tab.content;
  tab.saving = true;
  renderNoteStatus();
  try {
    await api.writeTextFile(state.activeProfile.id, tab.path, content);
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

function renderNoteStatus(message?: string, danger = false) {
  const tab = activeNoteTab();
  el.notesStatus.classList.toggle('danger', danger);
  if (message) {
    el.notesStatus.textContent = message;
  } else if (!tab) {
    el.notesStatus.textContent = 'No note';
  } else if (tab.saving) {
    el.notesStatus.textContent = 'Saving...';
  } else if (tab.dirty) {
    el.notesStatus.textContent = 'Unsaved';
  } else {
    el.notesStatus.textContent = tab.lastSavedAt ? `Saved ${new Date(tab.lastSavedAt).toLocaleTimeString()}` : 'Autosaved';
  }
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

function noteTabLabel(tab: NoteTabState) {
  const firstLine = tab.content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 40);
  return tab.title || noteTitleFromPath(tab.path);
}

function noteTitleFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.txt$/i, '') || 'Quick note';
}

function noteRelativePath(path: string) {
  const marker = `${NOTES_DIR}/`;
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : noteTitleFromPath(path);
}

function renderCalculatorKeys() {
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
  if (!state.calculatorHistory.length) {
    el.calculatorHistory.innerHTML = '<div class="calculator-empty">No calculations yet</div>';
    return;
  }
  el.calculatorHistory.innerHTML = '';
  for (const item of state.calculatorHistory) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'calculator-history-row';
    row.innerHTML = `<span>${escapeHtml(item.expression)}</span><strong>${escapeHtml(item.result)}</strong>`;
    row.addEventListener('click', () => {
      state.calculatorExpression = item.result;
      renderCalculator();
      saveActiveWorkspaceSnapshot();
      el.calculatorExpression.focus();
    });
    el.calculatorHistory.append(row);
  }
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

function restoreBrowserState(snapshot: WorkspaceSnapshot) {
  const runtime = restoreWorkspaceRuntimeCache(snapshot.id);
  state.browserTabs = runtime?.browserTabs.length
    ? runtime.browserTabs.map((tab) => normalizeBrowserTabForCurrentMode(tab))
    : Array.isArray(snapshot.browserTabs)
      ? snapshot.browserTabs
      .filter((tab) => tab && typeof tab.url === 'string')
      .map((tab) => normalizeBrowserTabForCurrentMode({ id: tab.id || makeBrowserTabId(), url: tab.url, label: tab.label || browserTabLabel(tab.url) }))
      : [];
  state.previewProxies = USE_PREVIEW_PROXY_BROWSER && runtime ? runtime.previewProxies.map((proxy) => ({ ...proxy })) : [];
  state.browserConsoleLogs = runtime ? runtime.browserConsoleLogs.map((log) => ({ ...log })) : state.browserConsoleLogs;
  state.activeBrowserTabId = runtime?.activeBrowserTabId ?? '';
  state.previewUrl = runtime?.previewUrl ?? '';
  state.browserDeviceId = snapshot.browserDeviceId || DEFAULT_BROWSER_DEVICE_ID;
  state.browserOrientation = snapshot.browserOrientation || 'portrait';
  setBrowserConsolePosition(snapshot.browserConsolePosition || 'bottom');
  setBrowserConsoleVisible(Boolean(snapshot.browserConsoleVisible));
  if (state.browserDeviceId === 'desktop') setBrowserMode('desktop');
  else if (state.browserDeviceId) setBrowserDevice(state.browserDeviceId);
  if (state.browserTabs.length) {
    const active = state.browserTabs.find((tab) => tab.id === (runtime?.activeBrowserTabId || snapshot.activeBrowserTabId)) ?? state.browserTabs[0];
    state.activeBrowserTabId = active.id;
    state.previewUrl = active.url;
    el.previewUrl.value = active.url;
    if (!getPanel('browser').classList.contains('hidden')) showRestoredBrowserIdle(active);
  }
  renderBrowserTabs();
  renderBrowserConsole();
}

function normalizeBrowserTabForCurrentMode(tab: BrowserTab): BrowserTab {
  const normalized = { ...tab };
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
    loadBrowserTabFallback(tab);
    return;
  }
  hideAllBrowserFrames();
  setEdgePreviewVisible(true);
  showEdgePreviewStatus(`Browser paused. Click "${tab.label}" or Reload to reconnect.`);
}

function workspaceLabel(profile: ConnectionProfile, root: string) {
  const tail = root.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || root || 'workspace';
  return `${profile.label}: ${tail}`;
}

function selectProfile(profileId: string): boolean {
  const profile = state.profiles.find((item) => item.id === profileId) ?? null;
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
    if (state.workspaceOpen) await closeWorkspace();
    state.activeWorkspaceId = '';
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
  document.querySelectorAll<HTMLButtonElement>('[data-llm]').forEach((button) => {
    button.addEventListener('click', () => launchLlm(button.dataset.llm ?? 'llm'));
  });
  bindWindowChrome();
  bindFloatingPanels();
  el.saveFile.addEventListener('click', saveOpenFile);
  el.toggleRaw.addEventListener('click', toggleRawMode);
  el.startForward.addEventListener('click', startForward);
  el.loadPreview.addEventListener('click', () => void openPreviewValue(el.previewUrl.value.trim()));
  el.browserBack.addEventListener('click', () => navigateBrowserHistory(-1));
  el.browserForward.addEventListener('click', () => navigateBrowserHistory(1));
  el.reloadPreview.addEventListener('click', () => refreshPreview(false));
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
  document.addEventListener('keydown', handleResizeShortcut, true);
  document.addEventListener('keydown', handleWidgetFocusShortcut, true);
  document.addEventListener('keydown', handleExplorerKeyboard, true);
  document.addEventListener('keydown', handleCalculatorGlobalKey, true);
  document.addEventListener('keydown', handleBrowserRefreshShortcut, true);
  document.addEventListener('mousedown', handleExplorerMouseNavigation, true);
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('pointerdown', handleContextMenuPointerDown, true);
  document.addEventListener('keydown', handleContextMenuKeydown, true);
  window.addEventListener('resize', () => {
    hideContextMenu();
    FLOATING_PANELS.forEach((id) => applyStoredLayoutRatio(getPanel(id)));
    state.terminalWidgets.forEach((widget) => {
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget);
    });
    scheduleExplorerVirtualRender();
    codeView?.requestMeasure();
    scheduleConfigureEdgeViewport();
  });
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('pagehide', flushTerminalCwdSnapshotSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTerminalCwdSnapshotSave();
  });
  window.addEventListener('beforeunload', () => {
    flushTerminalCwdSnapshotSave();
    if (marketTickerSocket) marketTickerSocket.close();
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

  const codeEditor = target.closest('.cm-editor');
  if (codeEditor) return editorContextMenuItems();

  const editable = editableTarget(target);
  if (editable) return textContextMenuItems(editable);

  const terminalCard = target.closest<HTMLElement>('.terminal-card');
  if (terminalCard) return terminalContextMenuItems(target, terminalCard);

  const fileRow = target.closest<HTMLElement>('.file-row');
  if (fileRow?.dataset.path) selectExplorerEntry(fileRow.dataset.path, false);
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
  const workspace = state.workspaceSnapshots.find((item) => item.id === id);
  if (!workspace) return [];
  return [
    { label: 'Open workspace', action: () => activateWorkspaceTab(id), disabled: id === state.activeWorkspaceId && state.workspaceOpen },
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
  const entry = findExplorerEntry(state.explorerSelectedPath);
  return [
    { label: 'Open', action: () => { if (entry) openExplorerEntry(entry); }, disabled: !entry },
    { label: 'Rename', action: renameSelectedExplorerEntry, disabled: !entry },
    { label: 'Export', action: startExportSelectedExplorerEntry, disabled: !entry },
    { separator: true },
    { label: 'New file', action: () => createExplorerItem('file') },
    { label: 'New folder', action: () => createExplorerItem('dir') },
    { label: 'Copy current cd', action: copyCurrentFolderCdCommand },
    { label: 'Refresh', action: () => refreshExplorerTree({ manual: true }) }
  ];
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
    ? state.terminals.find((item) => item.paneId === host.dataset.paneId) ?? activePaneForElement(card)
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
    { label: 'Copy URL', action: () => { if (tab) void copyTextToClipboard(tab.url, 'Copied browser URL'); }, disabled: !tab },
    { separator: true },
    { label: state.browserConsoleVisible ? 'Hide console' : 'Show console', action: () => setBrowserConsoleVisible(!state.browserConsoleVisible) },
    { label: 'Clear console', action: () => { state.browserConsoleLogs = []; renderBrowserConsole(); } },
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
    ? state.profiles.find((item) => item.id === activePane.profileId) ?? state.activeProfile
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
  else if (action === 'close') await currentWindow.close();
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
  createTerminal(llmLauncherCommand(id), id, { initialHeight: 420 });
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
  return [
    `__svi_source="$(type ${executable} 2>/dev/null || true)"`,
    `__svi_path="$(command -v ${executable} 2>/dev/null || true)"`,
    'if [ -n "$__svi_path" ] && [ -f "$__svi_path" ] && [ -r "$__svi_path" ]; then',
    '  __svi_source="$__svi_source',
    "$(head -c 65536 \"$__svi_path\" 2>/dev/null | tr -cd '\\011\\012\\015\\040-\\176')\"",
    'fi',
    '__svi_args=()',
    ...launcher.flags.map((flag) =>
      `case "$__svi_source" in ${flag.bashPattern}) ;; *) __svi_args+=(${flag.args.map(bashQuote).join(' ')}) ;; esac`
    ),
    `${executable} "\${__svi_args[@]}"`
  ].join('\n');
}

function powershellLlmLauncherCommand(launcher: LlmLauncherConfig) {
  const executable = launcher.executable;
  return [
    `$sviSource = (Get-Command ${executable} -All -ErrorAction SilentlyContinue | Format-List * | Out-String)`,
    `$sviPath = (Get-Command ${executable} -ErrorAction SilentlyContinue).Source`,
    'if ($sviPath -and (Test-Path -LiteralPath $sviPath -PathType Leaf)) { $sviSource += "`n" + ((Get-Content -LiteralPath $sviPath -TotalCount 400 -ErrorAction SilentlyContinue) -join "`n") }',
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
  const profile = state.profiles.find((item) => item.id === 'windows-local') ?? {
    id: 'windows-local',
    label: 'Windows Local',
    kind: 'windows' as const,
    root: 'C:\\Windows\\Temp\\simple-vibe-ide-shell',
    shell: 'powershell.exe -NoLogo -NoProfile'
  };
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

  if (event.key === 'F2') {
    event.preventDefault();
    event.stopPropagation();
    void renameSelectedExplorerEntry();
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
    moveExplorerSelection(event.key === 'ArrowDown' ? 1 : -1);
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

  const pane = state.terminals.find((item) => item.paneId === target.paneId);
  if (pane) resizeTerminalFont(direction);
}

function resizeIde(direction: number) {
  const factor = direction > 0 ? 1.05 : 1 / 1.05;
  ideScale = clamp(ideScale * factor, 0.72, 1.45);
  document.documentElement.style.setProperty('--ide-scale', ideScale.toFixed(3));
  requestAnimationFrame(() => {
    FLOATING_PANELS.forEach((id) => applyStoredLayoutRatio(getPanel(id)));
    state.terminalWidgets.forEach((widget) => {
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget);
    });
    codeView?.requestMeasure();
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
  if (panel.dataset.panel === 'editor') codeView?.requestMeasure();
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
  document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  codeView?.requestMeasure();
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
  document.documentElement.style.setProperty('--notes-font-size', `${noteFontSize}px`);
}

function setNoteOpacity(value: number, options: { save: boolean }) {
  noteOpacity = clamp(Number.isFinite(value) ? value : 100, 45, 100);
  applyNoteOpacity();
  if (options.save) saveActiveWorkspaceSnapshot();
}

function applyNoteOpacity() {
  const percent = `${Math.round(noteOpacity)}%`;
  document.documentElement.style.setProperty('--notes-opacity', percent);
  el.notesOpacity.value = String(Math.round(noteOpacity));
  el.notesOpacityValue.textContent = percent;
}

function resizeBrowserZoom(direction: number) {
  state.browserZoom = clamp(state.browserZoom + direction * 0.1, 0.5, 2);
  applyBrowserZoom();
  setStatus(`Browser zoom ${Math.round(state.browserZoom * 100)}%`);
  saveActiveWorkspaceSnapshot();
}

function applyBrowserZoom() {
  document.documentElement.style.setProperty('--browser-preview-zoom', state.browserZoom.toFixed(2));
}

function resizeCalculatorFont(direction: number) {
  calculatorFontSize = clamp(calculatorFontSize + direction, 10, 28);
  applyCalculatorFontSize();
  saveActiveWorkspaceSnapshot();
}

function applyCalculatorFontSize() {
  document.documentElement.style.setProperty('--calculator-font-size', `${calculatorFontSize}px`);
}

function terminalMinWidth() {
  return window.matchMedia('(max-width: 900px)').matches ? 220 : 300;
}

function terminalMinHeight() {
  return window.matchMedia('(max-width: 900px)').matches ? 220 : 280;
}

function setKeyboardResizeTarget(target: ResizeTarget) {
  keyboardResizeTarget = target;
  el.titlebar.classList.toggle('keyboard-target', target.kind === 'ide');
  document.querySelectorAll<HTMLElement>('.floating-panel.keyboard-target, .terminal-card.keyboard-target')
    .forEach((element) => element.classList.remove('keyboard-target'));

  if (target.kind === 'panel') {
    getPanel(target.id).classList.add('keyboard-target');
  } else if (target.kind === 'terminal') {
    const pane = state.terminals.find((item) => item.paneId === target.paneId);
    pane?.element.classList.add('keyboard-target');
  }
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
  for (const widget of activeWorkspaceTerminalWidgets()) {
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
      new ResizeObserver(() => codeView?.requestMeasure()).observe(panel);
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', () => setPanelVisible(button.dataset.closePanel as FloatingPanelId, false));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-toggle-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.togglePanel as FloatingPanelId;
      setPanelVisible(id, getPanel(id).classList.contains('hidden'));
    });
  });
  el.resetLayout.addEventListener('click', resetFloatingLayout);
}

function getPanel(id: FloatingPanelId) {
  return document.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
}

function getPanelToggle(id: FloatingPanelId) {
  return document.querySelector<HTMLButtonElement>(`[data-toggle-panel="${id}"]`);
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

function setPanelVisible(id: FloatingPanelId, visible: boolean, options: { skipSave?: boolean } = {}) {
  const panel = getPanel(id);
  panel.classList.toggle('hidden', !visible);
  getPanelToggle(id)?.classList.toggle('active', visible);
  getPanelToggle(id)?.setAttribute('aria-pressed', String(visible));
  if (visible) {
    bringPanelToFront(panel);
    pinPanelToWorkspace(panel);
    setKeyboardResizeTarget({ kind: 'panel', id });
    if (id === 'notes' && !restoringWorkspace) void ensureNotesReady();
    if (id === 'explorer' && state.workspaceOpen && !restoringWorkspace) {
      void refreshExplorerTree({ silent: true });
      scheduleExplorerWatch();
    }
    if (id === 'browser' && !restoringWorkspace) ensureActiveBrowserFrame();
    codeView?.requestMeasure();
  } else if (keyboardResizeTarget.kind === 'panel' && keyboardResizeTarget.id === id) {
    setKeyboardResizeTarget({ kind: 'ide' });
  }
  if (!options.skipSave) saveActiveWorkspaceSnapshot();
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
  codeView?.requestMeasure();
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

  panel.setPointerCapture(event.pointerId);
  panel.classList.add('dragging');

  const move = (moveEvent: PointerEvent) => {
    const maxLeft = Math.max(0, workspace.clientWidth - panel.offsetWidth);
    const maxTop = Math.max(0, workspace.clientHeight - panel.offsetHeight);
    const rawRect = {
      left: clamp(startLeft + moveEvent.clientX - startX, 0, maxLeft),
      top: clamp(startTop + moveEvent.clientY - startY, 0, maxTop),
      width: panel.offsetWidth,
      height: panel.offsetHeight
    };
    applyPanelRect(panel, snapPanelRect(panel, rawRect, { moveX: true, moveY: true }));
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
      width = clamp(panelRect.width + deltaX, minWidth, workspace.clientWidth - panelRect.left);
    }
    if (resizeSouth) {
      height = clamp(panelRect.height + deltaY, minHeight, workspace.clientHeight - panelRect.top);
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
    }));
    if (panel.dataset.panel === 'editor') codeView?.requestMeasure();
    const widget = terminalWidgetForElement(panel);
    if (widget) scheduleFitTerminalWidget(widget);
  };

  const up = (upEvent: PointerEvent) => {
    panel.classList.remove('resizing');
    grip.releasePointerCapture(upEvent.pointerId);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    codeView?.requestMeasure();
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
  }
) {
  const workspace = panel.parentElement as HTMLElement;
  const guides = collectSnapGuides(panel, workspace);
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
  const guideElements = [
    ...document.querySelectorAll<HTMLElement>('.floating-panel:not(.hidden)'),
    ...document.querySelectorAll<HTMLElement>('.terminal-card'),
    document.querySelector<HTMLElement>('#terminal-grid')
  ].filter((element): element is HTMLElement => Boolean(element) && element !== panel);

  for (const element of guideElements) {
    const rect = currentPanelRect(element, workspace);
    x.push(rect.left, rect.left + rect.width);
    y.push(rect.top, rect.top + rect.height);
  }

  return { x, y };
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

function elementLayoutRatio(element: HTMLElement): LayoutRatio | undefined {
  const workspace = element.parentElement as HTMLElement | null;
  if (!workspace?.clientWidth || !workspace.clientHeight) return layoutRatios.get(element);
  if (element.classList.contains('hidden')) return layoutRatios.get(element);
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
  saveActiveWorkspaceSnapshot();
  state.workspaceRoot = path;
  state.currentDir = path;
  el.rootInput.value = path;
  if (!state.activeWorkspaceId) state.activeWorkspaceId = crypto.randomUUID();
  await closeTerminalsForWorkspace(state.activeWorkspaceId);
  discardWorkspacePreviewRuntime(state.activeWorkspaceId);
  clearWorkspacePanels();
  await openWorkspace(path);
  setWorkspaceOpen(true);
  await createTerminal(null, 'shell');
  saveActiveWorkspaceSnapshot();
}

function discardWorkspacePreviewRuntime(workspaceId: string) {
  for (const proxy of state.previewProxies) {
    void api.stopPortForward(proxy.id).catch(() => undefined);
  }
  state.previewProxies = [];
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
  el.profileSelect.value = '';
  el.rootInput.value = '';
  el.rootInput.placeholder = 'select a profile first';
  if (options.killTerminals && workspaceId) await closeTerminalsForWorkspace(workspaceId);
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
  for (const pane of terminals) {
    if (pane.backendId) await api.killTerminal(pane.backendId).catch(() => undefined);
    if (pane.fitFrame) cancelAnimationFrame(pane.fitFrame);
    pane.resizeObserver?.disconnect();
    pane.term.dispose();
    pane.host.remove();
  }
  for (const widget of widgets) widget.element.remove();
  syncActivePaneClass();
  renderShellTabs();
}

async function closeTerminalsForWorkspace(workspaceId: string) {
  const widgets = state.terminalWidgets.filter((widget) => widget.workspaceId === workspaceId);
  for (const widget of widgets) {
    await closeTerminalWidget(widget.widgetId);
  }
  if (state.activePaneId && !activeWorkspaceTerminalPanes().some((pane) => pane.paneId === state.activePaneId)) {
    state.activePaneId = '';
  }
  syncActivePaneClass();
  renderShellTabs();
}

function hideAllTerminalWidgets() {
  for (const widget of state.terminalWidgets) widget.element.classList.add('hidden');
  state.activePaneId = '';
  syncActivePaneClass();
  renderShellTabs();
}

function showTerminalWidgetsForWorkspace(workspaceId: string) {
  for (const widget of state.terminalWidgets) {
    widget.element.classList.toggle('hidden', widget.workspaceId !== workspaceId);
    if (widget.workspaceId === workspaceId) {
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget);
    }
  }
}

function clearWorkspacePanels() {
  codeView?.destroy();
  codeView = null;
  state.entries = [];
  state.explorerExpanded = new Set();
  state.explorerChildren = new Map();
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map();
  state.explorerSelectedPath = '';
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  state.explorerDropTargetDir = '';
  state.exportJobs = [];
  renderExportJobs();
  state.openFile = null;
  state.editorTabs = [];
  state.activeEditorTabId = '';
  ensureEditorTab();
  state.imagePreviewDataUrl = '';
  state.imagePreviewLabel = 'No image selected';
  state.imageHistory = [];
  state.imageHistoryVisible = false;
  state.imageTabs = [];
  state.activeImageTabId = '';
  ensureImageTab();
  for (const timer of noteSaveTimers.values()) window.clearTimeout(timer);
  noteSaveTimers.clear();
  state.noteTabs = [];
  state.activeNoteTabId = '';
  state.notePinned = false;
  noteOpacity = 100;
  applyNoteOpacity();
  renderNoteTabs();
  renderNotes();
  renderNotePin();
  state.calculatorExpression = '';
  state.calculatorResult = '';
  state.calculatorHistory = [];
  renderCalculator();
  state.previewProxies = [];
  state.previewUrl = '';
  state.forwards = [];
  state.detectedPorts = [];
  state.browserTabs = [];
  state.activeBrowserTabId = '';
  state.browserConsoleLogs = [];
  el.previewUrl.value = '';
  hideAllBrowserFrames();
  disconnectActiveEdgeCdp();
  setEdgePreviewVisible(false);
  el.browserShell.classList.remove('has-preview');
  renderEditorTabs();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
  renderForwards();
  renderBrowserTabs();
  renderBrowserConsole();
  renderEditor();
}

function setWorkspaceOpen(open: boolean, options: { preserveVisibility?: boolean } = {}) {
  state.workspaceOpen = open;
  el.copyCurrentCd.disabled = !open;
  el.newShell.disabled = !open;
  el.shellNewTab.disabled = !open;
  el.shellTabs.classList.add('hidden');
  el.resetLayout.disabled = !open;
  document.querySelectorAll<HTMLButtonElement>('[data-llm]').forEach((button) => {
    button.disabled = !open;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-toggle-panel]').forEach((button) => {
    button.disabled = !open && button.dataset.togglePanel !== 'settings';
  });
  el.newFile.disabled = !open;
  el.newFolder.disabled = !open;
  el.refreshExplorer.disabled = !open;
  el.exportSelected.disabled = !open;

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

function explorerDirectoryCacheKey(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  return `${workspaceId || 'workspace'}\0${profileId}\0${path}`;
}

function hasCachedExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  return explorerDirectoryCache.has(explorerDirectoryCacheKey(profileId, path, workspaceId));
}

function cloneExplorerEntries(entries: FileEntry[]) {
  return entries.map((entry) => ({ ...entry }));
}

function cachedExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  const cached = explorerDirectoryCache.get(key);
  if (!cached) return null;
  explorerDirectoryCache.delete(key);
  explorerDirectoryCache.set(key, cached);
  return cloneExplorerEntries(cached.entries);
}

function cacheExplorerDirectory(profileId: string, path: string, entries: FileEntry[], workspaceId = state.activeWorkspaceId) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  explorerDirectoryCache.delete(key);
  explorerDirectoryCache.set(key, { entries: cloneExplorerEntries(entries), cachedAt: Date.now() });
  while (explorerDirectoryCache.size > EXPLORER_DIRECTORY_CACHE_LIMIT) {
    const oldest = explorerDirectoryCache.keys().next().value;
    if (!oldest) break;
    explorerDirectoryCache.delete(oldest);
  }
}

async function readExplorerDirectoryCached(profileId: string, path: string, workspaceId = state.activeWorkspaceId) {
  const cached = cachedExplorerDirectory(profileId, path, workspaceId);
  if (cached) return cached;
  return fetchExplorerDirectory(profileId, path, workspaceId);
}

async function fetchExplorerDirectory(profileId: string, path: string, workspaceId = state.activeWorkspaceId, force = false) {
  const key = explorerDirectoryCacheKey(profileId, path, workspaceId);
  const pending = explorerDirectoryReads.get(key);
  if (pending && !force) return cloneExplorerEntries(await pending);

  let read: Promise<FileEntry[]>;
  read = api.listDirectory(profileId, path)
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

function applyLoadedDirectory(path: string, entries: FileEntry[]) {
  state.entries = cloneExplorerEntries(entries);
  state.currentDir = path;
  state.explorerExpanded = new Set([path]);
  state.explorerChildren = new Map();
  state.explorerLoading = new Set();
  state.explorerSignatures = new Map([[path, explorerDirectorySignature(state.entries)]]);
  state.explorerSelectedPath = '';
  state.explorerTypeahead = '';
  state.explorerTypeaheadAt = 0;
  renderExplorer();
  scheduleVisibleExplorerDirectoryPrefetch();
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
    void refreshExplorerDirectory(path, profileId, workspaceId, true, true)
      .then(() => saveActiveWorkspaceSnapshot())
      .catch(() => undefined);
    return;
  }
  setStatus(`Loading ${path}...`);
  try {
    const entries = await fetchExplorerDirectory(profileId, path, workspaceId);
    cacheExplorerDirectory(profileId, path, entries, workspaceId);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    applyLoadedDirectory(path, entries);
    setStatus('Directory loaded');
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderExplorer() {
  const scrollTop = el.fileList.scrollTop;
  el.pathRow.innerHTML = '';
  updateExplorerFileSizeMode();
  updateExplorerOpenMode();
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

  rebuildExplorerVisibleRows();
  renderVirtualExplorerRows(scrollTop);
  updateExplorerSelection(false);
  renderExportJobs();
  scheduleVisibleExplorerDirectoryPrefetch();
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
  explorerVisibleRows = [];
  explorerVisibleEntryByPath.clear();
  appendExplorerVisibleRows(state.entries, 0);
}

function appendExplorerVisibleRows(entries: FileEntry[], depth: number) {
  for (const entry of entries) {
    explorerVisibleRows.push({ entry, path: entry.path, depth, loading: false });
    explorerVisibleEntryByPath.set(explorerPathKey(entry.path), entry);

    if (entry.kind === 'dir' && state.explorerExpanded.has(entry.path)) {
      const children = state.explorerChildren.get(entry.path);
      if (children) appendExplorerVisibleRows(children, depth + 1);
      else if (state.explorerLoading.has(entry.path)) {
        explorerVisibleRows.push({
          entry: null,
          path: `${entry.path}::loading`,
          depth: depth + 1,
          loading: true
        });
      }
    }
  }
}

function renderVirtualExplorerRows(scrollTop = el.fileList.scrollTop) {
  const total = explorerVisibleRows.length;
  const viewportHeight = Math.max(el.fileList.clientHeight, EXPLORER_ROW_HEIGHT * 8);
  const maxScrollTop = Math.max(0, total * EXPLORER_ROW_HEIGHT - viewportHeight);
  const nextScrollTop = clamp(scrollTop, 0, maxScrollTop);
  const visibleCount = Math.ceil(viewportHeight / EXPLORER_ROW_HEIGHT) + EXPLORER_VIRTUAL_OVERSCAN * 2;
  explorerRenderedStart = clamp(Math.floor(nextScrollTop / EXPLORER_ROW_HEIGHT) - EXPLORER_VIRTUAL_OVERSCAN, 0, total);
  explorerRenderedEnd = clamp(explorerRenderedStart + visibleCount, explorerRenderedStart, total);

  const fragment = document.createDocumentFragment();
  appendExplorerSpacer(fragment, explorerRenderedStart * EXPLORER_ROW_HEIGHT);
  for (let index = explorerRenderedStart; index < explorerRenderedEnd; index += 1) {
    const item = explorerVisibleRows[index];
    fragment.append(item.loading ? createExplorerLoadingRow(item.depth) : createExplorerRow(item.entry!, item.depth));
  }
  appendExplorerSpacer(fragment, (total - explorerRenderedEnd) * EXPLORER_ROW_HEIGHT);
  el.fileList.replaceChildren(fragment);
  el.fileList.scrollTop = nextScrollTop;
}

function appendExplorerSpacer(fragment: DocumentFragment, height: number) {
  if (height <= 0) return;
  const spacer = document.createElement('div');
  spacer.className = 'explorer-spacer';
  spacer.style.height = `${height}px`;
  fragment.append(spacer);
}

function createExplorerRow(entry: FileEntry, depth: number) {
  const row = document.createElement('div');
  row.className = `file-row ${entry.kind}`;
  row.dataset.path = entry.path;
  if (sameExplorerPath(entry.path, state.explorerDropTargetDir)) row.classList.add('drop-target');
  row.tabIndex = 0;
  row.style.setProperty('--depth', String(depth));
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(sameExplorerPath(entry.path, state.explorerSelectedPath)));

  const disclosure = document.createElement('span');
  disclosure.className = 'file-disclosure';
  disclosure.textContent = entry.kind === 'dir'
    ? state.explorerExpanded.has(entry.path) ? 'v' : '>'
    : '';

  const name = document.createElement('span');
  name.className = 'file-name';
  if (activeExplorerRename && sameExplorerPath(activeExplorerRename.path, entry.path)) {
    attachExplorerRenameInput(name, entry);
  } else {
    name.textContent = entry.name;
  }

  const size = document.createElement('small');
  size.textContent = entry.kind === 'file' ? formatBytes(entry.size) : '';

  row.append(disclosure, name, size);
  return row;
}

function createExplorerLoadingRow(depth: number) {
  const row = document.createElement('div');
  row.className = 'file-row loading';
  row.style.setProperty('--depth', String(depth));
  row.setAttribute('role', 'option');
  row.innerHTML = '<span class="file-disclosure"></span><span class="file-name">Loading...</span><small></small>';
  return row;
}

function bindExplorerListEvents() {
  el.fileList.addEventListener('scroll', handleExplorerScroll, { passive: true });
  el.fileList.addEventListener('wheel', markExplorerScrolling, { passive: true });
  el.fileList.addEventListener('pointerover', handleExplorerPointerOver);
  el.fileList.addEventListener('pointerdown', handleExplorerPointerDown);
  el.fileList.addEventListener('focusin', handleExplorerFocusIn);
  el.fileList.addEventListener('click', handleExplorerClick);
  el.fileList.addEventListener('dblclick', handleExplorerDoubleClick);
  explorerResizeObserver = new ResizeObserver(scheduleExplorerVirtualRender);
  explorerResizeObserver.observe(el.fileList);
}

function handleExplorerScroll() {
  markExplorerScrolling();
  scheduleExplorerVirtualRender();
}

function scheduleExplorerVirtualRender() {
  if (explorerRenderFrame) return;
  explorerRenderFrame = window.requestAnimationFrame(() => {
    explorerRenderFrame = 0;
    renderVirtualExplorerRows();
    updateExplorerSelection(false);
  });
}

function markExplorerScrolling() {
  explorerScrollingUntil = Date.now() + EXPLORER_SCROLL_IDLE_MS;
  cancelExplorerHoverPrefetch();
  if (explorerScrollIdleTimer) window.clearTimeout(explorerScrollIdleTimer);
  explorerScrollIdleTimer = window.setTimeout(() => {
    explorerScrollIdleTimer = 0;
    scheduleVisibleExplorerDirectoryPrefetch();
  }, EXPLORER_SCROLL_IDLE_MS);
}

function handleExplorerPointerOver(event: PointerEvent) {
  const row = explorerRowFromEvent(event);
  if (!row || row.contains(event.relatedTarget as Node | null)) return;
  const entry = explorerEntryForRow(row);
  if (!entry) return;
  scheduleExplorerHoverPrefetch(entry);
}

function handleExplorerPointerDown(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  const entry = explorerEntryFromEvent(event);
  if (!entry) return;
  selectExplorerEntry(entry.path, false);
  scheduleTextFilePrefetch(entry, 0);
  scheduleExplorerDirectoryPrefetch(entry, 0);
}

function handleExplorerFocusIn(event: FocusEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  const entry = explorerEntryFromEvent(event);
  if (!entry) return;
  selectExplorerEntry(entry.path, false);
  scheduleTextFilePrefetch(entry, 0);
  scheduleExplorerDirectoryPrefetch(entry, 0);
}

function handleExplorerClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('.file-rename-input')) return;
  const entry = explorerEntryFromEvent(event);
  if (!entry) return;
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
  return explorerVisibleEntryByPath.get(explorerPathKey(path)) ?? findExplorerEntry(path);
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
  const entry = findExplorerEntry(state.explorerSelectedPath);
  if (!entry) {
    setStatus('Select an item to export', true);
    return;
  }

  try {
    const result = await api.startExportPath(state.activeProfile.id, entry.path);
    upsertExportJob({
      id: result.id,
      name: result.name,
      status: 'running',
      progress: 0,
      outputPath: null,
      message: 'Export queued',
      directory: entry.kind === 'dir',
      createdAt: Date.now()
    });
    setStatus(`Exporting ${entry.name} in background`);
  } catch (error) {
    setStatus(`Export failed to start: ${String(error)}`, true);
  }
}

function handleExportProgress(payload: ExportProgressEvent) {
  upsertExportJob({
    id: payload.id,
    name: payload.name,
    status: payload.status,
    progress: payload.progress ?? null,
    outputPath: payload.outputPath ?? null,
    message: payload.message ?? null,
    directory: payload.directory,
    createdAt: state.exportJobs.find((job) => job.id === payload.id)?.createdAt ?? Date.now()
  });
  if (payload.status === 'completed') setStatus(`${payload.name} ready to drag out`);
  else if (payload.status === 'failed') setStatus(`Export failed: ${payload.message ?? payload.name}`, true);
  else if (payload.status === 'cancelled') setStatus(`Export cancelled: ${payload.name}`);
}

function upsertExportJob(job: ExportJobState) {
  const existing = state.exportJobs.findIndex((item) => item.id === job.id);
  if (existing >= 0) state.exportJobs[existing] = { ...state.exportJobs[existing], ...job };
  else state.exportJobs.unshift(job);
  state.exportJobs = state.exportJobs.slice(0, 8);
  renderExportJobs();
}

function renderExportJobs() {
  el.exportList.classList.toggle('hidden', state.exportJobs.length === 0);
  el.exportList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const job of state.exportJobs) {
    const row = document.createElement('div');
    row.className = `export-job ${job.status}`;

    const meta = document.createElement('div');
    meta.className = 'export-meta';
    const title = document.createElement('strong');
    title.textContent = job.name;
    const detail = document.createElement('span');
    detail.textContent = exportJobDetail(job);
    meta.append(title, detail);

    const progress = document.createElement('div');
    progress.className = 'export-progress';
    const bar = document.createElement('div');
    bar.style.width = `${Math.round((job.progress ?? 0) * 100)}%`;
    progress.classList.toggle('indeterminate', job.status === 'running' && job.progress == null);
    progress.append(bar);

    const actions = document.createElement('div');
    actions.className = 'export-actions';
    if (job.status === 'running') {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => void cancelExportJob(job.id));
      actions.append(cancel);
    } else if (job.status === 'completed' && job.outputPath) {
      const drag = document.createElement('button');
      drag.textContent = 'Drag out';
      drag.className = 'export-drag';
      drag.draggable = true;
      drag.title = 'Drag this to Windows Explorer';
      drag.addEventListener('dragstart', (event) => prepareExportDrag(event, job));
      const open = document.createElement('button');
      open.textContent = 'Open';
      open.addEventListener('click', () => void api.openExportPath(job.outputPath!));
      actions.append(drag, open);
    }

    row.append(meta, progress, actions);
    fragment.append(row);
  }
  el.exportList.append(fragment);
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
    await reloadExplorerDirectory(targetDir);
    selectExplorerEntry(targetDir, false);
    setStatus(`Copied ${copied} dropped item${copied === 1 ? '' : 's'}`);
  } catch (error) {
    setStatus(`Drop copy failed: ${String(error)}`, true);
  }
}

function updateExplorerDropTarget(position?: { x: number; y: number }) {
  const targetDir = explorerDropTargetDirectory(position);
  const explorer = getPanel('explorer');
  explorer.classList.toggle('drop-active', Boolean(targetDir));
  state.explorerDropTargetDir = targetDir ?? '';
  el.fileList.querySelectorAll<HTMLElement>('.file-row.drop-target')
    .forEach((row) => row.classList.remove('drop-target'));
  if (targetDir) explorerRowForPath(targetDir)?.classList.add('drop-target');
}

function clearExplorerDropTarget() {
  state.explorerDropTargetDir = '';
  getPanel('explorer').classList.remove('drop-active');
  el.fileList.querySelectorAll<HTMLElement>('.file-row.drop-target')
    .forEach((row) => row.classList.remove('drop-target'));
}

function explorerDropTargetDirectory(position?: { x: number; y: number }) {
  if (!state.workspaceOpen || !state.currentDir) return '';
  const explorer = getPanel('explorer');
  if (explorer.classList.contains('hidden')) return '';
  const target = elementFromDragPosition(position);
  if (!target || !explorer.contains(target)) return '';

  const row = target.closest<HTMLElement>('.file-row');
  if (row?.dataset.path) {
    const entry = findExplorerEntry(row.dataset.path);
    if (entry?.kind === 'dir') return entry.path;
    if (entry) return parentPath(entry.path);
  }
  return state.currentDir;
}

function elementFromDragPosition(position?: { x: number; y: number }) {
  if (!position) return null;
  const explorer = getPanel('explorer');
  const ratio = window.devicePixelRatio || 1;
  const direct = document.elementFromPoint(position.x, position.y);
  const scaled = ratio === 1 ? null : document.elementFromPoint(position.x / ratio, position.y / ratio);
  if (direct && explorer.contains(direct)) return direct;
  if (scaled && explorer.contains(scaled)) return scaled;
  return direct ?? scaled;
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
    state.explorerSignatures.set(entry.path, explorerDirectorySignature(cached));
    state.explorerExpanded.add(entry.path);
    state.explorerLoading.delete(entry.path);
    renderExplorer();
    saveActiveWorkspaceSnapshot();
    void refreshExplorerDirectory(entry.path, profileId, workspaceId).catch(() => undefined);
    return;
  }

  state.explorerExpanded.add(entry.path);
  state.explorerLoading.add(entry.path);
  renderExplorer();

  try {
    const children = await fetchExplorerDirectory(profileId, entry.path, workspaceId);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    state.explorerChildren.set(entry.path, children);
    state.explorerSignatures.set(entry.path, explorerDirectorySignature(children));
    state.explorerExpanded.add(entry.path);
    scheduleVisibleExplorerDirectoryPrefetch();
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

function isWindowsExecutablePath(path: string) {
  return path.toLowerCase().endsWith('.exe');
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
    if (kind === 'file') cacheTextFile(state.activeProfile.id, path, '');
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
  return Array.from(el.fileList.querySelectorAll<HTMLElement>('.file-row'))
    .find((row) => sameExplorerPath(row.dataset.path ?? '', path)) ?? null;
}

function findExplorerEntry(path: string) {
  if (!path) return null;
  return findExplorerEntryIn(path, state.entries);
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
  const entries = await fetchExplorerDirectory(profileId, path, workspaceId, force);
  if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
  const signature = explorerDirectorySignature(entries);
  const previous = state.explorerSignatures.get(path);
  if (renderOnlyIfChanged && previous === signature) return;

  if (path === state.currentDir) {
    state.entries = entries;
    state.explorerSignatures.set(path, signature);
    state.explorerSelectedPath = selected;
    renderExplorer();
    return;
  }

  state.explorerChildren.set(path, entries);
  state.explorerSignatures.set(path, signature);
  state.explorerExpanded.add(path);
  state.explorerSelectedPath = selected;
  renderExplorer();
}

async function refreshExplorerTree(options: { manual?: boolean; silent?: boolean } = {}) {
  if (!state.activeProfile || !state.workspaceOpen || !state.currentDir) return;
  if (explorerWatchInFlight && !options.manual) return;

  const previousLabel = el.refreshExplorer.textContent;
  if (options.manual) {
    el.refreshExplorer.disabled = true;
    el.refreshExplorer.textContent = '...';
    setStatus('Refreshing Explorer...');
  }

  try {
    const changed = await pollExplorerDirectories();
    if (options.manual) setStatus(changed ? 'Explorer refreshed' : 'Explorer already up to date');
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
  if (!state.workspaceOpen || !state.activeProfile || !state.currentDir) return;
  explorerWatchTimer = window.setTimeout(() => void runExplorerWatch(), delayMs);
}

function stopExplorerWatch() {
  if (explorerWatchTimer) window.clearTimeout(explorerWatchTimer);
  explorerWatchTimer = 0;
  explorerWatchInFlight = false;
}

async function runExplorerWatch() {
  explorerWatchTimer = 0;
  if (!state.workspaceOpen || !state.activeProfile || !state.currentDir) return;
  if (getPanel('explorer').classList.contains('hidden')) {
    scheduleExplorerWatch(explorerWatchInterval() * 2);
    return;
  }
  try {
    await pollExplorerDirectories();
  } catch {
    // Background Explorer watching must never interrupt terminal/editor work.
  } finally {
    scheduleExplorerWatch();
  }
}

async function pollExplorerDirectories() {
  if (!state.activeProfile || explorerWatchInFlight) return false;
  explorerWatchInFlight = true;
  let changed = false;
  const previousSelection = state.explorerSelectedPath;
  try {
    for (const path of explorerWatchPaths()) {
      try {
        const entries = await fetchExplorerDirectory(state.activeProfile.id, path);
        const signature = explorerDirectorySignature(entries);
        const previous = state.explorerSignatures.get(path);
        if (previous !== signature) {
          state.explorerSignatures.set(path, signature);
          if (path === state.currentDir) state.entries = entries;
          else state.explorerChildren.set(path, entries);
          changed = true;
        }
      } catch (error) {
        if (sameExplorerPath(path, state.currentDir)) throw error;
        state.explorerExpanded.delete(path);
        state.explorerChildren.delete(path);
        state.explorerSignatures.delete(path);
        changed = true;
      }
    }
    if (changed) {
      state.explorerSelectedPath = previousSelection;
      renderExplorer();
    }
  } finally {
    explorerWatchInFlight = false;
  }
  return changed;
}

function explorerWatchPaths() {
  const paths: string[] = [];
  const add = (path: string) => {
    if (!path || paths.some((item) => sameExplorerPath(item, path))) return;
    paths.push(path);
  };
  add(state.currentDir);
  for (const path of state.explorerExpanded) {
    if (paths.length >= EXPLORER_WATCH_MAX_DIRS) break;
    if (path === state.currentDir || state.explorerChildren.has(path)) add(path);
  }
  return paths;
}

function explorerWatchInterval() {
  if (state.activeProfile?.kind === 'ssh') return EXPLORER_WATCH_SSH_MS;
  if (state.activeProfile?.kind === 'wsl') return EXPLORER_WATCH_WSL_MS;
  return EXPLORER_WATCH_LOCAL_MS;
}

function explorerDirectorySignature(entries: FileEntry[]) {
  return entries
    .map((entry) => `${entry.name}\t${entry.kind}\t${entry.size}\t${entry.hidden ? 1 : 0}`)
    .sort()
    .join('\n');
}

function moveExplorerChildCache(oldPath: string, newPath: string) {
  const children = state.explorerChildren.get(oldPath);
  if (children) {
    state.explorerChildren.delete(oldPath);
    state.explorerChildren.set(newPath, children);
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
    if (tab.file?.path === oldPath) tab.file.path = newPath;
  }
  if (state.openFile?.path === oldPath) state.openFile.path = newPath;
  for (const tab of state.imageTabs) {
    if (tab.sourcePath === oldPath) {
      tab.sourcePath = newPath;
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
  const existing = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
  if (!existing.has(baseName.toLocaleLowerCase())) return baseName;
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
  if (state.explorerSelectedPath === path) {
    updateExplorerSelection(scrollIntoView);
    return;
  }
  state.explorerSelectedPath = path;
  updateExplorerSelection(scrollIntoView);
}

function updateExplorerSelection(scrollIntoView = true) {
  if (scrollIntoView) scrollExplorerPathIntoView(state.explorerSelectedPath);
  el.fileList.querySelectorAll<HTMLElement>('.file-row').forEach((row) => {
    const selected = sameExplorerPath(row.dataset.path ?? '', state.explorerSelectedPath);
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
  });
}

function scrollExplorerPathIntoView(path: string) {
  if (!path) return;
  const index = explorerVisibleRows.findIndex((row) => !row.loading && sameExplorerPath(row.path, path));
  if (index < 0) return;
  const top = index * EXPLORER_ROW_HEIGHT;
  const bottom = top + EXPLORER_ROW_HEIGHT;
  const currentTop = el.fileList.scrollTop;
  const currentBottom = currentTop + el.fileList.clientHeight;
  let nextTop = currentTop;
  if (top < currentTop) nextTop = top;
  else if (bottom > currentBottom) nextTop = bottom - el.fileList.clientHeight;
  if (nextTop === currentTop) return;
  renderVirtualExplorerRows(nextTop);
}

function scheduleTextFilePrefetch(entry: FileEntry, delay = 80) {
  if (!state.activeProfile || !shouldPrefetchTextFile(entry)) return;
  const profileId = state.activeProfile.id;
  const key = textFileCacheKey(profileId, entry.path);
  if (textFileCache.has(key) || textFileReads.has(key)) return;
  const existing = textFilePrefetchTimers.get(key);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    textFilePrefetchTimers.delete(key);
    if (state.activeProfile?.id !== profileId) return;
    warmEditorForPath(entry.path);
    void readTextFileCached(profileId, entry.path).catch(() => undefined);
  }, delay);
  textFilePrefetchTimers.set(key, timer);
}

function shouldPrefetchTextFile(entry: FileEntry) {
  if (entry.kind !== 'file') return false;
  if (entry.size > TEXT_FILE_PREFETCH_MAX_BYTES) return false;
  if (isImagePath(entry.path)) return false;
  if (shouldMaskFile(entry.path)) return false;
  return isLikelyTextPath(entry.path);
}

function scheduleExplorerDirectoryPrefetch(entry: FileEntry, delay = EXPLORER_DIRECTORY_PREFETCH_DELAY_MS) {
  if (!state.activeProfile || entry.kind !== 'dir') return;
  if (state.explorerChildren.has(entry.path) || state.explorerLoading.has(entry.path)) return;
  const profileId = state.activeProfile.id;
  const workspaceId = state.activeWorkspaceId;
  const key = explorerDirectoryCacheKey(profileId, entry.path, workspaceId);
  if (hasCachedExplorerDirectory(profileId, entry.path, workspaceId) || explorerDirectoryReads.has(key)) return;
  const existing = explorerDirectoryPrefetchTimers.get(key);
  if (existing) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    explorerDirectoryPrefetchTimers.delete(key);
    if (state.activeProfile?.id !== profileId || state.activeWorkspaceId !== workspaceId) return;
    void fetchExplorerDirectory(profileId, entry.path, workspaceId).catch(() => undefined);
  }, delay);
  explorerDirectoryPrefetchTimers.set(key, timer);
}

function scheduleVisibleExplorerDirectoryPrefetch() {
  if (!state.activeProfile || !state.workspaceOpen || getPanel('explorer').classList.contains('hidden')) return;
  if (Date.now() < explorerScrollingUntil) return;
  const limit = explorerDirectoryPrefetchLimit();
  let count = 0;
  for (const entry of visibleExplorerViewportEntries()) {
    if (count >= limit) break;
    if (entry.kind !== 'dir' || state.explorerExpanded.has(entry.path)) continue;
    scheduleExplorerDirectoryPrefetch(entry, EXPLORER_DIRECTORY_PREFETCH_DELAY_MS + count * 90);
    count += 1;
  }
}

function visibleExplorerViewportEntries() {
  return explorerVisibleRows
    .slice(explorerRenderedStart, explorerRenderedEnd)
    .map((row) => row.entry)
    .filter((entry): entry is FileEntry => Boolean(entry));
}

function explorerDirectoryPrefetchLimit() {
  if (state.activeProfile?.kind === 'ssh') return 2;
  if (state.activeProfile?.kind === 'wsl') return Math.min(4, EXPLORER_DIRECTORY_PREFETCH_LIMIT);
  return EXPLORER_DIRECTORY_PREFETCH_LIMIT;
}

function isLikelyTextPath(path: string) {
  const name = path.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? path.toLowerCase();
  if (/^(readme|license|dockerfile|makefile|gemfile|rakefile|procfile|cargo\.toml|package\.json|tsconfig\.json)$/i.test(name)) return true;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (!extension) return true;
  const textExtensions = new Set([
    'bash', 'bat', 'cmd', 'conf', 'config', 'cpp', 'cs', 'css', 'csv', 'c', 'env', 'go',
    'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'lock', 'log', 'lua',
    'md', 'mjs', 'ps1', 'py', 'rs', 'scss', 'sh', 'sql', 'svelte', 'toml', 'ts', 'tsx',
    'txt', 'vue', 'xml', 'yaml', 'yml'
  ]);
  return textExtensions.has(extension);
}

function selectExplorerByTypeahead(key: string) {
  const now = Date.now();
  const previous = now - state.explorerTypeaheadAt <= EXPLORER_TYPEAHEAD_TIMEOUT_MS
    ? state.explorerTypeahead
    : '';
  let query = `${previous}${key}`.toLocaleLowerCase();
  let entry = findExplorerTypeaheadMatch(query);

  if (!entry && previous) {
    query = key.toLocaleLowerCase();
    entry = findExplorerTypeaheadMatch(query);
  }

  state.explorerTypeahead = query;
  state.explorerTypeaheadAt = now;
  if (entry) selectExplorerEntry(entry.path);
}

function findExplorerTypeaheadMatch(query: string) {
  const visible = visibleExplorerEntries();
  const candidates = [
    ...visible.filter((entry) => entry.kind === 'dir'),
    ...visible.filter((entry) => entry.kind !== 'dir')
  ];
  if (!candidates.length) return null;

  const selectedIndex = candidates.findIndex((entry) => entry.path === state.explorerSelectedPath);
  const start = query.length === 1 && selectedIndex >= 0 ? selectedIndex + 1 : 0;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const entry = candidates[(start + offset) % candidates.length];
    if (entry.name.toLocaleLowerCase().startsWith(query)) return entry;
  }
  return null;
}

function moveExplorerSelection(direction: number) {
  const entries = visibleExplorerEntries();
  if (!entries.length) return;
  const current = entries.findIndex((entry) => entry.path === state.explorerSelectedPath);
  const next = current < 0
    ? direction > 0 ? 0 : entries.length - 1
    : (current + direction + entries.length) % entries.length;
  selectExplorerEntry(entries[next].path);
}

function visibleExplorerEntries() {
  const result: FileEntry[] = [];
  appendVisibleExplorerEntries(result, state.entries);
  return result;
}

function appendVisibleExplorerEntries(result: FileEntry[], entries: FileEntry[]) {
  for (const entry of entries) {
    result.push(entry);
    if (entry.kind === 'dir' && state.explorerExpanded.has(entry.path)) {
      appendVisibleExplorerEntries(result, state.explorerChildren.get(entry.path) ?? []);
    }
  }
}

function updateExplorerFileSizeMode() {
  const explorer = getPanel('explorer');
  explorer.classList.toggle('hide-file-sizes', !state.showFileSizes);
  el.fileSizeToggle.classList.toggle('active', state.showFileSizes);
  el.fileSizeToggle.setAttribute('aria-pressed', String(state.showFileSizes));
}

function updateExplorerOpenMode() {
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

function ensureEditorTab() {
  return activeEditorTab();
}

function activeEditorTab() {
  let tab = state.editorTabs.find((item) => item.id === state.activeEditorTabId);
  if (!tab) tab = createEditorTab(null, false);
  return tab;
}

function createEditorTab(file: OpenFileState | null, activate = true, id: string = crypto.randomUUID()) {
  const tab = { id, file };
  state.editorTabs.push(tab);
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
  const tab = state.editorTabs.find((item) => item.id === id);
  if (!tab) return;
  state.activeEditorTabId = tab.id;
  state.openFile = tab.file;
  renderEditorTabs();
  renderEditor();
  void hydrateVisibleEditorTab();
  saveActiveWorkspaceSnapshot();
}

function closeEditorTab(id: string) {
  syncActiveEditorTabFromView();
  const index = state.editorTabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  state.editorTabs.splice(index, 1);
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
  el.editorTabs.innerHTML = '';
  el.editorOpenNewTab.checked = state.editorOpenInNewTab;
  el.editorWordWrap.checked = state.editorWordWrap;
  const fragment = document.createDocumentFragment();
  for (const tab of state.editorTabs) {
    const item = document.createElement('div');
    item.className = `widget-tab${tab.id === state.activeEditorTabId ? ' active' : ''}`;
    item.title = tab.file?.path ?? tab.pendingPath ?? 'Empty editor';
    item.innerHTML = `<button class="widget-tab-label">${escapeHtml(editorTabLabel(tab))}</button><button class="widget-tab-close" title="Close editor tab" aria-label="Close editor tab">x</button>`;
    item.querySelector<HTMLButtonElement>('.widget-tab-label')!.addEventListener('click', () => activateEditorTab(tab.id));
    item.querySelector<HTMLButtonElement>('.widget-tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      closeEditorTab(tab.id);
    });
    fragment.append(item);
  }
  el.editorTabs.append(fragment);
}

function editorTabLabel(tab: EditorTabState) {
  const path = tab.file?.path ?? tab.pendingPath;
  if (!path) return 'Empty';
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const suffix = tab.file?.dirty ? ' *' : tab.loading ? ' ...' : '';
  return `${name}${suffix}`;
}

function syncActiveEditorTabFromView() {
  const tab = state.editorTabs.find((item) => item.id === state.activeEditorTabId);
  if (!tab?.file) return;
  if (codeView && state.openFile === tab.file && !(tab.file.masked && !tab.file.rawMode)) {
    tab.file.draftContent = codeView.state.doc.toString();
    tab.file.dirty = !sameEditorContent(tab.file.draftContent, tab.file.content);
  }
}

async function openFile(path: string) {
  const profile = state.activeProfile;
  if (!profile) return;
  const openToken = ++fileOpenToken;
  if (isImagePath(path)) {
    await openImageFile(path);
    return;
  }

  try {
    syncActiveEditorTabFromView();
    const existing = state.editorTabs.find((tab) => tab.file?.path === path);
    if (existing) {
      activateEditorTab(existing.id);
      setStatus('File opened');
      return;
    }

    const cancelLoading = scheduleEditorLoading(path);
    warmEditorForPath(path);
    const content = await readTextFileCached(profile.id, path);
    cancelLoading();
    if (openToken !== fileOpenToken || state.activeProfile?.id !== profile.id) return;
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
    tab.file = file;
    state.activeEditorTabId = tab.id;
    state.openFile = file;
    renderEditorTabs();
    renderEditor();
    setPanelVisible('editor', true);
    setStatus('File opened');
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    if (openToken !== fileOpenToken) return;
    cancelPendingEditorLoading();
    setStatus(String(error), true);
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
  const cached = textFileCache.get(key);
  if (cached) {
    textFileCache.delete(key);
    textFileCache.set(key, cached);
    return cached.content;
  }

  const pending = textFileReads.get(key);
  if (pending) return pending;

  const read = api.readTextFile(profileId, path)
    .then((content) => {
      cacheTextFile(profileId, path, content);
      return content;
    })
    .finally(() => {
      textFileReads.delete(key);
    });
  textFileReads.set(key, read);
  return read;
}

function cacheTextFile(profileId: string, path: string, content: string) {
  if (content.length > TEXT_FILE_PREFETCH_MAX_BYTES) return;
  const key = textFileCacheKey(profileId, path);
  textFileCache.delete(key);
  textFileCache.set(key, { content, cachedAt: Date.now() });
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

function ensureImageTab() {
  return activeImageTab();
}

function activeImageTab() {
  let tab = state.imageTabs.find((item) => item.id === state.activeImageTabId);
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
    historyVisible: seed?.historyVisible ?? false
  };
  state.imageTabs.push(tab);
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
  const tab = state.imageTabs.find((item) => item.id === id);
  if (!tab) return;
  state.activeImageTabId = tab.id;
  syncImageStateFromActiveTab();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
  saveActiveWorkspaceSnapshot();
}

function closeImageTab(id: string) {
  syncActiveImageTabFromState();
  const index = state.imageTabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  state.imageTabs.splice(index, 1);
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
  el.imageTabs.innerHTML = '';
  el.imageOpenNewTab.checked = state.imageOpenInNewTab;
  const fragment = document.createDocumentFragment();
  for (const tab of state.imageTabs) {
    const item = document.createElement('div');
    item.className = `widget-tab${tab.id === state.activeImageTabId ? ' active' : ''}`;
    item.title = tab.sourcePath ?? tab.label;
    item.innerHTML = `<button class="widget-tab-label">${escapeHtml(imageTabLabel(tab))}</button><button class="widget-tab-close" title="Close image tab" aria-label="Close image tab">x</button>`;
    item.querySelector<HTMLButtonElement>('.widget-tab-label')!.addEventListener('click', () => activateImageTab(tab.id));
    item.querySelector<HTMLButtonElement>('.widget-tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      closeImageTab(tab.id);
    });
    fragment.append(item);
  }
  el.imageTabs.append(fragment);
}

function imageTabLabel(tab: ImageTabState) {
  if (tab.sourcePath) return tab.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? tab.sourcePath;
  if (tab.dataUrl) return 'Pasted image';
  return 'Empty';
}

function syncImageStateFromActiveTab() {
  const tab = activeImageTab();
  state.imagePreviewDataUrl = tab.dataUrl;
  state.imagePreviewLabel = tab.label;
  state.imageHistory = tab.history;
  state.imageHistoryVisible = tab.historyVisible;
}

function syncActiveImageTabFromState() {
  const tab = state.imageTabs.find((item) => item.id === state.activeImageTabId);
  if (!tab) return;
  tab.dataUrl = state.imagePreviewDataUrl;
  tab.label = state.imagePreviewLabel;
  tab.history = state.imageHistory;
  tab.historyVisible = state.imageHistoryVisible;
}

async function openImageFile(path: string) {
  if (!state.activeProfile) return;
  setStatus(`Opening image ${path}...`);
  try {
    const existing = state.imageTabs.find((tab) => tab.sourcePath === path);
    if (existing) {
      activateImageTab(existing.id);
      setPanelVisible('image', true);
      setStatus('Image opened');
      return;
    }

    const dataUrl = await api.readFileDataUrl(state.activeProfile.id, path);
    const tab = state.imageOpenInNewTab && activeImageTab().dataUrl
      ? createImageTab(undefined, true)
      : activeImageTab();
    tab.sourcePath = path;
    tab.dataUrl = dataUrl;
    tab.label = `Image selected: ${path}`;
    state.activeImageTabId = tab.id;
    syncImageStateFromActiveTab();
    renderImageTabs();
    renderImagePreview();
    setPanelVisible('image', true);
    setStatus('Image opened');
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderEditor() {
  const renderToken = ++editorRenderToken;
  codeView?.destroy();
  codeView = null;
  const activeTab = activeEditorTab();
  state.openFile = activeTab.file;
  const file = state.openFile;
  el.editorBody.innerHTML = '';
  el.editorBody.classList.remove('empty');
  el.toggleRaw.classList.toggle('hidden', !file?.masked);
  el.saveFile.disabled = !file;

  if (!file) {
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

  const mount = document.createElement('div');
  mount.className = 'code-mount';
  el.editorBody.append(mount);
  void mountCodeEditor(file, mount, renderToken);
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

async function mountCodeEditor(file: OpenFileState, mount: HTMLElement, renderToken: number) {
  const runtime = await ensureEditorRuntime();
  if (renderToken !== editorRenderToken || state.openFile !== file) return;

  codeView = new runtime.EditorView({
    state: runtime.EditorState.create({
      doc: editorDocumentText(file),
      extensions: editorExtensions(file.path, runtime)
    }),
    parent: mount
  });
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
        state.openFile.draftContent = update.state.doc.toString();
        setEditorDirtyFromContent(state.openFile.draftContent);
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
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ typescript: true, jsx: lower.endsWith('.tsx') });
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: lower.endsWith('.jsx') });
  }
  if (lower.endsWith('.json')) {
    const { json } = await import('@codemirror/lang-json');
    return json();
  }
  if (lower.endsWith('.css')) {
    const { css } = await import('@codemirror/lang-css');
    return css();
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const { markdown } = await import('@codemirror/lang-markdown');
    return markdown();
  }
  if (lower.endsWith('.py')) {
    const { python } = await import('@codemirror/lang-python');
    return python();
  }
  if (lower.endsWith('.rs')) {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
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

function setEditorDirtyFromContent(currentContent: string) {
  if (!state.openFile) return;
  state.openFile.dirty = !sameEditorContent(currentContent, state.openFile.content);
  updateEditorLabel();
  renderEditorTabs();
  el.saveFile.disabled = false;
}

function sameEditorContent(left: string, right: string) {
  return normalizeEditorContent(left) === normalizeEditorContent(right);
}

function normalizeEditorContent(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

function updateEditorLabel() {
  const file = state.openFile;
  if (!file) {
    el.editorLabel.textContent = 'Editor';
    return;
  }
  el.editorLabel.textContent = `${file.masked ? '🔒 ' : ''}${file.path}${file.dirty ? ' *' : ''}`;
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
    cacheTextFile(profile.id, file.path, content);
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
  card.innerHTML = `
    <div class="terminal-title panel-drag-handle">
      <button class="focus-dot" title="Active prompt target"></button>
      <strong class="terminal-widget-title">${escapeHtml(title)}</strong>
      <span class="muted terminal-widget-cwd">${escapeHtml(cwd)}</span>
      <span class="spacer"></span>
      <button class="close-pane" title="Close shell widget" aria-label="Close shell widget">x</button>
    </div>
    <div class="terminal-widget-tabbar">
      <div class="terminal-tab-list widget-tabs"></div>
      <button class="terminal-new-tab tab-add" title="New tab in this shell" aria-label="New tab in this shell">+</button>
    </div>
    <div class="terminal-host-stack"></div>
  `;
  el.mainGrid.append(card);
  const grips = ensureResizeGrips(card, 'terminal');
  if (options.rect) applyLayoutRatio(card, options.rect);
  else placeTerminalCard(card, options);

  const widget: TerminalWidget = {
    widgetId,
    workspaceId,
    element: card,
    title: card.querySelector<HTMLElement>('.terminal-widget-title')!,
    cwd: card.querySelector<HTMLElement>('.terminal-widget-cwd')!,
    tabList: card.querySelector<HTMLElement>('.terminal-tab-list')!,
    hostStack: card.querySelector<HTMLElement>('.terminal-host-stack')!,
    activePaneId: ''
  };
  state.terminalWidgets.push(widget);

  card.addEventListener('pointerdown', () => {
    const pane = activePaneForWidget(widget);
    if (pane) setActivePane(pane.paneId);
    bringPanelToFront(card);
  });
  card.querySelector<HTMLElement>('.terminal-title')!
    .addEventListener('pointerdown', (event) => startPanelDrag(event, card));
  grips.forEach((grip) => {
    grip.addEventListener('pointerdown', (event) => {
      startPanelResize(event, card, grip);
      scheduleFitTerminalWidget(widget);
    });
  });
  card.querySelector<HTMLButtonElement>('.close-pane')!.addEventListener('click', () => void closeTerminalWidget(widget.widgetId));
  card.querySelector<HTMLButtonElement>('.terminal-new-tab')!.addEventListener('click', (event) => {
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

  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: fontChoice(MONO_FONT_CHOICES, state.ideSettings.monoFont).stack,
    fontSize: terminalFontSize,
    theme: { background: '#080b10', foreground: '#d8e0ea' }
  });
  const fit = new FitAddon();
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
    cwdOutputBuffer: '',
    inputBuffer: '',
    seenPorts: new Set(),
    lastRows: term.rows,
    lastCols: term.cols
  };
  state.terminals.push(pane);
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
    trackTerminalCwdFromInput(pane, data);
    if (pane.backendId) void api.writeTerminal(pane.backendId, data);
  });
  host.addEventListener('paste', (event) => handleTerminalPaste(event, pane), true);

  pane.resizeObserver = new ResizeObserver(() => scheduleFitTerminal(pane));
  pane.resizeObserver.observe(host);

  try {
    await settleTerminalInitialFit(pane);
    const spawnCwd = await usableTerminalCwd(terminalProfile, pane.cwd);
    if (spawnCwd !== pane.cwd) {
      pane.cwd = spawnCwd;
      updateTerminalWidgetTitle(widget);
    }
    pane.backendId = await api.spawnTerminal(terminalProfile.id, pane.cwd, command, term.rows, term.cols);
    if (options.focus !== false) {
      queueTerminalFitBurst(pane);
      bringPanelToFront(widget.element);
      term.focus();
    }
    setStatus(`Terminal started: ${title}`);
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    term.write(`\r\nFailed to start terminal: ${String(error)}\r\n`);
    setStatus(String(error), true);
  }
  return pane;
}

async function closeTerminalPane(paneId: string) {
  const pane = state.terminals.find((item) => item.paneId === paneId);
  if (!pane) return;
  const widget = terminalWidgetForPane(pane);
  if (pane.backendId) await api.killTerminal(pane.backendId).catch(() => undefined);
  if (pane.fitFrame) cancelAnimationFrame(pane.fitFrame);
  pane.resizeObserver?.disconnect();
  pane.term.dispose();
  state.terminals = state.terminals.filter((item) => item.paneId !== paneId);
  pane.host.remove();
  const remainingInWidget = widget ? terminalPanesForWidget(widget) : [];
  if (widget && !remainingInWidget.length) {
    state.terminalWidgets = state.terminalWidgets.filter((item) => item.widgetId !== widget.widgetId);
    widget.element.remove();
  } else if (widget && widget.activePaneId === paneId) {
    widget.activePaneId = remainingInWidget[0]?.paneId ?? '';
  }

  if (state.activePaneId === paneId) {
    const next = remainingInWidget[0] ?? activeWorkspaceTerminalPanes()[0];
    state.activePaneId = '';
    if (next) setActivePane(next.paneId);
    else setKeyboardResizeTarget({ kind: 'ide' });
  }
  syncActivePaneClass();
  renderShellTabs();
  saveActiveWorkspaceSnapshot();
}

async function closeTerminalWidget(widgetId: string) {
  const paneIds = state.terminals
    .filter((pane) => pane.widgetId === widgetId)
    .map((pane) => pane.paneId);
  for (const paneId of paneIds) {
    await closeTerminalPane(paneId);
  }
}

function renderShellTabs() {
  el.shellTabs.classList.add('hidden');
  el.shellTabList.innerHTML = '';
  for (const widget of activeWorkspaceTerminalWidgets()) renderTerminalWidgetTabs(widget);
}

function renderTerminalWidgetTabs(widget: TerminalWidget) {
  widget.tabList.innerHTML = '';
  const panes = terminalPanesForWidget(widget);
  const fragment = document.createDocumentFragment();
  for (const pane of panes) {
    const item = document.createElement('div');
    item.className = `widget-tab${pane.paneId === widget.activePaneId ? ' active' : ''}`;
    item.title = pane.command || pane.title;
    item.innerHTML = `<button class="widget-tab-label">${escapeHtml(pane.title)}</button><button class="widget-tab-close" title="Close shell" aria-label="Close shell">x</button>`;
    item.querySelector<HTMLButtonElement>('.widget-tab-label')!.addEventListener('click', () => {
      setActivePane(pane.paneId);
      bringPanelToFront(pane.element);
      pane.term.focus();
    });
    item.querySelector<HTMLButtonElement>('.widget-tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void closeTerminalPane(pane.paneId);
    });
    fragment.append(item);
  }
  widget.tabList.append(fragment);
  updateTerminalWidgetTitle(widget);
}

function terminalPanesForWidget(widget: TerminalWidget) {
  return state.terminals.filter((pane) => pane.widgetId === widget.widgetId);
}

function activeWorkspaceTerminalWidgets() {
  return state.terminalWidgets.filter((widget) => widget.workspaceId === state.activeWorkspaceId);
}

function activeWorkspaceTerminalPanes() {
  return state.terminals.filter((pane) => pane.workspaceId === state.activeWorkspaceId);
}

function terminalWidgetForPane(pane: TerminalPane) {
  return state.terminalWidgets.find((widget) => widget.widgetId === pane.widgetId) ?? null;
}

function terminalWidgetForElement(element: HTMLElement) {
  return state.terminalWidgets.find((widget) => widget.element === element) ?? null;
}

function activePaneForWidget(widget: TerminalWidget) {
  return state.terminals.find((pane) => pane.paneId === widget.activePaneId)
    ?? terminalPanesForWidget(widget)[0]
    ?? null;
}

function activeTerminalWidget() {
  const pane = activeWorkspaceTerminalPanes().find((item) => item.paneId === state.activePaneId);
  return pane ? terminalWidgetForPane(pane) : activeWorkspaceTerminalWidgets()[0] ?? null;
}

function activePaneForElement(element: HTMLElement) {
  const widget = terminalWidgetForElement(element);
  return widget ? activePaneForWidget(widget) : null;
}

function profileForTerminalWidget(widget: TerminalWidget) {
  const pane = activePaneForWidget(widget);
  if (!pane) return null;
  return state.profiles.find((profile) => profile.id === pane.profileId)
    ?? (pane.profileId === 'windows-local' ? windowsLocalProfileFallback() : null);
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
      await api.listDirectory(profile.id, candidate);
      return candidate;
    } catch {
      // Try the next likely folder without surfacing private paths.
    }
  }
  return profile.kind === 'windows' ? '' : '~';
}

function updateTerminalWidgetTitle(widget: TerminalWidget) {
  const pane = activePaneForWidget(widget);
  widget.activePaneId = pane?.paneId ?? '';
  widget.title.textContent = pane?.title ?? 'shell';
  widget.cwd.textContent = pane?.cwd ?? '';
}

function scheduleFitTerminalWidget(widget: TerminalWidget) {
  for (const pane of terminalPanesForWidget(widget)) scheduleFitTerminal(pane);
}

function handleTerminalKey(event: KeyboardEvent, pane: TerminalPane) {
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
    if (!value || !pane.backendId) return;
    await api.writeTerminal(pane.backendId, terminalPastePayload(value));
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

function fitTerminal(pane: TerminalPane) {
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

function setActivePane(paneId: string) {
  const pane = state.terminals.find((item) => item.paneId === paneId);
  if (!pane) return;
  if (pane.workspaceId !== state.activeWorkspaceId) return;
  const widget = terminalWidgetForPane(pane);
  if (widget) widget.activePaneId = paneId;
  state.activePaneId = paneId;
  setKeyboardResizeTarget({ kind: 'terminal', paneId });
  syncActivePaneClass();
  renderShellTabs();
  scheduleFitTerminal(pane);
  saveActiveWorkspaceSnapshot();
}

function syncActivePaneClass() {
  for (const widget of state.terminalWidgets) {
    const activePane = activePaneForWidget(widget);
    widget.activePaneId = activePane?.paneId ?? '';
    widget.element.classList.toggle('active', widget.activePaneId === state.activePaneId);
    for (const pane of terminalPanesForWidget(widget)) {
      pane.host.classList.toggle('hidden', pane.paneId !== widget.activePaneId);
    }
    updateTerminalWidgetTitle(widget);
  }
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
  const item = [...(event.clipboardData?.items ?? [])].find((candidate) => candidate.type.startsWith('image/'));
  const file = item?.getAsFile()
    ?? [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith('image/') || isImagePath(candidate.name));
  return file ? blobToDataUrl(file) : null;
}

function clipboardEventMayContainImage(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) return true;
  if ([...data.items].some((item) => item.type.startsWith('image/'))) return true;
  if ([...data.files].some((file) => file.type.startsWith('image/') || isImagePath(file.name))) return true;
  if ([...data.types].includes('Files')) return true;
  const html = data.getData('text/html');
  if (/<img\b|data:image\//i.test(html)) return true;
  return data.types.length === 0 && !data.getData('text/plain');
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
  const item: PastedImageItem = {
    id: crypto.randomUUID(),
    path: result.path,
    tag: result.tag,
    dataUrl,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  state.imageHistory = [item, ...state.imageHistory].slice(0, 24);
  state.imagePreviewDataUrl = dataUrl;
  targetTab.sourcePath = result.path;
  const pasted = pasteToShell ? await pasteImageTagToActiveTerminal(result.tag) : false;
  state.imagePreviewLabel = pasted ? `${result.tag} copied into active prompt` : `${result.tag} saved`;
  syncActiveImageTabFromState();
  renderImageTabs();
  renderImagePreview();
  renderImageHistory();
  setStatus(pasted ? `Saved and pasted ${result.path}` : `Saved ${result.path}`);
  saveActiveWorkspaceSnapshot();
}

function renderImagePreview() {
  el.imageLabel.textContent = state.imagePreviewLabel;
  if (state.imagePreviewDataUrl) {
    el.imagePreview.src = state.imagePreviewDataUrl;
    el.imagePreview.classList.add('visible');
  } else {
    el.imagePreview.removeAttribute('src');
    el.imagePreview.classList.remove('visible');
  }
}

function renderImageHistory() {
  el.imageHistoryToggle.classList.toggle('active', state.imageHistoryVisible);
  el.imageHistoryToggle.setAttribute('aria-pressed', String(state.imageHistoryVisible));
  el.imageHistoryClear.disabled = state.imageHistory.length === 0;
  el.imageHistory.classList.toggle('hidden', !state.imageHistoryVisible);
  if (!state.imageHistoryVisible) return;

  el.imageHistory.innerHTML = '';
  if (state.imageHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'image-history-empty';
    empty.textContent = 'No pasted images yet.';
    el.imageHistory.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.imageHistory) {
    const row = document.createElement('div');
    row.className = 'image-history-row';

    const preview = document.createElement('button');
    preview.className = 'image-history-preview';
    preview.title = 'Preview image';
    preview.innerHTML = `<img alt="" src="${item.dataUrl}" />`;
    preview.addEventListener('click', () => previewImageHistoryItem(item));

    const meta = document.createElement('button');
    meta.className = 'image-history-meta';
    meta.title = 'Preview image';
    meta.innerHTML = `<span>${escapeHtml(item.path)}</span><small>${escapeHtml(item.createdAt)}</small>`;
    meta.addEventListener('click', () => previewImageHistoryItem(item));

    const paste = document.createElement('button');
    paste.className = 'image-history-paste';
    paste.textContent = 'Paste';
    paste.title = 'Paste tag to active shell';
    paste.addEventListener('click', () => void pasteImageTagToActiveTerminal(item.tag));

    row.append(preview, meta, paste);
    fragment.append(row);
  }
  el.imageHistory.append(fragment);
}

function previewImageHistoryItem(item: PastedImageItem) {
  state.imagePreviewDataUrl = item.dataUrl;
  state.imagePreviewLabel = item.tag;
  syncActiveImageTabFromState();
  renderImagePreview();
  renderImageTabs();
  saveActiveWorkspaceSnapshot();
}

async function pasteImageTagToActiveTerminal(tag: string) {
  const active = state.terminals.find((pane) => pane.paneId === state.activePaneId);
  if (!active?.backendId) {
    setStatus('No active shell for image tag paste', true);
    return false;
  }
  await api.writeTerminal(active.backendId, tag);
  setStatus(`Pasted ${tag}`);
  return true;
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
    state.forwards.push(forward);
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(state.activeProfile!.id, remotePort));
    renderForwards();
    await openLocalBrowserTab(forward.url, portTabLabel(forward.localPort));
    setStatus(`Forwarding ${forward.localPort} -> ${forward.targetHost}:${forward.remotePort}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

async function openPreviewValue(value: string) {
  if (!value) return;
  const localUrl = parseLocalPreviewUrl(value);
  if (localUrl) {
    await openLocalPreviewUrl(localUrl);
    return;
  }
  const port = parsePreviewPort(value);
  if (port) {
    await openPort(port, 'manual');
    return;
  }
  openBrowserTab(normalizePreviewUrl(value));
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

  const existing = state.forwards.find((forward) => forward.remotePort === port);
  if (existing) {
    await openLocalBrowserTab(`${existing.url}${suffix}`, browserTabLabel(url.toString()));
    return;
  }

  const forward = await startForwardForPort(port, 'manual');
  state.forwards.push(forward);
  state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(state.activeProfile!.id, port));
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

async function scanTerminalOutputForPorts(pane: TerminalPane, data: string) {
  if (pane.workspaceId !== state.activeWorkspaceId) return;
  if (!state.activeProfile) return;
  pane.outputBuffer = trimPortScanBuffer(`${pane.outputBuffer}${stripAnsi(data)}`);
  const ports = detectLocalServerPorts(pane.outputBuffer).filter((port) => !pane.seenPorts.has(port));
  for (const port of ports) {
    pane.seenPorts.add(port);
    queueDetectedPort(port);
  }
}

function trackTerminalCwdFromOutput(pane: TerminalPane, data: string) {
  const oscCwd = extractOsc7Cwd(data);
  if (oscCwd) updateTerminalCwd(pane, oscCwd);

  const clean = stripAnsi(data).replace(/\r/g, '\n');
  pane.cwdOutputBuffer = trimTerminalCwdBuffer(`${pane.cwdOutputBuffer}${clean}`);
  const promptCwd = extractPromptCwd(pane.cwdOutputBuffer, pane);
  if (promptCwd) updateTerminalCwd(pane, promptCwd);
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
  const profile = state.profiles.find((item) => item.id === pane.profileId) ?? state.activeProfile;
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
  const pattern = /\x1b]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  for (const match of data.matchAll(pattern)) {
    found = decodeTerminalPath(match[1]);
  }
  return found;
}

function extractPromptCwd(buffer: string, pane: TerminalPane) {
  const lines = buffer.split('\n').slice(-40);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trimEnd();
    const powershell = line.match(/(?:^|\s)PS\s+([A-Za-z]:\\[^<>|?*\r\n]*)>\s*$/);
    if (powershell) return normalizeWindowsTerminalPath(powershell[1]);

    const bash = line.match(/(?:^|\s)[^@\s:]+@[^:\s]+:([^#$\r\n]+)[#$]\s*$/);
    if (bash) return normalizePosixTerminalPath(expandTildeTerminalPath(bash[1].trim(), pane.cwd));
  }
  return '';
}

function expandTildeTerminalPath(path: string, currentCwd: string) {
  if (!path.startsWith('~')) return path;
  const tail = path === '~' ? '' : path.slice(2);
  const candidates = [currentCwd, state.workspaceRoot, state.currentDir, state.activeProfile?.root ?? '']
    .filter((value) => value.startsWith('/'));
  if (!tail) {
    const current = candidates[0];
    const home = current?.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/)?.[1];
    return home || path;
  }
  const first = tail.split('/')[0];
  for (const candidate of candidates) {
    const marker = `/${first}`;
    const index = candidate.indexOf(marker);
    if (index > 0) return `${candidate.slice(0, index)}/${tail}`;
  }
  return path;
}

function updateTerminalCwd(pane: TerminalPane, cwd: string) {
  const normalized = isWindowsPath(cwd) ? normalizeWindowsTerminalPath(cwd) : normalizePosixTerminalPath(cwd);
  if (normalized.startsWith('~')) return;
  if (!normalized || normalized === pane.cwd) return;
  pane.cwd = normalized;
  const widget = terminalWidgetForPane(pane);
  if (widget) updateTerminalWidgetTitle(widget);
  scheduleTerminalCwdSnapshotSave();
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

function trimTerminalCwdBuffer(value: string) {
  return value.length > TERMINAL_CWD_SCAN_LIMIT
    ? value.slice(value.length - TERMINAL_CWD_SCAN_LIMIT)
    : value;
}

function scheduleTerminalCwdSnapshotSave() {
  if (restoringWorkspace || !state.workspaceOpen) return;
  if (terminalCwdSaveTimer) window.clearTimeout(terminalCwdSaveTimer);
  terminalCwdSaveTimer = window.setTimeout(() => {
    terminalCwdSaveTimer = 0;
    saveActiveWorkspaceSnapshot();
  }, 150);
}

function flushTerminalCwdSnapshotSave() {
  if (terminalCwdSaveTimer) {
    window.clearTimeout(terminalCwdSaveTimer);
    terminalCwdSaveTimer = 0;
  }
  saveActiveWorkspaceSnapshot();
}

async function openPort(port: number, source: 'manual' | 'auto') {
  if (!state.activeProfile || !isPreviewPort(port)) return;
  const profile = state.activeProfile;
  const key = `${profile.id}:${port}`;
  const existing = state.forwards.find((forward) => forward.remotePort === port);
  if (existing) {
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(profile.id, port));
    renderForwards();
    await openLocalBrowserTab(existing.url, portTabLabel(existing.localPort));
    if (source === 'auto') setStatus(`Detected port ${port}; using ${existing.url}`);
    return;
  }

  if (profile.kind === 'windows') {
    const url = `http://127.0.0.1:${port}`;
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(profile.id, port));
    renderForwards();
    await openLocalBrowserTab(url, portTabLabel(port));
    setStatus(source === 'auto' ? `Detected local server on ${url}` : `Previewing ${url}`);
    return;
  }

  if (autoForwardingPorts.has(key)) return;
  autoForwardingPorts.add(key);
  try {
    const forward = await startForwardForPort(port, source);
    state.forwards.push(forward);
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(profile.id, port));
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
  if (state.detectedPorts.some((item) => item.id === id)) return;
  if (state.browserTabs.some((tab) => tab.url === url)) return;

  state.detectedPorts.push({ id, profileId: profile.id, port, url });
  renderForwards();
  setPanelVisible('browser', true);
  logBrowserConsole('info', `Detected local server on ${url}`);
  setStatus(`Detected local server on :${port}`);
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
  el.forwardList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const activeProfileId = state.activeProfile?.id;
  let rows = 0;
  for (const item of state.detectedPorts.filter((port) => port.profileId === activeProfileId)) {
    const row = document.createElement('div');
    row.className = 'forward-row pending';
    row.innerHTML = `<button class="load">Open</button><span>Detected :${item.port}</span><button class="stop">Ignore</button>`;
    row.querySelector<HTMLButtonElement>('.load')!.addEventListener('click', () => void openPort(item.port, 'manual'));
    row.querySelector<HTMLButtonElement>('.stop')!.addEventListener('click', () => {
      state.detectedPorts = state.detectedPorts.filter((port) => port.id !== item.id);
      renderForwards();
    });
    fragment.append(row);
    rows += 1;
  }

  for (const forward of state.forwards) {
    if (isPreviewProxyLocalPort(forward.localPort)) continue;
    const row = document.createElement('div');
    row.className = 'forward-row';
    row.innerHTML = `<button class="load">:${forward.localPort}</button><span>Forwarded to ${escapeHtml(forward.targetHost)}:${forward.remotePort}</span><button class="stop">Stop</button>`;
    row.querySelector<HTMLButtonElement>('.load')!.addEventListener('click', () => void openLocalBrowserTab(forward.url, portTabLabel(forward.localPort)));
    row.querySelector<HTMLButtonElement>('.stop')!.addEventListener('click', async () => {
      await api.stopPortForward(forward.id).catch((error) => setStatus(String(error), true));
      state.forwards = state.forwards.filter((item) => item.id !== forward.id);
      renderForwards();
    });
    fragment.append(row);
    rows += 1;
  }
  if (!rows) {
    const row = document.createElement('div');
    row.className = 'forward-row empty';
    row.textContent = 'No active manual forwards.';
    fragment.append(row);
  }
  el.forwardList.append(fragment);
}

function loadPreview(url: string) {
  openBrowserTab(url);
}

function previewFrames(workspaceId?: string) {
  const frames = Array.from(el.browserShell.querySelectorAll<HTMLIFrameElement>('iframe.preview-frame'));
  if (!workspaceId) return frames;
  return frames.filter((frame) => frame.dataset.browserWorkspaceId === workspaceId);
}

function browserFrameForTab(id: string, workspaceId = state.activeWorkspaceId) {
  return previewFrames(workspaceId).find((frame) => frame.dataset.browserTabId === id) ?? null;
}

function activeBrowserFrame() {
  return browserFrameForTab(state.activeBrowserTabId);
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
  frame.addEventListener('load', () => logBrowserConsole('info', `Loaded ${frame.dataset.displayUrl || state.previewUrl}`));
  frame.addEventListener('error', () => logBrowserConsole('error', `Failed to load ${frame.dataset.displayUrl || state.previewUrl}`));
}

function showBrowserFrame(tab: BrowserTab) {
  const frame = ensureBrowserFrame(tab);
  for (const item of previewFrames()) {
    const active = item === frame;
    item.classList.toggle('hidden', !active);
    item.classList.toggle('active', active);
  }
  el.browserShell.classList.add('has-preview');
  return frame;
}

function loadBrowserFrame(tab: BrowserTab, options: { hard?: boolean } = {}) {
  if (!USE_PREVIEW_PROXY_BROWSER && !USE_EDGE_CDP_BROWSER) {
    tab.frameUrl = tab.url;
  }
  const frame = showBrowserFrame(tab);
  const frameUrl = tab.frameUrl ?? tab.url;
  frame.dataset.displayUrl = tab.url;
  if (!options.hard && frame.dataset.loadedUrl === frameUrl) return frame;
  frame.src = options.hard ? withPreviewCacheBuster(frameUrl) : frameUrl;
  frame.dataset.loadedUrl = frameUrl;
  return frame;
}

function removeBrowserFrame(id: string) {
  const frame = browserFrameForTab(id);
  if (!frame) return;
  if (frame === el.previewFrame) {
    frame.removeAttribute('src');
    delete frame.dataset.browserTabId;
    delete frame.dataset.browserWorkspaceId;
    delete frame.dataset.loadedUrl;
    frame.classList.add('hidden');
    frame.classList.remove('active');
    return;
  }
  frame.remove();
}

function clearBrowserFrames(workspaceId = state.activeWorkspaceId) {
  for (const frame of previewFrames(workspaceId)) {
    if (frame === el.previewFrame) {
      frame.removeAttribute('src');
      delete frame.dataset.browserTabId;
      delete frame.dataset.browserWorkspaceId;
      delete frame.dataset.loadedUrl;
      frame.classList.add('hidden');
      frame.classList.remove('active');
    } else {
      frame.remove();
    }
  }
}

function hideBrowserFramesForWorkspace(workspaceId: string) {
  for (const frame of previewFrames(workspaceId)) {
    frame.classList.add('hidden');
    frame.classList.remove('active');
  }
}

function hideAllBrowserFrames() {
  for (const frame of previewFrames()) {
    frame.classList.add('hidden');
    frame.classList.remove('active');
  }
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

function loadBrowserTabThroughPreviewProxy(tab: BrowserTab) {
  showBrowserFrame(tab);
  void previewFrameUrl(tab.url).then((frameUrl) => {
    if (tab.frameUrl !== frameUrl) {
      tab.frameUrl = frameUrl;
      const frame = browserFrameForTab(tab.id);
      if (frame) delete frame.dataset.loadedUrl;
    }
    if (state.activeBrowserTabId === tab.id) loadBrowserFrame(tab);
  }).catch((error) => setStatus(`Preview proxy failed: ${String(error)}`, true));
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
  el.edgePreviewCanvas.classList.toggle('hidden', !visible);
  el.browserShell.classList.toggle('edge-preview-active', visible);
  if (visible) {
    hideAllBrowserFrames();
    el.browserShell.classList.add('has-preview');
    applyEdgePreviewSizing();
    return;
  }
  el.edgePreviewStatus.classList.add('hidden');
  el.browserShell.classList.remove('edge-preview-active');
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
  const tab = state.browserTabs.find((item) => item.id === tabId);
  if (!tab || tab.url === url) return;
  tab.url = url;
  tab.label = browserTabLabel(url);
  if (state.activeBrowserTabId === tabId) {
    state.previewUrl = url;
    el.previewUrl.value = url;
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
    const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === state.browserDeviceId) ?? BROWSER_DEVICE_PRESETS[0];
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
    const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === state.browserDeviceId) ?? BROWSER_DEVICE_PRESETS[0];
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
  el.edgePreviewCanvas.style.width = `${width}px`;
  el.edgePreviewCanvas.style.height = `${height}px`;
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
  try {
    openBrowserTab(url, label, await previewFrameUrl(url));
  } catch (error) {
    setStatus(`Preview proxy failed: ${String(error)}`, true);
    openBrowserTab(url, label);
  }
}

async function previewFrameUrl(url: string) {
  const parsed = localHttpPreviewUrl(url);
  if (!parsed) return url;
  const origin = normalizedLocalPreviewOrigin(parsed);
  const proxy = await ensurePreviewProxy(origin);
  return `${proxy.url}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function ensurePreviewProxy(targetOrigin: string) {
  const existing = state.previewProxies.find((proxy) => proxy.targetHost === targetOrigin);
  if (existing) {
    try {
      if (await api.probeLocalHttpUrl(existing.url)) return existing;
    } catch {
      // Treat probe failures as stale proxy state and recreate below.
    }
    state.previewProxies = state.previewProxies.filter((proxy) => proxy.id !== existing.id);
    void api.stopPortForward(existing.id).catch(() => undefined);
    logBrowserConsole('warn', `Preview proxy ${existing.url} was stale; reopening ${targetOrigin}`);
  }
  const proxy = await api.startPreviewProxy(targetOrigin);
  state.previewProxies.push(proxy);
  logBrowserConsole('info', `Preview proxy ${proxy.url} -> ${targetOrigin}`);
  return proxy;
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

function isPreviewProxyLocalPort(port: number) {
  return state.previewProxies.some((proxy) => proxy.localPort === port);
}

function ensureActiveBrowserFrame() {
  if (getPanel('browser').classList.contains('hidden')) return;
  const active = state.browserTabs.find((tab) => tab.id === state.activeBrowserTabId) ?? state.browserTabs[0];
  if (active) activateBrowserTab(active.id);
}

function openBrowserTab(url: string, label = browserTabLabel(url), frameUrl = url) {
  if (!url) return;
  const existing = state.browserTabs.find((tab) => tab.url === url);
  if (existing) {
    existing.frameUrl = frameUrl;
    existing.label = label;
    activateBrowserTab(existing.id);
    return;
  }

  const tab: BrowserTab = { id: makeBrowserTabId(), url, label, frameUrl };
  state.browserTabs.push(tab);
  logBrowserConsole('info', `Opened preview tab ${url}`);
  activateBrowserTab(tab.id);
  setPanelVisible('browser', true);
}

function activateBrowserTab(id: string) {
  const tab = state.browserTabs.find((item) => item.id === id);
  if (!tab) return;
  const alreadyActive = state.activeBrowserTabId === tab.id;
  state.activeBrowserTabId = tab.id;
  state.previewUrl = tab.url;
  el.previewUrl.value = tab.url;
  if (USE_EDGE_CDP_BROWSER) {
    renderBrowserTabs();
    setEdgePreviewVisible(true);
    void loadEdgeBrowserTab(tab).catch((error) => {
      logBrowserConsole('error', `Edge preview failed: ${String(error)}`);
      setStatus(`Edge preview failed: ${String(error)}`, true);
      loadBrowserTabFallback(tab);
    });
    if (!alreadyActive) logBrowserConsole('info', `Activated tab ${tab.url}`);
    saveActiveWorkspaceSnapshot();
    return;
  }
  if (USE_PREVIEW_PROXY_BROWSER && localHttpPreviewUrl(tab.url)) {
    loadBrowserTabThroughPreviewProxy(tab);
  } else {
    loadBrowserFrame(tab);
  }
  renderBrowserTabs();
  if (!alreadyActive) logBrowserConsole('info', `Activated tab ${tab.url}`);
  saveActiveWorkspaceSnapshot();
}

function closeBrowserTab(id: string) {
  const index = state.browserTabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = state.activeBrowserTabId === id;
  const closedTab = state.browserTabs[index];
  const closedUrl = closedTab.url;
  closeEdgeBrowserTab(closedTab);
  state.browserTabs.splice(index, 1);
  removeBrowserFrame(id);
  logBrowserConsole('info', `Closed tab ${closedUrl}`);
  if (wasActive) {
    const next = state.browserTabs[index] ?? state.browserTabs[index - 1];
    if (next) {
      activateBrowserTab(next.id);
    } else {
      state.activeBrowserTabId = '';
      state.previewUrl = '';
      el.previewUrl.value = '';
      clearBrowserFrames();
      el.browserShell.classList.remove('has-preview');
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
  el.browserTabs.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const tab of state.browserTabs) {
    const item = document.createElement('div');
    item.className = `browser-tab${tab.id === state.activeBrowserTabId ? ' active' : ''}`;
    item.title = tab.url;
    item.innerHTML = `<button class="tab-label">${escapeHtml(tab.label)}</button><button class="tab-close" title="Close tab" aria-label="Close tab">x</button>`;
    item.querySelector<HTMLButtonElement>('.tab-label')!.addEventListener('click', () => activateBrowserTab(tab.id));
    item.querySelector<HTMLButtonElement>('.tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      closeBrowserTab(tab.id);
    });
    fragment.append(item);
  }
  el.browserTabs.append(fragment);
}

function setBrowserConsoleVisible(visible: boolean) {
  state.browserConsoleVisible = visible;
  el.browserWorkspace.classList.toggle('console-visible', visible);
  el.browserConsole.classList.toggle('hidden', !visible);
  el.browserConsoleToggle.classList.toggle('active', visible);
  el.browserConsoleToggle.setAttribute('aria-pressed', String(visible));
  applyBrowserConsoleSize();
  if (visible) renderBrowserConsole();
  saveActiveWorkspaceSnapshot();
}

function setBrowserConsolePosition(position: BrowserConsolePosition) {
  if (!['bottom', 'right', 'top', 'left'].includes(position)) return;
  state.browserConsolePosition = position;
  el.browserConsolePosition.value = position;
  el.browserWorkspace.classList.remove('console-bottom', 'console-right', 'console-top', 'console-left');
  el.browserWorkspace.classList.add(`console-${position}`);
  applyBrowserConsoleSize();
  if (state.browserConsoleVisible) logBrowserConsole('info', `Console moved to ${position}`);
  saveActiveWorkspaceSnapshot();
}

function applyBrowserConsoleSize() {
  state.browserConsoleSize = clamp(state.browserConsoleSize || 0.34, 0.18, 0.72);
  el.browserWorkspace.style.setProperty('--browser-console-size', `${(state.browserConsoleSize * 100).toFixed(2)}%`);
}

function startBrowserConsoleResize(event: PointerEvent) {
  if (event.button !== 0 || !state.browserConsoleVisible) return;
  event.preventDefault();
  event.stopPropagation();
  activateBrowserPanel();
  el.browserConsoleResizer.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    const rect = el.browserWorkspace.getBoundingClientRect();
    const position = state.browserConsolePosition;
    const raw = position === 'bottom'
      ? (rect.bottom - moveEvent.clientY) / rect.height
      : position === 'top'
        ? (moveEvent.clientY - rect.top) / rect.height
        : position === 'right'
          ? (rect.right - moveEvent.clientX) / rect.width
          : (moveEvent.clientX - rect.left) / rect.width;
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
  const entry = {
    id: makeBrowserTabId(),
    time: new Date().toTimeString().slice(0, 8),
    level,
    message
  };
  state.browserConsoleLogs.push(entry);
  if (state.browserConsoleLogs.length > 250) state.browserConsoleLogs.shift();
  if (state.browserConsoleVisible) renderBrowserConsole();
  if (options.scanForLocalPorts) maybeAutoForwardBrowserLocalUrl(message);
}

function renderBrowserConsole() {
  if (!state.browserConsoleLogs.length) {
    el.browserConsoleLog.innerHTML = '<div class="browser-console-empty">No console events yet</div>';
    return;
  }

  el.browserConsoleLog.innerHTML = state.browserConsoleLogs
    .map((entry) => `
      <div class="browser-console-line ${entry.level}">
        <span class="browser-console-time">${escapeHtml(entry.time)}</span>
        <span class="browser-console-level">${entry.level}</span>
        <span class="browser-console-message">${escapeHtml(entry.message)}</span>
      </div>
    `)
    .join('');
  el.browserConsoleLog.scrollTop = el.browserConsoleLog.scrollHeight;
}

function handleBrowserConsoleMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  const openUrl = (data as { __simpleVibeOpenUrl?: unknown }).__simpleVibeOpenUrl;
  if (typeof openUrl === 'string' && openUrl.trim()) {
    void openPreviewValue(openUrl.trim());
    return;
  }
  const refresh = (data as { __simpleVibeRefresh?: unknown }).__simpleVibeRefresh;
  if (refresh && typeof refresh === 'object') {
    refreshPreview(Boolean((refresh as { hard?: unknown }).hard));
    return;
  }
  const contextMenu = (data as { __simpleVibeContextMenu?: unknown }).__simpleVibeContextMenu;
  if (contextMenu && typeof contextMenu === 'object') {
    const payload = contextMenu as { x?: unknown; y?: unknown };
    showBrowserContextMenuFromFrame(Number(payload.x), Number(payload.y));
    return;
  }
  const payload = (data as { simpleVibeConsole?: unknown; __simpleVibeConsole?: unknown }).simpleVibeConsole
    ?? (data as { simpleVibeConsole?: unknown; __simpleVibeConsole?: unknown }).__simpleVibeConsole;
  if (!payload || typeof payload !== 'object') return;

  const record = payload as { level?: string; message?: unknown; args?: unknown[] };
  const level = record.level === 'warn' || record.level === 'error' ? record.level : 'info';
  const message = record.args?.map(formatConsoleValue).join(' ') ?? formatConsoleValue(record.message ?? '');
  if (message) logBrowserConsole(level, message, { scanForLocalPorts: true });
}

function maybeAutoForwardBrowserLocalUrl(message: string) {
  if (!state.activeProfile || state.activeProfile.kind === 'windows') return;
  const matches = message.matchAll(/\b(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})\b/gi);
  for (const match of matches) {
    const port = Number(match[1]);
    if (!isPreviewPort(port)) continue;
    if (isPreviewProxyLocalPort(port)) continue;
    if (state.forwards.some((forward) => forward.remotePort === port)) continue;
    const key = `browser-dep:${state.activeProfile.id}:${port}`;
    if (autoForwardingPorts.has(key)) continue;
    autoForwardingPorts.add(key);
    void startForwardForPort(port, 'auto')
      .then((forward) => {
        state.forwards.push(forward);
        renderForwards();
        logBrowserConsole('info', `Auto forwarded browser dependency port ${port}`);
      })
      .catch((error) => logBrowserConsole('warn', `Auto forward for browser dependency port ${port} failed: ${String(error)}`))
      .finally(() => autoForwardingPorts.delete(key));
  }
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
  if (typeof value === 'string') return value;
  if (value == null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function currentBrowserTab() {
  return state.browserTabs.find((tab) => tab.id === state.activeBrowserTabId) ?? null;
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
      el.previewUrl.value = tab.url;
      logBrowserConsole('info', hard ? `Hard refresh ${tab.url}` : `Reload ${tab.url}`);
      setStatus(hard ? `Hard refreshed ${tab.url}` : `Reloaded ${tab.url}`);
    }).catch((error) => setStatus(`Browser reload failed: ${String(error)}`, true));
    return;
  }

  if (USE_EDGE_CDP_BROWSER) {
    activateBrowserTab(tab.id);
    return;
  }

  loadBrowserFrame(tab, { hard });
  state.previewUrl = tab.url;
  el.previewUrl.value = tab.url;
  logBrowserConsole('info', hard ? `Hard refresh ${tab.url}` : `Reload ${tab.url}`);
  setStatus(hard ? `Hard refreshed ${tab.url}` : `Reloaded ${tab.url}`);
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

function normalizePreviewUrl(value: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `http://${value}`;
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

function detectLocalServerPorts(text: string) {
  const ports = new Set<number>();
  const urlPattern = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/gi;
  for (const match of text.matchAll(urlPattern)) {
    const port = Number(match[1]);
    if (isPreviewPort(port)) ports.add(port);
  }

  const listeningPattern = /\b(?:listening|running|available|started|serving|server)\b[^\r\n]{0,80}\b(?:port\s*)?(\d{4,5})\b/gi;
  for (const match of text.matchAll(listeningPattern)) {
    const port = Number(match[1]);
    if (isPreviewPort(port)) ports.add(port);
  }
  return [...ports];
}

function isPreviewPort(port: number) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function trimPortScanBuffer(value: string) {
  return value.length > TERMINAL_PORT_SCAN_LIMIT
    ? value.slice(value.length - TERMINAL_PORT_SCAN_LIMIT)
    : value;
}

function renderBrowserDeviceOptions() {
  el.deviceSelect.innerHTML = '';
  const desktop = document.createElement('option');
  desktop.value = 'desktop';
  desktop.textContent = 'Desktop';
  el.deviceSelect.append(desktop);
  for (const kind of ['phone', 'tablet'] as const) {
    const group = document.createElement('optgroup');
    group.label = kind === 'phone' ? 'Phones' : 'Tablets';
    for (const preset of BROWSER_DEVICE_PRESETS.filter((item) => item.kind === kind)) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.label} (${preset.width} x ${preset.height})`;
      group.append(option);
    }
    el.deviceSelect.append(group);
  }
  el.deviceSelect.value = 'desktop';
}

function setBrowserMode(mode: 'desktop' | 'device') {
  const isDesktop = mode === 'desktop';
  el.browserShell.classList.toggle('device', !isDesktop);
  el.browserShell.classList.toggle('desktop', isDesktop);
  el.desktopSize?.classList.toggle('active', isDesktop);
  el.deviceSelect.classList.toggle('active', !isDesktop);
  el.rotateDevice.disabled = isDesktop;

  if (isDesktop) {
    el.deviceSelect.value = 'desktop';
    previewFrames().forEach((frame) => {
      frame.style.width = '';
      frame.style.height = '';
      frame.title = state.browserTabs.find((tab) => tab.id === frame.dataset.browserTabId)?.label ?? 'local preview';
    });
    el.browserShell.dataset.device = 'Desktop';
    el.rotateDevice.textContent = 'Rotate';
    applyEdgePreviewSizing();
    scheduleConfigureEdgeViewport();
    saveActiveWorkspaceSnapshot();
    return;
  }

  applyBrowserDevice();
  saveActiveWorkspaceSnapshot();
}

function setBrowserDevice(id: string) {
  if (!BROWSER_DEVICE_PRESETS.some((preset) => preset.id === id)) return;
  state.browserDeviceId = id;
  el.deviceSelect.value = id;
  setBrowserMode('device');
}

function rotateBrowserDevice() {
  state.browserOrientation = state.browserOrientation === 'portrait' ? 'landscape' : 'portrait';
  setBrowserMode('device');
}

function applyBrowserDevice() {
  const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === state.browserDeviceId) ?? BROWSER_DEVICE_PRESETS[0];
  const portrait = state.browserOrientation === 'portrait';
  const width = portrait ? preset.width : preset.height;
  const height = portrait ? preset.height : preset.width;
  previewFrames().forEach((frame) => {
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.title = `${preset.label} ${width} x ${height}`;
  });
  el.browserShell.dataset.device = `${preset.label} ${width} x ${height}`;
  el.rotateDevice.textContent = portrait ? 'Rotate' : 'Portrait';
  applyEdgePreviewSizing();
  scheduleConfigureEdgeViewport();
}

function applyBrowserFrameSizing(frame: HTMLIFrameElement) {
  if (el.browserShell.classList.contains('desktop')) {
    frame.style.width = '';
    frame.style.height = '';
    return;
  }
  const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === state.browserDeviceId) ?? BROWSER_DEVICE_PRESETS[0];
  const portrait = state.browserOrientation === 'portrait';
  frame.style.width = `${portrait ? preset.width : preset.height}px`;
  frame.style.height = `${portrait ? preset.height : preset.width}px`;
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
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return normalized.toLocaleLowerCase();
  }
  return normalized;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char] ?? char);
}

init().catch((error) => setStatus(String(error), true));
