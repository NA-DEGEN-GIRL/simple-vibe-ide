#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';

// Helper-level allocation/operation tests. No user files, storage or browser are opened.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const baseline = process.argv.includes('--baseline');

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

function dirtyChromeCoalescing() {
  const file = { dirty: false, draftContent: 'old snapshot' };
  const counts = { labels: 0, tabs: 0 };
  const context = loadHelpers(['markOpenFileDirtyFromEditorEdit'], {
    state: { openFile: file },
    updateEditorLabel: () => { counts.labels += 1; },
    renderEditorTabs: () => { counts.tabs += 1; },
    el: { saveFile: { disabled: true } }
  });
  for (let index = 0; index < 1_000; index += 1) {
    file.draftContent = 'snapshot must always be invalidated';
    context.markOpenFileDirtyFromEditorEdit(file);
    assert.equal(file.draftContent, undefined);
    assert.equal(file.dirty, true);
  }
  console.log(`Editor dirty chrome: ${counts.tabs} tab render(s), ${counts.labels} label update(s) / 1,000 edits`);
  if (!baseline) {
    assert.equal(counts.tabs, 1, 'Already-dirty typing must not rebuild every editor tab');
    assert.equal(counts.labels, 1, 'Unchanged dirty label must not be refreshed per edit');
  }
  file.dirty = false;
  context.markOpenFileDirtyFromEditorEdit(file);
  if (!baseline) assert.equal(counts.tabs, 2, 'Typing after save must refresh dirty chrome again');
  const inactive = { dirty: false, draftContent: 'stale' };
  context.markOpenFileDirtyFromEditorEdit(inactive);
  assert.equal(inactive.dirty, true);
  assert.equal(inactive.draftContent, undefined);
}

function referenceCompact(records, maxChars) {
  const seen = new Set();
  const result = records.filter((record) => record.profileId && record.workspaceKey && record.path)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((record) => {
      const key = `${record.profileId}\0${record.workspaceKey}\0${record.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 200);
  // Independent full-envelope oracle, using binary search only to keep the test
  // itself from doing the original quadratic work on the large fixture.
  if (result.length < 2) return result;
  let low = 1;
  let high = result.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify({ version: 1, notes: result.slice(0, middle) }).length <= maxChars) low = middle;
    else high = middle - 1;
  }
  return result.slice(0, low);
}

function compactFixture(records, maxChars = 2 * 1024 * 1024) {
  let stringifyChars = 0;
  let stringifyCalls = 0;
  const context = loadHelpers(['compactNoteMemoryRecords', 'noteMemoryRecordScopeKey'], {
    noteMemoryRecords: records.slice(),
    noteMemoryPathKey: (path) => path,
    NOTES_MEMORY_LIMIT: 200,
    NOTES_MEMORY_STORE_MAX_CHARS: maxChars,
    JSON: {
      stringify(value) {
        const result = JSON.stringify(value);
        stringifyChars += result.length;
        stringifyCalls += 1;
        return result;
      }
    }
  });
  const started = performance.now();
  context.compactNoteMemoryRecords();
  const elapsed = performance.now() - started;
  assert.deepEqual(Array.from(context.noteMemoryRecords, (record) => record.id), referenceCompact(records, maxChars).map((record) => record.id));
  return { elapsed, stringifyChars, stringifyCalls };
}

function noteCompactionWork() {
  const records = Array.from({ length: 200 }, (_, index) => ({
    id: `note-${index}`, profileId: 'profile', workspaceKey: '/workspace',
    path: `/workspace/note-${index}.txt`, title: `Note ${index}`,
    // Include characters with nontrivial JSON escaping and UTF-16 length.
    content: '한글😀\n\t"\\'.repeat(4_000), updatedAt: index
  }));
  const result = compactFixture(records);
  const inputChars = JSON.stringify({ version: 1, notes: records }).length;
  console.log(`Notes overflow compaction: ${result.stringifyCalls} stringify call(s), ${(result.stringifyChars / 1048576).toFixed(1)} Mi characters serialized, ${result.elapsed.toFixed(1)} ms`);
  if (!baseline) assert.ok(result.stringifyChars <= inputChars * 2, 'Compaction serialization must be linear, not repeatedly stringify each shrinking array');
  compactFixture([]);
  compactFixture([records[0]], 20); // Existing at-least-one recovery policy is intentional.
  compactFixture([records[0], { ...records[0], id: 'newer duplicate', updatedAt: 201 }, records[1], { ...records[2], profileId: '' }], 200_000);
  const pair = [records[0], records[1]];
  const exact = JSON.stringify({ version: 1, notes: pair }).length;
  compactFixture(pair, exact);
  compactFixture(pair, exact - 1);
}

function editorDocumentMaterialization() {
  let editor = EditorState.create({ doc: 'const value = "한글😀";\n'.repeat(32_768) });
  const originalDocument = editor.doc;
  let flattenCalls = 0;
  function trackDocument(doc) {
    const original = doc.toString;
    doc.toString = function () { flattenCalls += 1; return original.call(this); };
  }
  trackDocument(editor.doc);
  const file = { content: editor.doc.sliceString(0), dirty: false };
  const tab = { file };
  const pane = { id: 'pane', activeTabId: 'tab' };
  let scrollSnapshotCount = 0;
  const viewState = {
    file, renderSignature: 'plain',
    view: { state: editor, scrollSnapshot: () => ({ value: ++scrollSnapshotCount }) }
  };
  const names = ['syncEditorPaneFromView', 'currentEditorContentForFile'];
  if (parsed.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'editorViewDocumentText')) {
    names.push('editorViewDocumentText');
  }
  const context = loadHelpers(names, {
    editorPaneForId: () => pane,
    editorTabForId: () => tab,
    editorPaneViewState: new Map([[pane.id, viewState]]),
    sameEditorContent: (left, right) => left === right
  });
  const start = performance.now();
  for (let index = 0; index < 64; index += 1) {
    editor = editor.update({ selection: { anchor: index } }).state;
    viewState.view.state = editor;
    context.syncEditorPaneFromView(pane.id);
    assert.equal(context.currentEditorContentForFile(file), file.content);
    assert.equal(tab.runtimeViewState.selection.main.anchor, index, 'Document cache must not freeze cursor state');
    assert.equal(tab.runtimeViewState.scrollTo.value, index + 1, 'Document cache must not freeze scroll snapshots');
  }
  console.log(`Editor unchanged Text: ${flattenCalls} flatten(s) / 128 snapshot/save reads, ${(performance.now() - start).toFixed(1)} ms`);
  if (!baseline) assert.equal(flattenCalls, 1, 'Immutable CodeMirror Text must be flattened once per view/document, not once per snapshot');
  editor = editor.update({ changes: { from: 0, to: 0, insert: 'new ' } }).state;
  trackDocument(editor.doc);
  viewState.view.state = editor;
  const previousCalls = flattenCalls;
  context.syncEditorPaneFromView(pane.id);
  assert.equal(flattenCalls, previousCalls + 1, 'A changed document must invalidate the flattened text');
  assert.equal(file.dirty, true);
  assert.ok(file.draftContent.startsWith('new '));
  const changedDocumentCalls = flattenCalls;
  viewState.view.state = EditorState.create({ doc: originalDocument });
  context.syncEditorPaneFromView(pane.id);
  assert.equal(flattenCalls, changedDocumentCalls + 1, 'Only the current flatten is retained, not a strong cache of every undo version');
  assert.equal(file.dirty, false);
}

function explorerGlassFlagFastPath() {
  const state = { ideSettings: { appGlass: {} } };
  const classes = new Set();
  let enabled = false;
  let normalizations = 0;
  const context = loadHelpers([
    'explorerRowsGlassActiveForScrollGuard', 'explorerGlassActiveForHorizontalScroll', 'isPlainRecord'
  ], {
    state,
    appGlassEnabled: () => enabled,
    getPanel: () => ({ classList: { contains: (name) => classes.has(name) } }),
    normalizeAppGlassSettings(value) {
      normalizations += 1;
      const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return { explorerRows: record.explorerRows !== false };
    }
  });
  for (const value of [undefined, null, false, 0, 'legacy', [], {}, { explorerRows: false }, { explorerRows: true }, { explorerRows: null }, { explorerRows: 0 }]) {
    state.ideSettings.appGlass = value;
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    for (const active of [false, true]) for (const hidden of [false, true]) for (const shell of [false, true]) {
      enabled = active;
      classes.clear();
      if (hidden) classes.add('hidden');
      if (shell) classes.add('app-glass-active-shell');
      assert.equal(context.explorerRowsGlassActiveForScrollGuard(), active && raw.explorerRows !== false && !hidden);
      assert.equal(context.explorerGlassActiveForHorizontalScroll(), active && (shell || raw.explorerRows !== false) && !hidden);
    }
  }
  console.log(`Explorer glass guards: ${normalizations} full settings normalization(s) / 176 flag checks`);
  if (!baseline) assert.equal(normalizations, 0, 'Scroll guard flag reads must not normalize all glass materials');
}

function noteSaveFixture() {
  const scope = { workspaceId: 'workspace-a', profileId: 'profile-a', workspaceKey: '/workspace-a' };
  const tab = { id: 'note', path: '/workspace-a/note.txt', content: 'older', dirty: true, loading: false };
  const writes = [];
  const disk = new Map();
  const memoryScopes = [];
  const names = ['saveNoteTabNow'];
  for (const node of parsed.statements) {
    if (ts.isFunctionDeclaration(node) && /^(?:writeNoteTab|performNoteSave|runNoteSave)/.test(node.name?.text ?? '')) names.push(node.name.text);
  }
  const context = loadHelpers(names, {
    state: { activeWorkspaceId: scope.workspaceId, activeProfile: { id: scope.profileId } },
    noteSaveTimers: new Map(),
    noteSaveInFlightByTab: new WeakMap(),
    currentNotePersistenceScope: () => scope,
    noteTabForId: () => tab,
    window: { clearTimeout() {} },
    renderNoteStatus() {}, renderNoteTabs() {}, invalidateExplorerParentDirectoryCache() {},
    queueNoteMemoryUpsert(saved, options) { memoryScopes.push({ saved, scope: options.scope }); },
    api: {
      writeTextFile(profile, path, content) {
        let resolve;
        let reject;
        const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
        writes.push({ profile, path, content, finish() { disk.set(`${profile}:${path}`, content); resolve(); }, fail: reject });
        return promise;
      }
    }
  });
  return { context, scope, tab, writes, disk, memoryScopes };
}

async function flushPromises() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function serializedNotesWrites() {
  const { context, scope, tab, writes, disk } = noteSaveFixture();
  const older = context.saveNoteTabNow(tab, scope);
  assert.equal(writes.length, 1);
  tab.content = 'newer';
  let newerFinished = false;
  const newer = context.saveNoteTabNow(tab, scope).then(() => { newerFinished = true; });
  if (baseline && writes.length > 1) {
    writes[1].finish();
    await newer;
    writes[0].finish();
    await older;
    assert.equal(disk.get(`${scope.profileId}:${tab.path}`), 'older');
    assert.equal(tab.dirty, false);
    console.log('Notes overlapping writes baseline: stale disk content after newer save, dirty=false (reproduced)');
    return;
  }
  assert.equal(writes.length, 1, 'A newer save must not overlap an in-flight write to the same note');
  const duplicate = context.saveNoteTabNow(tab, scope);
  writes[0].finish();
  await flushPromises();
  assert.equal(writes.length, 2, 'Waiters must coalesce the latest content into one follow-up write');
  assert.equal(writes[1].content, 'newer');
  assert.equal(tab.dirty, true, 'Older save completion must not clear newer dirty text');
  assert.equal(newerFinished, false, 'Manual save promise must wait for its latest content to be saved');
  writes[1].finish();
  await Promise.all([older, newer, duplicate]);
  assert.equal(disk.get(`${scope.profileId}:${tab.path}`), 'newer');
  assert.equal(tab.dirty, false);
  assert.equal(tab.saving, false);
  assert.equal(writes.length, 2);

  // Failed writes must release the gate without silently marking text saved.
  tab.content = 'retry';
  tab.dirty = true;
  const failing = context.saveNoteTabNow(tab, scope);
  writes[2].fail(new Error('synthetic write failure'));
  await failing;
  assert.equal(tab.dirty, true);
  assert.equal(tab.saving, false);
  const retrying = context.saveNoteTabNow(tab, scope);
  assert.equal(writes.length, 4);
  writes[3].finish();
  await retrying;
  assert.equal(tab.dirty, false);
  console.log('Notes saves: serialized/coalesced newest content, completion and failure retry passed.');
}

async function notesWriteScopeIsolation() {
  const { context, scope, tab, writes, memoryScopes } = noteSaveFixture();
  const otherScope = { workspaceId: 'workspace-b', profileId: 'profile-b', workspaceKey: '/workspace-b' };
  const otherTab = { ...tab, path: '/workspace-b/note.txt', content: 'other workspace' };
  const first = context.saveNoteTabNow(tab, scope);
  const second = context.saveNoteTabNow(otherTab, otherScope);
  assert.equal(writes.length, 2, 'Independent workspace tab objects must not share a save gate even if restored IDs match');
  assert.equal(writes[0].profile, scope.profileId);
  assert.equal(writes[1].profile, otherScope.profileId);
  assert.equal(writes[0].path, tab.path);
  assert.equal(writes[1].path, otherTab.path);
  writes[1].finish();
  writes[0].finish();
  await Promise.all([first, second]);
  assert.equal(memoryScopes.find((entry) => entry.saved === otherTab).scope, otherScope);
  console.log('Notes saves: workspace/profile/path isolation passed.');
}

async function staleNoteWaiterPreservesCurrentTimer() {
  const { context, scope, tab, writes } = noteSaveFixture();
  const older = context.saveNoteTabNow(tab, scope);
  tab.content = 'queued before closing the old tab';
  const queued = context.saveNoteTabNow(tab, scope);
  // closeNoteTab can remove the old object while its queued save still waits.
  // Copied/restored workspaces may then own another note object with this ID.
  const currentTab = { ...tab, path: '/workspace-b/note.txt' };
  context.state.activeWorkspaceId = 'workspace-b';
  context.state.activeProfile.id = 'profile-b';
  context.noteTabForId = () => currentTab;
  context.noteSaveTimers.set(currentTab.id, 777);
  writes[0].finish();
  await flushPromises();
  assert.equal(writes.length, 2, 'Old queued content still needs its captured-scope save');
  assert.equal(context.noteSaveTimers.get(currentTab.id), 777, 'An old-tab waiter must not cancel another workspace tab autosave with the same ID');
  assert.equal(writes[1].profile, scope.profileId);
  assert.equal(writes[1].path, tab.path);
  writes[1].finish();
  await Promise.all([older, queued]);
  assert.equal(context.noteSaveTimers.get(currentTab.id), 777);
  console.log('Notes saves: stale closed-tab waiter preserves current workspace autosave timer.');
}

dirtyChromeCoalescing();
noteCompactionWork();
editorDocumentMaterialization();
explorerGlassFlagFastPath();
await serializedNotesWrites();
await notesWriteScopeIsolation();
await staleNoteWaiterPreservesCurrentTimer();
console.log(baseline ? 'Editor/Notes/Explorer baseline recorded.' : 'Editor/Notes/Explorer performance regressions passed.');
