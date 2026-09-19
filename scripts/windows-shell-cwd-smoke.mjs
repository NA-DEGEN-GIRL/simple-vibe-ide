#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real frontend launch/path helpers. No shell, Windows process or user directory is opened.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const baseline = process.argv.includes('--baseline');
const failures = [];
let checks = 0;

function loadHelpers(names, bindings, variables = []) {
  const functions = parsed.statements.filter((node) => (
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  ));
  assert.equal(functions.length, names.length, 'Every tested helper must come from the app');
  const declarations = parsed.statements.filter((node) => (
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => (
      ts.isIdentifier(entry.name) && variables.includes(entry.name.text)
    ))
  ));
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule([...declarations, ...functions].map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context;
}

async function check(name, test) {
  checks += 1;
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    if (!baseline) throw error;
    failures.push(name);
    console.log(`BASELINE FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}

const windows = { id: 'windows-local', kind: 'windows', root: 'C:\\ProfileRoot' };
const wsl = { id: 'wsl:TestDistro', kind: 'wsl', root: '/workspace' };
const ssh = { id: 'ssh:test', kind: 'ssh', root: '/remote/workspace' };

await check('+Shell retains the selected project profile and root across startup waits', async () => {
  let clickHandler;
  const events = [];
  const widget = { workspaceId: 'project-a' };
  const state = {
    activeProfile: windows, activeWorkspaceId: 'project-a',
    workspaceRoot: 'D:\\Projects\\한글 [demo]', currentDir: 'D:\\Projects\\한글 [demo]\\nested'
  };
  let finish;
  const startup = new Promise((resolve) => { finish = resolve; });
  const context = loadHelpers(['createTerminal', 'workspaceShellCwd'], {
    state,
    el: { newShell: { addEventListener: (type, handler) => { assert.equal(type, 'click'); clickHandler = handler; } } },
    createTerminalWidget: (title, cwd, options) => { events.push({ title, cwd, options }); return widget; },
    createTerminalTab: async (_widget, command, title, options) => {
      events.push({ command, title, options });
      await startup;
    }
  });
  const bindEvents = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'bindEvents');
  const binding = bindEvents.body.statements.find((node) => node.getText(parsed).startsWith("el.newShell.addEventListener('click'"));
  assert.ok(binding, 'Exercise the real +Shell click binding, not a reconstructed route');
  vm.runInContext(ts.transpileModule(binding.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  const pending = clickHandler();
  state.workspaceRoot = 'E:\\OtherProject';
  state.currentDir = 'E:\\OtherProject';
  state.activeProfile = ssh;
  finish();
  await pending;
  assert.equal(events.length, 2);
  assert.equal(events[0].cwd, 'D:\\Projects\\한글 [demo]');
  assert.equal(events[1].options.cwd, events[0].cwd, 'Explorer navigation must not replace the project root');
  assert.equal(events[1].options.profile, windows, 'A later workspace switch must not replace the captured profile');
  assert.equal(events[1].command, null);
  for (const [profile, root] of [[wsl, '/workspace/a'], [ssh, '/remote/project']]) {
    state.activeProfile = profile;
    state.workspaceRoot = root;
    await context.createTerminal(null, 'shell');
    assert.equal(events.at(-1).options.profile, profile);
    assert.equal(events.at(-1).options.cwd, root);
  }
});

await check('Workspace cwd fallback order and explicit launch directories are preserved', async () => {
  const events = [];
  const state = { activeProfile: windows, workspaceRoot: 'D:\\Project', currentDir: 'D:\\Project\\child' };
  const context = loadHelpers(['createTerminal', 'workspaceShellCwd'], {
    state,
    createTerminalWidget: () => ({}),
    createTerminalTab: async (_widget, _command, _title, options) => events.push(options)
  });
  assert.equal(context.workspaceShellCwd(), 'D:\\Project');
  state.workspaceRoot = '';
  assert.equal(context.workspaceShellCwd(), 'D:\\Project\\child');
  state.currentDir = '';
  assert.equal(context.workspaceShellCwd(), windows.root);
  await context.createTerminal(null, 'shell', { profile: wsl, cwd: '/explicit/project' });
  assert.equal(events[0].profile, wsl);
  assert.equal(events[0].cwd, '/explicit/project');
  state.activeProfile = null;
  assert.equal(context.workspaceShellCwd(), '.');
  assert.equal(await context.createTerminal(null, 'shell'), null);
  assert.equal(events.length, 1, 'No active profile must not create a terminal');
});

await check('A new shell tab inherits its own pane cwd, profile and Python environment', async () => {
  const widget = { workspaceId: 'project-a' };
  const active = { cwd: '\\\\server\\share\\한글 project', activePythonEnv: { kind: 'python-venv' } };
  const created = { paneId: 'new-pane' };
  const launches = [];
  const restored = [];
  const context = loadHelpers(['createShellTabInWidget', 'workspaceShellCwd'], {
    state: { activeProfile: ssh, workspaceRoot: '/wrong/workspace' },
    activePaneForWidget: () => active,
    profileForTerminalWidget: () => windows,
    createTerminalTab: async (...args) => { launches.push(args); return created; },
    restoreTerminalPythonEnvForPane: async (pane) => restored.push(pane)
  });
  await context.createShellTabInWidget(widget);
  assert.equal(launches[0][0], widget);
  assert.equal(launches[0][1], null);
  assert.equal(launches[0][3].profile, windows);
  assert.equal(launches[0][3].cwd, active.cwd);
  assert.equal(launches[0][3].pythonEnv, active.activePythonEnv);
  assert.deepEqual(restored, [created]);
});

const paths = loadHelpers([
  'normalizeWindowsTerminalPath', 'normalizePosixTerminalPath', 'isWindowsPath',
  'resolveWindowsCdTarget', 'extractPromptCwd', 'terminalOutputMayContainPromptCwdHint',
  'terminalPromptCwdContinuationTail', 'terminalDataMayContainPromptCwdHint'
], {
  expandTildeTerminalPath: (path) => path,
  terminalPaneVisibility: () => 'visible',
  TERMINAL_CWD_CONTINUATION_TAIL_LIMIT: 1024
}, [
  'TERMINAL_POWERSHELL_PROMPT_CWD_PATTERN', 'TERMINAL_BASH_PROMPT_CWD_PATTERN',
  'TERMINAL_PROMPT_SHORT_HINT_PATTERN', 'TERMINAL_PROMPT_CWD_HINT_PATTERN',
  'TERMINAL_PROMPT_CONTINUATION_HINT_PATTERN'
]);

await check('Windows path normalization preserves drive and UNC roots', () => {
  const cases = [
    ['D:\\Projects\\repo\\.\\src\\..', 'D:\\Projects\\repo'],
    ['D:/Projects/한글 [demo]/../repo', 'D:\\Projects\\repo'],
    ['D:\\#Projects\\example', 'D:\\#Projects\\example'],
    ['D:/#Projects/한글 [demo]', 'D:\\#Projects\\한글 [demo]'],
    ['D:\\..\\..\\repo', 'D:\\repo'],
    ['D:\\', 'D:\\'],
    ['\\\\server\\share\\한글 [demo]\\.\\src\\..', '\\\\server\\share\\한글 [demo]'],
    ['//server/share/한글 project/../repo', '\\\\server\\share\\repo'],
    ['\\\\server\\share', '\\\\server\\share'],
    ["\\\\wsl.localhost\\TestDistro\\workspace\\O'Brien", "\\\\wsl.localhost\\TestDistro\\workspace\\O'Brien"],
    ['\\\\wsl$\\TestDistro\\workspace\\repo', '\\\\wsl$\\TestDistro\\workspace\\repo'],
    ['\\\\?\\D:\\Project\\..\\repo', '\\\\?\\D:\\Project\\..\\repo'],
    ['\\\\?\\UNC\\server\\share\\Project\\..\\repo', '\\\\?\\UNC\\server\\share\\Project\\..\\repo'],
    ['\\\\.\\DeviceName', '\\\\.\\DeviceName']
  ];
  for (const [input, expected] of cases) {
    assert.equal(paths.normalizeWindowsTerminalPath(input), expected);
    assert.equal(paths.normalizeWindowsTerminalPath(expected), expected, 'Normalization is idempotent');
    assert.equal(paths.isWindowsPath(expected), true, 'Normalized paths must remain recognizably Windows');
  }
});

await check('Relative Windows cd cannot climb above a UNC share', () => {
  const cwd = '\\\\server\\share\\project\\src';
  for (const [target, expected] of [
    ['..', '\\\\server\\share\\project'],
    ['..\\..\\..\\..', '\\\\server\\share'],
    ['..\\..\\..\\other', '\\\\server\\share\\other'],
    ['D:\\OtherProject', 'D:\\OtherProject'],
    ['\\OtherProject', '\\\\server\\share\\OtherProject'],
    ['/OtherProject', '\\\\server\\share\\OtherProject'],
    ['//other/share/repo', '\\\\other\\share\\repo']
  ]) {
    const resolved = paths.resolveWindowsCdTarget(cwd, target, windows.root);
    assert.equal(paths.normalizeWindowsTerminalPath(resolved), expected);
  }
  assert.equal(paths.resolveWindowsCdTarget('D:\\Project\\src', '\\OtherProject'), 'D:\\OtherProject');
  assert.equal(paths.resolveWindowsCdTarget('D:\\Project\\src', '/OtherProject'), 'D:\\OtherProject');
  assert.equal(paths.normalizeWindowsTerminalPath('\\parent\\..\\root'), '\\root');
});

await check('PowerShell prompt extraction recognizes drive and UNC project directories', () => {
  const pane = { cwd: 'D:\\Old' };
  for (const cwd of [
    'D:\\Projects\\한글 [demo]',
    'D:\\#Projects\\example',
    'D:\\#Projects\\한글 [demo]',
    '\\\\server\\share\\한글 [demo]',
    "\\\\wsl.localhost\\TestDistro\\workspace\\O'Brien",
    '\\\\wsl$\\TestDistro\\workspace\\repo'
  ]) {
    assert.equal(paths.extractPromptCwd(`old output\nPS ${cwd}> `, pane), cwd);
    assert.equal(paths.terminalOutputMayContainPromptCwdHint(`PS ${cwd}`), true,
      'An unfinished UNC prompt must still be scheduled for cwd tracking');
    assert.equal(paths.terminalOutputMayContainPromptCwdHint(`old output ${'x'.repeat(300)}\nPS ${cwd}`), true);
  }
  assert.equal(paths.extractPromptCwd('PS HKLM:\\Software> ', pane), '', 'Registry providers are not filesystem cwd');
  assert.equal(paths.extractPromptCwd('plain output, not a prompt', pane), '');
  assert.equal(paths.extractPromptCwd('shell@host:/workspace/project$ ', pane), '/workspace/project');
});

await check('Fragmented UNC prompts retain bounded tracking state', () => {
  const prefix = 'PS \\\\server\\share\\';
  const suffix = '한글 project> ';
  assert.equal(paths.terminalPromptCwdContinuationTail(`old line\n${prefix}`), prefix);
  const pane = { cwd: 'D:\\Old', cwdOutputBuffer: prefix, command: null };
  assert.equal(paths.terminalDataMayContainPromptCwdHint(pane, '한글 project'), true);
  assert.equal(paths.extractPromptCwd(`${prefix}${suffix}`, pane), '\\\\server\\share\\한글 project');
  assert.equal(paths.terminalDataMayContainPromptCwdHint(pane, suffix, 'background'), false);
  assert.equal(paths.terminalDataMayContainPromptCwdHint({ ...pane, command: 'llm' }, suffix), false);
});

await check('Long incomplete UNC prompts avoid overlapping-pattern backtracking', () => {
  const pane = { cwd: 'D:\\Old' };
  const longPart = 'x'.repeat(32_768);
  // CPU time excludes descheduling on shared CI. The ceiling is deliberately generous
  // for a linear scan; overlapping share/tail quantifiers repeatedly rescan this suffix.
  // Keep the fixture to 32 KiB so a regression fails promptly rather than hanging tests.
  const started = process.cpuUsage();
  assert.equal(paths.extractPromptCwd(`PS \\\\server\\${longPart}`, pane), '');
  const elapsed = process.cpuUsage(started);
  const cpuMs = (elapsed.user + elapsed.system) / 1000;
  assert.ok(cpuMs < 250, `An incomplete UNC prompt must not trigger quadratic backtracking (${cpuMs.toFixed(1)} ms CPU)`);
  assert.equal(paths.extractPromptCwd(`PS \\\\server\\${longPart}?invalid> `, pane), '');
  assert.equal(paths.extractPromptCwd(`PS \\\\${longPart}`, pane), '');
  assert.equal(paths.extractPromptCwd('PS \\\\server\\share> ', pane), '\\\\server\\share');
});

await check('UNC cwd updates remain absolute in pane snapshots and do not resave unchanged values', () => {
  const saves = [];
  const titles = [];
  const widget = {};
  const context = loadHelpers([
    'updateTerminalCwd', 'normalizeWindowsTerminalPath', 'normalizePosixTerminalPath', 'isWindowsPath'
  ], {
    terminalWidgetForPane: () => widget,
    updateTerminalWidgetTitle: (value) => titles.push(value),
    terminalPaneLlmId: () => null,
    scheduleTerminalCwdSnapshotSave: (pane) => saves.push(pane.cwd)
  });
  const pane = { cwd: 'D:\\Old' };
  context.updateTerminalCwd(pane, '\\\\server\\share\\project\\src\\..');
  assert.equal(pane.cwd, '\\\\server\\share\\project');
  context.updateTerminalCwd(pane, '\\\\server\\share\\project');
  assert.deepEqual(saves, ['\\\\server\\share\\project']);
  assert.deepEqual(titles, [widget]);
});

await check('Windows cwd validation returns the exact resolved directory used by the probe', async () => {
  const probes = [];
  const context = loadHelpers(['usableTerminalCwd'], {
    api: {
      resolveProfilePath: async (profileId, candidate) => {
        assert.equal(profileId, windows.id);
        return candidate.trim() || windows.root;
      },
      profileDirectoryIsDir: async (profileId, path) => { probes.push([profileId, path]); return true; }
    }
  });
  assert.equal(await context.usableTerminalCwd(windows, '  D:\\Project  '), 'D:\\Project');
  assert.equal(await context.usableTerminalCwd(windows, ''), windows.root,
    'An empty request resolves to an explicit directory, never process cwd inheritance');
  assert.deepEqual(probes, [[windows.id, 'D:\\Project'], [windows.id, windows.root]]);
});

await check('Drive-relative Windows shell folders fail with actionable guidance before IPC or recovery', async () => {
  const calls = [];
  const context = loadHelpers(['usableTerminalCwd'], {
    api: {
      resolveProfilePath: async (_profileId, candidate) => { calls.push(candidate); return candidate; },
      profileDirectoryIsDir: async (_profileId, path) => { calls.push(path); return true; }
    }
  });
  for (const requested of ['D:#Projects\\example', 'd:relative', 'D:', '  d:#Projects\\example  ']) {
    await assert.rejects(
      context.usableTerminalCwd(windows, requested, ['E:\\UnrelatedProject', windows.root]),
      (error) => {
        assert.match(error.message, /drive.relative|absolute|fully.qualified/i);
        assert.match(error.message, /[A-Za-z]:\\/);
        assert.doesNotMatch(error.message, /requested shell folder is unavailable/i);
        return true;
      }
    );
  }
  assert.deepEqual(calls, [], 'Ambiguous Windows roots must not be probed or silently recovered elsewhere');
  for (const profile of [wsl, ssh]) {
    assert.equal(await context.usableTerminalCwd(profile, 'd:relative'), 'd:relative',
      'A colon in a POSIX relative filename is not a Windows drive');
  }
});

await check('Drive-absolute shell folders preserve literal hash characters through validation', async () => {
  const calls = [];
  const context = loadHelpers(['usableTerminalCwd'], {
    api: {
      resolveProfilePath: async (profileId, candidate) => { calls.push(['resolve', profileId, candidate]); return candidate; },
      profileDirectoryIsDir: async (profileId, path) => { calls.push(['probe', profileId, path]); return true; }
    }
  });
  for (const requested of ['D:\\#Projects\\example', 'd:/#Projects/한글 [demo]']) {
    assert.equal(await context.usableTerminalCwd(windows, requested), requested);
    assert.deepEqual(calls.splice(0), [
      ['resolve', windows.id, requested], ['probe', windows.id, requested]
    ]);
  }
});

await check('A fresh unavailable Windows cwd fails rather than silently using home or another project', async () => {
  const probes = [];
  const state = { currentDir: 'E:\\OtherProject', workspaceRoot: 'E:\\OtherProject', activeProfile: windows };
  const context = loadHelpers(['usableTerminalCwd'], {
    state,
    api: {
      resolveProfilePath: async (_profileId, candidate) => { probes.push(candidate); return candidate; },
      profileDirectoryIsDir: async (_profileId, path) => path !== 'D:\\MissingProject'
    }
  });
  await assert.rejects(context.usableTerminalCwd(windows, 'D:\\MissingProject'), /requested shell folder is unavailable/i);
  assert.deepEqual(probes, ['D:\\MissingProject']);
  context.api.resolveProfilePath = async () => { throw new Error('sensitive-probe-detail'); };
  try {
    await context.usableTerminalCwd(windows, 'D:\\MissingProject');
    assert.fail('Probe errors must fail the shell launch');
  } catch (error) {
    assert.match(error.message, /requested shell folder is unavailable/i);
    assert.ok(!error.message.includes('sensitive-probe-detail'), 'Do not surface raw probe diagnostics');
  }
});

await check('Restore recovery only uses its captured candidate list after a workspace switch', async () => {
  const probes = [];
  const state = { workspaceRoot: 'D:\\SnapshotProject', currentDir: 'D:\\SnapshotProject\\child' };
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const context = loadHelpers(['usableTerminalCwd'], {
    state,
    api: {
      resolveProfilePath: async (_profileId, candidate) => {
        probes.push(candidate);
        if (candidate === 'D:\\MissingOldCwd') await waiting;
        return candidate;
      },
      profileDirectoryIsDir: async (_profileId, candidate) => candidate === 'D:\\SnapshotProject'
    }
  });
  const fallbacks = [state.workspaceRoot, state.currentDir, windows.root, ''];
  const pending = context.usableTerminalCwd(windows, 'D:\\MissingOldCwd', fallbacks);
  state.workspaceRoot = 'E:\\NewWorkspace';
  state.currentDir = 'E:\\NewWorkspace\\child';
  fallbacks[0] = 'E:\\MutationAfterStart';
  finish();
  assert.equal(await pending, 'D:\\SnapshotProject');
  assert.deepEqual(probes, ['D:\\MissingOldCwd', 'D:\\SnapshotProject']);
});

function repairFixture() {
  const previous = 'D:#Projects\\한글 [demo]';
  const corrected = 'D:\\#Projects\\한글 [demo]';
  const pane = { workspaceId: 'project-a', profileId: windows.id, cwd: previous };
  const live = { ...pane, backendId: 'live' };
  const pending = { ...pane, pendingRuntimeOperationId: 'starting' };
  const otherWorkspace = { ...pane, workspaceId: 'project-b' };
  const otherProfile = { ...pane, profileId: ssh.id };
  const state = {
    activeProfile: windows, activeWorkspaceId: 'project-a', workspaceRoot: previous,
    currentDir: previous, workspaceOpen: true,
    terminals: [pane, live, pending, otherWorkspace, otherProfile]
  };
  const snapshot = {
    profileId: windows.id, root: previous, currentDir: previous,
    terminals: [{ cwd: previous }, { cwd: previous, backendId: 'live' }]
  };
  const calls = [];
  const context = loadHelpers([
    'usableTerminalCwd', 'repairWindowsShellFolder',
    'applyWindowsShellFolderRepair', 'sameWindowsFolderRepairPath'
  ], {
    state, workspaceActivationGeneration: 1, workspacePathSwitchGeneration: 1,
    windowsFolderRepairRequests: new Map(), IS_TERMINAL_APP: false,
    el: { rootInput: { value: previous } },
    api: {
      profileDirectoryIsDir: async (_id, path) => { calls.push(['probe', path]); return true; },
      resolveProfilePath: async (_id, path) => { calls.push(['resolve', path]); return path; }
    },
    withTimeout: (promise) => promise,
    window: { confirm: (message) => { calls.push(['confirm', message]); return true; } },
    clearExplorerBackgroundWork: () => calls.push(['clear-explorer']),
    terminalWidgetForPane: () => ({}), updateTerminalWidgetTitle: () => {},
    workspaceSnapshotForId: () => snapshot,
    scheduleWorkspaceStorePersist: () => calls.push(['persist']),
    saveActiveWorkspaceSnapshot: () => calls.push(['save']),
    renderWorkspaceTabs: () => {},
    loadWorkspaceDirectoryInBackground: (...args) => calls.push(['load', ...args]),
    scheduleExplorerWatch: () => calls.push(['watch'])
  });
  return { context, previous, corrected, state, snapshot, calls };
}

await check('Confirmed existing Windows folder repairs root and unstarted panes without touching live shells', async () => {
  const { context, previous, corrected, state, snapshot, calls } = repairFixture();
  assert.equal(await context.usableTerminalCwd(windows, previous, [], 'project-a'), corrected);
  assert.equal(state.workspaceRoot, corrected);
  assert.equal(state.currentDir, corrected);
  assert.equal(context.el.rootInput.value, corrected);
  assert.equal(state.terminals[0].cwd, corrected);
  for (const pane of state.terminals.slice(1)) assert.equal(pane.cwd, previous);
  assert.equal(snapshot.root, corrected);
  assert.equal(snapshot.currentDir, corrected);
  assert.equal(snapshot.terminals[0].cwd, corrected, 'Cold restore must persist repair even with UI capture suppressed');
  assert.equal(snapshot.terminals[1].cwd, previous);
  assert.equal(calls.filter(([name]) => name === 'confirm').length, 1);
  assert.ok(calls.some(([name]) => name === 'persist'));
  assert.ok(calls.some(([name]) => name === 'watch'), 'Root repair must resume Explorer polling');
  assert.deepEqual(calls.find(([name]) => name === 'load'), ['load', corrected, windows.id, 'project-a']);
});

await check('Concurrent repairs share one probe and confirmation, then release the pending request', async () => {
  const { context, previous, corrected, calls } = repairFixture();
  const first = context.repairWindowsShellFolder(windows, previous, 'project-a');
  const second = context.repairWindowsShellFolder(windows, previous, 'project-a');
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [corrected, corrected]);
  assert.equal(calls.filter(([name]) => name === 'probe').length, 1);
  assert.equal(calls.filter(([name]) => name === 'confirm').length, 1);
  assert.equal(context.windowsFolderRepairRequests.size, 0);
});

await check('Cancelled, absent and failed repair probes never mutate paths or try a home fallback', async () => {
  for (const mode of ['cancel', 'absent', 'error']) {
    const { context, previous, state, snapshot, calls } = repairFixture();
    if (mode === 'cancel') context.window.confirm = () => false;
    if (mode === 'absent') context.api.profileDirectoryIsDir = async () => false;
    if (mode === 'error') context.api.profileDirectoryIsDir = async () => { throw new Error('private-probe-detail'); };
    await assert.rejects(context.usableTerminalCwd(windows, previous, [windows.root, ''], 'project-a'), (error) => {
      assert.match(error.message, /cancelled|does not exist|Could not verify/);
      assert.doesNotMatch(error.message, /private-probe-detail/);
      return true;
    });
    assert.equal(state.workspaceRoot, previous);
    assert.equal(snapshot.root, previous);
    assert.ok(state.terminals.every((pane) => pane.cwd === previous));
    assert.ok(!calls.some(([name]) => ['resolve', 'persist', 'save'].includes(name)));
    assert.equal(context.windowsFolderRepairRequests.size, 0);
  }
});

await check('A workspace switch or leave-and-return during a repair probe cancels stale confirmation', async () => {
  for (const mode of ['workspace', 'activation', 'path', 'profile', 'root']) {
    const { context, previous, state, snapshot, calls } = repairFixture();
    let finish;
    context.api.profileDirectoryIsDir = () => new Promise((resolve) => { finish = resolve; });
    const pending = context.repairWindowsShellFolder(windows, previous, 'project-a');
    await Promise.resolve();
    if (mode === 'workspace') state.activeWorkspaceId = 'project-b';
    if (mode === 'activation') context.workspaceActivationGeneration += 1;
    if (mode === 'path') context.workspacePathSwitchGeneration += 1;
    if (mode === 'profile') state.activeProfile = ssh;
    if (mode === 'root') state.workspaceRoot = 'E:\\AnotherProject';
    finish(true);
    await assert.rejects(pending, /workspace changed/);
    assert.equal(snapshot.root, previous);
    assert.ok(!calls.some(([name]) => name === 'confirm' || name === 'persist'));
    assert.equal(context.windowsFolderRepairRequests.size, 0);
  }
});

await check('Approved repair cannot fall back elsewhere if the folder disappears before spawning', async () => {
  const { context, previous, corrected, calls } = repairFixture();
  let probes = 0;
  context.api.profileDirectoryIsDir = async () => ++probes === 1;
  await assert.rejects(context.usableTerminalCwd(windows, previous, [windows.root, ''], 'project-a'), /unavailable/);
  assert.deepEqual(calls.filter(([name]) => name === 'resolve'), [['resolve', corrected]]);
});

await check('Absolute Windows and POSIX paths bypass repair, while launch and restore supply workspace context', async () => {
  const { context, calls } = repairFixture();
  for (const [profile, path] of [[windows, 'D:\\#Projects\\Example'], [windows, '\\\\server\\share'], [ssh, 'D:filename']]) {
    assert.equal(await context.repairWindowsShellFolder(profile, path, 'project-a'), path);
  }
  assert.deepEqual(calls, []);
  const helperText = (name) => parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed);
  assert.match(helperText('startTerminalPaneBackend'), /usableTerminalCwd\(terminalProfile, pane\.cwd, \[\], pane\.workspaceId\)/);
  assert.match(helperText('resolveSelectedRoot'), /await repairWindowsShellFolder\(/);
  assert.match(source, /usableTerminalCwd\(plan\.terminalProfile, plan\.pane\.cwd,[\s\S]{0,250}\], snapshot\.id\)/);
});

if (baseline) console.log(`Windows shell cwd baseline: ${failures.length} known failing groups`);
else console.log(`Windows shell cwd smoke: ${checks} groups passed (helper-level; not Windows runtime).`);
