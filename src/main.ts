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
import type { ConnectionProfile, ExportJobStatus, ExportProgressEvent, FileEntry, PortForwardResult, TerminalDataEvent, TerminalExitEvent } from './types';
import { parseSecretLines, serializeSecretLines, shouldMaskFile, type SecretLine } from './privacyPolicy';

interface TerminalPane {
  paneId: string;
  widgetId: string;
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
  seenPorts: Set<number>;
  fitFrame?: number;
  lastRows?: number;
  lastCols?: number;
  resizeObserver?: ResizeObserver;
}

interface TerminalWidget {
  widgetId: string;
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
  languageCompartment: import('@codemirror/state').Compartment;
}

type FloatingPanelId = 'explorer' | 'editor' | 'image' | 'browser' | 'notes' | 'calculator';
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

const FLOATING_PANELS: FloatingPanelId[] = ['explorer', 'editor', 'image', 'browser', 'notes', 'calculator'];
const DEFAULT_PANEL_VISIBILITY: Record<FloatingPanelId, boolean> = {
  explorer: true,
  editor: true,
  image: true,
  browser: true,
  notes: false,
  calculator: false
};
const WORKSPACE_STORE_KEY = 'simple-vibe-ide.workspaces.v1';
const MARKET_TICKER_STORE_KEY = 'simple-vibe-ide.marketTicker.v1';
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
const EXPLORER_TYPEAHEAD_TIMEOUT_MS = 900;
const TEXT_FILE_CACHE_LIMIT = 64;
const TEXT_FILE_PREFETCH_MAX_BYTES = 512 * 1024;
const DEFAULT_BROWSER_DEVICE_ID = 'iphone-15';
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
  detectedPorts: [] as DetectedPortItem[],
  browserTabs: [] as BrowserTab[],
  activeBrowserTabId: '',
  previewUrl: '',
  browserDeviceId: DEFAULT_BROWSER_DEVICE_ID,
  browserOrientation: 'portrait' as BrowserOrientation,
  browserConsoleVisible: false,
  browserConsolePosition: 'bottom' as BrowserConsolePosition,
  browserConsoleLogs: [] as BrowserConsoleLog[],
  browserZoom: 1,
  calculatorExpression: '',
  calculatorResult: '',
  calculatorHistory: [] as CalculatorHistoryItem[],
  marketTickers: [] as MarketTickerConfig[],
  marketQuotes: new Map<string, MarketTickerQuote>(),
  marketTickerConnected: false,
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
const noteSaveTimers = new Map<string, number>();
let marketTickerSocket: WebSocket | null = null;
let marketTickerReconnectTimer = 0;
let marketTickerFallbackTimer = 0;
let marketTickerRenderFrame = 0;
let marketTickerReconnectAttempt = 0;
let fileOpenToken = 0;
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
          <span>Browser / Ports</span>
          <span class="spacer"></span>
          <button class="panel-close" data-close-panel="browser" title="Close Browser" aria-label="Close Browser">x</button>
        </div>
        <details class="manual-forward">
          <summary>Manual forward</summary>
          <div class="port-form">
            <input id="remote-port" type="number" min="1" max="65535" placeholder="remote port" />
            <input id="local-port" type="number" min="0" max="65535" placeholder="local=remote" />
            <button id="start-forward">Forward</button>
          </div>
        </details>
        <div class="browser-form">
          <input id="preview-url" placeholder="3000 or http://127.0.0.1:3000" />
          <button id="load-preview">Load</button>
          <button id="reload-preview" title="Reload preview">Reload</button>
          <button id="hard-refresh-preview" title="Reload with a cache-busting local URL">Hard</button>
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
        <div id="forward-list" class="forward-list"></div>
        <div id="browser-workspace" class="browser-workspace console-bottom">
          <div id="browser-shell" class="browser-shell desktop"><iframe id="preview-frame" class="hidden" title="local preview"></iframe></div>
          <section id="browser-console" class="browser-console hidden" aria-label="Preview console">
            <div class="browser-console-toolbar">
              <span>Console</span>
              <button id="clear-browser-console" title="Clear console">Clear</button>
            </div>
            <div id="browser-console-log" class="browser-console-log"></div>
          </section>
        </div>
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
    </main>
  </div>
  <div class="window-controls" aria-label="Window controls" data-no-window-drag>
    <button id="window-minimize" class="window-control" type="button" title="Minimize" aria-label="Minimize" data-window-action="minimize"><span class="window-control-icon minimize" aria-hidden="true"></span></button>
    <button id="window-maximize" class="window-control" type="button" title="Maximize or restore" aria-label="Maximize or restore" data-window-action="toggle-maximize"><span class="window-control-icon maximize" aria-hidden="true"></span></button>
    <button id="window-close" class="window-control close" type="button" title="Close" aria-label="Close" data-window-action="close"><span class="window-control-icon close" aria-hidden="true"></span></button>
  </div>
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
  newShell: document.querySelector<HTMLButtonElement>('#new-shell')!,
  newWindowsShell: document.querySelector<HTMLButtonElement>('#new-windows-shell')!,
  resetLayout: document.querySelector<HTMLButtonElement>('#reset-layout')!,
  marketTickerList: document.querySelector<HTMLDivElement>('#market-ticker-list')!,
  marketSymbolInput: document.querySelector<HTMLInputElement>('#market-symbol-input')!,
  marketAddSymbol: document.querySelector<HTMLButtonElement>('#market-add-symbol')!,
  mainGrid: document.querySelector<HTMLElement>('.main-grid')!,
  newFile: document.querySelector<HTMLButtonElement>('#new-file')!,
  newFolder: document.querySelector<HTMLButtonElement>('#new-folder')!,
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
  browserConsole: document.querySelector<HTMLElement>('#browser-console')!,
  browserConsoleClear: document.querySelector<HTMLButtonElement>('#clear-browser-console')!,
  browserConsoleLog: document.querySelector<HTMLDivElement>('#browser-console-log')!,
  previewFrame: document.querySelector<HTMLIFrameElement>('#preview-frame')!,
  calculatorExpression: document.querySelector<HTMLInputElement>('#calculator-expression')!,
  calculatorResult: document.querySelector<HTMLDivElement>('#calculator-result')!,
  calculatorKeys: document.querySelector<HTMLDivElement>('#calculator-keys')!,
  calculatorHistory: document.querySelector<HTMLDivElement>('#calculator-history')!,
  calculatorClear: document.querySelector<HTMLButtonElement>('#calculator-clear')!
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
  renderMarketTicker();
  setBrowserMode('desktop');
  setBrowserConsolePosition(state.browserConsolePosition);
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
    tab.title = `${workspace.label} - ${workspace.root}${protectedWorkspace ? ' - capture blocked when active' : ''}`;
    const securityTitle = protectedWorkspace ? 'Disable capture block' : 'Block capture while this workspace is active';
    tab.innerHTML = `
      <button class="workspace-tab-label">${escapeHtml(workspace.label)}</button>
      <button class="workspace-tab-security${protectedWorkspace ? ' active' : ''}" title="${securityTitle}" aria-label="${securityTitle}" aria-pressed="${String(protectedWorkspace)}">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 7V5a3 3 0 0 1 6 0v2"></path>
          <rect x="3.5" y="7" width="9" height="7" rx="1.5"></rect>
        </svg>
      </button>
      <button class="workspace-tab-close" title="Close workspace" aria-label="Close workspace">x</button>
    `;
    tab.querySelector<HTMLButtonElement>('.workspace-tab-label')!.addEventListener('click', () => void activateWorkspaceTab(workspace.id));
    tab.querySelector<HTMLButtonElement>('.workspace-tab-security')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleWorkspaceCaptureProtection(workspace.id);
    });
    tab.querySelector<HTMLButtonElement>('.workspace-tab-close')!.addEventListener('click', (event) => {
      event.stopPropagation();
      void closeWorkspaceTab(workspace.id);
    });
    fragment.append(tab);
  }
  el.workspaceTabs.append(fragment);
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
  const id = crypto.randomUUID();
  state.activeWorkspaceId = id;
  state.workspaceCaptureProtected = false;
  state.workspaceSnapshots.unshift(blankWorkspaceSnapshot(id));
  await closeWorkspace();
  persistWorkspaceStore();
  setStatus('New empty workspace');
}

async function closeWorkspaceTab(id: string) {
  const wasActive = state.activeWorkspaceId === id;
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
    await closeWorkspace();
  }
  persistWorkspaceStore();
}

async function activateWorkspaceTab(id: string) {
  if (id === state.activeWorkspaceId && state.workspaceOpen) return;
  await saveAllDirtyNotes();
  saveActiveWorkspaceSnapshot();
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
  const activeTerminalIndex = Math.max(0, state.terminals.findIndex((pane) => pane.paneId === state.activePaneId));
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
    terminals: state.terminals.map((pane) => ({
      title: pane.title.replace(/\s+\(exited\)$/i, ''),
      command: pane.command,
      widgetId: pane.widgetId,
      profileId: pane.profileId,
      cwd: pane.cwd,
      rect: elementLayoutRatio(pane.element)
    })),
    activeTerminalIndex,
    editorTabs: state.editorTabs
      .filter((tab) => tab.file)
      .map((tab) => ({ id: tab.id, path: tab.file!.path, rawMode: tab.file!.rawMode })),
    activeEditorTabId: state.activeEditorTabId,
    editorOpenInNewTab: state.editorOpenInNewTab,
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
    browserTabs: state.browserTabs,
    activeBrowserTabId: state.activeBrowserTabId,
    browserDeviceId: el.browserShell.classList.contains('desktop') ? 'desktop' : state.browserDeviceId,
    browserOrientation: state.browserOrientation,
    browserConsoleVisible: state.browserConsoleVisible,
    browserConsolePosition: state.browserConsolePosition,
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

async function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  const profile = state.profiles.find((item) => item.id === snapshot.profileId) ?? null;
  if (!profile) {
    setStatus(`Workspace profile is unavailable: ${snapshot.label}`, true);
    return;
  }

  restoringWorkspace = true;
  try {
    await closeAllTerminals();
    clearWorkspacePanels();
    state.activeProfile = profile;
    state.workspaceRoot = snapshot.root || profile.root;
    state.currentDir = snapshot.currentDir || state.workspaceRoot;
    state.workspaceOpen = true;
    state.workspaceCaptureProtected = Boolean(snapshot.captureProtected);
    state.explorerOpenMode = snapshot.explorerOpenMode ?? 'single';
    state.showFileSizes = snapshot.showFileSizes ?? true;
    state.editorOpenInNewTab = Boolean(snapshot.editorOpenInNewTab);
    state.imageOpenInNewTab = Boolean(snapshot.imageOpenInNewTab);
    state.notePinned = Boolean(snapshot.notePinned);
    noteOpacity = clamp(snapshot.noteOpacity || 100, 45, 100);
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
    applyBrowserZoom();
    el.profileSelect.value = profile.id;
    el.rootInput.value = state.workspaceRoot;
    el.rootInput.placeholder = profile.kind === 'ssh' ? 'remote working directory' : 'working directory';
    el.editorOpenNewTab.checked = state.editorOpenInNewTab;
    el.imageOpenNewTab.checked = state.imageOpenInNewTab;
    updateExplorerOpenMode();
    updateExplorerFileSizeMode();
    await applyWorkspaceCaptureProtection(state.workspaceCaptureProtected, { quiet: true });

    await openWorkspace(state.currentDir);
    setWorkspaceOpen(true, { preserveVisibility: true });
    restorePanelSnapshots(snapshot.panels);
    await restoreEditorTabs(snapshot);
    restoreImageTabs(snapshot);
    await restoreNoteTabs(snapshot);
    restoreBrowserState(snapshot);
    renderCalculator();

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
          cwd: terminal.cwd || state.currentDir
        });
      } else {
        const widget = await createTerminal(terminal.command, terminal.title || 'shell', {
          rect: terminal.rect,
          focus: false,
          profile: terminalProfile,
          cwd: terminal.cwd || state.currentDir
        });
        if (widget) widgetsBySnapshotId.set(widgetKey, widget);
      }
    }
    const active = state.terminals[clamp(snapshot.activeTerminalIndex || 0, 0, Math.max(0, state.terminals.length - 1))];
    if (active) {
      setActivePane(active.paneId);
      bringPanelToFront(active.element);
    }
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
    setPanelVisible(id, snapshot?.visible ?? true, { skipSave: true });
  }
}

async function restoreEditorTabs(snapshot: WorkspaceSnapshot) {
  state.editorTabs = [];
  for (const tab of snapshot.editorTabs ?? []) {
    const editorTab = createEditorTab(null, false, tab.id);
    try {
      const content = await api.readTextFile(snapshot.profileId, tab.path);
      const masked = shouldMaskFile(tab.path);
      editorTab.file = {
        path: tab.path,
        content,
        masked,
        rawMode: tab.rawMode,
        lines: masked ? parseSecretLines(content) : [],
        dirty: false
      };
    } catch {
      editorTab.file = null;
    }
  }
  if (!state.editorTabs.length) createEditorTab(null, false);
  state.activeEditorTabId = state.editorTabs.some((tab) => tab.id === snapshot.activeEditorTabId)
    ? snapshot.activeEditorTabId
    : state.editorTabs[0].id;
  state.openFile = activeEditorTab().file;
  renderEditorTabs();
  renderEditor();
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
  state.noteTabs = [];
  for (const tab of snapshot.noteTabs ?? []) {
    if (!tab.path) continue;
    let content = '';
    try {
      content = await api.readTextFile(snapshot.profileId, tab.path);
    } catch {
      content = '';
    }
    state.noteTabs.push({
      id: tab.id || crypto.randomUUID(),
      path: tab.path,
      title: tab.title || noteTitleFromPath(tab.path),
      theme: normalizeNoteTheme(tab.theme),
      content,
      dirty: false,
      saving: false,
      lastSavedAt: Date.now()
    });
  }
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
  tab.content = el.notesBody.value;
  tab.dirty = true;
  tab.title = noteTabLabel(tab);
  renderNoteTabs();
  renderNoteStatus();
  scheduleNoteSave(tab, 650);
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

function restoreBrowserState(snapshot: WorkspaceSnapshot) {
  state.browserTabs = Array.isArray(snapshot.browserTabs) ? snapshot.browserTabs : [];
  state.activeBrowserTabId = '';
  state.browserDeviceId = snapshot.browserDeviceId || DEFAULT_BROWSER_DEVICE_ID;
  state.browserOrientation = snapshot.browserOrientation || 'portrait';
  setBrowserConsolePosition(snapshot.browserConsolePosition || 'bottom');
  setBrowserConsoleVisible(Boolean(snapshot.browserConsoleVisible));
  renderBrowserTabs();
  if (state.browserTabs.length) {
    const active = state.browserTabs.find((tab) => tab.id === snapshot.activeBrowserTabId) ?? state.browserTabs[0];
    activateBrowserTab(active.id);
  }
  if (state.browserDeviceId === 'desktop') setBrowserMode('desktop');
  else if (state.browserDeviceId) setBrowserDevice(state.browserDeviceId);
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
  el.reloadPreview.addEventListener('click', () => refreshPreview(false));
  el.hardRefreshPreview.addEventListener('click', () => refreshPreview(true));
  el.newFile.addEventListener('click', () => void createExplorerItem('file'));
  el.newFolder.addEventListener('click', () => void createExplorerItem('dir'));
  el.exportSelected.addEventListener('click', () => void startExportSelectedExplorerEntry());
  el.explorerOpenModeToggle.addEventListener('click', () => {
    state.explorerOpenMode = state.explorerOpenMode === 'single' ? 'double' : 'single';
    updateExplorerOpenMode();
  });
  el.fileSizeToggle.addEventListener('click', () => {
    state.showFileSizes = !state.showFileSizes;
    updateExplorerFileSizeMode();
  });
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
  el.browserConsoleClear.addEventListener('click', () => {
    state.browserConsoleLogs = [];
    renderBrowserConsole();
  });
  el.calculatorExpression.addEventListener('input', () => {
    state.calculatorExpression = el.calculatorExpression.value;
    updateCalculatorPreview();
    saveActiveWorkspaceSnapshot();
  });
  el.calculatorExpression.addEventListener('keydown', handleCalculatorKey);
  el.calculatorClear.addEventListener('click', clearCalculator);
  el.previewFrame.addEventListener('load', () => logBrowserConsole('info', `Loaded ${el.previewFrame.src || state.previewUrl}`));
  el.previewFrame.addEventListener('error', () => logBrowserConsole('error', `Failed to load ${el.previewFrame.src || state.previewUrl}`));
  window.addEventListener('message', handleBrowserConsoleMessage);
  document.addEventListener('paste', handlePaste);
  document.addEventListener('keydown', handleImageClipboardShortcut, true);
  document.addEventListener('keydown', handleEditorSaveShortcut, true);
  document.addEventListener('keydown', handleResizeShortcut, true);
  document.addEventListener('keydown', handleWidgetFocusShortcut, true);
  document.addEventListener('keydown', handleExplorerKeyboard, true);
  document.addEventListener('keydown', handleCalculatorGlobalKey, true);
  document.addEventListener('mousedown', handleExplorerMouseNavigation, true);
  window.addEventListener('resize', () => {
    FLOATING_PANELS.forEach((id) => applyStoredLayoutRatio(getPanel(id)));
    state.terminalWidgets.forEach((widget) => {
      applyStoredLayoutRatio(widget.element);
      scheduleFitTerminalWidget(widget);
    });
    codeView?.requestMeasure();
  });
  window.addEventListener('beforeunload', () => {
    if (marketTickerSocket) marketTickerSocket.close();
  });
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
  for (const widget of state.terminalWidgets) {
    const pane = activePaneForWidget(widget);
    if (pane && widget.element.isConnected) items.push({ kind: 'terminal', pane, element: widget.element });
  }
  addPanelFocusItem(items, 'editor');
  addPanelFocusItem(items, 'notes');
  addPanelFocusItem(items, 'image');
  addPanelFocusItem(items, 'browser');
  addPanelFocusItem(items, 'calculator');
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
    const grip = ensureResizeGrip(panel, id);
    panel.addEventListener('pointerdown', () => {
      bringPanelToFront(panel);
      setKeyboardResizeTarget({ kind: 'panel', id });
    });
    handle?.addEventListener('pointerdown', (event) => startPanelDrag(event, panel));
    grip.addEventListener('pointerdown', (event) => startPanelResize(event, panel, grip));

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

function ensureResizeGrip(panel: HTMLElement, id: FloatingPanelId) {
  const existing = panel.querySelector<HTMLElement>('.panel-resize-grip');
  if (existing) return existing;
  const grip = document.createElement('div');
  grip.className = 'panel-resize-grip';
  grip.title = `Resize ${id}`;
  grip.setAttribute('aria-hidden', 'true');
  panel.append(grip);
  return grip;
}

function ensureTerminalResizeGrip(card: HTMLElement) {
  const existing = card.querySelector<HTMLElement>('.panel-resize-grip');
  if (existing) return existing;
  const grip = document.createElement('div');
  grip.className = 'panel-resize-grip';
  grip.title = 'Resize terminal';
  grip.setAttribute('aria-hidden', 'true');
  card.append(grip);
  return grip;
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
    const rawRect = {
      left: panelRect.left,
      top: panelRect.top,
      width: clamp(panelRect.width + moveEvent.clientX - startX, minWidth, workspace.clientWidth - panelRect.left),
      height: clamp(panelRect.height + moveEvent.clientY - startY, minHeight, workspace.clientHeight - panelRect.top)
    };
    applyPanelRect(panel, snapPanelRect(panel, rawRect, { resizeX: true, resizeY: true }));
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
  mode: { moveX?: boolean; moveY?: boolean; resizeX?: boolean; resizeY?: boolean }
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
  if (mode.resizeX) {
    const snappedRight = snapEdge(next.left + next.width, guides.x);
    if (snappedRight !== null) next.width = snappedRight - next.left;
  }
  if (mode.resizeY) {
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
  await closeAllTerminals();
  clearWorkspacePanels();
  await openWorkspace(path);
  setWorkspaceOpen(true);
  await createTerminal(null, 'shell');
  if (!state.activeWorkspaceId) state.activeWorkspaceId = crypto.randomUUID();
  saveActiveWorkspaceSnapshot();
}

async function closeWorkspace() {
  await saveAllDirtyNotes();
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
  await closeAllTerminals();
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

function clearWorkspacePanels() {
  codeView?.destroy();
  codeView = null;
  state.entries = [];
  state.explorerExpanded = new Set();
  state.explorerChildren = new Map();
  state.explorerLoading = new Set();
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
  state.previewUrl = '';
  state.forwards = [];
  state.detectedPorts = [];
  state.browserTabs = [];
  state.activeBrowserTabId = '';
  state.browserConsoleLogs = [];
  el.previewUrl.value = '';
  el.previewFrame.removeAttribute('src');
  el.previewFrame.classList.add('hidden');
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
  el.newShell.disabled = !open;
  el.shellNewTab.disabled = !open;
  el.shellTabs.classList.add('hidden');
  el.resetLayout.disabled = !open;
  document.querySelectorAll<HTMLButtonElement>('[data-llm]').forEach((button) => {
    button.disabled = !open;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-toggle-panel]').forEach((button) => {
    button.disabled = !open;
  });
  el.newFile.disabled = !open;
  el.newFolder.disabled = !open;
  el.exportSelected.disabled = !open;

  if (!options.preserveVisibility) {
    for (const id of FLOATING_PANELS) {
      setPanelVisible(id, open && DEFAULT_PANEL_VISIBILITY[id], { skipSave: true });
    }
  }
  if (!open) setKeyboardResizeTarget({ kind: 'ide' });
  renderShellTabs();
}

async function loadDirectory(path: string) {
  if (!state.activeProfile) return;
  setStatus(`Loading ${path}...`);
  try {
    state.entries = await api.listDirectory(state.activeProfile.id, path);
    state.currentDir = path;
    state.explorerExpanded = new Set([path]);
    state.explorerChildren = new Map();
    state.explorerLoading = new Set();
    state.explorerSelectedPath = '';
    state.explorerTypeahead = '';
    state.explorerTypeaheadAt = 0;
    renderExplorer();
    refreshTitle();
    setStatus('Directory loaded');
    saveActiveWorkspaceSnapshot();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderExplorer() {
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

  el.fileList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  renderExplorerRows(fragment, state.entries, 0);
  el.fileList.append(fragment);
  updateExplorerSelection(false);
  renderExportJobs();
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

function renderExplorerRows(fragment: DocumentFragment, entries: FileEntry[], depth: number) {
  for (const entry of entries) {
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
    row.addEventListener('pointerenter', () => scheduleTextFilePrefetch(entry));
    row.addEventListener('pointerdown', () => {
      selectExplorerEntry(entry.path, false);
      scheduleTextFilePrefetch(entry, 0);
    });
    row.addEventListener('focus', () => {
      selectExplorerEntry(entry.path, false);
      scheduleTextFilePrefetch(entry, 0);
    });
    row.addEventListener('click', () => {
      if (state.explorerOpenMode === 'single') openExplorerEntry(entry);
      else selectExplorerEntry(entry.path, false);
    });
    row.addEventListener('dblclick', () => openExplorerEntry(entry));
    fragment.append(row);

    if (entry.kind === 'dir' && state.explorerExpanded.has(entry.path)) {
      renderExplorerRows(fragment, state.explorerChildren.get(entry.path) ?? [], depth + 1);
    }
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

  try {
    state.explorerLoading.add(entry.path);
    const children = await api.listDirectory(state.activeProfile.id, entry.path);
    state.explorerChildren.set(entry.path, children);
    state.explorerExpanded.add(entry.path);
    setStatus(`Expanded ${entry.name}`);
  } catch (error) {
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
    if (kind === 'file' && !shouldMaskFile(path)) cacheTextFile(state.activeProfile.id, path, '');
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
  const children = await api.listDirectory(state.activeProfile.id, path);
  state.explorerChildren.set(path, children);
  state.explorerExpanded.add(path);
  return children;
}

async function reloadExplorerDirectory(path: string) {
  if (!state.activeProfile) return;
  if (path === state.currentDir) {
    const selected = state.explorerSelectedPath;
    state.entries = await api.listDirectory(state.activeProfile.id, path);
    state.explorerSelectedPath = selected;
    renderExplorer();
    return;
  }

  const children = await api.listDirectory(state.activeProfile.id, path);
  state.explorerChildren.set(path, children);
  state.explorerExpanded.add(path);
  renderExplorer();
}

function moveExplorerChildCache(oldPath: string, newPath: string) {
  const children = state.explorerChildren.get(oldPath);
  if (children) {
    state.explorerChildren.delete(oldPath);
    state.explorerChildren.set(newPath, children);
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
  let selectedRow: HTMLElement | null = null;
  el.fileList.querySelectorAll<HTMLElement>('.file-row').forEach((row) => {
    const selected = sameExplorerPath(row.dataset.path ?? '', state.explorerSelectedPath);
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
    if (selected) selectedRow = row;
  });
  const rowToReveal = selectedRow as HTMLElement | null;
  if (scrollIntoView && rowToReveal) rowToReveal.scrollIntoView({ block: 'nearest' });
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
  const fragment = document.createDocumentFragment();
  for (const tab of state.editorTabs) {
    const item = document.createElement('div');
    item.className = `widget-tab${tab.id === state.activeEditorTabId ? ' active' : ''}`;
    item.title = tab.file?.path ?? 'Empty editor';
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
  if (!tab.file) return 'Empty';
  const name = tab.file.path.split(/[\\/]/).filter(Boolean).pop() ?? tab.file.path;
  return `${name}${tab.file.dirty ? ' *' : ''}`;
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

  setStatus(`Opening ${path}...`);
  try {
    syncActiveEditorTabFromView();
    const existing = state.editorTabs.find((tab) => tab.file?.path === path);
    if (existing) {
      activateEditorTab(existing.id);
      setStatus('File opened');
      return;
    }

    showEditorLoading(path);
    warmEditorForPath(path);
    const content = await readTextFileCached(profile.id, path);
    if (openToken !== fileOpenToken || state.activeProfile?.id !== profile.id) return;
    const masked = shouldMaskFile(path);
    const file = {
      path,
      content,
      masked,
      rawMode: false,
      lines: masked ? parseSecretLines(content) : [],
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
    setStatus(String(error), true);
  }
}

function showEditorLoading(path: string) {
  setPanelVisible('editor', true, { skipSave: true });
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
  if (shouldMaskFile(path)) return api.readTextFile(profileId, path);
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
  if (shouldMaskFile(path)) return;
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
  state.openFile = activeEditorTab().file;
  const file = state.openFile;
  el.editorBody.innerHTML = '';
  el.editorBody.classList.remove('empty');
  el.toggleRaw.classList.toggle('hidden', !file?.masked);
  el.saveFile.disabled = !file;

  if (!file) {
    el.editorLabel.textContent = 'Editor';
    el.editorBody.textContent = 'Open a file from Explorer.';
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
    for (const line of file.lines) {
      if (line.kind === 'kv') {
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
        reveal.textContent = line.reveal ? '🙈' : '👁';
        reveal.title = line.reveal ? 'Hide value' : 'Reveal value';
        reveal.addEventListener('click', () => {
          line.reveal = !line.reveal;
          renderEditor();
        });
        row.append(key, input, reveal);
        form.append(row);
      } else {
        const raw = document.createElement('textarea');
        raw.className = 'secure-raw-line';
        raw.value = line.original;
        raw.rows = 1;
        raw.spellcheck = false;
        raw.addEventListener('input', () => {
          line.original = raw.value;
          markDirty();
        });
        form.append(raw);
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
    runtime.syntaxHighlighting(runtime.defaultHighlightStyle, { fallback: true }),
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

async function ensureEditorRuntime() {
  editorRuntimePromise ??= Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    import('@codemirror/language')
  ]).then(([stateModule, viewModule, commandsModule, searchModule, languageModule]) => ({
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
    if (shouldMaskFile(file.path)) invalidateTextFileCache(profile.id, file.path);
    else cacheTextFile(profile.id, file.path, content);
    file.content = content;
    file.draftContent = undefined;
    file.lines = file.masked ? parseSecretLines(content) : [];
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
    state.openFile.lines = parseSecretLines(state.openFile.draftContent);
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
  const terminalCwd = options.cwd ?? state.currentDir;
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
  const grip = ensureTerminalResizeGrip(card);
  if (options.rect) applyLayoutRatio(card, options.rect);
  else placeTerminalCard(card, options);

  const widget: TerminalWidget = {
    widgetId,
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
  grip.addEventListener('pointerdown', (event) => {
    startPanelResize(event, card, grip);
    scheduleFitTerminalWidget(widget);
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
  const terminalCwd = options.cwd ?? activePaneForWidget(widget)?.cwd ?? state.currentDir;
  const paneId = crypto.randomUUID();
  const host = document.createElement('div');
  host.className = 'terminal-host hidden';
  host.dataset.paneId = paneId;
  widget.hostStack.append(host);

  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: terminalFontSize,
    theme: { background: '#080b10', foreground: '#d8e0ea' }
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);

  const pane: TerminalPane = {
    paneId,
    widgetId: widget.widgetId,
    title,
    command,
    profileId: terminalProfile.id,
    cwd: terminalCwd,
    term,
    fit,
    element: widget.element,
    host,
    outputBuffer: '',
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
    if (pane.backendId) void api.writeTerminal(pane.backendId, data);
  });
  host.addEventListener('paste', (event) => handleTerminalPaste(event, pane), true);

  pane.resizeObserver = new ResizeObserver(() => scheduleFitTerminal(pane));
  pane.resizeObserver.observe(host);

  try {
    await settleTerminalInitialFit(pane);
    pane.backendId = await api.spawnTerminal(terminalProfile.id, terminalCwd, command, term.rows, term.cols);
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
    const next = remainingInWidget[0] ?? state.terminals[0];
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
  for (const widget of state.terminalWidgets) renderTerminalWidgetTabs(widget);
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
  const pane = state.terminals.find((item) => item.paneId === state.activePaneId);
  return pane ? terminalWidgetForPane(pane) : state.terminalWidgets[0] ?? null;
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
  const cwd = active?.cwd ?? state.currentDir;
  await createTerminalTab(widget, null, 'shell', { profile: profile ?? undefined, cwd });
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
  if (event.key.toLowerCase() !== 'c') return true;
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
    const value = text ?? await readText();
    if (!value || !pane.backendId) return;
    await api.writeTerminal(pane.backendId, value);
  } catch (error) {
    setStatus(`Failed to paste terminal text: ${String(error)}`, true);
  }
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
    openBrowserTab(forward.url, portTabLabel(forward.localPort));
    setStatus(`Forwarding ${forward.localPort} -> ${forward.targetHost}:${forward.remotePort}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

async function openPreviewValue(value: string) {
  if (!value) return;
  const port = parsePreviewPort(value);
  if (port) {
    await openPort(port, 'manual');
    return;
  }
  openBrowserTab(normalizePreviewUrl(value));
}

async function scanTerminalOutputForPorts(pane: TerminalPane, data: string) {
  if (!state.activeProfile) return;
  pane.outputBuffer = trimPortScanBuffer(`${pane.outputBuffer}${stripAnsi(data)}`);
  const ports = detectLocalServerPorts(pane.outputBuffer).filter((port) => !pane.seenPorts.has(port));
  for (const port of ports) {
    pane.seenPorts.add(port);
    queueDetectedPort(port);
  }
}

async function openPort(port: number, source: 'manual' | 'auto') {
  if (!state.activeProfile || !isPreviewPort(port)) return;
  const profile = state.activeProfile;
  const key = `${profile.id}:${port}`;
  const existing = state.forwards.find((forward) => forward.remotePort === port);
  if (existing) {
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(profile.id, port));
    renderForwards();
    openBrowserTab(existing.url, portTabLabel(existing.localPort));
    if (source === 'auto') setStatus(`Detected port ${port}; using ${existing.url}`);
    return;
  }

  if (profile.kind === 'windows') {
    const url = `http://127.0.0.1:${port}`;
    state.detectedPorts = state.detectedPorts.filter((item) => item.id !== detectedPortId(profile.id, port));
    renderForwards();
    openBrowserTab(url, portTabLabel(port));
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
    openBrowserTab(forward.url, portTabLabel(forward.localPort));
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
  const profile = state.activeProfile;
  const id = detectedPortId(profile.id, port);
  const url = `http://127.0.0.1:${port}`;
  if (state.detectedPorts.some((item) => item.id === id)) return;
  if (state.browserTabs.some((tab) => tab.url === url)) return;

  state.detectedPorts.push({ id, profileId: profile.id, port, url });
  renderForwards();
  setPanelVisible('browser', true);
  logBrowserConsole('info', `Detected local server on ${url}`);
  setStatus(`Detected port ${port}; open it from Browser / Ports`);
}

function detectedPortId(profileId: string, port: number) {
  return `${profileId}:${port}`;
}

async function startForwardForPort(port: number, source: 'manual' | 'auto') {
  if (!state.activeProfile) throw new Error('No active profile');
  try {
    return await api.startPortForward(state.activeProfile.id, port, port);
  } catch (error) {
    if (source !== 'auto' || state.activeProfile.kind === 'ssh') throw error;
    return api.startPortForward(state.activeProfile.id, port, 0);
  }
}

function renderForwards() {
  el.forwardList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const activeProfileId = state.activeProfile?.id;
  for (const item of state.detectedPorts.filter((port) => port.profileId === activeProfileId)) {
    const row = document.createElement('div');
    row.className = 'forward-row pending';
    row.innerHTML = `<button class="load">Open</button><span>Detected ${item.port} (${escapeHtml(item.url)})</span><button class="stop">Dismiss</button>`;
    row.querySelector<HTMLButtonElement>('.load')!.addEventListener('click', () => void openPort(item.port, 'manual'));
    row.querySelector<HTMLButtonElement>('.stop')!.addEventListener('click', () => {
      state.detectedPorts = state.detectedPorts.filter((port) => port.id !== item.id);
      renderForwards();
    });
    fragment.append(row);
  }

  for (const forward of state.forwards) {
    const row = document.createElement('div');
    row.className = 'forward-row';
    row.innerHTML = `<button class="load">${escapeHtml(forward.url)}</button><span>-> ${escapeHtml(forward.targetHost)}:${forward.remotePort}</span><button class="stop">Stop</button>`;
    row.querySelector<HTMLButtonElement>('.load')!.addEventListener('click', () => openBrowserTab(forward.url, portTabLabel(forward.localPort)));
    row.querySelector<HTMLButtonElement>('.stop')!.addEventListener('click', async () => {
      await api.stopPortForward(forward.id).catch((error) => setStatus(String(error), true));
      state.forwards = state.forwards.filter((item) => item.id !== forward.id);
      renderForwards();
    });
    fragment.append(row);
  }
  el.forwardList.append(fragment);
}

function loadPreview(url: string) {
  openBrowserTab(url);
}

function openBrowserTab(url: string, label = browserTabLabel(url)) {
  if (!url) return;
  const existing = state.browserTabs.find((tab) => tab.url === url);
  if (existing) {
    activateBrowserTab(existing.id);
    return;
  }

  const tab = { id: makeBrowserTabId(), url, label };
  state.browserTabs.push(tab);
  logBrowserConsole('info', `Opened preview tab ${url}`);
  activateBrowserTab(tab.id);
  setPanelVisible('browser', true);
}

function activateBrowserTab(id: string) {
  const tab = state.browserTabs.find((item) => item.id === id);
  if (!tab) return;
  state.activeBrowserTabId = tab.id;
  state.previewUrl = tab.url;
  el.previewUrl.value = tab.url;
  el.browserShell.classList.add('has-preview');
  el.previewFrame.classList.remove('hidden');
  el.previewFrame.src = tab.url;
  renderBrowserTabs();
  logBrowserConsole('info', `Activated tab ${tab.url}`);
  saveActiveWorkspaceSnapshot();
}

function closeBrowserTab(id: string) {
  const index = state.browserTabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = state.activeBrowserTabId === id;
  const closedUrl = state.browserTabs[index].url;
  state.browserTabs.splice(index, 1);
  logBrowserConsole('info', `Closed tab ${closedUrl}`);
  if (wasActive) {
    const next = state.browserTabs[index] ?? state.browserTabs[index - 1];
    if (next) {
      activateBrowserTab(next.id);
    } else {
      state.activeBrowserTabId = '';
      state.previewUrl = '';
      el.previewUrl.value = '';
      el.previewFrame.removeAttribute('src');
      el.previewFrame.classList.add('hidden');
      el.browserShell.classList.remove('has-preview');
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
  if (visible) renderBrowserConsole();
  saveActiveWorkspaceSnapshot();
}

function setBrowserConsolePosition(position: BrowserConsolePosition) {
  if (!['bottom', 'right', 'top', 'left'].includes(position)) return;
  state.browserConsolePosition = position;
  el.browserConsolePosition.value = position;
  el.browserWorkspace.classList.remove('console-bottom', 'console-right', 'console-top', 'console-left');
  el.browserWorkspace.classList.add(`console-${position}`);
  if (state.browserConsoleVisible) logBrowserConsole('info', `Console moved to ${position}`);
  saveActiveWorkspaceSnapshot();
}

function logBrowserConsole(level: BrowserConsoleLog['level'], message: string) {
  const entry = {
    id: makeBrowserTabId(),
    time: new Date().toTimeString().slice(0, 8),
    level,
    message
  };
  state.browserConsoleLogs.push(entry);
  if (state.browserConsoleLogs.length > 250) state.browserConsoleLogs.shift();
  if (state.browserConsoleVisible) renderBrowserConsole();
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
  const payload = (data as { simpleVibeConsole?: unknown; __simpleVibeConsole?: unknown }).simpleVibeConsole
    ?? (data as { simpleVibeConsole?: unknown; __simpleVibeConsole?: unknown }).__simpleVibeConsole;
  if (!payload || typeof payload !== 'object') return;

  const record = payload as { level?: string; message?: unknown; args?: unknown[] };
  const level = record.level === 'warn' || record.level === 'error' ? record.level : 'info';
  const message = record.args?.map(formatConsoleValue).join(' ') ?? formatConsoleValue(record.message ?? '');
  if (message) logBrowserConsole(level, message);
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

function refreshPreview(hard: boolean) {
  const tab = currentBrowserTab();
  if (!tab) {
    setStatus('No preview URL to refresh', true);
    return;
  }

  el.browserShell.classList.add('has-preview');
  el.previewFrame.classList.remove('hidden');
  el.previewFrame.src = hard ? withPreviewCacheBuster(tab.url) : tab.url;
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
    el.previewFrame.style.width = '';
    el.previewFrame.style.height = '';
    el.browserShell.dataset.device = 'Desktop';
    el.rotateDevice.textContent = 'Rotate';
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
  el.previewFrame.style.width = `${width}px`;
  el.previewFrame.style.height = `${height}px`;
  el.previewFrame.title = `${preset.label} ${width} x ${height}`;
  el.browserShell.dataset.device = `${preset.label} ${width} x ${height}`;
  el.rotateDevice.textContent = portrait ? 'Rotate' : 'Portrait';
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
