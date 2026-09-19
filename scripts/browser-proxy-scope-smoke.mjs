import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real preview proxy helpers with deterministic native IPC completions. No sockets
// or WebViews are created; Windows HTTP/rendering smoke is a separate gate.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const names = [
  'ensurePreviewProxy', 'clearPreviewProxyLookup', 'rebuildPreviewProxyLookup',
  'rememberPreviewProxy', 'forgetPreviewProxy', 'previewProxyForTargetOrigin',
  'removePreviewProxy', 'removePreviewProxiesForTargetOrigin',
  'previewFrameUrl', 'localHttpPreviewUrl', 'normalizedLocalPreviewOrigin',
  'loadBrowserTabThroughPreviewProxy', 'clearPreviewProxyForBrowserTab'
];
const variables = [
  'previewProxyProbeAt', 'previewProxyStarts', 'previewProxyScopeGeneration',
  'previewProxyByTargetOrigin', 'previewProxyByLocalPort', 'previewProxyLocalPortMisses',
  'browserLoadRequestByTabId', 'browserLoadRequestSeq', 'appShutdownStarted'
];
const functions = parsed.statements.filter((node) => (
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
));
assert.equal(functions.length, names.length, 'Every tested helper must come from the app');
const declarations = parsed.statements.filter((node) => (
  ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => (
    ts.isIdentifier(entry.name) && variables.includes(entry.name.text)
  ))
));
const compiled = ts.transpileModule([...declarations, ...functions].map((node) => node.getText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const origin = 'http://127.0.0.1:3000';

function proxy(id, localPort = 41001) {
  return { id, localPort, remotePort: 3000, targetHost: origin, url: `http://127.0.0.1:${localPort}` };
}

function fixture(existing = []) {
  const calls = { starts: [], probes: [], stops: [], logs: [], status: [], frames: [] };
  const state = {
    activeWorkspaceId: 'workspace-a', activeProfile: { id: 'profile-a' },
    workspaceRoot: '/workspace-a', previewProxies: existing,
    activeBrowserTabId: 'tab-a', browserTabs: []
  };
  const frameById = new Map();
  const context = vm.createContext({
    URL, state, PREVIEW_PROXY_PROBE_TTL_MS: 30_000,
    isLocalPreviewHost: (host) => ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(host),
    api: {
      startPreviewProxy(targetOrigin) {
        const pending = deferred(); calls.starts.push({ targetOrigin, ...pending }); return pending.promise;
      },
      probeLocalHttpUrl(url) {
        const pending = deferred(); calls.probes.push({ url, ...pending }); return pending.promise;
      },
      stopPortForward(id) { calls.stops.push(id); return Promise.resolve(); }
    },
    logBrowserConsole: (...args) => calls.logs.push(args),
    setStatus: (...args) => calls.status.push(args),
    prepareBrowserProxyPendingFrame() {},
    browserFrameForTab: (id) => frameById.get(id) ?? null,
    browserTabForId: (id) => state.browserTabs.find((tab) => tab.id === id) ?? null,
    loadBrowserFrame: (tab, options) => calls.frames.push({ tab, options })
  });
  vm.runInContext(compiled, context);
  context.rebuildPreviewProxyLookup();
  return {
    state, calls, context, frameById,
    start: (options) => outcome(context.ensurePreviewProxy(origin, options)),
    pendingSize: () => vm.runInContext('previewProxyStarts.size', context),
    changeWorkspace(id) {
      state.activeWorkspaceId = `workspace-${id}`;
      state.activeProfile = { id: `profile-${id}` };
      state.workspaceRoot = `/workspace-${id}`;
      state.previewProxies = [];
      context.clearPreviewProxyLookup();
    },
    tab() {
      const tab = { id: 'tab-a', url: `${origin}/page?q=test#section`, frameUrl: origin };
      state.browserTabs = [tab];
      frameById.set(tab.id, { dataset: { loadedUrl: origin }, src: origin });
      return tab;
    }
  };
}

const concurrentStart = fixture();
const startResults = Array.from({ length: 100 }, () => concurrentStart.start());
await settle();
assert.equal(concurrentStart.calls.starts.length, 1, 'Concurrent callers must share one native start');
const startedProxy = proxy('shared');
concurrentStart.calls.starts[0].resolve(startedProxy);
for (const result of await Promise.all(startResults)) assert.equal(result.value, startedProxy);
assert.deepEqual(concurrentStart.state.previewProxies, [startedProxy]);
assert.equal(concurrentStart.pendingSize(), 0);

const existingProxy = proxy('existing');
const concurrentProbe = fixture([existingProxy]);
const probeResults = Array.from({ length: 100 }, () => concurrentProbe.start({ forceProbe: true }));
await settle();
assert.equal(concurrentProbe.calls.probes.length, 1, 'Forced probes must share the same in-flight claim');
concurrentProbe.calls.probes[0].resolve(false);
await settle();
assert.equal(concurrentProbe.calls.starts.length, 1, 'A stale shared probe should produce only one replacement');
assert.deepEqual(concurrentProbe.calls.stops, ['existing']);
const replacement = proxy('replacement', 41002);
concurrentProbe.calls.starts[0].resolve(replacement);
for (const result of await Promise.all(probeResults)) assert.equal(result.value, replacement);
assert.deepEqual(concurrentProbe.state.previewProxies, [replacement]);
console.log('Preview proxy: 100 concurrent starts/probes each share one native operation');

const healthy = fixture([proxy('healthy')]);
const healthyResult = healthy.start({ forceProbe: true });
await settle();
healthy.calls.probes[0].resolve(true);
assert.equal((await healthyResult).value.id, 'healthy');
assert.equal(healthy.calls.starts.length, 0);
assert.deepEqual(healthy.calls.stops, []);

const lateStart = fixture();
const lateResult = lateStart.start();
await settle();
lateStart.changeWorkspace('b');
lateStart.calls.starts[0].resolve(proxy('old-scope'));
assert.match(String((await lateResult).error), /superseded/);
assert.deepEqual(lateStart.calls.stops, ['old-scope']);
assert.deepEqual(lateStart.state.previewProxies, []);
assert.deepEqual(lateStart.calls.logs, [], 'An obsolete start must not log into the new workspace');

const staleProbe = fixture([proxy('old-probe')]);
const staleProbeResult = staleProbe.start({ forceProbe: true });
await settle();
staleProbe.changeWorkspace('b');
staleProbe.calls.probes[0].resolve(false);
assert.match(String((await staleProbeResult).error), /superseded/);
assert.equal(staleProbe.calls.starts.length, 0, 'An obsolete failed probe must not create another listener');
assert.deepEqual(staleProbe.calls.stops, [], 'Do not tear down a retained old-workspace proxy from the new scope');

const returned = fixture();
const beforeLeave = returned.start();
await settle();
returned.changeWorkspace('b');
returned.changeWorkspace('a');
const afterReturn = returned.start();
await settle();
assert.equal(returned.calls.starts.length, 2);
returned.calls.starts[0].resolve(proxy('before-leave'));
assert.match(String((await beforeLeave).error), /superseded/);
assert.equal(returned.pendingSize(), 1, 'Old finally must not delete the new generation claim');
returned.calls.starts[1].resolve(proxy('after-return', 41003));
assert.equal((await afterReturn).value.id, 'after-return');
assert.deepEqual(returned.state.previewProxies.map((entry) => entry.id), ['after-return']);
assert.deepEqual(returned.calls.stops, ['before-leave']);

const forcedRetry = fixture();
const retryTab = forcedRetry.tab();
const beforeClear = forcedRetry.start();
await settle();
assert.equal(forcedRetry.context.clearPreviewProxyForBrowserTab(retryTab), false, 'No adopted proxy exists yet');
const afterClear = forcedRetry.start({ forceProbe: true });
await settle();
assert.equal(forcedRetry.calls.starts.length, 2, 'Forced clear must invalidate an unadopted pending start');
forcedRetry.calls.starts[0].resolve(proxy('before-clear'));
assert.match(String((await beforeClear).error), /superseded/);
assert.equal(forcedRetry.pendingSize(), 1);
forcedRetry.calls.starts[1].resolve(proxy('after-clear', 41004));
assert.equal((await afterClear).value.id, 'after-clear');
assert.deepEqual(forcedRetry.calls.stops, ['before-clear']);
assert.deepEqual(forcedRetry.state.previewProxies.map((entry) => entry.id), ['after-clear']);

const shutdown = fixture();
const beforeShutdown = shutdown.start();
await settle();
vm.runInContext('appShutdownStarted = true', shutdown.context);
shutdown.calls.starts[0].resolve(proxy('shutdown-result'));
assert.match(String((await beforeShutdown).error), /superseded/);
assert.deepEqual(shutdown.calls.stops, ['shutdown-result']);
assert.deepEqual(shutdown.state.previewProxies, []);
console.log('Preview proxy: scope exit/return, forced retry and shutdown reject and stop obsolete starts');

const liveUi = fixture();
const liveTab = liveUi.tab();
liveUi.context.loadBrowserTabThroughPreviewProxy(liveTab, { hard: true, reload: true });
await settle();
liveUi.calls.starts[0].resolve(proxy('live-ui'));
await settle();
assert.equal(liveTab.frameUrl, 'http://127.0.0.1:41001/page?q=test#section');
assert.equal(liveUi.calls.frames.length, 1);
assert.equal(liveUi.calls.frames[0].options.hard, true);
assert.equal(liveUi.calls.frames[0].options.reload, true);
assert.equal(liveUi.frameById.get(liveTab.id).dataset.loadedUrl, undefined);

for (const staleKind of ['workspace', 'removed-tab', 'replaced-tab', 'navigated-url']) {
  const ui = fixture();
  const tab = ui.tab();
  const beforeUrl = tab.frameUrl;
  ui.context.loadBrowserTabThroughPreviewProxy(tab);
  await settle();
  if (staleKind === 'workspace') ui.changeWorkspace('b');
  if (staleKind === 'removed-tab') ui.state.browserTabs = [];
  if (staleKind === 'replaced-tab') ui.state.browserTabs = [{ ...tab }];
  if (staleKind === 'navigated-url') tab.url = `${origin}/other`;
  ui.calls.starts[0].resolve(proxy(`stale-${staleKind}`));
  await settle();
  assert.equal(tab.frameUrl, beforeUrl, `${staleKind}: stale UI success must not mutate the tab`);
  assert.deepEqual(ui.calls.frames, [], `${staleKind}: stale UI success must not load a frame`);
  assert.deepEqual(ui.calls.status, []);
}

const staleUiError = fixture();
const staleErrorTab = staleUiError.tab();
staleUiError.context.loadBrowserTabThroughPreviewProxy(staleErrorTab);
await settle();
staleUiError.changeWorkspace('b');
staleUiError.calls.starts[0].reject(new Error('synthetic IPC failure'));
await settle();
assert.deepEqual(staleUiError.calls.status, [], 'An obsolete rejection must not replace current-workspace status');

const liveUiError = fixture();
liveUiError.context.loadBrowserTabThroughPreviewProxy(liveUiError.tab());
await settle();
liveUiError.calls.starts[0].reject(new Error('synthetic current IPC failure'));
await settle();
assert.equal(liveUiError.calls.status.length, 1);
assert.match(liveUiError.calls.status[0][0], /synthetic current IPC failure/);
assert.equal(liveUiError.calls.status[0][1], true, 'Current-scope errors remain visible');

const directFallback = fixture();
const directTab = directFallback.tab();
directFallback.context.loadBrowserTabThroughPreviewProxy(directTab);
await settle();
const abortedRequest = outcome(vm.runInContext(`previewProxyStarts.get('${origin}')`, directFallback.context));
const requestSequence = vm.runInContext('browserLoadRequestSeq', directFallback.context);
assert.equal(directFallback.context.clearPreviewProxyForBrowserTab(directTab), false);
directTab.frameUrl = directTab.url;
directFallback.calls.starts[0].resolve(proxy('cancelled-for-direct-fallback'));
assert.equal((await abortedRequest).error?.name, 'AbortError', 'Expected invalidation has an explicit cancellation type');
await settle();
assert.equal(directFallback.state.browserTabs[0], directTab, 'The same live tab still owns the UI');
assert.equal(vm.runInContext('browserLoadRequestSeq', directFallback.context), requestSequence, 'No replacement proxy load hides the error');
assert.deepEqual(directFallback.calls.status, [], 'Direct fallback cancellation must not display a proxy failure in the same live tab');
assert.deepEqual(directFallback.calls.frames, [], 'A cancelled result must not undo direct fallback');
assert.equal(directTab.frameUrl, directTab.url);
assert.deepEqual(directFallback.calls.stops, ['cancelled-for-direct-fallback']);

const newestUi = fixture();
const newestTab = newestUi.tab();
newestUi.context.loadBrowserTabThroughPreviewProxy(newestTab, { reload: true });
await settle();
newestUi.context.loadBrowserTabThroughPreviewProxy(newestTab, { hard: true, reload: true, clearCache: true });
await settle();
newestUi.calls.starts[1].resolve(proxy('newest-ui', 41005));
await settle();
newestUi.calls.starts[0].resolve(proxy('obsolete-ui', 41006));
await settle();
assert.equal(newestTab.frameUrl, 'http://127.0.0.1:41005/page?q=test#section');
assert.equal(newestUi.calls.frames.length, 1, 'Only the latest request may display its frame');
assert.deepEqual(newestUi.calls.status, []);
assert.deepEqual(newestUi.calls.stops, ['obsolete-ui']);
console.log('Browser proxy UI: newest-request ownership, stale success/error suppression and live failure visibility pass');
const startForwardNode = parsed.statements.find((node) => (
  ts.isFunctionDeclaration(node) && node.name?.text === 'startForward'
));
assert.ok(startForwardNode);
const startForwardCode = ts.transpileModule(startForwardNode.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
for (const mode of ['active', 'inactive', 'error']) {
  const calls = { starts: [], opened: [], removed: [], renders: 0, status: [] };
  const scope = { profileId: 'profile-a', workspaceId: 'workspace-a' };
  const forward = proxy('manual-forward');
  const context = vm.createContext({
    state: { activeProfile: { id: scope.profileId, kind: 'ssh' } },
    el: { remotePort: { value: '3000' }, localPort: { value: '41001' } },
    currentBrowserForwardScope: () => scope,
    browserForwardScopeIsActive: () => mode !== 'inactive',
    startBrowserForwardForScope: async (...args) => {
      calls.starts.push(args);
      if (mode === 'error') throw new Error('forward failed');
      return { forward, disposition: 'active' };
    },
    detectedPortId: (profileId, port) => `${profileId}:${port}`,
    removeDetectedPortById: (id) => calls.removed.push(id),
    renderForwards: () => calls.renders++,
    openLocalBrowserTab: (...args) => calls.opened.push(args),
    portTabLabel: (port) => `:${port}`,
    setStatus: (...args) => calls.status.push(args)
  });
  vm.runInContext(startForwardCode, context);
  await context.startForward();
  assert.deepEqual(calls.starts, [[scope, 'ssh', 3000, 41001]]);
  assert.deepEqual(calls.opened, [], 'Manual Forward must never open or focus a browser tab');
  assert.equal(calls.renders, mode === 'active' ? 1 : 0);
  if (mode === 'active') {
    assert.deepEqual(calls.removed, ['profile-a:3000']);
    assert.match(calls.status[0][0], /Forwarding/);
  } else if (mode === 'error') {
    assert.equal(calls.status[0][1], true, 'Actual forward errors must remain visible');
  } else {
    assert.deepEqual(calls.status, [], 'Late forwards must not update another workspace');
  }
}
console.log('Manual Forward establishes the tunnel without opening a browser; scope and errors preserved.');
console.log('Browser proxy scope smoke passed (helper-only; no real network/WebView exercised).');
