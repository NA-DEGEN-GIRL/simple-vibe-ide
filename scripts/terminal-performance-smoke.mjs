#!/usr/bin/env node
// Run real terminal-history helpers without starting Tauri or a provider session.
// This covers CPU/queue invariants; it does not replace Windows/WebView2 smoke.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const helperNames = new Set([
  'surrogateSafeChunkEnd',
  'flushTerminalWriteBufferWhenReady',
  'terminalHasCachedHistory',
  'runWhenUiIdle'
]);
const declarations = [];
const constantNames = [];
for (const statement of sourceFile.statements) {
  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text ?? '';
    if (/TerminalHistory|^terminalHistory/.test(name) || helperNames.has(name)) {
      declarations.push(statement.getText(sourceFile));
    }
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.name.text.startsWith('TERMINAL_HISTORY_')) continue;
      declarations.push(`const ${declaration.getText(sourceFile)};`);
      constantNames.push(declaration.name.text);
    }
  }
}
const compiled = ts.transpileModule(declarations.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

function createHarness(mode = 'balanced') {
  const timers = new Map();
  const idleCallbacks = [];
  const idleTimeouts = [];
  let nextTimer = 1;
  const context = vm.createContext({
    performance,
    console,
    appShutdownStarted: false,
    state: { ideSettings: { terminalHistoryCache: mode } },
    window: {
      setTimeout(callback) {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
      requestIdleCallback(callback, options) {
        idleCallbacks.push(callback);
        idleTimeouts.push(options?.timeout);
        return nextTimer++;
      }
    },
    terminalHistoryCacheMode: (value) => value,
    terminalWidgetForPane: () => null,
    isTerminalPaneAlive: (pane) => !pane.closed,
    terminalPaneVisibility: (pane) => pane.visibility ?? 'background',
    uiBusyDelayMs: () => 0,
    flushTerminalWriteBuffer: (pane) => { pane.flushCount = (pane.flushCount ?? 0) + 1; },
    appendDiagnosticLog: () => {},
    diagnosticPaneLabel: () => 'fixture',
    clamp: (value, min, max) => Math.max(min, Math.min(max, value))
  });
  vm.runInContext(compiled, context);
  const constants = vm.runInContext(`({${constantNames.join(',')}})`, context);
  function runTimer() {
    const next = timers.entries().next().value;
    assert.ok(next, 'expected a scheduled history continuation');
    timers.delete(next[0]);
    next[1]();
  }
  function drainTimers() {
    let turns = 0;
    while (timers.size) {
      assert.ok(++turns < 10000, 'history timer queue must eventually drain');
      runTimer();
    }
    return turns;
  }
  return { context, constants, timers, idleCallbacks, idleTimeouts, runTimer, drainTimers };
}

function historyLines(context, pane) {
  return Array.from(context.terminalHistoryLines(pane));
}

function checkFragmentedOutput() {
  const { context } = createHarness();
  const controls = [
    ['charset selection', '\x1b(0'],
    ['OSC BEL', '\x1b]0;fixture title\x07'],
    ['OSC ST', '\x1b]0;fixture title\x1b\\'],
    ['DCS ST', '\x1bPfixture control payload\x1b\\'],
    ['APC ST', '\x1b_fixture control payload\x1b\\'],
    ['PM ST', '\x1b^fixture control payload\x1b\\']
  ];
  for (const [label, control] of controls) {
    const data = `${control}\x1b[32mhello\x1b[0m\r\nworld\r\n`;
    for (let split = 0; split <= data.length; split += 1) {
      const pane = {};
      context.appendTerminalHistoryCache(pane, data.slice(0, split));
      context.appendTerminalHistoryCache(pane, data.slice(split));
      assert.deepEqual(historyLines(context, pane), ['hello', 'world'], `${label}/CRLF split at ${split}`);
    }
    const pane = {};
    for (const char of data) context.appendTerminalHistoryCache(pane, char);
    assert.deepEqual(historyLines(context, pane), ['hello', 'world'], `${label} one-character PTY fragments`);
  }
  const longControl = {};
  context.appendTerminalHistoryCache(longControl, 'before\n\x1b]0;');
  for (let index = 0; index < 64; index += 1) {
    context.appendTerminalHistoryCache(longControl, 'control-payload'.repeat(512));
    assert.ok((longControl.historyCache.escapeCarry?.length ?? 0) <= 512, 'incomplete control payload must not grow the carry buffer');
  }
  context.appendTerminalHistoryCache(longControl, '\x1b');
  context.appendTerminalHistoryCache(longControl, '\\after\n');
  assert.deepEqual(historyLines(context, longControl), ['before', 'after'], 'large control payload stays out of history across a split ST');
  const overwrite = {};
  for (const chunk of ['progress 1\r', 'progress 2\r', '\n']) {
    context.appendTerminalHistoryCache(overwrite, chunk);
  }
  assert.deepEqual(historyLines(context, overwrite), ['progress 2'], 'bare CR overwrites the current line');
  console.log('PASS fragmented charset/ANSI/OSC/DCS/APC/PM, bounded control carry, CRLF, and progress redraw history');
}

function checkHistoryLimits() {
  for (const mode of ['balanced', 'deep']) {
    const { context } = createHarness(mode);
    const limits = context.terminalHistoryCacheLimits();
    const pane = {};
    // Newlines force eviction; a later unterminated line must share the same
    // byte budget rather than allocating a second complete history allowance.
    const line = 'x'.repeat(120) + '\n';
    for (let index = 0; index < limits.maxLines + 2000; index += 1) {
      context.appendTerminalHistoryCache(pane, line);
    }
    assert.ok(context.terminalHistoryLineCount(pane) <= limits.maxLines);
    context.appendTerminalHistoryCache(pane, 'y'.repeat(limits.maxChars + 100));
    const lines = historyLines(context, pane);
    const retained = lines.reduce((total, value) => total + value.length, 0);
    assert.ok(retained <= limits.maxChars, `${mode} completed and unfinished lines must share the character limit`);
    assert.ok(context.terminalHistoryLineCount(pane) <= limits.maxLines);
  }
  console.log('PASS bounded completed and unfinished history');
}

function checkHiddenWriteCoalescing() {
  const { context, idleCallbacks } = createHarness();
  const pane = {};
  for (let index = 0; index < 500; index += 1) context.flushTerminalWriteBufferWhenReady(pane, 200);
  assert.equal(idleCallbacks.length, 1, 'busy UI must retain only one hidden drain per pane');
  pane.closed = true;
  idleCallbacks.shift()();
  assert.equal(pane.flushCount ?? 0, 0, 'disposed pane must not receive a stale idle flush');
  console.log('PASS hidden write coalescing and disposed-pane guard');
}

function checkHiddenWriteBusyDeadline() {
  const { context, timers, idleCallbacks, idleTimeouts, runTimer } = createHarness();
  context.uiBusyDelayMs = () => 80;
  const expired = { didTimeout: true, timeRemaining: () => 0 };
  const pane = {};
  context.flushTerminalWriteBufferWhenReady(pane, 16);
  assert.equal(pane.flushCount ?? 0, 0, 'hidden output must still yield to native idle scheduling');
  assert.equal(idleTimeouts[0], 16, 'hidden continuation must retain its native idle timeout');
  idleCallbacks.shift()(expired);
  assert.equal(pane.flushCount, 1, 'continuous typing must not indefinitely postpone a hidden terminal drain');
  assert.equal(timers.size, 0, 'expired hidden drain must not recursively defer for busy input');

  let expensiveRuns = 0;
  context.runWhenUiIdle(() => { expensiveRuns += 1; }, 16);
  idleCallbacks.shift()(expired);
  assert.equal(expensiveRuns, 0, 'ordinary expensive idle jobs must still respect busy-input deferral');
  assert.equal(timers.size, 1);
  runTimer();
  assert.equal(idleCallbacks.length, 1, 'deferred ordinary work must return to native idle scheduling');
  context.uiBusyDelayMs = () => 0;
  idleCallbacks.shift()(expired);
  assert.equal(expensiveRuns, 1);
  assert.equal(timers.size, 0);
  console.log('PASS hidden drain survives busy-input deadline; ordinary idle work stays deferred');
}

function checkHistoryBurstScheduling() {
  const harness = createHarness();
  const { context, constants, timers, drainTimers, runTimer } = harness;
  const pendingLimit = constants.TERMINAL_HISTORY_PENDING_MAX_CHARS;
  const chunkLimit = constants.TERMINAL_HISTORY_PARSE_CHUNK_CHARS;
  assert.ok(pendingLimit > 0 && chunkLimit > 0, 'history queue and parser need explicit finite limits');
  let largestParse = 0;
  let parseCalls = 0;
  const append = context.appendTerminalHistoryCache;
  context.appendTerminalHistoryCache = (pane, data) => {
    largestParse = Math.max(largestParse, data.length);
    parseCalls += 1;
    append(pane, data);
  };
  const pane = {};
  const output = 'synthetic terminal output\r\n'.repeat(1000);
  for (let index = 0; index < 250; index += 1) {
    context.scheduleTerminalHistoryCacheAppend(pane, output);
    assert.ok((pane.historyPendingBuffer?.length ?? 0) <= pendingLimit, 'raw history queue must remain bounded during an output burst');
  }
  context.scheduleTerminalHistoryCacheAppend(pane, '\r\nend-of-burst\r\n');
  assert.equal(timers.size, 1, 'history burst must coalesce into one scheduled parse');
  assert.equal(parseCalls, 0, 'output ingress must not parse a history burst synchronously');
  runTimer();
  assert.equal(parseCalls, 1, 'one timer turn must execute one bounded parse');
  assert.ok(timers.size, 'large history backlog must yield before the next parse');
  const remainingTurns = drainTimers();
  assert.ok(largestParse <= chunkLimit, 'each history parser task must honor the character budget');
  assert.equal(pane.historyPendingBuffer, '', 'history queue drains fully');
  assert.equal(historyLines(context, pane).at(-1), 'end-of-burst', 'dropping an old backlog must retain the latest output');

  const closed = {};
  context.scheduleTerminalHistoryCacheAppend(closed, 'must not append after disposal\n');
  closed.closed = true;
  const callsBeforeClose = parseCalls;
  drainTimers();
  assert.equal(parseCalls, callsBeforeClose, 'stale history timer must not parse a disposed pane');
  console.log(`PASS burst queue <=${pendingLimit} chars; parser <=${chunkLimit} chars/turn; ${remainingTurns + 1} yielding turns`);
}

function checkOpenHistoryOverlay() {
  const { context, constants, timers, runTimer } = createHarness('deep');
  const limits = context.terminalHistoryCacheLimits();
  const pane = { paneId: 'history-fixture', historyControlsLastSyncAt: 1000 };
  context.terminalHistoryCacheForPane(pane);
  for (let index = 0; index < limits.maxLines; index += 1) {
    context.appendTerminalHistoryPlainText(pane.historyCache, `line ${index}\n`);
  }
  const widget = {
    historyOverlayPaneId: pane.paneId,
    historyOverlayEndLine: limits.maxLines,
    historyButton: { disabled: false },
    historyContent: { value: '' },
    historyMeta: {},
    historyOlder: {},
    historyNewer: {},
    historyCopyVisible: {},
    historyCopyAll: {},
    historyClear: {}
  };
  let now = 1000;
  let renders = 0;
  let lineVisits = 0;
  context.performance = { now: () => now };
  context.terminalWidgetForPane = () => widget;
  context.activePaneForWidget = () => pane;
  context.terminalPaneById = new Map([[pane.paneId, pane]]);
  context.setDisabledIfChanged = (node, disabled) => { node.disabled = disabled; };
  context.setTextContentIfChanged = (node, text) => { node.textContent = text; };
  context.toggleClassIfChanged = () => {};
  context.terminalHistoryLines = () => {
    assert.fail('the overlay must not materialize the complete 100k-line history');
  };
  const lineAt = context.terminalHistoryLineAt;
  context.terminalHistoryLineAt = (...args) => {
    lineVisits += 1;
    return lineAt(...args);
  };
  const render = context.renderTerminalHistoryOverlay;
  context.renderTerminalHistoryOverlay = (target) => {
    renders += 1;
    const before = lineVisits;
    render(target);
    assert.ok(lineVisits - before <= constants.TERMINAL_HISTORY_VISIBLE_PAGE_LINES * 2,
      'a history repaint must visit only the visible page, not the complete cache');
    assert.ok(target.historyContent.value.length <= constants.TERMINAL_HISTORY_VISIBLE_PAGE_CHARS);
  };

  // Simulate completed 50 ms history-parser batches while Hist stays open.
  // Real append/sync/render helpers run; only time and DOM nodes are synthetic.
  const interval = constants.TERMINAL_HISTORY_CONTROL_SYNC_MIN_MS;
  for (now = 1050; now < 1000 + interval; now += 50) {
    context.appendTerminalHistoryCache(pane, 'streamed line\n');
  }
  assert.equal(renders, 0, 'open Hist must respect its render interval during repeated output');
  assert.equal(timers.size, 1, 'pending history controls must have only one trailing refresh');
  now = 1000 + interval;
  context.appendTerminalHistoryCache(pane, 'streamed line\n');
  assert.equal(renders, 1);
  assert.equal(timers.size, 0, 'immediate interval refresh must cancel the older trailing timer');
  assert.equal(widget.historyOverlayPageEnd - widget.historyOverlayPageStart,
    constants.TERMINAL_HISTORY_VISIBLE_PAGE_LINES);
  for (now += 50; now < 1000 + interval * 2; now += 50) {
    context.appendTerminalHistoryCache(pane, 'streamed line\n');
  }
  assert.equal(renders, 1, 'more output within the next interval must not repaint each batch');
  assert.equal(timers.size, 1);
  now = 1050 + interval * 2;
  runTimer();
  assert.equal(renders, 2, 'trailing refresh must repaint once after output stops');
  assert.equal(timers.size, 0);
  console.log(`PASS open Hist throttled to ${interval}ms and <=${constants.TERMINAL_HISTORY_VISIBLE_PAGE_LINES * 2} line visits/render with ${limits.maxLines} cached lines`);
}

function benchmarkSaturatedHistory() {
  for (const mode of ['balanced', 'deep']) {
    const { context } = createHarness(mode);
    const limits = context.terminalHistoryCacheLimits();
    const data = 'x'.repeat(48) + '\n';
    const flushes = 10000;
    const append = (pane) => {
      const started = performance.now();
      for (let index = 0; index < flushes; index += 1) {
        context.appendTerminalHistoryPlainText(pane.historyCache, data);
        context.trimTerminalHistoryCache(pane);
      }
      return performance.now() - started;
    };
    const short = {};
    context.terminalHistoryCacheForPane(short);
    const freshMs = append(short);
    const saturated = {};
    context.terminalHistoryCacheForPane(saturated);
    for (let index = 0; index < limits.maxLines; index += 1) {
      context.appendTerminalHistoryPlainText(saturated.historyCache, data);
      context.trimTerminalHistoryCache(saturated);
    }
    const saturatedMs = append(saturated);
    assert.ok(context.terminalHistoryLineCount(saturated) <= limits.maxLines);
    console.log(`PERF ${mode}: ${flushes} one-line flushes, short=${freshMs.toFixed(1)}ms saturated=${saturatedMs.toFixed(1)}ms ratio=${(saturatedMs / freshMs).toFixed(2)}x`);
  }
}

checkFragmentedOutput();
checkHistoryLimits();
checkHistoryBurstScheduling();
checkHiddenWriteCoalescing();
checkHiddenWriteBusyDeadline();
checkOpenHistoryOverlay();
benchmarkSaturatedHistory();
console.log('Terminal performance smoke passed (helper fixtures; no Windows runtime claim).');
