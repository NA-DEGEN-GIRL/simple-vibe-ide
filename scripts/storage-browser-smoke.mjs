import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real app helpers and the injected bridge, isolated from native WebViews/networking.
const baseline = process.argv.includes('--baseline');
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function idleFixture(kind) {
  const prefix = kind === 'hidden' ? 'browserConsoleHiddenPayload' : 'browserConsolePortScan';
  const names = kind === 'hidden' ? [
    'scheduleBrowserConsoleHiddenPayloadFlush', 'flushBrowserConsoleHiddenPayloadQueue',
    'clearBrowserConsoleHiddenPayloadQueue'
  ] : [
    'scheduleBrowserConsoleLocalPortScan', 'flushBrowserConsoleLocalPortScan',
    'clearBrowserConsoleLocalPortScanQueue'
  ];
  const declarations = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  ));
  assert.equal(declarations.length, names.length);
  const variables = parsed.statements.filter((node) => (
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => (
      ts.isIdentifier(entry.name) && entry.name.text.startsWith(prefix)
    ))
  ));
  let nextTimer = 0;
  const timers = new Map();
  const idle = [];
  const consumed = [];
  const context = vm.createContext({
    window: {
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    },
    BROWSER_CONSOLE_HIDDEN_FLUSH_IDLE_MS: 900,
    BROWSER_CONSOLE_HIDDEN_FLUSH_DEBOUNCE_MS: 220,
    runWhenUiIdle(callback) { idle.push(callback); },
    browserConsoleTimeText: () => '00:00:00',
    browserConsoleRuntimeLogLimit: () => 80,
    formatConsoleValueCompact: (value) => value,
    browserConsoleLogEntryFromPayload: (payload) => payload,
    appendBrowserConsoleLogBatch(entries) { consumed.push(...entries); },
    shouldScanBrowserConsoleForLocalPorts: () => true,
    maybeAutoForwardBrowserLocalUrl(message) { consumed.push(message); }
  });
  vm.runInContext(ts.transpileModule([...variables, ...declarations].map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  const queueName = `${prefix}Queue`;
  return {
    idle, timers, consumed,
    enqueue(value) {
      context.nextPayload = value;
      vm.runInContext(`${queueName}.push(nextPayload)`, context);
      context[names[0]]();
    },
    clear: () => context[names[2]](),
    flush: () => context[names[1]](),
    queueSize: () => vm.runInContext(`${queueName}.length`, context),
    fireTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    }
  };
}

function checkIdleCoalescing(kind) {
  const fixture = idleFixture(kind);
  for (let index = 0; index < 200; index += 1) {
    fixture.enqueue(`record-${index}`);
    fixture.fireTimers();
  }
  console.log(`${kind}: ${fixture.idle.length} idle callbacks after 200 delayed queue updates`);
  if (!baseline) assert.equal(fixture.idle.length, 1, 'Only one deferred idle consumer may be outstanding');

  const scoped = idleFixture(kind);
  scoped.enqueue('previous workspace');
  scoped.fireTimers();
  scoped.clear();
  scoped.enqueue('current workspace');
  scoped.idle.shift()();
  console.log(`${kind}: stale callback consumed ${scoped.consumed.length} current-workspace records`);
  if (!baseline) {
    assert.equal(scoped.consumed.length, 0, 'Clearing must invalidate old idle consumers');
    assert.equal(scoped.queueSize(), 1);
    scoped.fireTimers();
    for (const callback of scoped.idle.splice(0)) callback();
    assert.deepEqual(scoped.consumed, ['current workspace']);
  }

  const direct = idleFixture(kind);
  direct.enqueue('explicitly flushed');
  direct.fireTimers();
  direct.flush();
  direct.enqueue('after explicit flush');
  direct.idle.shift()();
  if (!baseline) {
    assert.deepEqual(direct.consumed, ['explicitly flushed'], 'Direct flush must invalidate its old idle callback');
    assert.equal(direct.queueSize(), 1);
    direct.fireTimers();
    for (const callback of direct.idle.splice(0)) callback();
    assert.deepEqual(direct.consumed, ['explicitly flushed', 'after explicit flush']);
  }
}

function uiIdleFixture(nativeIdle) {
  const declaration = parsed.statements.find((node) => (
    ts.isFunctionDeclaration(node) && node.name?.text === 'runWhenUiIdle'
  ));
  assert.ok(declaration);
  const tasks = [];
  let cancelled = false;
  let busy = 0;
  let busyChecks = 0;
  let calls = 0;
  const schedule = (callback) => { tasks.push(callback); return tasks.length; };
  const window = { setTimeout: schedule, requestAnimationFrame: schedule };
  if (nativeIdle) window.requestIdleCallback = schedule;
  const context = vm.createContext({
    window,
    appShutdownStarted: false,
    uiBusyDelayMs() { busyChecks += 1; return busy; }
  });
  vm.runInContext(ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return {
    tasks,
    start(allowWhileBusy = false) {
      context.runWhenUiIdle(() => { calls += 1; }, 900, allowWhileBusy, () => cancelled);
    },
    cancel() { cancelled = true; },
    setBusy(value) { busy = value; },
    counts: () => ({ busyChecks, calls }),
    runOne() { assert.ok(tasks.length); tasks.shift()(); },
    drain() {
      for (let index = 0; tasks.length && index < 10; index += 1) tasks.shift()();
      assert.equal(tasks.length, 0, 'Idle helper must stop scheduling after cancellation or completion');
    }
  };
}

function checkUiIdleCancellation() {
  for (const nativeIdle of [false, true]) {
    const before = uiIdleFixture(nativeIdle);
    before.cancel();
    before.start();
    assert.equal(before.tasks.length, 0);
    assert.deepEqual(before.counts(), { busyChecks: 0, calls: 0 });

    const pending = uiIdleFixture(nativeIdle);
    pending.start();
    pending.cancel();
    pending.drain();
    assert.deepEqual(pending.counts(), { busyChecks: 0, calls: 0 }, 'Cancel before idle must avoid even busy-state measurement');

    const retry = uiIdleFixture(nativeIdle);
    retry.setBusy(100);
    retry.start();
    for (let index = 0; retry.counts().busyChecks === 0 && index < 3; index += 1) retry.runOne();
    assert.equal(retry.counts().busyChecks, 1);
    retry.cancel();
    retry.drain();
    assert.deepEqual(retry.counts(), { busyChecks: 1, calls: 0 }, 'Cancellation must survive the busy retry closure');

    const progress = uiIdleFixture(nativeIdle);
    progress.setBusy(100);
    progress.start();
    for (let index = 0; progress.counts().busyChecks === 0 && index < 3; index += 1) progress.runOne();
    progress.setBusy(0);
    progress.drain();
    assert.deepEqual(progress.counts(), { busyChecks: 2, calls: 1 }, 'Uncancelled work must still make progress after a busy retry');

    const allowed = uiIdleFixture(nativeIdle);
    allowed.setBusy(100);
    allowed.start(true);
    allowed.drain();
    assert.deepEqual(allowed.counts(), { busyChecks: 0, calls: 1 });
  }
  console.log('UI idle: cancellation and retry progress passed with native idle and timer/animation-frame fallback');
}

function bridgeFixture() {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const functionStart = rust.indexOf('fn preview_console_bridge_script(');
  const rawStart = rust.indexOf('script.push_str(r#"', functionStart) + 'script.push_str(r#"'.length;
  const rawEnd = rust.indexOf('"#);', rawStart);
  assert.ok(functionStart >= 0 && rawEnd > rawStart);
  const raw = rust.slice(rawStart, rawEnd);
  const sectionEnd = raw.indexOf("  window.addEventListener('contextmenu'");
  assert.ok(sectionEnd > 0, 'The real bridge formatter section must exist');
  const messages = [];
  const timers = new Map();
  let nextTimer = 0;
  const window = { addEventListener() {}, parent: { postMessage(value) { messages.push(value); } } };
  const context = vm.createContext({
    window,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(`${raw.slice(0, sectionEnd)}\nglobalThis.bridgeSend = send;\n})();`, context);
  return {
    window, context, messages,
    flush() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } }
  };
}

function checkBridgeBounds() {
  for (const detailed of [false, true]) {
    const fixture = bridgeFixture();
    fixture.window.__simpleVibeConsoleDetailed = detailed;
    fixture.context.bridgeSend('info', Array(8).fill('x'.repeat(1024 * 1024)));
    fixture.flush();
    const entry = fixture.messages[0].__simpleVibeConsoleBatch[0];
    const chars = entry.args.reduce((sum, text) => sum + text.length, 0);
    console.log(`bridge ${detailed ? 'detailed' : 'compact'}: ${chars} transported chars for 8 MiB of strings`);
    if (!baseline) assert.ok(chars <= 8 * 4096, 'Truncate before cross-WebView structured cloning');
  }
  const fixture = bridgeFixture();
  fixture.window.__simpleVibeConsoleDetailed = true;
  let reads = 0;
  const object = {};
  for (let index = 0; index < 10_000; index += 1) {
    Object.defineProperty(object, `key${index}`, {
      enumerable: true,
      get() { reads += 1; return index; }
    });
  }
  fixture.context.bridgeSend('info', [object]);
  fixture.flush();
  console.log(`bridge detailed: ${reads} property reads for 10,000-key object`);
  if (!baseline) assert.ok(reads <= 64, 'Detailed console formatting must bound traversal, not stringify entire objects');
}

function checkBridgeExceptionalValues() {
  for (const detailed of [false, true]) {
    const fixture = bridgeFixture();
    fixture.window.__simpleVibeConsoleDetailed = detailed;
    const cycle = { label: 'cycle' };
    cycle.self = cycle;
    let badReads = 0;
    const throwing = { good: 'retained' };
    Object.defineProperty(throwing, 'bad', {
      enumerable: true,
      get() { badReads += 1; throw new Error('getter intentionally unavailable'); }
    });
    fixture.context.bridgeSend('info', [cycle, throwing, 'other argument remains']);
    fixture.context.bridgeSend('info', [10n ** 10_000n, 'after bigint']);
    fixture.flush();
    const entries = fixture.messages.flatMap((message) => message.__simpleVibeConsoleBatch);
    assert.equal(entries.length, 2, 'An exceptional value must not discard its record or later records');
    assert.equal(entries[0].args.length, 3);
    assert.equal(entries[0].args[2], 'other argument remains');
    assert.equal(entries[1].args[1], 'after bigint');
    console.log(`bridge ${detailed ? 'detailed' : 'compact'}: ${entries[1].args[0].length} transported chars for 10,001-digit bigint`);
    if (!baseline) {
      assert.ok(entries[1].args[0].length <= 4096, 'Primitive BigInt formatting must also obey transport bounds');
      assert.ok(entries[0].args.every((argument) => typeof argument === 'string' && argument.length <= 4096));
      if (detailed) {
        assert.match(entries[0].args[0], /\[Circular\]/);
        assert.match(entries[0].args[1], /\[Unavailable\]/);
        assert.match(entries[0].args[1], /retained/);
        assert.equal(badReads, 1);
      } else {
        assert.equal(badReads, 0, 'Compact formatting must not invoke object getters');
      }
    }
  }
}

checkIdleCoalescing('hidden');
checkIdleCoalescing('ports');
if (!baseline) checkUiIdleCancellation();
checkBridgeBounds();
checkBridgeExceptionalValues();
console.log(baseline ? 'Browser baseline recorded (not a passing regression gate).' : 'Browser storage/bridge smoke passed.');
