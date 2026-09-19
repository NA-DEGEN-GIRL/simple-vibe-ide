import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real app helpers with controlled async completion order, without a WebView or SSH host.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function loadHelpers(names, bindings) {
  const wanted = new Set(names);
  const declarations = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)
  ));
  assert.equal(declarations.length, wanted.size, 'Every requested app helper must exist');
  const context = vm.createContext(bindings);
  const code = declarations.map((node) => node.getText(parsed)).join('\n');
  vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function withinDeadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Async helper did not settle')), 1000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function explorerFixture() {
  const calls = [];
  const state = { activeWorkspaceId: 'workspace', showFileSizes: false };
  const bindings = {
    state,
    crypto: { randomUUID: () => `operation-${calls.length}` },
    explorerDirectoryCache: new Map(),
    explorerDirectoryReads: new Map(),
    explorerDirectorySignatureCache: new WeakMap(),
    explorerDirectorySignature: (entries) => JSON.stringify(entries),
    explorerDirectoryCacheTtl: () => 60_000,
    pruneExplorerDirectoryCache: () => {},
    shouldDeferRemoteDirectoryRead: () => false,
    explorerPathKey: (path) => path,
    trackExplorerRuntimeOperation: (_id, promise) => promise,
    withExplorerDirectoryTimeout: (_profile, promise) => promise,
    profileForIdWithWindowsFallback: () => ({ kind: 'ssh' }),
    api: {
      listDirectory(profileId, path, includeSizes) {
        const result = deferred();
        calls.push({ paths: [path], includeSizes, ...result, batch: false });
        return result.promise;
      },
      listDirectories(profileId, paths, includeSizes) {
        const result = deferred();
        calls.push({ paths: [...paths], includeSizes, ...result, batch: true });
        return result.promise;
      }
    }
  };
  const context = loadHelpers([
    'explorerDirectoryCacheKey',
    'cloneExplorerEntries',
    'cachedFreshExplorerDirectoryByKey',
    'cacheExplorerDirectory',
    'createExplorerDirectoryPendingRead',
    'fetchExplorerDirectory',
    'fetchExplorerDirectories'
  ], bindings);
  const entries = (path) => [{ name: 'file.txt', path: `${path}/file.txt`, kind: 'file', size: 0, hidden: false }];
  function complete(call) {
    call.resolve(call.batch
      ? call.paths.map((path) => ({ path, entries: entries(path), error: null }))
      : entries(call.paths[0]));
  }
  return { context, calls, state, entries, complete };
}

async function explorerConcurrentDedup() {
  const { context, calls, entries, complete } = explorerFixture();
  const oldRead = deferred();
  const key = context.explorerDirectoryCacheKey('ssh', '/already-loading');
  context.explorerDirectoryReads.set(key, oldRead.promise);
  const batch = context.fetchExplorerDirectories('ssh', ['/already-loading', '/next']);
  const single = context.fetchExplorerDirectory('ssh', '/next');
  oldRead.resolve(entries('/already-loading'));
  await settle();
  assert.equal(calls.filter((call) => call.paths.includes('/next')).length, 1,
    'A batch waiting on another directory must not duplicate a concurrent single read');
  for (const call of calls) complete(call);
  const [batchResult, singleResult] = await withinDeadline(Promise.all([batch, single]));
  assert.equal(batchResult.get('/next').entries[0].path, '/next/file.txt');
  assert.equal(singleResult[0].path, '/next/file.txt');
}

async function explorerSizeModeSingle() {
  const { context, calls, state, complete } = explorerFixture();
  const read = context.fetchExplorerDirectory('ssh', '/single');
  state.showFileSizes = true;
  assert.equal(calls[0].includeSizes, false);
  complete(calls[0]);
  await withinDeadline(read);
  assert.ok(context.explorerDirectoryCache.has(context.explorerDirectoryCacheKey('ssh', '/single', 'workspace', false)));
  assert.equal(context.explorerDirectoryCache.has(context.explorerDirectoryCacheKey('ssh', '/single', 'workspace', true)), false,
    'An old no-size result must not populate the size-aware cache after a UI toggle');
}

async function explorerSizeModeBatch() {
  const { context, calls, state, complete } = explorerFixture();
  const batch = context.fetchExplorerDirectories('ssh', ['/batch']);
  const joined = context.fetchExplorerDirectory('ssh', '/batch');
  state.showFileSizes = true;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includeSizes, false);
  complete(calls[0]);
  const [result, joinedEntries] = await withinDeadline(Promise.all([batch, joined]));
  assert.equal(result.get('/batch').entries[0].path, '/batch/file.txt');
  assert.equal(joinedEntries[0].path, '/batch/file.txt', 'Joined callers must settle under the original cache key');
  assert.ok(context.explorerDirectoryCache.has(context.explorerDirectoryCacheKey('ssh', '/batch', 'workspace', false)));
  assert.equal(context.explorerDirectoryCache.has(context.explorerDirectoryCacheKey('ssh', '/batch', 'workspace', true)), false);
}

function editorFixture(readTextFileCached) {
  const queue = [];
  const tabs = ['deleted', 'valid'].map((id) => ({
    id, pendingPath: `/${id}.txt`, pendingProfileId: 'ssh', loading: false
  }));
  const state = { activeWorkspaceId: 'workspace', activeEditorTabId: 'active', workspaceOpen: true, editorTabs: tabs };
  const context = loadHelpers([
    'scheduleInactiveEditorHydration', 'hydrateInactiveEditorTabs', 'hydrateEditorTab'
  ], {
    state,
    inactiveEditorHydrationToken: 0,
    document: { hidden: false },
    runWhenUiIdle: (callback) => queue.push(callback),
    getPanel: () => ({ classList: { contains: () => true } }),
    isEditorPanelVisible: () => true,
    readTextFileCached,
    editorTabForId: (id) => tabs.find((tab) => tab.id === id),
    shouldMaskFile: () => false,
    setEditorTabFile: (tab, file) => { tab.file = file; },
    saveActiveWorkspaceSnapshot: () => {}
  });
  return { context, state, tabs, queue };
}

async function editorFailureDoesNotLoop() {
  const reads = [];
  const { context, tabs, queue } = editorFixture(async (_profile, path) => {
    reads.push(path);
    if (path === '/deleted.txt') throw new Error('File does not exist');
    return 'content';
  });
  context.scheduleInactiveEditorHydration();
  for (let i = 0; i < 8 && queue.length; i += 1) {
    queue.shift()();
    await settle();
  }
  assert.deepEqual(reads, ['/deleted.txt', '/valid.txt'], 'A failed background file must not loop or starve later tabs');
  assert.equal(queue.length, 0);
  assert.equal(tabs[0].pendingPath, '/deleted.txt', 'A failed tab must remain available for an explicit retry');
  assert.equal(tabs[1].file.content, 'content');
}

async function editorWorkspaceSwitchReleasesLoading() {
  for (const fails of [false, true]) {
    const read = deferred();
    const { context, state, tabs } = editorFixture(() => read.promise);
    const hydration = context.hydrateEditorTab(tabs[0], false);
    assert.equal(tabs[0].loading, true);
    state.activeWorkspaceId = 'other-workspace';
    if (fails) read.reject(new Error('Remote read failed'));
    else read.resolve('content');
    await withinDeadline(hydration);
    assert.equal(tabs[0].loading, false, 'A cached tab must not remain loading after its workspace was left');
  }
}

function explorerUiFixture(names, extra = {}) {
  const calls = { render: 0, create: 0, status: 0 };
  const state = {
    activeWorkspaceId: 'workspace', activeProfile: { id: 'ssh' }, workspaceOpen: true,
    workspaceRoot: '/root', currentDir: '/root', entries: [],
    explorerChildren: new Map(), explorerExpanded: new Set(), explorerLoading: new Set(), explorerSignatures: new Map()
  };
  const context = loadHelpers(names, {
    state,
    workspaceActivationGeneration: 0,
    markExplorerEntryLookupDirty: () => {},
    renderExplorer: () => { calls.render += 1; },
    saveActiveWorkspaceSnapshot: () => {},
    setStatus: () => { calls.status += 1; },
    cachedExplorerDirectory: () => null,
    queueVisibleExplorerDirectoryPrefetch: () => {},
    explorerDirectorySignature: (entries) => JSON.stringify(entries),
    ...extra
  });
  const entry = { path: '/root/child', name: 'child', kind: 'dir' };
  const children = [{ path: '/root/child/file', name: 'file', kind: 'file', size: 0 }];
  function switchWorkspace() {
    context.workspaceActivationGeneration += 1;
    state.activeWorkspaceId = 'other-workspace';
    state.activeProfile = { id: 'other-ssh' };
    state.workspaceRoot = '/other';
    state.currentDir = '/other';
    state.explorerChildren = new Map();
    state.explorerExpanded = new Set([entry.path]);
    state.explorerLoading = new Set([entry.path]);
    state.explorerSignatures = new Map();
  }
  return { context, state, calls, entry, children, switchWorkspace };
}

async function explorerEnsureDoesNotCrossWorkspace() {
  const read = deferred();
  const { context, state, entry, children, switchWorkspace } = explorerUiFixture([
    'ensureExplorerDirectoryChildren'
  ], { readExplorerDirectoryCached: () => read.promise });
  const ensure = context.ensureExplorerDirectoryChildren(entry.path);
  switchWorkspace();
  read.resolve(children);
  await withinDeadline(ensure);
  assert.equal(state.explorerChildren.size, 0, 'An old listing must not populate another workspace');
}

async function checkExplorerCreateStaleScope(resetMode) {
  const read = deferred();
  let creates = 0;
  let directoryReads = 0;
  const { context, state, children, switchWorkspace } = explorerUiFixture(['createExplorerItem'], {
    explorerCreateTargetDirectory: async () => '/root/child',
    ensureExplorerDirectoryChildren: () => { directoryReads += 1; return read.promise; },
    uniqueExplorerName: () => 'new-file.txt',
    joinExplorerPath: (dir, name) => `${dir}/${name}`,
    api: { createFile: async () => { creates += 1; } },
    invalidateTextFileCache: () => {},
    invalidateExplorerDirectoryCache: () => {},
    reloadExplorerDirectory: async () => {},
    selectExplorerEntry: () => {},
    startInlineExplorerRename: () => {}
  });
  const creation = context.createExplorerItem('file');
  await settle();
  assert.equal(directoryReads, 1, 'The create must be waiting on a directory read when the workspace changes');
  if (resetMode === 'map') state.explorerChildren = new Map();
  else if (resetMode === 'generation') context.workspaceActivationGeneration += 1;
  else switchWorkspace();
  read.resolve(children);
  await withinDeadline(creation);
  assert.equal(creates, 0, 'A delayed create must not continue after its Explorer scope was replaced');
}

async function explorerCreateDoesNotCrossWorkspace() {
  await checkExplorerCreateStaleScope();
}

async function explorerCreateDoesNotSurviveScopeReset() {
  await checkExplorerCreateStaleScope('map');
}

async function explorerCreateDoesNotSurviveLeaveAndReturn() {
  await checkExplorerCreateStaleScope('generation');
}

async function explorerCollapseSurvivesCompletion() {
  const read = deferred();
  const { context, state, entry, children } = explorerUiFixture(['toggleExplorerDirectory'], {
    fetchExplorerDirectory: () => read.promise
  });
  const opening = context.toggleExplorerDirectory(entry);
  assert.ok(state.explorerExpanded.has(entry.path));
  await context.toggleExplorerDirectory(entry);
  assert.equal(state.explorerExpanded.has(entry.path), false);
  read.resolve(children);
  await withinDeadline(opening);
  assert.equal(state.explorerExpanded.has(entry.path), false, 'A completed listing must respect a user collapse');
  assert.equal(state.explorerChildren.get(entry.path)?.length, 1, 'The collapsed directory should still cache the successful result');
}

async function explorerStaleToggleDoesNotTouchCurrentUi() {
  for (const fails of [false, true]) {
    const read = deferred();
    const { context, state, calls, entry, children, switchWorkspace } = explorerUiFixture(['toggleExplorerDirectory'], {
      fetchExplorerDirectory: () => read.promise
    });
    const opening = context.toggleExplorerDirectory(entry);
    switchWorkspace();
    const rendersAtSwitch = calls.render;
    const statusesAtSwitch = calls.status;
    if (fails) read.reject(new Error('Remote read canceled'));
    else read.resolve(children);
    await withinDeadline(opening);
    assert.ok(state.explorerExpanded.has(entry.path), 'A stale failure must not collapse the current workspace');
    assert.ok(state.explorerLoading.has(entry.path), 'A stale finally must not release another workspace loading state');
    assert.equal(calls.render, rendersAtSwitch, 'A stale read must not trigger a full current-tree render');
    assert.equal(calls.status, statusesAtSwitch);
  }
}

async function explorerWidthCacheDoesNotThrash() {
  const names = ['measureExplorerRowContentWidth', 'calculateExplorerSemanticContentWidth'];
  if (parsed.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'pruneExplorerRowWidthMeasureCache')) {
    names.push('pruneExplorerRowWidthMeasureCache');
  }
  // Match the cache's actual ownership model so the assertion measures reuse, not the constructor.
  const declaration = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => node.name.getText(parsed) === 'explorerRowWidthMeasureCache');
  const usesWeakCache = declaration?.initializer && ts.isNewExpression(declaration.initializer)
    && declaration.initializer.expression.getText(parsed) === 'WeakMap';
  let measurements = 0;
  const entries = Array.from({ length: 3000 }, (_, index) => ({ name: `file-${index}`, path: `/root/file-${index}`, kind: 'file' }));
  const rows = () => entries.map((entry, index) => ({ entry, depth: 0, sizeText: '', staticSignature: `row-${index}` }));
  const context = loadHelpers(names, {
    explorerVisibleRows: rows(),
    explorerRowWidthMeasureCache: usesWeakCache ? new WeakMap() : new Map(),
    explorerMeasurementFont: () => '13px system-ui',
    explorerRowsHideFileSizesForWidth: () => true,
    calculateExplorerSemanticRowWidthFallback: () => { measurements += 1; return 100; }
  });
  assert.equal(context.calculateExplorerSemanticContentWidth(), 100);
  assert.equal(measurements, entries.length);
  context.explorerVisibleRows = rows();
  assert.equal(context.calculateExplorerSemanticContentWidth(), 100);
  assert.equal(measurements, entries.length, 'An unchanged large tree must reuse widths across rebuilt row wrappers');
  context.explorerVisibleRows[0].depth = 1;
  context.explorerVisibleRows[0].staticSignature += '\tdepth:1';
  context.calculateExplorerSemanticContentWidth();
  assert.equal(measurements, entries.length + 1, 'Depth changes must invalidate the affected width');
}

let failures = 0;
for (const check of [
  explorerConcurrentDedup,
  explorerSizeModeSingle,
  explorerSizeModeBatch,
  editorFailureDoesNotLoop,
  editorWorkspaceSwitchReleasesLoading,
  explorerEnsureDoesNotCrossWorkspace,
  explorerCreateDoesNotCrossWorkspace,
  explorerCreateDoesNotSurviveScopeReset,
  explorerCreateDoesNotSurviveLeaveAndReturn,
  explorerCollapseSurvivesCompletion,
  explorerStaleToggleDoesNotTouchCurrentUi,
  explorerWidthCacheDoesNotThrash
]) {
  try {
    await check();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${error.message}`);
  }
}
if (failures) process.exitCode = 1;
