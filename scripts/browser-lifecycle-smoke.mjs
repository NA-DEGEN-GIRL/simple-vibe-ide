import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Extract real lifecycle helpers; this is not a WebView2 or network runtime test.
const baseline = process.argv.includes('--baseline');
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function helpers(names, bindings, variablePrefix = '') {
  const wanted = new Set(names);
  const declarations = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)
  ));
  assert.equal(declarations.length, wanted.size, 'Every requested lifecycle helper must exist');
  const variables = variablePrefix ? parsed.statements.filter((node) => (
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => (
      ts.isIdentifier(entry.name) && entry.name.text.startsWith(variablePrefix)
    ))
  )) : [];
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule([...variables, ...declarations].map((node) => node.getText(parsed)).join('\n'), {
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

function frameFixture() {
  const writes = [];
  const messages = [];
  const events = new Map();
  let reloads = 0;
  let crossOrigin = false;
  let currentSrc = '';
  const state = { browserConsoleVisible: true, activeWorkspaceId: 'workspace', activeBrowserTabId: 'tab' };
  const frame = {
    dataset: { browserWorkspaceId: 'workspace', browserTabId: 'tab' },
    classList: { contains: () => false },
    contentWindow: {
      location: { reload() { if (crossOrigin) throw new Error('Cross-origin frame'); reloads += 1; } },
      postMessage(value) { messages.push(value); }
    },
    addEventListener(name, handler) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    },
    getAttribute(name) { return name === 'src' ? currentSrc : null; },
    get src() { return currentSrc; },
    set src(value) { currentSrc = value; writes.push(value); }
  };
  const context = helpers([
    'loadBrowserFrame', 'bindBrowserFrameEvents', 'browserFrameIsActiveVisible',
    'browserConsoleDetailedForFrame', 'setBrowserFrameConsoleDetailed', 'syncBrowserConsoleCaptureForFrame'
  ], {
    state,
    USE_PREVIEW_PROXY_BROWSER: true,
    USE_EDGE_CDP_BROWSER: false,
    hideNativeBrowserWebview() {},
    showBrowserFrame: () => frame,
    withPreviewCacheBuster: (value) => `${value}?__test=refresh`,
    activateBrowserPanel() {},
    logBrowserConsole() {},
    isBrowserPanelHidden: () => false
  });
  return {
    context, frame, state, writes, messages, events,
    reloads: () => reloads,
    crossOrigin: () => { crossOrigin = true; },
    load() { for (const handler of events.get('load') ?? []) handler(); }
  };
}

function frameNavigationCoalescing() {
  const fixture = frameFixture();
  const { context, frame, writes } = fixture;
  const tab = { id: 'tab', url: 'http://localhost:3000/page', frameUrl: 'http://localhost:4000/page' };
  for (let index = 0; index < 100; index += 1) context.loadBrowserFrame(tab);
  console.log(`iframe: ${writes.length} src assignments for 100 activations while loading`);
  if (!baseline) assert.equal(writes.length, 1, 'Reactivating an in-flight iframe must not restart the same navigation');

  const previousWrites = writes.length;
  tab.frameUrl = 'http://localhost:4000/next';
  context.loadBrowserFrame(tab);
  assert.equal(writes.length, previousWrites + 1, 'A different URL must still navigate');
  assert.equal(frame.dataset.loadingUrl, tab.frameUrl);
  context.bindBrowserFrameEvents(frame);
  fixture.load();
  assert.equal(frame.dataset.loadedUrl, tab.frameUrl);
  context.loadBrowserFrame(tab);
  assert.equal(writes.length, previousWrites + 1, 'Loaded frames retain their page on activation');
  context.loadBrowserFrame(tab, { reload: true });
  assert.equal(fixture.reloads(), 1, 'Explicit same-origin reload must bypass deduplication');
  fixture.crossOrigin();
  context.loadBrowserFrame(tab, { reload: true });
  assert.equal(writes.length, previousWrites + 2, 'Cross-origin reload must assign src when location.reload is denied');
  context.loadBrowserFrame(tab, { hard: true });
  assert.equal(writes.length, previousWrites + 3, 'Explicit hard reload must bypass in-flight deduplication');
  frame.dataset.suspended = 'true';
  frame.src = 'about:blank';
  context.loadBrowserFrame(tab);
  assert.equal(frame.src, tab.frameUrl, 'Suspended documents must not be mistaken for an in-flight preview');
  const beforeError = writes.length;
  for (const handler of fixture.events.get('error') ?? []) handler();
  context.loadBrowserFrame(tab);
  if (!baseline) assert.equal(writes.length, beforeError + 1, 'Failed iframe navigation must remain retryable');
}

function frameConsoleModePerDocument() {
  const { context, frame, state, messages, events, load } = frameFixture();
  context.bindBrowserFrameEvents(frame);
  context.bindBrowserFrameEvents(frame);
  assert.equal(events.get('load').length, 1, 'Frame event listeners must remain idempotent');
  context.syncBrowserConsoleCaptureForFrame(frame);
  assert.equal(messages.length, 1);
  load();
  console.log(`iframe: ${messages.length - 1} console-mode posts to a replacement document`);
  if (!baseline) assert.equal(messages.length, 2, 'A new iframe document needs its own console mode message');
  assert.equal(messages.at(-1).__simpleVibeConsoleDetailed, true);
  const visibleCount = messages.length;
  context.syncBrowserConsoleCaptureForFrame(frame);
  assert.equal(messages.length, visibleCount, 'The same document still deduplicates unchanged mode');
  state.browserConsoleVisible = false;
  context.syncBrowserConsoleCaptureForFrame(frame);
  const hiddenCount = messages.length;
  load();
  if (!baseline) assert.equal(messages.length, hiddenCount + 1, 'New documents receive compact mode too');
  assert.equal(messages.at(-1).__simpleVibeConsoleDetailed, false);
}

function refreshFixture(local = false) {
  const calls = [];
  const tab = { id: 'tab', url: local ? 'http://localhost:3000/' : 'https://example.invalid/' };
  const state = { previewUrl: tab.url };
  const frame = { dataset: {}, set src(value) { calls.push(['src', value]); } };
  const context = helpers(['refreshPreview', 'clearBrowserCacheAndReload'], {
    state, el: { previewUrl: {} },
    activeEdgeCdp: null,
    USE_NATIVE_BROWSER_WEBVIEW: true,
    USE_EDGE_CDP_BROWSER: false,
    USE_PREVIEW_PROXY_BROWSER: true,
    currentBrowserTab: () => tab,
    nativeBrowserWebviewAllowedForActiveWorkspace: () => false,
    nativeBrowserWebviewLabelForOperation: () => '',
    hideBrowserAddressSuggestions() {},
    activateBrowserTab: (...args) => calls.push(['activate', ...args]),
    showNativeBrowserWebview: async (...args) => { calls.push(['native', ...args]); },
    loadBrowserFrame: (...args) => calls.push(['iframe', ...args]),
    loadBrowserTabThroughPreviewProxy: (...args) => calls.push(['proxy', ...args]),
    clearPreviewProxyForBrowserTab: (...args) => calls.push(['clear-proxy', ...args]),
    localHttpPreviewUrl: () => local ? {} : null,
    browserFrameForTab: () => frame,
    withPreviewCacheBuster: (url) => `${url}?__test=refresh`,
    setInputValueIfChanged() {},
    logBrowserConsole() {},
    setStatus() {}
  });
  return { context, calls, tab };
}

async function captureSafeReloadRoutes() {
  for (const local of [false, true]) {
    const { context, calls } = refreshFixture(local);
    const route = local ? 'proxy' : 'iframe';
    context.refreshPreview(false);
    context.refreshPreview(true);
    await context.clearBrowserCacheAndReload();
    const loads = calls.filter((call) => call[0] === route);
    console.log(`capture-safe ${route}: ${loads.length} actual reload calls for Reload, Hard refresh and Clear cache`);
    if (!baseline) {
      assert.equal(loads.length, 3, 'Capture-safe preview controls must reach the iframe/proxy reload path');
      assert.equal(loads[0][2].reload, true);
      assert.equal(loads[0][2].hard, false);
      assert.equal(loads[1][2].reload, true);
      assert.equal(loads[1][2].hard, true);
      assert.equal(loads[2][2].hard, true);
      assert.equal(calls.some((call) => call[0] === 'native'), false, 'Capture protection must not create a native child');
      assert.equal(calls.some((call) => call[0] === 'activate'), false, 'Reload must not silently turn into tab activation');
    }
  }
}

function nativeFixture() {
  const shows = [];
  const hides = [];
  const closes = [];
  const fallbacks = [];
  const tabs = [
    { id: 'tab', url: 'https://example.invalid/' },
    { id: 'other', url: 'https://other.invalid/' }
  ];
  const state = { activeWorkspaceId: 'workspace', activeBrowserTabId: 'tab', browserTabs: tabs };
  let rect = { x: 1.25, y: 2.5, width: 800, height: 600 };
  const context = helpers([
    'showNativeBrowserWebview', 'hideNativeBrowserWebview', 'closeNativeBrowserWebview',
    'closeAllNativeBrowserWebviews', 'closeHiddenNativeBrowserWebview'
  ], {
    state, el: { browserShell: {} },
    appShutdownStarted: false,
    document: { hidden: false },
    window: { cancelAnimationFrame() {} },
    nativeBrowserWebviewAllowedForActiveWorkspace: () => true,
    nativeBrowserWebviewLabelForTab: (tab) => `native-${state.activeWorkspaceId}-${tab.id}`,
    nativeBrowserPreviewRect: () => rect,
    browserTabForId: (id) => tabs.find((tab) => tab.id === id),
    isBrowserPanelHidden: () => false,
    scheduleNativeBrowserWebviewClose() {},
    cancelNativeBrowserWebviewClose() {},
    cancelAllNativeBrowserWebviewCloses() {},
    hideAllBrowserFrames() {},
    disconnectActiveEdgeCdp() {},
    setEdgePreviewVisible() {},
    toggleClassIfChanged() {},
    logBrowserConsole() {},
    setStatus() {},
    loadBrowserTabFallback: (tab) => fallbacks.push(tab.id),
    api: {
      showBrowserWebview(...args) {
        const completion = deferred();
        shows.push({ args, ...completion });
        return completion.promise;
      },
      async hideBrowserWebview(label) { hides.push(label); },
      closeBrowserWebview(label) {
        const completion = deferred();
        closes.push({ label, ...completion });
        return completion.promise;
      }
    }
  }, 'nativeBrowserWebview');
  return {
    context, state, tabs, shows, hides, closes, fallbacks,
    setRect(value) { rect = value; },
    async show(tab = tabs[0], options = {}) {
      const before = shows.length;
      const promise = context.showNativeBrowserWebview(tab, options);
      for (const call of shows.slice(before)) call.resolve();
      await promise;
    },
    resolveAll() { for (const call of [...shows, ...closes]) call.resolve(); }
  };
}

async function nativeBoundsDeduplication() {
  const settled = nativeFixture();
  await settled.show();
  for (let index = 0; index < 100; index += 1) await settled.show(settled.tabs[0], { boundsOnly: true, navigate: false });
  console.log(`native: ${settled.shows.length - 1} unchanged-bounds IPC calls for 100 settled syncs`);
  if (!baseline) assert.equal(settled.shows.length, 1, 'Unchanged settled bounds must skip native IPC');
  const beforeMove = settled.shows.length;
  settled.setRect({ x: 1.5, y: 2.5, width: 800, height: 600 });
  await settled.show(settled.tabs[0], { boundsOnly: true, navigate: false });
  assert.equal(settled.shows.length, beforeMove + 1, 'Subpixel geometry changes must not be rounded away');
  await settled.show(settled.tabs[0], { boundsOnly: true, navigate: true, loadUrl: settled.tabs[0].url });
  assert.equal(settled.shows.length, beforeMove + 2, 'Explicit navigation must bypass bounds deduplication');

  const pending = nativeFixture();
  const promises = [pending.context.showNativeBrowserWebview(pending.tabs[0])];
  for (let index = 0; index < 100; index += 1) {
    promises.push(pending.context.showNativeBrowserWebview(pending.tabs[0], { boundsOnly: true, navigate: false }));
  }
  console.log(`native: ${pending.shows.length} IPC calls for 100 duplicate syncs behind an in-flight show`);
  if (!baseline) assert.equal(pending.shows.length, 1, 'Duplicate bounds must not fan out behind one pending show');
  pending.resolveAll();
  await Promise.all(promises);
  if (!baseline) {
    assert.equal(vm.runInContext('nativeBrowserWebviewPendingKey', pending.context), '',
      'Skipped duplicate calls must not stale the original completion sequence');
    assert.notEqual(vm.runInContext('nativeBrowserWebviewAppliedKey', pending.context), '');
  }

  // A -> B pending -> A cannot skip A merely because A was once successfully applied.
  const reordered = nativeFixture();
  await reordered.show();
  reordered.setRect({ x: 100, y: 2.5, width: 800, height: 600 });
  const second = reordered.context.showNativeBrowserWebview(reordered.tabs[0], { boundsOnly: true });
  reordered.setRect({ x: 1.25, y: 2.5, width: 800, height: 600 });
  const third = reordered.context.showNativeBrowserWebview(reordered.tabs[0], { boundsOnly: true });
  assert.equal(reordered.shows.length, 3, 'A pending different rect invalidates the prior applied-rect shortcut');
  reordered.shows[2].resolve();
  await third;
  reordered.shows[1].resolve();
  await second;
  assert.equal(reordered.hides.length, 0, 'Obsolete same-label completion must not hide the desired native child');
}

async function nativeLifecycleInvalidation() {
  for (const transition of ['hide', 'close', 'close-all', 'zero-rect']) {
    const fixture = nativeFixture();
    await fixture.show();
    if (transition === 'hide') fixture.context.hideNativeBrowserWebview();
    if (transition === 'close') fixture.context.closeNativeBrowserWebview('native-workspace-tab');
    if (transition === 'close-all') fixture.context.closeAllNativeBrowserWebviews();
    if (transition === 'zero-rect') {
      fixture.setRect(null);
      await fixture.show(fixture.tabs[0], { boundsOnly: true });
      fixture.setRect({ x: 1.25, y: 2.5, width: 800, height: 600 });
    }
    await fixture.show(fixture.tabs[0], { boundsOnly: true });
    assert.equal(fixture.shows.length, 2, `${transition} must permit recovery at the same bounds`);
    fixture.resolveAll();
  }

  const failure = nativeFixture();
  const failed = failure.context.showNativeBrowserWebview(failure.tabs[0], { boundsOnly: true });
  failure.shows[0].reject(new Error('Native preview unavailable'));
  await failed;
  assert.deepEqual(failure.fallbacks, ['tab']);
  await failure.show(failure.tabs[0], { boundsOnly: true });
  assert.equal(failure.shows.length, 2, 'Failed requests must never populate the applied-bounds cache');

  const race = nativeFixture();
  await race.show();
  race.context.hideNativeBrowserWebview();
  const close = race.context.closeHiddenNativeBrowserWebview('native-workspace-tab');
  await race.show(race.tabs[0], { boundsOnly: true });
  race.closes[0].resolve();
  await close;
  assert.equal(race.shows.length, 3, 'Late retention close must recreate a reactivated child even with identical bounds');
  race.resolveAll();
  await Promise.resolve();
}

function assetRecoveryFixture() {
  let nextTimer = 0;
  const timers = new Map();
  const calls = [];
  const state = {
    activeWorkspaceId: 'workspace', activeBrowserTabId: 'tab', activeProfile: { id: 'profile' }, workspaceOpen: true
  };
  let tab = { id: 'tab', url: 'https://example.invalid/old' };
  const context = helpers(['scheduleBrowserAssetRecovery'], {
    state,
    appShutdownStarted: false,
    previewProxyScopeGeneration: 1,
    browserAssetRecoveryTimers: new Map(),
    browserAssetRecoveryByTabId: new Map(),
    BROWSER_ASSET_RECOVERY_MAX_ATTEMPTS: 3,
    BROWSER_ASSET_RECOVERY_WINDOW_MS: 45_000,
    BROWSER_ASSET_RECOVERY_DELAYS_MS: [600, 1400, 2800],
    USE_PREVIEW_PROXY_BROWSER: false,
    browserTabForId: () => tab,
    localHttpPreviewUrl: () => null,
    loadBrowserFrame: (...args) => calls.push(args),
    logBrowserConsole() {},
    fallbackBrowserTabToDirectPreview: () => false,
    window: {
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  return {
    context, state, calls,
    tab: () => tab,
    replaceTab() { tab = { ...tab }; },
    fire() { for (const callback of timers.values()) callback(); timers.clear(); }
  };
}

function assetRecoveryScope() {
  const current = assetRecoveryFixture();
  current.context.scheduleBrowserAssetRecovery(current.tab());
  current.fire();
  assert.equal(current.calls.length, 1, 'Current asset failure still retries');
  for (const change of ['url', 'workspace', 'profile', 'generation', 'tab-object']) {
    const fixture = assetRecoveryFixture();
    fixture.context.scheduleBrowserAssetRecovery(fixture.tab());
    if (change === 'url') fixture.tab().url = 'https://example.invalid/new';
    if (change === 'workspace') fixture.state.activeWorkspaceId = 'another-workspace';
    if (change === 'profile') fixture.state.activeProfile = { id: 'another-profile' };
    if (change === 'generation') fixture.context.previewProxyScopeGeneration += 1;
    if (change === 'tab-object') fixture.replaceTab();
    fixture.fire();
    console.log(`asset retry after ${change} change: ${fixture.calls.length} stale reloads`);
    if (!baseline) assert.equal(fixture.calls.length, 0, `Asset retry must not reload a newer ${change}`);
  }
}

function workspaceSuspendFixture() {
  const timers = new Map();
  const idle = [];
  const suspended = [];
  let nextTimer = 0;
  const state = { activeWorkspaceId: 'active' };
  const context = helpers([
    'scheduleBrowserWorkspaceFrameSuspend', 'cancelScheduledBrowserWorkspaceFrameSuspend',
    'trimHiddenBrowserFrameWorkspaces'
  ], {
    state,
    document: { hidden: false },
    browserWorkspaceSuspendTimers: new Map(),
    BROWSER_HIDDEN_CONTEXT_TTL_MS: 300_000,
    BROWSER_FRAME_SUSPEND_IDLE_MS: 250,
    BROWSER_FRAME_WORKSPACE_RETAIN_LIMIT: 4,
    isBrowserPanelHidden: () => false,
    suspendBrowserFramesForWorkspace: (workspaceId) => suspended.push(workspaceId),
    runWhenUiIdle(callback, _timeout, _allowWhileBusy, cancelled) { idle.push({ callback, cancelled }); },
    window: {
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  return {
    context, state, timers, idle, suspended,
    fireTimer(id = timers.keys().next().value) {
      const callback = timers.get(id);
      assert.ok(callback);
      timers.delete(id);
      callback();
    }
  };
}

function workspaceSuspendCancellation() {
  const fixture = workspaceSuspendFixture();
  fixture.context.scheduleBrowserWorkspaceFrameSuspend('inactive', { includeActive: true });
  fixture.fireTimer();
  const staleIdle = fixture.idle.shift();
  fixture.state.activeWorkspaceId = 'inactive';
  fixture.context.cancelScheduledBrowserWorkspaceFrameSuspend('inactive');
  fixture.state.activeWorkspaceId = 'active';
  fixture.context.scheduleBrowserWorkspaceFrameSuspend('inactive', { includeActive: true });
  if (!baseline) assert.equal(staleIdle.cancelled?.(), true, 'Obsolete idle retries should stop scheduling');
  staleIdle.callback();
  console.log(`workspace suspension: ${fixture.suspended.length} stale idle suspends after cancel and rearm`);
  if (!baseline) {
    assert.equal(fixture.suspended.length, 0, 'An expired timer must not steal a newer workspace grace period');
    assert.equal(fixture.context.browserWorkspaceSuspendTimers.size, 1, 'An old callback must not erase the current timer token');
  }
  fixture.fireTimer();
  fixture.idle.shift().callback();
  if (!baseline) assert.deepEqual(fixture.suspended, ['inactive'], 'The current timer still suspends its hidden workspace');

  const active = workspaceSuspendFixture();
  active.context.scheduleBrowserWorkspaceFrameSuspend('active', { includeActive: true });
  active.fireTimer();
  active.idle.shift().callback();
  assert.deepEqual(active.suspended, [], 'A visible active workspace must never be suspended');

  const capped = workspaceSuspendFixture();
  for (let index = 0; index < 5; index += 1) {
    capped.context.scheduleBrowserWorkspaceFrameSuspend(`hidden-${index}`, { includeActive: true });
  }
  assert.deepEqual(capped.suspended, ['hidden-0'], 'Oldest hidden context is still evicted at the existing cap');
  assert.equal(capped.context.browserWorkspaceSuspendTimers.size, 4);
}

frameNavigationCoalescing();
frameConsoleModePerDocument();
await captureSafeReloadRoutes();
await nativeBoundsDeduplication();
await nativeLifecycleInvalidation();
assetRecoveryScope();
workspaceSuspendCancellation();
console.log(baseline ? 'Browser lifecycle baseline recorded.' : 'Browser lifecycle smoke passed.');
