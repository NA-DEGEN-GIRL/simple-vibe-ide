#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise actual app handlers; no WebView, user files, or remote shell is opened.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function loadHelpers(names, bindings) {
  const wanted = new Set(names);
  const declarations = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)
  ));
  assert.equal(declarations.length, wanted.size, 'Every requested app helper must exist');
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(declarations.map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context;
}

class FakeElement {
  constructor(classes = [], entry = null, tagName = 'DIV') {
    this.classes = new Set(classes);
    this.entry = entry;
    this.tagName = tagName;
    this.parentElement = null;
  }

  closest(selector) {
    for (const part of selector.split(',').map((value) => value.trim())) {
      const className = /^\.([\w-]+)/.exec(part)?.[1];
      if (className && this.classes.has(className)
        && (!part.includes('[data-path]') || this.entry)) return this;
      if (part.toUpperCase() === this.tagName) return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(element) {
    return element === this || element?.parentElement === this;
  }
}

function selectionFixture() {
  const directory = { path: '/workspace/child', kind: 'dir' };
  const file = { path: '/workspace/child/file.txt', kind: 'file' };
  const state = {
    currentDir: '/workspace',
    explorerSelectedPath: directory.path,
    explorerSelectedPaths: new Set([directory.path]),
    explorerSelectionAnchorPath: directory.path,
    explorerOpenMode: 'single'
  };
  const opened = [];
  const updates = [];
  const fileList = new FakeElement();
  const context = loadHelpers([
    'handleExplorerClick', 'setExplorerSelection', 'maybeAutoOpenExplorerSelection',
    'resetExplorerSelection', 'clearExplorerModifierPointer', 'explorerCreateTargetDirectory'
  ], {
    state,
    Element: FakeElement,
    el: { fileList },
    explorerDragEndAt: 0,
    EXPLORER_CLICK_SUPPRESS_MS: 400,
    explorerAutoOpenSuppressed: 0,
    explorerLastSelectedPath: directory.path,
    explorerModifierPointerPath: directory.path,
    explorerModifierPointerUntil: 100,
    explorerEntryFromEvent: (event) => event.target.entry,
    updateExplorerSelection: (...args) => updates.push(args),
    clearExplorerTextSelection: () => {},
    openExplorerEntry: (entry) => opened.push(entry.path),
    selectExplorerEntryFromPointer: () => {},
    selectExplorerEntry: () => {},
    findExplorerEntry: (path) => [directory, file].find((entry) => entry.path === path) ?? null,
    parentPath: (path) => path.slice(0, path.lastIndexOf('/')),
    isWindowsExecutablePath: () => false,
    openFile: (path) => opened.push(path)
  });
  function click(target = fileList, options = {}) {
    if (target !== fileList) target.parentElement = fileList;
    context.handleExplorerClick({
      target, button: 0, ctrlKey: false, metaKey: false, shiftKey: false,
      preventDefault() {}, stopPropagation() {}, ...options
    });
  }
  return { context, state, directory, file, opened, updates, fileList, click };
}

async function blankClickSelectsCurrentDirectory() {
  const { context, state, updates, click } = selectionFixture();
  assert.equal(await context.explorerCreateTargetDirectory(), '/workspace/child');
  click();
  assert.equal(state.explorerSelectedPath, '', 'Blank Explorer click must clear the active child');
  assert.equal(state.explorerSelectedPaths.size, 0, 'Blank click must clear multi-selection too');
  assert.equal(state.explorerSelectionAnchorPath, '', 'Blank click must reset the range-selection anchor');
  assert.equal(await context.explorerCreateTargetDirectory(), '/workspace',
    'New File and New Folder must target the current directory after a blank click');
  assert.ok(updates.length > 0, 'Selected row styling must be refreshed');
}

async function selectionBoundaries() {
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const { click, state, directory } = selectionFixture();
    click(undefined, modifiers);
    assert.equal(state.explorerSelectedPath, directory.path, 'Modifier blank click preserves selection');
  }
  for (const classes of [['file-row', 'loading'], ['file-rename-input']]) {
    const { click, state, directory } = selectionFixture();
    click(new FakeElement(classes));
    assert.equal(state.explorerSelectedPath, directory.path, 'Loading and rename controls are not blank space');
  }
  const { click, file, opened } = selectionFixture();
  click(new FakeElement(['file-row'], file));
  assert.deepEqual(opened, [file.path], 'A real row click must retain the normal open path');
  const dragged = selectionFixture();
  dragged.context.explorerDragEndAt = Date.now();
  dragged.click();
  assert.equal(dragged.state.explorerSelectedPath, dragged.directory.path,
    'A trailing drag click must not clear the selection');
}

function openFileFixture(existing) {
  const raised = [];
  const activated = [];
  const tab = { id: 'editor-tab', file: existing ? { path: '/workspace/file.txt' } : null };
  const context = loadHelpers(['openFile'], {
    state: { activeProfile: { id: 'profile' }, editorOpenInNewTab: false },
    fileOpenToken: 0,
    isImagePath: () => false,
    syncActiveEditorTabFromView: () => {},
    editorTabForPath: () => existing ? tab : null,
    activateEditorTab: (id) => activated.push(id),
    refreshOpenTabFromDisk: async () => {},
    scheduleEditorLoading: () => () => {},
    warmEditorForPath: () => {},
    readTextFileCached: async () => 'plain text',
    shouldMaskFile: () => false,
    activeEditorTab: () => tab,
    setEditorTabFile: (target, file) => { target.file = file; },
    renderEditorTabs: () => {},
    renderEditor: () => {},
    setPanelVisible: (id, visible, options) => raised.push({ id, visible, options }),
    setStatus: () => {},
    saveActiveWorkspaceSnapshot: () => {},
    cancelPendingEditorLoading: () => {}
  });
  return { context, raised, activated };
}

async function editorOpenRaisesPanel() {
  for (const existing of [true, false]) {
    const { context, raised, activated } = openFileFixture(existing);
    assert.equal(await context.openFile('/workspace/file.txt'), true);
    assert.ok(raised.some((call) => call.id === 'editor' && call.visible && !call.options?.skipFocus),
      `${existing ? 'Already-open' : 'New'} file must show and raise Editor above other panels`);
    if (existing) assert.deepEqual(activated, ['editor-tab']);
  }
}

let failures = 0;
for (const test of [blankClickSelectsCurrentDirectory, selectionBoundaries, editorOpenRaisesPanel]) {
  try {
    await test();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${test.name}: ${error.message}`);
  }
}
if (failures) process.exitCode = 1;
