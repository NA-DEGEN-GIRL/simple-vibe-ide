#!/usr/bin/env node
// Exercise the app's actual output acknowledgement helpers with delayed xterm
// writes and IPC completion. No provider, WSL session, or WebView is started.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const helperNames = new Set([
  'handleBackendTerminalData',
  'acknowledgeTerminalOutputIfDrained',
  'terminalWriteDrainReady',
  'prunePendingTerminalBackendEvents',
  'bufferPendingTerminalData',
  'dropPendingTerminalBackendEvents',
  'flushPendingTerminalBackendEvents',
  'setTerminalBackendId'
]);
const declarations = parsed.statements.filter((statement) => (
  ts.isFunctionDeclaration(statement) && helperNames.has(statement.name?.text)
));
assert.equal(declarations.length, helperNames.size, 'All output flow helpers must exist');
const code = ts.transpileModule(declarations.map((node) => node.getText(parsed)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function harness() {
  const timers = new Map();
  let nextTimer = 1;
  const calls = [];
  const received = [];
  const context = vm.createContext({
    performance,
    console,
    appShutdownStarted: false,
    TERMINAL_PENDING_BACKEND_EVENT_LIMIT: 64,
    TERMINAL_PENDING_BACKEND_DATA_CHARS: 128 * 1024,
    pendingTerminalDataByBackendId: new Map(),
    pendingTerminalSequenceByBackendId: new Map(),
    pendingTerminalCursorQueriesByBackendId: new Map(),
    pendingTerminalExitByBackendId: new Map(),
    terminalPaneByBackendId: new Map(),
    window: {
      setTimeout(callback) {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) { timers.delete(id); }
    },
    api: {
      acknowledgeTerminalOutput(id, sequence) {
        const result = deferred();
        calls.push({ id, sequence, ...result });
        return result.promise;
      }
    },
    isTerminalPaneAlive: (pane) => !pane.closed,
    handleTerminalData: (pane, data) => {
      received.push(data);
      pane.writeBuffer = (pane.writeBuffer ?? '') + data;
    },
    terminalPaneLlmId: () => undefined,
    clearTerminalBackendTerminationRetry: () => {},
    clearTerminalStartupDeadline: () => {},
    clearTerminalStartupWatch: () => {},
    clearWorkspaceLlmWaitingForPane: () => {},
    clearWorkspaceLlmTitleActivityForPane: () => {},
    clearWorkspaceLlmTitleSignalTimer: () => {},
    resetWorkspaceLlmTitleStatusTracker: () => {},
    clearTerminalPendingShellReadyActions: () => {},
    terminalNeedsShellReadyGate: () => false,
    terminalShellReadyProfile: () => ({ kind: 'windows' }),
    flushTerminalInput: async () => {},
    reportTerminalInputWriteError: () => {},
    renderWorkspaceLlmActivityTab: () => {},
    respondToTerminalCursorQuery: async () => {},
    handleTerminalExitEvent: () => {}
  });
  vm.runInContext(code, context);
  function runTimer() {
    const next = timers.entries().next().value;
    assert.ok(next, 'Expected one scheduled acknowledgement continuation');
    timers.delete(next[0]);
    next[1]();
  }
  function pane(backendId = 'backend') {
    return { backendId, writeBuffer: '', pendingTerminalWrites: 0, workspaceId: 'workspace' };
  }
  return { context, calls, received, timers, runTimer, pane };
}

async function drainAcknowledgement() {
  const { context, calls, pane } = harness();
  const terminal = pane();
  context.handleBackendTerminalData(terminal, 'first', 1);
  context.handleBackendTerminalData(terminal, 'second', 2);
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 0, 'Buffered output must retain backend credit');
  terminal.writeBuffer = '';
  for (const field of ['writeFrame', 'writeTimer']) {
    terminal[field] = 1;
    context.acknowledgeTerminalOutputIfDrained(terminal);
    assert.equal(calls.length, 0, 'A scheduled terminal write must retain backend credit');
    terminal[field] = undefined;
  }
  terminal.pendingTerminalWrites = 1;
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 0, 'An xterm write callback must finish before credit returns');
  terminal.pendingTerminalWrites = 0;
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sequence, 2, 'Only the latest fully drained sequence is acknowledged');
  calls[0].resolve();
  await settle();
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 1, 'Already acknowledged output must not produce repeated IPC');
}

async function pendingBeforeBind() {
  const { context, calls, received, pane } = harness();
  context.bufferPendingTerminalData('early', 'first', 3);
  context.bufferPendingTerminalData('early', 'second', 7);
  assert.equal(calls.length, 0, 'Unknown backend output must not be acknowledged before binding');
  const terminal = pane(undefined);
  context.setTerminalBackendId(terminal, 'early');
  assert.equal(received.join(''), 'firstsecond');
  assert.equal(terminal.outputSequence, 7);
  assert.equal(calls.length, 0, 'Binding must retain credit while buffered data is still rendering');
  terminal.writeBuffer = '';
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sequence, 7);
  calls[0].resolve();
  await settle();
}

async function newerOutputWhileAckIsInFlight() {
  const { context, calls, pane } = harness();
  const terminal = pane();
  context.handleBackendTerminalData(terminal, 'first', 4);
  terminal.writeBuffer = '';
  context.acknowledgeTerminalOutputIfDrained(terminal);
  context.handleBackendTerminalData(terminal, 'second', 8);
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 1, 'Only one acknowledgement may be in flight per pane');
  calls[0].resolve();
  await settle();
  assert.equal(calls.length, 1, 'An earlier completion cannot acknowledge newer buffered bytes');
  terminal.writeBuffer = '';
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sequence, 8);
  calls[1].resolve();
  await settle();
  // Duplicate/out-of-order sequence metadata cannot lower the acknowledgement
  // frontier or generate additional acknowledgement traffic.
  for (const sequence of [8, 4, 1]) {
    context.handleBackendTerminalData(terminal, '', sequence);
  }
  assert.equal(terminal.outputSequence, 8);
  assert.equal(calls.length, 2);
}

async function acknowledgementFailureRetriesLatestDrainedSequence() {
  const { context, calls, timers, runTimer, pane } = harness();
  const terminal = pane();
  context.handleBackendTerminalData(terminal, 'first', 1);
  terminal.writeBuffer = '';
  context.acknowledgeTerminalOutputIfDrained(terminal);
  calls[0].reject(new Error('temporary IPC failure'));
  await settle();
  assert.equal(timers.size, 1, 'A failed acknowledgement must queue one retry');
  context.handleBackendTerminalData(terminal, 'second', 2);
  terminal.writeBuffer = '';
  for (let index = 0; index < 100; index += 1) context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(timers.size, 1, 'Repeated drain callbacks must not fan out retry timers');
  assert.equal(calls.length, 1);
  runTimer();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sequence, 2, 'Retry must coalesce to the latest drained sequence');
  calls[1].resolve();
  await settle();
  assert.equal(timers.size, 0);
}

async function identityAndDisposalGuards() {
  for (const fails of [false, true]) {
    const { context, calls, timers, pane } = harness();
    const terminal = pane('old');
    context.handleBackendTerminalData(terminal, 'old output', 15);
    terminal.writeBuffer = '';
    context.acknowledgeTerminalOutputIfDrained(terminal);
    context.setTerminalBackendId(terminal, 'new');
    context.handleBackendTerminalData(terminal, 'new output', 1);
    terminal.writeBuffer = '';
    context.acknowledgeTerminalOutputIfDrained(terminal);
    const newRequest = terminal.outputAckInFlight;
    if (fails) calls[0].reject(new Error('stale request failure'));
    else calls[0].resolve();
    await settle();
    assert.equal(terminal.outputAckInFlight, newRequest, 'An old finalizer cannot clear the new backend request');
    assert.equal(terminal.outputAcknowledgedSequence, 0, 'Old backend credit cannot leak into the new identity');
    assert.equal(timers.size, 0, 'An old backend rejection must not schedule a new identity retry');
    calls[1].resolve();
    await settle();
    assert.equal(terminal.outputAcknowledgedSequence, 1);
  }

  const { context, calls, timers, runTimer, received, pane } = harness();
  const terminal = pane();
  context.handleBackendTerminalData(terminal, 'before close', 1);
  terminal.writeBuffer = '';
  context.acknowledgeTerminalOutputIfDrained(terminal);
  calls[0].reject(new Error('temporary IPC failure'));
  await settle();
  terminal.closed = true;
  runTimer();
  context.handleBackendTerminalData(terminal, 'after close', 2);
  context.acknowledgeTerminalOutputIfDrained(terminal);
  assert.equal(calls.length, 1, 'Disposed-pane callbacks must not invoke more backend work');
  assert.equal(timers.size, 0);
  assert.deepEqual(received, ['before close'], 'Disposed panes must not parse new terminal output');

  const rebound = harness();
  const reboundPane = rebound.pane('old');
  rebound.context.handleBackendTerminalData(reboundPane, 'output', 1);
  reboundPane.writeBuffer = '';
  rebound.context.acknowledgeTerminalOutputIfDrained(reboundPane);
  rebound.calls[0].reject(new Error('temporary IPC failure'));
  await settle();
  assert.equal(rebound.timers.size, 1);
  rebound.context.setTerminalBackendId(reboundPane, 'replacement');
  assert.equal(rebound.timers.size, 0, 'Rebinding must clear a pending old-identity retry');
}

await drainAcknowledgement();
await pendingBeforeBind();
await newerOutputWhileAckIsInFlight();
await acknowledgementFailureRetriesLatestDrainedSequence();
await identityAndDisposalGuards();
console.log('Terminal output flow smoke passed (helper fixtures; no Windows runtime claim).');
