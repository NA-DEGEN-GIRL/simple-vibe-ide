import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
function helpers(names, bindings, variables = []) {
  const nodes = ast.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  ) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => variables.includes(item.name.getText(ast)))));
  assert.equal(nodes.length, names.length + variables.length);
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(nodes.map((node) => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(rules = []) {
  const snapshot = { id: 'a', profileId: 'ssh-test', root: '/project', portForwards: rules };
  const state = { activeWorkspaceId: 'a', activeProfile: { id: 'ssh-test', kind: 'ssh' },
    workspaceRoot: '/project', workspaceOpen: true, forwards: [], terminals: [] };
  const calls = { starts: [], stops: [], saves: 0, status: [] };
  const request = (...args) => new Promise((resolve, reject) => calls.starts.push({ args, resolve, reject }));
  const context = helpers([
    'normalizedWorkspacePortRules', 'workspacePortRules', 'saveWorkspacePortRule', 'forgetWorkspacePortRule',
    'restoreWorkspacePortForwards', 'currentBrowserForwardScope', 'browserForwardStartKey',
    'browserForwardScopeIsActive', 'startBrowserForwardForScope', 'adoptBrowserForward'
  ], {
    state, IS_TERMINAL_APP: false, appShutdownStarted: false, restoringWorkspace: false,
    browserForwardStarts: new Map(), workspaceSnapshotSignatures: new Map([['a', 'old-signature']]),
    workspaceSnapshotForId: (id) => id === snapshot.id ? snapshot : null,
    scheduleWorkspaceStorePersist: () => calls.saves++,
    renderForwards: () => {}, setStatus: (...args) => calls.status.push(args),
    ensureCachedBrowserForwardScope: () => null, cachedBrowserForwardScope: () => null,
    forwardForRemotePort: (port) => state.forwards.find((item) => item.remotePort === port),
    addForward: (forward) => state.forwards.push(forward), removeDetectedPortForScope: () => {},
    startForwardForProfile: request,
    api: { startPortForward: request, stopPortForward: async (id) => calls.stops.push(id) }
  });
  return { context, state, snapshot, calls, scope: context.currentBrowserForwardScope() };
}
const forward = (remotePort = 3000) => ({ id: `forward-${remotePort}`, remotePort, localPort: remotePort,
  targetHost: '127.0.0.1', url: `http://127.0.0.1:${remotePort}` });

{
  const { context, scope, snapshot, calls } = fixture();
  const normalized = context.normalizedWorkspacePortRules([
    null, { remotePort: 3000, localPort: 0, enabled: false, secret: 'discard' },
    { remotePort: 3000, localPort: 42 }, { remotePort: -1, localPort: 0 },
    { remotePort: 65536, localPort: 0 }, { remotePort: 4, localPort: 65536 }
  ]);
  assert.deepEqual(plain(normalized), [{ remotePort: 3000, localPort: 0, enabled: false }]);
  assert.equal(context.normalizedWorkspacePortRules(Array.from({ length: 100 }, (_, i) => ({ remotePort: i + 1000, localPort: 0 }))).length, 32);
  context.saveWorkspacePortRule(scope, { remotePort: 3000, localPort: 3000, enabled: true });
  assert.equal(calls.saves, 1);
  assert.equal(context.workspaceSnapshotSignatures.has('a'), false, 'Persisted JSON cache must be invalidated');
  context.saveWorkspacePortRule(scope, { remotePort: 3000, localPort: 3000, enabled: true });
  assert.equal(calls.saves, 1, 'Repeated output must not rewrite unchanged port settings');
  context.saveWorkspacePortRule({ ...scope, root: '/different' }, { remotePort: 4000, localPort: 0, enabled: true });
  assert.equal(snapshot.portForwards.length, 1, 'Stale root must not acquire another workspace port');
  context.forgetWorkspacePortRule(scope, 3000);
  assert.equal(snapshot.portForwards.length, 0, 'Forget frees space for new automatic ports');
  assert.match(source, /signature \+= `\|\$\{JSON\.stringify\(normalizedWorkspacePortRules\(snapshot\.portForwards\)\)\}`/);
}
console.log('Ports: bounded schema, scope isolation, persistence invalidation and unchanged-write dedup pass.');

{
  const first = fixture();
  const a = first.context.startBrowserForwardForScope(first.scope, 'ssh', 3000);
  const b = first.context.startBrowserForwardForScope(first.scope, 'ssh', 3000);
  assert.equal(a, b);
  assert.equal(first.calls.starts.length, 1);
  first.calls.starts[0].resolve(forward());
  await a;
  assert.equal(first.context.browserForwardStarts.size, 0);
  const stored = plain(first.snapshot.portForwards);
  assert.deepEqual(stored, [{ remotePort: 3000, localPort: 3000, enabled: true }]);
  assert.ok(!JSON.stringify(stored).includes('forward-'), 'Do not persist process IDs or stale runtime tunnel IDs');
  const second = fixture(stored);
  const restoring = second.context.restoreWorkspacePortForwards();
  assert.deepEqual(second.calls.starts[0].args, ['ssh-test', 3000, 3000]);
  second.calls.starts[0].resolve(forward());
  await restoring;
  await second.context.restoreWorkspacePortForwards();
  assert.equal(second.calls.starts.length, 1, 'Returning to live workspace reuses the tunnel');
  second.state.forwards[0].localPort = 49152;
  await second.context.startBrowserForwardForScope(second.scope, 'ssh', 3000);
  assert.equal(second.snapshot.portForwards[0].localPort, 49152, 'Rediscovery must retain the actual fallback port');
}
console.log('Ports: concurrent starts deduplicate; cold restart restores with stable local ports and no browser API.');

for (const mode of ['disabled', 'shutdown', 'switched']) {
  const f = fixture([{ remotePort: 3000, localPort: 3000, enabled: true }, { remotePort: 4000, localPort: 4000, enabled: true }]);
  const pending = f.context.restoreWorkspacePortForwards();
  assert.equal(f.calls.starts.length, 1, 'Restoration must be serial, not an SSH prompt storm');
  if (mode === 'disabled') {
    for (const rule of f.snapshot.portForwards) f.context.saveWorkspacePortRule(f.scope, { ...rule, enabled: false });
    f.context.forgetWorkspacePortRule(f.scope, 3000);
    assert.equal(f.snapshot.portForwards.find((rule) => rule.remotePort === 3000)?.enabled, false,
      'Disable then Forget cannot remove the cancellation tombstone while a start is pending');
  } else if (mode === 'shutdown') f.context.appShutdownStarted = true;
  else f.state.activeWorkspaceId = 'b';
  f.calls.starts[0].resolve(forward());
  await pending;
  assert.deepEqual(f.calls.stops, ['forward-3000'], 'Late abandoned tunnel must be stopped');
  assert.equal(f.calls.starts.length, 1);
  assert.equal(f.state.forwards.length, 0);
  if (mode === 'disabled') {
    f.context.forgetWorkspacePortRule(f.scope, 3000);
    assert.ok(!f.snapshot.portForwards.some((rule) => rule.remotePort === 3000));
  }
}
{
  const f = fixture([{ remotePort: 3000, localPort: 3000, enabled: false }]);
  await f.context.restoreWorkspacePortForwards();
  assert.equal(f.calls.starts.length, 0, 'Stopped ports must stay stopped after restart');
  f.context.saveWorkspacePortRule(f.scope, { remotePort: 3000, localPort: 3000, enabled: true });
  const pending = f.context.restoreWorkspacePortForwards();
  f.calls.starts[0].reject(new Error('unreachable'));
  await pending;
  assert.equal(f.snapshot.portForwards[0].enabled, true, 'Failed restore must retain a retriable rule');
  assert.equal(f.context.browserForwardStarts.size, 0);
  assert.equal(f.calls.status.length, 1);
}
console.log('Ports: stop/disable, shutdown, workspace switch, serial restore and failed-retry state pass.');

const detected = [];
const scan = helpers([
  'terminalPortScanData', 'terminalOutputMayContainPreviewPortHint', 'runTerminalPortScan',
  'detectNewLocalServerPorts', 'localServerPortMatchIsHighConfidence', 'isPreviewPort'
], {
  state: { activeWorkspaceId: 'a', activeProfile: { id: 'test' } },
  cleanTerminalMetadataBuffer: (value) => value,
  queueDetectedPort: (port, _pane, auto) => detected.push([port, auto])
}, [
  'TERMINAL_PREVIEW_PORT_HINT_PATTERN', 'TERMINAL_PREVIEW_PORT_KEYWORD_PATTERN',
  'LOCAL_PREVIEW_URL_PORT_PATTERN', 'LOCAL_PREVIEW_LISTENING_PORT_PATTERN',
  'LOCAL_SERVER_POSITIVE_CONTEXT_PATTERN', 'LOCAL_SERVER_NEGATIVE_CONTEXT_PATTERN'
]);
const line = 'Local: http://localhost:3000/\n';
for (let cut = 1; cut < line.length; cut++) {
  const pane = { workspaceId: 'a', profileId: 'test', outputBuffer: '', seenPorts: new Set() };
  detected.length = 0;
  for (const data of [line.slice(0, cut), line.slice(cut)]) {
    const text = scan.terminalPortScanData(pane, data);
    if (text !== null) { pane.outputBuffer += text; scan.runTerminalPortScan(pane); }
  }
  assert.ok(detected.some(([port, auto]) => port === 3000 && auto), `Split at ${cut} must still auto-forward`);
  assert.equal(pane.outputBuffer, '', 'Do not continuously scan stale metadata after a batch');
}
for (const [text, expected] of [
  ['http://127.0.0.1:5173/\n', true], ['Running on http://0.0.0.0:8000\n', true],
  ['Example: http://localhost:3000\n', false], ['Error: failed to listen on http://localhost:3000\n', false]
]) {
  const events = [];
  scan.detectNewLocalServerPorts(text, new Set(), (port, auto) => events.push([port, auto]));
  assert.equal(events[0][1], expected, text);
}
const pane = { workspaceId: 'a', profileId: 'test', outputBuffer: '', seenPorts: new Set() };
for (let i = 0; i < 1000; i++) scan.terminalPortScanData(pane, 'x'.repeat(10_000));
assert.equal(pane.portHintTail.length, 256);
pane.workspaceId = 'b';
pane.outputBuffer = scan.terminalPortScanData(pane, `\n${line}`);
detected.length = 0;
scan.runTerminalPortScan(pane);
assert.deepEqual(detected, [], 'Background discovery must not start a tunnel in the wrong workspace');
assert.equal(pane.pendingDetectedPorts.get(3000), true);
for (let port = 5000; port < 5100; port++) {
  pane.outputBuffer = `Local: http://localhost:${port}/\n`;
  scan.runTerminalPortScan(pane);
}
assert.equal(pane.pendingDetectedPorts.size, 32, 'Background discoveries must remain bounded');
{
  const f = fixture();
  f.state.terminals = [{ ...pane, workspaceId: 'a', profileId: 'ssh-test', outputBuffer: '', pendingDetectedPorts: new Map([[3000, true]]) }];
  const events = [];
  f.context.queueDetectedPort = (...args) => events.push(args);
  const replay = f.context.restoreWorkspacePortForwards();
  assert.equal(f.calls.starts.length, 1);
  f.calls.starts[0].resolve(forward());
  await replay;
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 3000);
  assert.equal(events[0][2], false, 'Background replay must not bypass serial forward restoration');
  assert.equal(f.state.terminals[0].pendingDetectedPorts.size, 0, 'Consume background hints once on activation');
}
assert.match(source, /id="terminal-ports-toggle" class="terminal-ports-toggle"/);
assert.match(source, /void restoreWorkspacePortForwards\(\);/);
console.log('Ports: every split URL boundary, standalone URLs, negative context and bounded scan carry pass.');
