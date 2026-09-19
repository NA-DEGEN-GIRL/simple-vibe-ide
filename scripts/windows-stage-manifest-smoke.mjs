import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectStageManifest, isBuildSourcePath, isPrivateLookingUntrackedPath
} from './windows-stage-manifest.mjs';

// Real Git/filesystem fixtures for the staging manifest, not a Windows build smoke.
const helperPath = fileURLToPath(new URL('./windows-stage-manifest.mjs', import.meta.url));
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'simple-vibe-stage-test-'));
const emptyGlobalExcludes = path.join(temporaryRoot, 'empty-global-excludes');
writeFileSync(emptyGlobalExcludes, '');
let fixtureNumber = 0;
let checks = 0;

function check(name, run) {
  run();
  checks += 1;
  console.log(`PASS: ${name}`);
}

function fixture() {
  const root = path.join(temporaryRoot, `fixture-${++fixtureNumber}`);
  mkdirSync(root);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Synthetic fixture Git command must succeed');
    return result.stdout;
  };
  const write = (relative, content = '// synthetic fixture\n') => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.quotepath', 'true');
  git('config', 'core.excludesFile', emptyGlobalExcludes);
  write('.gitignore', '.handoff/\n.vibe-ide-temp/\nnode_modules/\ndist/\n**/generated/\n');
  write('package.json', '{"name":"stage-fixture","private":true}\n');
  write('src/main.ts');
  write('src-tauri/src/lib.rs', 'mod preview_body;\n');
  git('add', '.gitignore', 'package.json', 'src/main.ts', 'src-tauri/src/lib.rs');
  return { root, git, write };
}

function indexSnapshot(root) {
  return readFileSync(path.join(root, '.git', 'index'));
}

try {
  check('default allowlist covers source modules and helpers, not unrelated data', () => {
    const accepted = [
      'src-tauri/src/preview_body.rs', 'src-tauri/src/nested/parser.rs',
      'src-tauri/build.rs', 'src-tauri/capabilities/browser.json',
      'src/Editor.ts', 'src/views/Editor.tsx', 'src/views/Editor.jsx',
      'src/theme.css', 'src/theme.scss', 'src/theme.sass', 'src/theme.less',
      'src/frame.html', 'src/Widget.vue', 'src/Widget.svelte',
      'src/worker.js', 'src/worker.mjs', 'src/worker.cjs',
      'scripts/smoke.ps1', 'scripts/build.cmd', 'scripts/build.bat',
      'scripts/test.mjs', 'scripts/test.cjs', 'scripts/test.js',
      'scripts/test.sh', 'scripts/test.py'
    ];
    for (const relative of accepted) assert.equal(isBuildSourcePath(relative), true, relative);
    for (const relative of [
      'docs/local.md', 'public/new.png', 'src/local.json', 'src-tauri/target/cache.rs',
      'src-tauri/src/private.txt', 'scripts/output.log', '.handoff/latest.md',
      '.vibe-ide-temp/attachment.png', 'node_modules/library/index.js', '.env'
    ]) assert.equal(isBuildSourcePath(relative), false, relative);
  });

  check('private-looking names remain blocked, including inside source directories', () => {
    for (const relative of [
      '.env', '.env.production', 'src/.env.local', '.npmrc', '.netrc',
      '.git-credentials', 'id_rsa', 'id_ed25519', 'src/.aws/config.ts',
      'src/.ssh/config.ts', 'src/.azure/token.ts', 'src/.gnupg/key.ts',
      'cert.pem', 'cert.key', 'cert.p12', 'cert.pfx'
    ]) assert.equal(isPrivateLookingUntrackedPath(relative), true, relative);
    assert.equal(isPrivateLookingUntrackedPath('.env.example'), false);
    assert.equal(isPrivateLookingUntrackedPath('src-tauri/src/preview_body.rs'), false);
  });

  check('new Rust module/helpers are included without modifying the Git index', () => {
    const { root, write } = fixture();
    const automatic = [
      'src-tauri/src/preview_body.rs', 'src-tauri/src/nested/추가 [테스트] 🚀.rs',
      'scripts/windows-stage-manifest.mjs', 'scripts/windows-stage-manifest-smoke.mjs',
      'src/components/new file [1].tsx', 'src/theme/new.css',
      'src-tauri/build.rs', 'src-tauri/capabilities/new.json'
    ];
    for (const relative of automatic) write(relative);
    for (const relative of [
      '.handoff/latest.md', '.vibe-ide-temp/private.ts', 'node_modules/new/file.ts',
      'src/generated/ignored.ts', 'docs/local.md', 'public/new.png', 'src/local.json', '.env'
    ]) write(relative, 'synthetic fixture only\n');
    const before = indexSnapshot(root);
    const manifest = collectStageManifest(root);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.automaticUntrackedCount, automatic.length);
    assert.deepEqual(new Set(manifest.files), new Set([
      '.gitignore', 'package.json', 'src/main.ts', 'src-tauri/src/lib.rs', ...automatic
    ]));
    assert.deepEqual(indexSnapshot(root), before, 'Manifest creation must not stage new files in Git');

    const cli = spawnSync(process.execPath, [helperPath, '--source-root', root, '--git', 'git'], {
      encoding: 'utf8'
    });
    assert.equal(cli.status, 0);
    assert.equal(cli.stderr, '');
    assert.equal(/[^\x00-\x7f]/.test(cli.stdout), false, 'PowerShell JSON output must stay ASCII-safe');
    assert.deepEqual(JSON.parse(cli.stdout), manifest, 'CLI must preserve exact Unicode and bracket paths');
    assert.deepEqual(indexSnapshot(root), before);
  });

  check('tracked working-tree edits are retained and tracked deletions are skipped', () => {
    const { root, git, write } = fixture();
    write('deleted.txt');
    git('add', 'deleted.txt');
    rmSync(path.join(root, 'deleted.txt'));
    write('src/main.ts', '// changed working tree, not index\n');
    const manifest = collectStageManifest(root);
    assert.equal(manifest.files.includes('deleted.txt'), false);
    assert.equal(manifest.files.includes('src/main.ts'), true);
    assert.equal(readFileSync(path.join(root, 'src/main.ts'), 'utf8'), '// changed working tree, not index\n');
  });

  check('explicit wider inclusion includes nonignored assets but still excludes ignored files', () => {
    const { root, write } = fixture();
    write('docs/new.md');
    write('public/new.png');
    write('.env.example', 'SAMPLE_VALUE=example\n');
    write('.handoff/latest.md');
    write('src/generated/ignored.ts');
    const manifest = collectStageManifest(root, { includeUntracked: true });
    for (const relative of ['docs/new.md', 'public/new.png', '.env.example']) {
      assert.equal(manifest.files.includes(relative), true, relative);
    }
    for (const relative of ['.handoff/latest.md', 'src/generated/ignored.ts']) {
      assert.equal(manifest.files.includes(relative), false, relative);
    }
  });

  check('explicit wider inclusion rejects private-looking files without disclosing their paths', () => {
    const { root, write } = fixture();
    write('.env.production', 'SYNTHETIC_SECRET=not-real\n');
    assert.doesNotThrow(() => collectStageManifest(root));
    assert.throws(() => collectStageManifest(root, { includeUntracked: true }));
    const cli = spawnSync(process.execPath, [helperPath, '--source-root', root, '--include-untracked'], {
      encoding: 'utf8'
    });
    assert.notEqual(cli.status, 0);
    assert.equal(cli.stdout.trim(), '');
    assert.equal(cli.stderr.includes(root), false);
    assert.equal(cli.stderr.includes('.env.production'), false);
    assert.equal(cli.stderr.includes('SYNTHETIC_SECRET'), false);
  });

  check('automatic source inclusion rejects private directory components', () => {
    const { root, write } = fixture();
    write('src/.aws/credentials.ts', '// synthetic fixture only\n');
    assert.throws(() => collectStageManifest(root));
  });

  check('Git execution failure produces no partial manifest', () => {
    const { root } = fixture();
    assert.throws(() => collectStageManifest(root, {
      gitExecutable: path.join(root, 'nonexistent-git-executable')
    }));
    const cli = spawnSync(process.execPath, [
      helperPath, '--source-root', root, '--git', path.join(root, 'nonexistent-git-executable')
    ], { encoding: 'utf8' });
    assert.notEqual(cli.status, 0);
    assert.equal(cli.stdout.trim(), '');
    assert.equal(cli.stderr.includes(root), false);
  });

  if (process.platform !== 'win32') {
    check('Windows-invalid names are rejected before any copy', () => {
      for (const relative of [
        'src/CON.ts', 'src/aux/file.ts', 'src/a:b.ts', 'src/quote"name.ts',
        'src/new\nline.ts', 'src/tab\tname.ts', 'src/back\\slash.ts',
        'src/trailing. /file.ts', 'src/trailing./file.ts'
      ]) {
        const { root, write } = fixture();
        write(relative);
        assert.throws(() => collectStageManifest(root), undefined, relative);
      }
    });
  } else {
    console.log('SKIP: creating Windows-invalid filenames requires a non-Windows fixture filesystem');
  }

  {
    const { root, write } = fixture();
    write('src/Case.ts');
    if (existsSync(path.join(root, 'src/case.ts'))) {
      console.log('SKIP: case-collision creation requires a case-sensitive fixture filesystem');
    } else {
      check('case-insensitive Windows destination collisions are rejected', () => {
        write('src/case.ts');
        assert.throws(() => collectStageManifest(root));
      });
      rmSync(path.join(root, 'src/case.ts'));
      rmSync(path.join(root, 'src/Case.ts'));
      check('directory-name collisions are rejected even when filenames differ', () => {
        write('src/Folder/one.ts');
        write('src/folder/two.ts');
        assert.throws(() => collectStageManifest(root));
      });
    }
  }

  {
    const { root, git, write } = fixture();
    let supportsSymlinks = true;
    try {
      symlinkSync(path.join(root, 'src/main.ts'), path.join(root, 'src/linked.ts'), 'file');
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
      supportsSymlinks = false;
      console.log('SKIP: this environment does not permit creating symlink fixtures');
    }
    if (supportsSymlinks) {
      check('source file symlinks are rejected, not followed into their targets', () => {
        assert.throws(() => collectStageManifest(root));
      });
      rmSync(path.join(root, 'src/linked.ts'));
      write('src/nested/file.ts');
      git('add', 'src/nested/file.ts');
      rmSync(path.join(root, 'src/nested'), { recursive: true });
      const externalDirectory = path.join(temporaryRoot, 'external-fixture');
      mkdirSync(externalDirectory);
      writeFileSync(path.join(externalDirectory, 'file.ts'), '// outside synthetic checkout\n');
      symlinkSync(externalDirectory, path.join(root, 'src/nested'), 'junction');
      check('tracked paths with symlink directory components are rejected', () => {
        assert.throws(() => collectStageManifest(root));
      });
    }
  }
  console.log(`Windows stage manifest smoke passed (${checks} checks; no Windows build executed).`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
