/**
 * Log / error redaction. Everything a build prints, and every error shown to
 * users, goes through redact() so credentials and host paths never leak.
 */
const SECRET_ENV_NAMES = [
  'WORKER_SECRET', 'REDIS_PASSWORD', 'JWT_SECRET', 'POSTGRES_PASSWORD', 'ANTHROPIC_API_KEY',
  'GITHUB_CLIENT_SECRET', 'KEYSTORE_PASSWORD', 'KEY_PASSWORD',
];

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '***'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '***'],
  [/(:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1***@'],
  // key=value / key: value for credential-looking names
  [/\b([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|storePassword|keyPassword|authorization)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2***'],
];

export function redact(input: string, extraSecrets: string[] = []): string {
  if (!input) return input;
  let out = input;
  const values = [
    ...SECRET_ENV_NAMES.map((n) => process.env[n] || ''),
    ...extraSecrets,
  ].filter((v) => v.length >= 6);
  for (const v of values) out = out.split(v).join('***');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);

  // host paths → stable, non-identifying placeholders
  const ws = (process.env.WORKSPACE_DIR || '/tmp/apk-factory/workspaces').replace(/\/+$/, '');
  out = out.split(ws + '/').join('<workspaces>/');
  out = out.replace(/<workspaces>\/[^/\s]+/g, '/workspace');
  out = out.replace(/\/app\/uploads\/[^\s'":]*/g, '<uploads>');
  out = out.replace(/\/home\/(?!builder\b)[^/\s]+/g, '/home/<user>');
  return out;
}
