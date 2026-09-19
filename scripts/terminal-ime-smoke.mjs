#!/usr/bin/env node
// Replay event ordering against the installed xterm composition implementation and
// the app's actual IME bridge. Synthetic events do not emulate Windows native TSF.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const mainPath = new URL('../src/main.ts', import.meta.url);
const main = ts.createSourceFile('main.ts', readFileSync(mainPath, 'utf8'), ts.ScriptTarget.Latest, true);
const extraHelpers = new Set(['handleTerminalKey', 'handleTerminalInputData', 'filterTerminalInputData', 'terminalInputShouldSendImmediately']);
const appDeclarations = main.statements.filter((node) => ts.isFunctionDeclaration(node)
  && (/[Tt]erminalIme/.test(node.name?.text ?? '') || extraHelpers.has(node.name?.text)));
const appCode = ts.transpileModule(appDeclarations.map((node) => node.getText(main)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

const compositionPath = new URL('../node_modules/@xterm/xterm/src/browser/input/CompositionHelper.ts', import.meta.url);
const composition = ts.createSourceFile('CompositionHelper.ts', readFileSync(compositionPath, 'utf8'), ts.ScriptTarget.Latest, true);
const compositionClass = composition.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'CompositionHelper');
assert.ok(compositionClass, 'Installed xterm CompositionHelper source must be available');
const stripped = ts.transform(compositionClass, [(context) => {
  const visit = (node) => {
    if (ts.isParameter(node)) {
      return ts.factory.updateParameterDeclaration(node, node.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
        node.dotDotDotToken, node.name, node.questionToken, node.type, node.initializer);
    }
    if (ts.isClassDeclaration(node)) {
      return ts.visitEachChild(ts.factory.updateClassDeclaration(node,
        node.modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword),
        node.name, node.typeParameters, node.heritageClauses, node.members), visit, context);
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (node) => ts.visitNode(node, visit);
}]);
const compositionCode = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, stripped.transformed[0], composition), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
stripped.dispose();
const corePath = new URL('../node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts', import.meta.url);
const core = ts.createSourceFile('CoreBrowserTerminal.ts', readFileSync(corePath, 'utf8'), ts.ScriptTarget.Latest, true);
const coreClass = core.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'CoreBrowserTerminal');
const blurMethod = coreClass?.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(core) === '_handleTextAreaBlur');
assert.ok(blurMethod, 'Installed xterm blur implementation must be available');
const blurCode = ts.transpileModule(`class XtermBlurOwner { ${blurMethod.getText(core)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

class FakeTextarea {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  isConnected = true;
  style = {};
  listeners = new Map();
  addEventListener(type, callback, options = false) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture: typeof options === 'boolean' ? options : Boolean(options.capture) });
    this.listeners.set(type, listeners);
  }
  dispatchEvent(event) {
    event.target = this;
    event.stopImmediatePropagation ??= () => { event.stopped = true; };
    for (const capture of [true, false]) {
      for (const listener of this.listeners.get(event.type) ?? []) {
        if (listener.capture !== capture) continue;
        listener.callback(event);
        if (event.stopped) return true;
      }
    }
    return true;
  }
}

function harness() {
  let now = 1;
  let nextTimer = 1;
  const timers = new Map();
  const sent = [];
  const actions = [];
  const activeClasses = new Set();
  const classList = {
    add: (name) => activeClasses.add(name),
    remove: (name) => activeClasses.delete(name),
    contains: (name) => activeClasses.has(name)
  };
  const textarea = new FakeTextarea();
  const compositionView = { classList, style: {}, textContent: '' };
  const document = { activeElement: textarea, body: {}, documentElement: {}, hasFocus: () => true };
  const setTimeout = (callback, delay = 0) => {
    const id = nextTimer++;
    timers.set(id, { callback, due: now + delay });
    return id;
  };
  const pane = {
    paneId: 'fixture-pane',
    host: { querySelector: (selector) => selector === '.composition-view' ? compositionView : selector === '.xterm' ? { classList } : textarea },
    term: { rows: 24, refresh() {}, hasSelection: () => false }
  };
  const context = vm.createContext({
    console, document, C0: { DEL: '\x7f' },
    performance: { now: () => now },
    state: { ideSettings: { debugLogEnabled: false }, activePaneId: pane.paneId },
    pendingTerminalImeUiSwitch: null,
    TERMINAL_IME_RELEASE_DEFER_MS: 120,
    TERMINAL_IME_COMPOSITION_FALLBACK_MS: 30000,
    TERMINAL_IME_COMPOSITION_HARD_LIMIT_MS: 120000,
    FocusEvent: class { constructor(type) { this.type = type; } },
    setTimeout,
    window: { setTimeout, clearTimeout: (id) => timers.delete(id) },
    isTerminalPaneAlive: (value) => !value.closed,
    terminalPaneTextarea: () => textarea,
    terminalPaneVisibility: () => 'visible',
    terminalPaneHasFocus: () => document.activeElement === textarea,
    markTerminalUserInput() {}, cancelTerminalFocusRequest() {}, scheduleFitTerminal() {},
    focusActiveTerminalPaneWhenItOwnsKeyboard() {}, setStatus() {},
    sanitizeDiagnosticLogPart: (value) => value,
    terminalShouldSuppressFocusReports: () => false,
    markWorkspaceLlmInputActivityForPane() {}, trackTerminalCwdFromInput() {},
    sendTerminalInputNow: async (_pane, value) => { sent.push(value); },
    queueTerminalInput: (_pane, value) => { sent.push(value); },
    reportTerminalInputWriteError: (value) => { throw new Error(String(value)); },
    setTerminalTextTarget() {}, isWidgetFocusShortcut: () => false,
    terminalSplitNavigationDirection: () => null, isTerminalTypingPadFocusShortcut: () => false,
    shortcutResizeDirection: () => 0,
    copyTerminalSelection: () => actions.push('copy'),
    pasteTerminalClipboard: async () => { actions.push('paste'); }
  });
  vm.runInContext(`${appCode}\n${compositionCode}\n${blurCode}`, context);
  const coreService = { decPrivateModes: { sendFocus: false }, triggerDataEvent: (value) => context.handleTerminalInputData(pane, value) };
  const helper = new (vm.runInContext('CompositionHelper', context))(textarea, compositionView,
    { buffer: { isCursorInViewport: false } }, { rawOptions: {} }, coreService, {});
  const blurOwner = new (vm.runInContext('XtermBlurOwner', context))();
  Object.assign(blurOwner, { textarea, refresh() {}, buffer: { y: 0 }, coreService,
    element: { classList }, _onBlur: { fire: () => actions.push('blur') } });
  // xterm registers its handlers during open(); the IDE binds its guard later.
  textarea.addEventListener('compositionstart', () => helper.compositionstart());
  textarea.addEventListener('compositionupdate', (event) => helper.compositionupdate(event));
  textarea.addEventListener('compositionend', () => helper.compositionend());
  textarea.addEventListener('blur', () => blurOwner._handleTextAreaBlur());
  context.bindTerminalImeCompositionGuard(pane);
  function runReady() {
    let runs = 0;
    while (true) {
      const next = [...timers].find(([, timer]) => timer.due <= now);
      if (!next) return;
      assert.ok(++runs < 1000, 'IME immediate timers must settle');
      timers.delete(next[0]);
      next[1].callback();
    }
  }
  function runNextReady() {
    const next = [...timers].find(([, timer]) => timer.due <= now);
    assert.ok(next, 'Expected one ready IME timer');
    timers.delete(next[0]);
    next[1].callback();
  }
  function compose(value) {
    textarea.dispatchEvent({ type: 'compositionstart', data: '' });
    textarea.dispatchEvent({ type: 'compositionupdate', data: value });
    textarea.value += value;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    runReady();
  }
  function end(value = '') { textarea.dispatchEvent({ type: 'compositionend', data: value }); }
  function blur() { document.activeElement = document.body; textarea.dispatchEvent({ type: 'blur' }); }
  function key(value, code, options = {}) {
    const event = { type: 'keydown', key: value, code: value, keyCode: code, isComposing: false,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...options };
    const allowed = context.handleTerminalKey(event, pane);
    if (allowed && helper.keydown(event) && value === 'Enter') coreService.triggerDataEvent('\r');
    return allowed;
  }
  return { context, pane, textarea, sent, actions, timers, document, helper, compose, end, blur, key, runReady, runNextReady,
    advance: (milliseconds) => { now += milliseconds; runReady(); } };
}

function checkBlurAfterCompositionEnd() {
  const h = harness();
  h.compose('한');
  h.end(''); // Never trust compositionend.data over xterm's canonical textarea.
  h.blur();
  h.runReady();
  assert.deepEqual(h.sent, ['한'], 'Blur after compositionend must not clear the pending canonical Hangul commit');
  assert.equal(h.textarea.value, '', 'xterm still owns the normal blur cleanup');
  assert.equal(h.actions.filter((value) => value === 'blur').length, 1, 'deferred blur is replayed exactly once');
}

function checkBlurBeforeCompositionEnd() {
  const h = harness();
  h.compose('글');
  h.blur();
  h.end('wrong');
  h.runReady();
  assert.deepEqual(h.sent, ['글']);
  assert.equal(h.actions.filter((value) => value === 'blur').length, 1);
}

function checkNewCompositionBeforeDeferredBlur() {
  const h = harness();
  h.compose('한');
  h.end();
  h.blur();
  h.document.activeElement = h.textarea;
  h.compose('글');
  h.end();
  h.runReady();
  assert.deepEqual(h.sent, ['한', '글'], 'A newer composition survives the older deferred blur');
  assert.equal(h.actions.includes('blur'), false, 'Refocusing cancels the obsolete blur');
}

function checkNextKeyFinalizeAndNormalShortcuts() {
  const h = harness();
  h.compose('한');
  h.key('Enter', 13);
  h.runReady();
  assert.deepEqual(h.sent, ['한', '\r'], 'xterm canonical finalize precedes Enter when compositionend was omitted');
  const normal = harness();
  assert.equal(normal.key('c', 67, { ctrlKey: true }), true, 'Ctrl+C without selection stays an interrupt');
  assert.deepEqual(normal.actions, []);
  normal.pane.term.hasSelection = () => true;
  assert.equal(normal.key('c', 67, { ctrlKey: true }), false);
  assert.equal(normal.key('v', 86, { ctrlKey: true }), false);
  assert.deepEqual(normal.actions, ['copy', 'paste']);
}

function checkRepeatedHangulAndOrdinaryBlur() {
  const h = harness();
  for (let index = 0; index < 3; index += 1) {
    h.compose('가');
    h.end('가');
    h.runReady();
  }
  assert.deepEqual(h.sent, ['가', '가', '가'], 'Legitimate repeated Hangul is never string/time deduplicated');
  h.advance(120);
  h.blur();
  assert.equal(h.textarea.value, '');
  assert.deepEqual(h.actions, ['blur']);
}

function beginCompositionWithoutSettling(h, value) {
  h.textarea.dispatchEvent({ type: 'compositionstart', data: '' });
  h.textarea.dispatchEvent({ type: 'compositionupdate', data: value });
  h.textarea.value += value;
  h.textarea.selectionStart = h.textarea.selectionEnd = h.textarea.value.length;
}

function checkNewCompositionOvertakesQueuedBlur() {
  const h = harness();
  h.compose('한');
  h.end();
  h.blur();
  h.runNextReady(); // xterm's canonical commit
  h.runNextReady(); // app boundary queues, but does not yet replay, the blur
  assert.ok(h.pane.imeBlurReplayTimer);
  // Native composition events may still arrive while blur cleanup is pending.
  beginCompositionWithoutSettling(h, '글');
  h.runReady();
  assert.equal(h.pane.imeDeferredXtermBlur, true, 'A new composition keeps the old blur deferred');
  assert.equal(h.actions.includes('blur'), false, 'Queued blur must not clear newer preedit');
  h.end();
  h.runReady();
  assert.deepEqual(h.sent, ['한', '글']);
  assert.deepEqual(h.actions, ['blur'], 'Cleanup runs exactly once after the new commit');
}

function checkStaleCommitBoundaryGeneration() {
  const h = harness();
  h.compose('한');
  h.end();
  const staleCallback = h.timers.get(h.pane.imeCommitTimer).callback;
  h.context.scheduleTerminalImeCommitBoundary(h.pane, h.textarea);
  const currentTimer = h.pane.imeCommitTimer;
  // Invoke the superseded task explicitly to verify the generation check independently
  // of clearTimeout, as if a host had already selected that task for dispatch.
  staleCallback();
  assert.equal(h.pane.imeCommitPending, true, 'An old boundary must not release the newer commit');
  assert.equal(h.pane.imeCommitTimer, currentTimer, 'An old callback must not erase the live timer');
  h.runReady();
  assert.equal(h.pane.imeCommitPending, false);
  assert.deepEqual(h.sent, ['한']);
}

function checkClosedPaneCancelsQueuedUiSwitch() {
  const h = harness();
  let switches = 0;
  h.compose('한');
  h.context.deferTerminalImeUiSwitch(h.pane, 'test switch', () => { switches += 1; });
  h.end();
  h.runNextReady();
  h.runNextReady(); // releases the switch into a separate UI task
  h.pane.closed = true;
  h.runReady();
  assert.equal(switches, 0, 'A released but not yet dispatched UI action must ignore a closed source pane');
}

function checkUiSwitchDefersThroughNewComposition() {
  const h = harness();
  let switches = 0;
  h.compose('한');
  h.context.deferTerminalImeUiSwitch(h.pane, 'test switch', () => { switches += 1; });
  h.end();
  h.runNextReady();
  h.runNextReady();
  beginCompositionWithoutSettling(h, '글');
  h.runReady();
  assert.equal(switches, 0, 'A new composition must delay an already released UI switch');
  assert.ok(h.context.pendingTerminalImeUiSwitch, 'The UI action remains pending, not discarded');
  h.end();
  h.runReady();
  assert.equal(switches, 1, 'The delayed UI switch runs exactly once after the next commit');
  assert.equal(h.context.pendingTerminalImeUiSwitch, null);
  assert.deepEqual(h.sent, ['한', '글']);
}

function checkInputHotPathSkipsDisabledWork() {
  const h = harness();
  const unreadable = new Proxy({}, { get() { assert.fail('disabled IME diagnostics must not read DOM/event fields'); } });
  h.context.appendTerminalImeCompositionDiagnostic(h.pane, 'compositionupdate', unreadable, unreadable);
  h.context.appendTerminalImeInputDiagnostic(h.pane, 'beforeinput', unreadable, unreadable);

  const names = new Set(['scheduleFitTerminal', 'fitTerminal', 'terminalPaneCanFit']);
  const code = ts.transpileModule(main.statements.filter((node) => ts.isFunctionDeclaration(node)
    && names.has(node.name?.text)).map((node) => node.getText(main)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const context = vm.createContext({
    state: { activeWorkspaceId: 'active' },
    terminalImeCompositionGuardActive: () => true
  });
  vm.runInContext(code, context);
  context.scheduleFitTerminal({});
  context.fitTerminal({});
  assert.equal(context.terminalPaneCanFit({ workspaceId: 'inactive' }), false,
    'inactive panes must be rejected before querying layout');
  console.log('PASS disabled diagnostics and IME/inactive fit skip native property/layout reads');
}

checkBlurAfterCompositionEnd();
checkBlurBeforeCompositionEnd();
checkNewCompositionBeforeDeferredBlur();
checkNextKeyFinalizeAndNormalShortcuts();
checkRepeatedHangulAndOrdinaryBlur();
checkNewCompositionOvertakesQueuedBlur();
checkStaleCommitBoundaryGeneration();
checkClosedPaneCancelsQueuedUiSwitch();
checkUiSwitchDefersThroughNewComposition();
checkInputHotPathSkipsDisabledWork();
console.log('PASS installed-xterm Hangul commit/blur ordering, refocus, next-key finalize, repeated syllables, and copy/paste ownership');
console.log('PASS IME boundary generations, newer compositions, closed-pane UI cancellation, and exactly-once deferred switches');

if (process.argv.includes('--upstream-probe')) {
  const h = harness();
  // Simulate native input arriving in a burst before JS timer tasks can run.
  // Do not use compose(), which intentionally drains each update's timers.
  for (const value of ['니', '다']) {
    h.textarea.dispatchEvent({ type: 'compositionstart', data: '' });
    h.textarea.dispatchEvent({ type: 'compositionupdate', data: value });
    h.textarea.value += value;
    h.textarea.selectionStart = h.textarea.selectionEnd = h.textarea.value.length;
    h.end();
  }
  h.key('.', 190);
  h.runReady();
  console.log(h.sent.join('') === '니다'
    ? 'UPSTREAM PROBE: burst Hangul commit preserved'
    : 'KNOWN UPSTREAM LIMIT: pending compositions lose text under a timer backlog (xterm #6089); not a Windows-native reproduction');
}
