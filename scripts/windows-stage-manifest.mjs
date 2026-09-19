import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Windows build already requires Node. Keep Git's NUL-delimited UTF-8
// filenames out of PowerShell 5.1's native output/code-page conversion.
export function isPrivateLookingUntrackedPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  const leaf = path.posix.basename(normalized);
  return (leaf === '.env' || (leaf.startsWith('.env.') && !leaf.endsWith('.example')))
    || ['.npmrc', '.netrc', '.git-credentials', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa'].includes(leaf)
    || /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg)\//.test(normalized)
    || /\.(pem|key|p12|pfx)$/.test(leaf);
}

export function isBuildSourcePath(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (normalized === 'src-tauri/build.rs') return true;
  if (normalized.startsWith('src-tauri/src/')) return normalized.endsWith('.rs');
  if (normalized.startsWith('src-tauri/capabilities/')) return normalized.endsWith('.json');
  if (normalized.startsWith('src/')) return /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|vue|svelte)$/.test(normalized);
  if (normalized.startsWith('scripts/')) return /\.(ps1|cmd|bat|mjs|cjs|js|sh|py)$/.test(normalized);
  return false;
}

function gitFiles(sourceRoot, gitExecutable, args) {
  try {
    const safeRoot = process.platform === 'win32' ? sourceRoot.replaceAll('\\', '/') : sourceRoot;
    const output = execFileSync(gitExecutable, ['-c', `safe.directory=${safeRoot}`, '-C', sourceRoot, 'ls-files', '-z', ...args], {
      maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return new TextDecoder('utf-8', { fatal: true }).decode(output).split('\0').filter(Boolean);
  } catch {
    // Git stderr can contain local home paths or remote details.
    throw new Error('Could not enumerate source files with Git; the existing stage was not changed.');
  }
}

function validateRelativePath(relativePath) {
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'
    || /[\x00-\x1f\x7f<>:"\\|?*]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('A source filename is unsafe or incompatible with Windows; rename it before staging.');
  }
}

function inspectSourceFile(sourceRoot, relativePath, directories) {
  let current = sourceRoot;
  const parts = relativePath.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    if (index < parts.length - 1 && directories.has(current)) continue;
    let item;
    try { item = lstatSync(current); }
    catch (error) {
      // Preserve tracked deletions in a working-tree build, not the old stage.
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw new Error('Could not inspect a source file; the existing stage was not changed.');
    }
    if (item.isSymbolicLink()) {
      throw new Error('Refusing to stage a source symlink or junction; use regular source files.');
    }
    if (index === parts.length - 1) return item.isFile();
    if (!item.isDirectory()) return false;
    directories.add(current);
  }
  return false;
}

export function collectStageManifest(sourceRoot, { gitExecutable = 'git', includeUntracked = false } = {}) {
  sourceRoot = path.resolve(sourceRoot);
  const tracked = gitFiles(sourceRoot, gitExecutable, ['--cached']);
  const untracked = gitFiles(sourceRoot, gitExecutable, ['--others', '--exclude-standard']);
  const selectedUntracked = untracked.filter((file) => includeUntracked || isBuildSourcePath(file));
  if (selectedUntracked.some(isPrivateLookingUntrackedPath)) {
    throw new Error('Refusing to stage private-looking untracked files. Ignore private local files before retrying.');
  }
  const automatic = new Set(selectedUntracked.filter(isBuildSourcePath));
  const directories = new Set();
  const windowsPaths = new Map();
  const files = [];
  let automaticUntrackedCount = 0;
  for (const file of [...new Set([...tracked, ...selectedUntracked])].sort()) {
    validateRelativePath(file);
    if (!inspectSourceFile(sourceRoot, file, directories)) continue;
    // Check directory components too: Foo/a.rs and foo/b.rs collide on Windows.
    const parts = file.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const name = parts.slice(0, index).join('/');
      const key = name.toLowerCase();
      const previous = windowsPaths.get(key);
      if (previous && previous !== name) {
        throw new Error('Source paths collide on case-insensitive Windows filesystems; rename them before staging.');
      }
      windowsPaths.set(key, name);
    }
    files.push(file);
    if (automatic.has(file)) automaticUntrackedCount += 1;
  }
  if (!files.length) throw new Error('Git returned an empty source manifest.');
  return { version: 1, files, automaticUntrackedCount };
}

function main(args) {
  let sourceRoot = '';
  let gitExecutable = 'git';
  let includeUntracked = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--include-untracked') includeUntracked = true;
    else if (arg === '--source-root' && args[index + 1]) sourceRoot = args[++index];
    else if (arg === '--git' && args[index + 1]) gitExecutable = args[++index];
    else throw new Error('Invalid Windows stage manifest arguments.');
  }
  if (!sourceRoot) throw new Error('The Windows stage manifest requires --source-root.');
  const result = collectStageManifest(sourceRoot, { gitExecutable, includeUntracked });
  // ASCII-only JSON safely crosses legacy Windows PowerShell code pages. JSON
  // reconstructs Unicode, spaces and brackets before Copy-Item -LiteralPath.
  process.stdout.write(JSON.stringify(result).replace(/[\u007f-\uffff]/g, (value) => (
    `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`
  )) + '\n');
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    const entry = realpathSync(process.argv[1]);
    const module = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? entry.toLowerCase() === module.toLowerCase() : entry === module;
  } catch { return false; }
}

if (isEntryPoint()) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
