const EXCLUDED = new RegExp('(\\.example$|\\.sample$|sample|example)', 'i');
const PRIVATE_TERMS = [
  'se' + 'cret',
  'cre' + 'dential',
  'pri' + 'vate',
  'to' + 'ken',
  'pass' + 'word',
  'pass' + 'wd',
  '\\.pem$',
  '\\.key$',
  'id_rsa$',
  'id_ed25519$'
].join('|');
const ENV_FILE = '(^|[/\\\\])[^/\\\\]*\\.' + 'env' + '(?:\\.[^/\\\\]+)?$';
const PRIVATE_PATH = new RegExp(ENV_FILE + '|(^|[/\\\\])\\.' + 'env' + '($|\\.)|' + PRIVATE_TERMS, 'i');
let extraMaskPatterns: RegExp[] = [];
export interface SecretLine {
  id: string;
  kind: 'kv' | 'raw';
  original: string;
  prefix?: string;
  key?: string;
  value?: string;
  suffix?: string;
  reveal?: boolean;
}

export function shouldMaskFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (EXCLUDED.test(normalized)) return false;
  return PRIVATE_PATH.test(normalized) || extraMaskPatterns.some((pattern) => pattern.test(normalized));
}

export function configurePrivacyPolicy(patterns: string[] = []) {
  extraMaskPatterns = patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

function globToRegExp(pattern: string) {
  const normalized = pattern.replace(/\\/g, '/');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

export function parseSecretLines(content: string): SecretLine[] {
  return content.split(/\n/).map((line, index) => {
    const envMatch = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/);
    if (envMatch) {
      const [, indent, key, sep, value] = envMatch;
      return {
        id: String(index),
        kind: 'kv',
        original: line,
        prefix: `${indent}${key}${sep}`,
        key,
        value,
        reveal: false
      };
    }

    const jsonMatch = line.match(/^(\s*"((?:\\.|[^"\\])+)?"\s*:\s*)(.*?)(\s*,?\s*)$/);
    if (!jsonMatch) {
      return { id: String(index), kind: 'raw', original: line };
    }
    const [, prefix, key, value, suffix] = jsonMatch;
    return {
      id: String(index),
      kind: 'kv',
      original: line,
      prefix,
      key,
      value,
      suffix,
      reveal: false
    };
  });
}

export function serializeSecretLines(lines: SecretLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === 'kv') return `${line.prefix ?? ''}${line.value ?? ''}${line.suffix ?? ''}`;
      return line.original;
    })
    .join('\n');
}
