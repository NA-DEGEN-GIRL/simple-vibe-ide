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
const PRIVATE_PATH = new RegExp('(^|[/\\\\])\\.' + 'env' + '($|\\.)|' + PRIVATE_TERMS, 'i');
const SENSITIVE_KEY = new RegExp(
  [
    'se' + 'cret',
    'to' + 'ken',
    'pass' + 'word',
    'pass' + 'wd',
    'api[_-]?key',
    'pri' + 'vate',
    'cre' + 'dential',
    'client[_-]?' + 'se' + 'cret',
    'bot[_-]?' + 'to' + 'ken'
  ].join('|'),
  'i'
);

export interface SecretLine {
  id: string;
  kind: 'kv' | 'raw';
  original: string;
  prefix?: string;
  key?: string;
  value?: string;
  reveal?: boolean;
}

export function shouldMaskFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (EXCLUDED.test(normalized)) return false;
  return PRIVATE_PATH.test(normalized);
}

export function parseSecretLines(content: string): SecretLine[] {
  return content.split(/\n/).map((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/);
    if (!match) {
      return { id: String(index), kind: 'raw', original: line };
    }
    const [, key, sep, value] = match;
    const sensitive = SENSITIVE_KEY.test(key) || value.length > 0;
    if (!sensitive) {
      return { id: String(index), kind: 'raw', original: line };
    }
    return {
      id: String(index),
      kind: 'kv',
      original: line,
      prefix: `${key}${sep}`,
      key,
      value,
      reveal: false
    };
  });
}

export function serializeSecretLines(lines: SecretLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === 'kv') return `${line.prefix ?? ''}${line.value ?? ''}`;
      return line.original;
    })
    .join('\n');
}
