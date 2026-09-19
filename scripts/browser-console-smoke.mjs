import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real Browser console helpers, isolated from WebView layout and remote processes.
const baseline = process.argv.includes('--baseline');
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function helperSource(names, variables = []) {
  const functions = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  ));
  assert.equal(functions.length, names.length, 'Every tested helper must come from the app');
  const declarations = parsed.statements.filter((node) => (
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => (
      ts.isIdentifier(entry.name) && variables.includes(entry.name.text)
    ))
  ));
  return ts.transpileModule([...declarations, ...functions].map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

function payloadFixture() {
  const context = vm.createContext({
    BROWSER_CONSOLE_PORT_SCAN_QUEUE_PRUNE_BATCH: 32,
    browserConsoleRuntimeLogLimit: () => 80,
    scheduleBrowserConsoleHiddenPayloadFlush: () => { context.schedules += 1; },
    schedules: 0
  });
  vm.runInContext(helperSource([
    'queueBrowserConsoleHiddenPayloads', 'appendBrowserConsoleHiddenPayload',
    'pruneBrowserConsoleHiddenPayloadQueue'
  ], ['browserConsoleHiddenPayloadQueue']), context);
  return {
    queue: (batch) => context.queueBrowserConsoleHiddenPayloads(batch),
    records: () => Array.from(vm.runInContext('browserConsoleHiddenPayloadQueue', context)),
    schedules: () => context.schedules
  };
}

const burst = payloadFixture();
let payloadReads = 0;
const largeBatch = new Proxy(Array.from({ length: 100_000 }, (_, id) => ({ id })), {
  get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) payloadReads += 1;
    return Reflect.get(target, property, receiver);
  }
});
burst.queue(largeBatch);
assert.deepEqual(burst.records().map((record) => record.id), Array.from({ length: 80 }, (_, index) => 99_920 + index));
assert.equal(burst.schedules(), 1);
console.log(`Browser hidden console: ${payloadReads} payload reads for a 100,000-record batch; retained ${burst.records().length}`);
if (!baseline) assert.ok(payloadReads <= 80, 'Do not push/scan every valid payload only to discard its prefix');

const mixed = payloadFixture();
mixed.queue([{ id: 'previous' }]);
mixed.queue([null, { id: 'a' }, undefined, false, { id: 'b' }, 0]);
assert.deepEqual(mixed.records().map((record) => record.id), ['previous', 'a', 'b']);
const invalidTail = Array.from({ length: 90 }, (_, id) => [null, { id }, false]).flat();
mixed.queue(invalidTail);
assert.deepEqual(mixed.records().map((record) => record.id), Array.from({ length: 80 }, (_, index) => index + 10));
const beforeInvalid = mixed.records();
const beforeSchedules = mixed.schedules();
mixed.queue([undefined, null, '', 0, false]);
assert.deepEqual(mixed.records(), beforeInvalid);
assert.equal(mixed.schedules(), beforeSchedules, 'An invalid-only batch must not schedule work');

function renderFixture({ count = 40, scrollTop = 100, empty = false } = {}) {
  const events = [];
  class Element {
    constructor(fragment = false) {
      this.fragment = fragment;
      this.children = [];
      this.parent = null;
      this.className = '';
      this.value = scrollTop;
      this.classList = { contains: (name) => this.className.split(' ').includes(name) };
    }
    get firstElementChild() { return this.children[0] ?? null; }
    get childElementCount() { return this.children.length; }
    get scrollHeight() { events.push('read-height'); return this.children.length * 20; }
    get clientHeight() { events.push('read-client'); return 240; }
    get scrollTop() { events.push('read-top'); return this.value; }
    set scrollTop(value) { events.push('write-top'); this.value = value; }
    append(...children) {
      events.push('mutate');
      for (const child of children) {
        if (child.fragment) this.append(...child.children);
        else { child.parent = this; this.children.push(child); }
      }
    }
    replaceChildren(...children) {
      events.push('mutate');
      this.children = [];
      this.append(...children);
    }
    remove() {
      events.push('mutate');
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }
  const container = new Element();
  const logs = Array.from({ length: count }, (_, id) => ({ id: `log-${id}`, message: `record ${id}` }));
  if (!empty) for (const _entry of logs) { const row = new Element(); row.parent = container; container.children.push(row); }
  const state = { browserConsoleVisible: true, browserConsoleLogs: logs };
  const context = vm.createContext({
    state, el: { browserConsoleLog: container }, BROWSER_CONSOLE_RENDER_LIMIT: 120,
    isBrowserPanelHidden: () => false,
    window: { cancelAnimationFrame() {} },
    document: { createDocumentFragment: () => new Element(true), createElement: () => new Element() },
    browserConsoleRowElement: () => new Element()
  });
  vm.runInContext(helperSource([
    'renderBrowserConsole', 'browserConsoleSignature', 'clearBrowserConsoleRowElementCache'
  ], [
    'browserConsoleRenderFrame', 'browserConsoleLastRenderedLogId',
    'browserConsoleLastRenderedLogIndex', 'browserConsoleLogVersion',
    'browserConsoleRenderSignature', 'browserConsoleRowElementCache'
  ]), context);
  if (!empty && count) vm.runInContext(`browserConsoleLastRenderedLogId = 'log-${count - 1}'; browserConsoleLastRenderedLogIndex = ${count - 1}`, context);
  return {
    container, state, events,
    render: () => context.renderBrowserConsole(),
    append(id) { state.browserConsoleLogs.push({ id: `log-${id}`, message: `record ${id}` }); vm.runInContext('browserConsoleLogVersion += 1', context); }
  };
}

const reading = renderFixture();
reading.append(40);
reading.render();
console.log(`Browser console scrolled-up viewport: ${reading.events.filter((event) => event === 'write-top').length} forced scroll writes`);
if (!baseline) {
  assert.equal(reading.container.value, 100, 'New events must not pull a reader to the bottom');
  assert.equal(reading.events.includes('write-top'), false, 'Let browser scroll anchoring preserve the reader viewport');
}

const following = renderFixture({ scrollTop: 560 });
following.append(40);
following.render();
assert.equal(following.container.value, 820, 'An at-bottom viewport must still follow new logs');
if (!baseline) {
  assert.ok(following.events.indexOf('read-height') < following.events.indexOf('mutate'), 'Determine whether to follow before changing the DOM');
}
following.events.length = 0;
following.render();
assert.deepEqual(following.events, [], 'An unchanged render signature must skip geometry and DOM work');

const initial = renderFixture({ count: 60, scrollTop: 0, empty: true });
initial.render();
assert.equal(initial.container.value, 1200, 'An initially empty console should open at the newest logs');

const bounded = renderFixture({ count: 120, scrollTop: 120 });
bounded.append(120);
bounded.render();
assert.equal(bounded.container.childElementCount, 120, 'Follow-tail changes must preserve the DOM row cap');
if (!baseline) assert.equal(bounded.events.includes('write-top'), false);

console.log('Browser console smoke passed (helper-only; native scroll anchoring/layout remains a Windows smoke check).');
