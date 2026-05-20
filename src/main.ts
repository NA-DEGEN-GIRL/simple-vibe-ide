import { listen } from '@tauri-apps/api/event';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { api } from './api';
import type { ConnectionProfile, FileEntry, PortForwardResult, TerminalDataEvent, TerminalExitEvent } from './types';
import { parseSecretLines, serializeSecretLines, shouldMaskFile, type SecretLine } from './privacyPolicy';

interface TerminalPane {
  paneId: string;
  backendId?: string;
  title: string;
  command: string | null;
  term: Terminal;
  fit: FitAddon;
  element: HTMLElement;
  resizeObserver?: ResizeObserver;
}

interface OpenFileState {
  path: string;
  content: string;
  masked: boolean;
  rawMode: boolean;
  lines: SecretLine[];
  dirty: boolean;
}

const state = {
  profiles: [] as ConnectionProfile[],
  activeProfile: null as ConnectionProfile | null,
  workspaceRoot: '',
  currentDir: '',
  entries: [] as FileEntry[],
  openFile: null as OpenFileState | null,
  terminals: [] as TerminalPane[],
  activePaneId: '',
  attachmentSession: new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14),
  imageCounter: 0,
  imagePreviewDataUrl: '',
  imagePreviewLabel: 'No image selected',
  forwards: [] as PortForwardResult[],
  previewUrl: ''
};

let codeView: EditorView | null = null;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing app root');

app.innerHTML = `
  <div class="shell">
    <header class="titlebar">
      <div>
        <strong>Simple Vibe IDE</strong>
        <span id="title-context" class="muted">starting...</span>
      </div>
      <div id="status" class="status">Ready</div>
    </header>
    <section class="workspace-bar">
      <label>Profile <select id="profile-select"></select></label>
      <label>Root <input id="root-input" spellcheck="false" /></label>
      <button id="open-root">Open</button>
      <button id="new-shell">+ Shell</button>
      <button data-llm="codex">Codex</button>
      <button data-llm="claude">Claude</button>
      <button data-llm="grok">Grok</button>
      <button data-llm="antigravity">Antigravity</button>
    </section>
    <main class="main-grid">
      <aside class="explorer panel">
        <div class="panel-title">Explorer</div>
        <div id="path-row" class="path-row"></div>
        <div id="file-list" class="file-list"></div>
      </aside>
      <section class="work-area">
        <div id="terminal-grid" class="terminal-grid"></div>
        <section class="editor panel">
          <div class="panel-title editor-title">
            <span id="editor-label">Editor</span>
            <span class="spacer"></span>
            <button id="toggle-raw" class="hidden">Raw</button>
            <button id="save-file" disabled>Save</button>
          </div>
          <div id="editor-body" class="editor-body empty">Open a file from Explorer.</div>
        </section>
      </section>
      <aside class="side-stack">
        <section class="panel image-panel">
          <div class="panel-title">Image Preview / Paste Target</div>
          <div id="image-label" class="image-label">No image selected</div>
          <img id="image-preview" alt="pasted preview" />
          <p class="hint">Paste a screenshot while a terminal pane is active. The file is saved under .vibe-ide/attachments and @tag text is inserted into the active LLM prompt.</p>
        </section>
        <section class="panel browser-panel">
          <div class="panel-title">Browser / Ports</div>
          <div class="port-form">
            <input id="remote-port" type="number" min="1" max="65535" placeholder="remote port" />
            <input id="local-port" type="number" min="0" max="65535" placeholder="local=remote" />
            <button id="start-forward">Forward</button>
          </div>
          <div class="browser-form">
            <input id="preview-url" placeholder="http://127.0.0.1:3000" />
            <button id="load-preview">Load</button>
            <button id="desktop-size">Desktop</button>
            <button id="mobile-size">Mobile</button>
          </div>
          <div id="forward-list" class="forward-list"></div>
          <div id="browser-shell" class="browser-shell desktop"><iframe id="preview-frame" title="local preview"></iframe></div>
          <div class="console-note">Console: iframe preview is lightweight; use app/devtools for full browser console when cross-origin pages block injection.</div>
        </section>
      </aside>
    </main>
  </div>
`;

const el = {
  titleContext: document.querySelector<HTMLSpanElement>('#title-context')!,
  status: document.querySelector<HTMLDivElement>('#status')!,
  profileSelect: document.querySelector<HTMLSelectElement>('#profile-select')!,
  rootInput: document.querySelector<HTMLInputElement>('#root-input')!,
  openRoot: document.querySelector<HTMLButtonElement>('#open-root')!,
  newShell: document.querySelector<HTMLButtonElement>('#new-shell')!,
  fileList: document.querySelector<HTMLDivElement>('#file-list')!,
  pathRow: document.querySelector<HTMLDivElement>('#path-row')!,
  terminalGrid: document.querySelector<HTMLDivElement>('#terminal-grid')!,
  editorLabel: document.querySelector<HTMLSpanElement>('#editor-label')!,
  editorBody: document.querySelector<HTMLDivElement>('#editor-body')!,
  saveFile: document.querySelector<HTMLButtonElement>('#save-file')!,
  toggleRaw: document.querySelector<HTMLButtonElement>('#toggle-raw')!,
  imagePreview: document.querySelector<HTMLImageElement>('#image-preview')!,
  imageLabel: document.querySelector<HTMLDivElement>('#image-label')!,
  remotePort: document.querySelector<HTMLInputElement>('#remote-port')!,
  localPort: document.querySelector<HTMLInputElement>('#local-port')!,
  startForward: document.querySelector<HTMLButtonElement>('#start-forward')!,
  previewUrl: document.querySelector<HTMLInputElement>('#preview-url')!,
  loadPreview: document.querySelector<HTMLButtonElement>('#load-preview')!,
  desktopSize: document.querySelector<HTMLButtonElement>('#desktop-size')!,
  mobileSize: document.querySelector<HTMLButtonElement>('#mobile-size')!,
  forwardList: document.querySelector<HTMLDivElement>('#forward-list')!,
  browserShell: document.querySelector<HTMLDivElement>('#browser-shell')!,
  previewFrame: document.querySelector<HTMLIFrameElement>('#preview-frame')!
};

function setStatus(message: string, danger = false) {
  el.status.textContent = message;
  el.status.classList.toggle('danger', danger);
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
    pane?.term.write(event.payload.data);
  });
  await listen<TerminalExitEvent>('terminal-exit', (event) => {
    const pane = state.terminals.find((item) => item.backendId === event.payload.id);
    if (pane) pane.title = `${pane.title} (exited)`;
  });

  state.profiles = await api.listProfiles();
  renderProfiles();
  const first = state.profiles[0];
  if (!first) throw new Error('no connection profiles available');
  selectProfile(first.id);
  await openWorkspace(state.workspaceRoot);
  await createTerminal(null, 'shell');
  bindEvents();
  setStatus('Ready');
}

function renderProfiles() {
  el.profileSelect.innerHTML = '';
  for (const profile of state.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    el.profileSelect.append(option);
  }
}

function selectProfile(profileId: string) {
  const profile = state.profiles.find((item) => item.id === profileId) ?? state.profiles[0];
  state.activeProfile = profile;
  state.workspaceRoot = profile.root;
  state.currentDir = profile.root;
  el.profileSelect.value = profile.id;
  el.rootInput.value = profile.root;
  refreshTitle();
}

function bindEvents() {
  el.profileSelect.addEventListener('change', async () => {
    selectProfile(el.profileSelect.value);
    await openWorkspace(state.workspaceRoot);
  });
  el.openRoot.addEventListener('click', async () => {
    state.workspaceRoot = el.rootInput.value.trim() || state.activeProfile?.root || '.';
    await openWorkspace(state.workspaceRoot);
  });
  el.newShell.addEventListener('click', () => createTerminal(null, 'shell'));
  document.querySelectorAll<HTMLButtonElement>('[data-llm]').forEach((button) => {
    button.addEventListener('click', () => createTerminal(button.dataset.llm ?? null, button.dataset.llm ?? 'llm'));
  });
  el.saveFile.addEventListener('click', saveOpenFile);
  el.toggleRaw.addEventListener('click', toggleRawMode);
  el.startForward.addEventListener('click', startForward);
  el.loadPreview.addEventListener('click', () => loadPreview(el.previewUrl.value.trim()));
  el.desktopSize.addEventListener('click', () => setBrowserMode('desktop'));
  el.mobileSize.addEventListener('click', () => setBrowserMode('mobile'));
  document.addEventListener('paste', handlePaste);
  window.addEventListener('resize', () => state.terminals.forEach(fitTerminal));
}

async function openWorkspace(path: string) {
  state.currentDir = path;
  await loadDirectory(path);
  refreshTitle();
}

async function loadDirectory(path: string) {
  if (!state.activeProfile) return;
  setStatus(`Loading ${path}...`);
  try {
    state.entries = await api.listDirectory(state.activeProfile.id, path);
    state.currentDir = path;
    renderExplorer();
    refreshTitle();
    setStatus('Directory loaded');
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderExplorer() {
  el.pathRow.innerHTML = '';
  const up = document.createElement('button');
  up.textContent = '..';
  up.title = 'Parent directory';
  up.addEventListener('click', () => loadDirectory(parentPath(state.currentDir)));
  el.pathRow.append(up, pathBadge(state.currentDir));

  el.fileList.innerHTML = '';
  for (const entry of state.entries) {
    const row = document.createElement('button');
    row.className = `file-row ${entry.kind}`;
    row.innerHTML = `<span>${entry.kind === 'dir' ? '📁' : entry.kind === 'file' ? '📄' : '•'}</span><span>${escapeHtml(entry.name)}</span><small>${entry.kind === 'file' ? formatBytes(entry.size) : ''}</small>`;
    row.addEventListener('click', () => {
      if (entry.kind === 'dir') loadDirectory(entry.path);
      else openFile(entry.path);
    });
    el.fileList.append(row);
  }
}

function pathBadge(path: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'path-badge';
  span.textContent = path;
  return span;
}

async function openFile(path: string) {
  if (!state.activeProfile) return;
  setStatus(`Opening ${path}...`);
  try {
    const content = await api.readTextFile(state.activeProfile.id, path);
    const masked = shouldMaskFile(path);
    state.openFile = {
      path,
      content,
      masked,
      rawMode: false,
      lines: masked ? parseSecretLines(content) : [],
      dirty: false
    };
    renderEditor();
    if (isImagePath(path)) {
      state.imagePreviewDataUrl = '';
      state.imagePreviewLabel = `Image selected: ${path}`;
      renderImagePreview();
    }
    setStatus('File opened');
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderEditor() {
  codeView?.destroy();
  codeView = null;
  const file = state.openFile;
  el.editorBody.innerHTML = '';
  el.editorBody.classList.remove('empty');
  el.toggleRaw.classList.toggle('hidden', !file?.masked);
  el.saveFile.disabled = !file;

  if (!file) {
    el.editorLabel.textContent = 'Editor';
    el.editorBody.textContent = 'Open a file from Explorer.';
    el.editorBody.classList.add('empty');
    return;
  }

  el.editorLabel.textContent = `${file.masked ? '🔒 ' : ''}${file.path}${file.dirty ? ' *' : ''}`;
  el.toggleRaw.textContent = file.rawMode ? 'Secure form' : 'Raw reveal';

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
    el.editorBody.append(form);
    return;
  }

  const mount = document.createElement('div');
  mount.className = 'code-mount';
  el.editorBody.append(mount);
  codeView = new EditorView({
    state: EditorState.create({
      doc: file.rawMode && file.masked ? serializeSecretLines(file.lines) : file.content,
      extensions: editorExtensions(file.path)
    }),
    parent: mount
  });
}

function editorExtensions(path: string): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    languageFor(path),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) markDirty();
    })
  ];
}

function languageFor(path: string): Extension {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return javascript({ typescript: true, jsx: lower.endsWith('.tsx') });
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return javascript({ jsx: lower.endsWith('.jsx') });
  if (lower.endsWith('.json')) return json();
  if (lower.endsWith('.css')) return css();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return html();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return markdown();
  if (lower.endsWith('.py')) return python();
  if (lower.endsWith('.rs')) return rust();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return yaml();
  return [];
}

function markDirty() {
  if (!state.openFile) return;
  state.openFile.dirty = true;
  el.editorLabel.textContent = `${state.openFile.masked ? '🔒 ' : ''}${state.openFile.path} *`;
  el.saveFile.disabled = false;
}

async function saveOpenFile() {
  const file = state.openFile;
  if (!file || !state.activeProfile) return;
  const content = file.masked && !file.rawMode ? serializeSecretLines(file.lines) : codeView?.state.doc.toString() ?? file.content;
  try {
    await api.writeTextFile(state.activeProfile.id, file.path, content);
    file.content = content;
    file.lines = file.masked ? parseSecretLines(content) : [];
    file.dirty = false;
    setStatus('Saved');
    renderEditor();
  } catch (error) {
    setStatus(String(error), true);
  }
}

function toggleRawMode() {
  if (!state.openFile?.masked) return;
  if (state.openFile.rawMode && codeView) {
    state.openFile.content = codeView.state.doc.toString();
    state.openFile.lines = parseSecretLines(state.openFile.content);
  }
  state.openFile.rawMode = !state.openFile.rawMode;
  renderEditor();
}

async function createTerminal(command: string | null, title: string) {
  if (!state.activeProfile) return;
  const paneId = crypto.randomUUID();
  const card = document.createElement('section');
  card.className = 'terminal-card panel';
  card.dataset.paneId = paneId;
  card.innerHTML = `
    <div class="terminal-title">
      <button class="focus-dot" title="Active prompt target"></button>
      <strong>${escapeHtml(title)}</strong>
      <span class="muted">${escapeHtml(state.currentDir)}</span>
      <span class="spacer"></span>
      <button class="close-pane">×</button>
    </div>
    <div class="terminal-host"></div>
  `;
  el.terminalGrid.append(card);
  const host = card.querySelector<HTMLDivElement>('.terminal-host')!;
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 13,
    theme: { background: '#080b10', foreground: '#d8e0ea' }
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();

  const pane: TerminalPane = { paneId, title, command, term, fit, element: card };
  state.terminals.push(pane);
  setActivePane(paneId);

  term.onData((data) => {
    if (pane.backendId) void api.writeTerminal(pane.backendId, data);
  });
  card.addEventListener('pointerdown', () => setActivePane(paneId));
  card.querySelector<HTMLButtonElement>('.close-pane')!.addEventListener('click', async () => {
    if (pane.backendId) await api.killTerminal(pane.backendId).catch(() => undefined);
    pane.resizeObserver?.disconnect();
    pane.term.dispose();
    state.terminals = state.terminals.filter((item) => item.paneId !== paneId);
    card.remove();
    state.activePaneId = state.terminals[0]?.paneId ?? '';
    syncActivePaneClass();
  });

  pane.resizeObserver = new ResizeObserver(() => fitTerminal(pane));
  pane.resizeObserver.observe(host);

  try {
    pane.backendId = await api.spawnTerminal(state.activeProfile.id, state.currentDir, command, term.rows, term.cols);
    term.focus();
    setStatus(`Terminal started: ${title}`);
  } catch (error) {
    term.write(`\r\nFailed to start terminal: ${String(error)}\r\n`);
    setStatus(String(error), true);
  }
}

function fitTerminal(pane: TerminalPane) {
  try {
    pane.fit.fit();
    if (pane.backendId) void api.resizeTerminal(pane.backendId, pane.term.rows, pane.term.cols);
  } catch {
    // xterm can throw while hidden or before first layout; safe to ignore.
  }
}

function setActivePane(paneId: string) {
  state.activePaneId = paneId;
  syncActivePaneClass();
}

function syncActivePaneClass() {
  state.terminals.forEach((pane) => {
    pane.element.classList.toggle('active', pane.paneId === state.activePaneId);
  });
}

async function handlePaste(event: ClipboardEvent) {
  const item = [...(event.clipboardData?.items ?? [])].find((candidate) => candidate.type.startsWith('image/'));
  if (!item || !state.activeProfile) return;
  const file = item.getAsFile();
  if (!file) return;
  event.preventDefault();
  const dataUrl = await blobToDataUrl(file);
  const fileName = nextImageName();
  try {
    const result = await api.saveAttachment(
      state.activeProfile.id,
      state.workspaceRoot,
      state.attachmentSession,
      fileName,
      dataUrl
    );
    state.imagePreviewDataUrl = dataUrl;
    state.imagePreviewLabel = `${result.tag} copied into active prompt`;
    renderImagePreview();
    const active = state.terminals.find((pane) => pane.paneId === state.activePaneId);
    if (active?.backendId) await api.writeTerminal(active.backendId, result.tag);
    setStatus(`Saved ${result.path}`);
  } catch (error) {
    setStatus(String(error), true);
  }
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
    renderForwards();
    loadPreview(forward.url);
    setStatus(`Forwarding ${forward.localPort} → ${forward.targetHost}:${forward.remotePort}`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

function renderForwards() {
  el.forwardList.innerHTML = '';
  for (const forward of state.forwards) {
    const row = document.createElement('div');
    row.className = 'forward-row';
    row.innerHTML = `<button class="load">${escapeHtml(forward.url)}</button><span>→ ${escapeHtml(forward.targetHost)}:${forward.remotePort}</span><button class="stop">Stop</button>`;
    row.querySelector<HTMLButtonElement>('.load')!.addEventListener('click', () => loadPreview(forward.url));
    row.querySelector<HTMLButtonElement>('.stop')!.addEventListener('click', async () => {
      await api.stopPortForward(forward.id).catch((error) => setStatus(String(error), true));
      state.forwards = state.forwards.filter((item) => item.id !== forward.id);
      renderForwards();
    });
    el.forwardList.append(row);
  }
}

function loadPreview(url: string) {
  if (!url) return;
  state.previewUrl = url;
  el.previewUrl.value = url;
  el.previewFrame.src = url;
}

function setBrowserMode(mode: 'desktop' | 'mobile') {
  el.browserShell.classList.toggle('mobile', mode === 'mobile');
  el.browserShell.classList.toggle('desktop', mode === 'desktop');
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
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalized || normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return path;
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = normalized.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent;
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
