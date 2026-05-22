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
const ENV_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/;
const JSON_LINE = /^(\s*"((?:\\.|[^"\\])+)?"\s*:\s*)(.*?)(\s*,?\s*)$/;
const JSON_SCALAR = /^(?:"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;
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

export function parseSecretLines(content: string, path = ''): SecretLine[] {
  const lines = content.split(/\n/);
  if (isJsonPath(path)) return parseJsonSecretLines(lines);
  return lines.map((line, index) => {
    const envMatch = line.match(ENV_LINE);
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

    const jsonMatch = line.match(JSON_LINE);
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

function parseJsonSecretLines(lines: string[]): SecretLine[] {
  return lines.map((line, index) => {
    const jsonMatch = line.match(JSON_LINE);
    if (!jsonMatch) return { id: String(index), kind: 'raw', original: line };

    const [, prefix, key, value, suffix] = jsonMatch;
    if (!isJsonScalar(value)) return { id: String(index), kind: 'raw', original: line };
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

function isJsonPath(path: string) {
  return path.toLocaleLowerCase().replace(/\\/g, '/').endsWith('.json');
}

function isJsonScalar(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[' || trimmed === '{') return false;
  return JSON_SCALAR.test(trimmed);
}

export function serializeSecretLines(lines: SecretLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === 'kv') return `${line.prefix ?? ''}${line.value ?? ''}${line.suffix ?? ''}`;
      return line.original;
    })
    .join('\n');
}
