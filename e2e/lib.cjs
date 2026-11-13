// Shared helpers for the e2e checks (CommonJS so a globally installed playwright also works).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const API = (process.env.E2E_API || 'http://localhost:4000').replace(/\/$/, '');
const WEB = (process.env.E2E_WEB || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(process.env.E2E_OUT || path.join(os.tmpdir(), 'apk-factory-e2e'));
const REF_ZIP = path.resolve(process.env.E2E_ZIP || path.join(__dirname, '..', 'examples', 'reference-android.zip'));
fs.mkdirSync(OUT, { recursive: true });

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let failures = 0;
const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function finish(name) {
  fs.writeFileSync(path.join(OUT, `${name}-results.json`), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed (${name})`);
  process.exit(failures ? 1 : 0);
}

async function api(route, { method = 'GET', token, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api/v1${route}`, {
    method, headers, body: form || (body ? JSON.stringify(body) : undefined),
    redirect: 'manual', signal: AbortSignal.timeout(120000),
  });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function register(prefix) {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  const secret = crypto.randomBytes(24).toString('base64url') + 'aA1'; // random per run, never written to disk
  const r = await api('/auth/register', { method: 'POST', body: { email, name: prefix, password: secret } });
  if (r.status >= 300) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { email, secret, token: r.body.token, id: r.body.user.id };
}

async function upload(token, file, name = 'e2e', filename = 'project.zip') {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), filename);
  form.append('name', name);
  return api('/projects/upload', { method: 'POST', token, form });
}

async function waitBuild(token, projectId, buildId, timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 1500000)) {
  const end = Date.now() + timeoutMs;
  let b;
  while (Date.now() < end) {
    b = (await api(`/projects/${projectId}/builds/${buildId}`, { token })).body;
    if (['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(b.status)) return b;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`build ${buildId} did not finish in time (last status ${b && b.status})`);
}

// ── fixture archives, derived from the reference project ─────────────────────
const STUB_OK = `#!/bin/sh
echo "> Task :app:assembleDebug"
mkdir -p app/build/outputs/apk/debug && head -c 30000 /dev/urandom > app/build/outputs/apk/debug/app-debug.apk
echo "BUILD SUCCESSFUL in 1s"
`;
const STUB_BROKEN = `#!/bin/sh
echo "> Task :app:compileDebugJavaWithJavac FAILED"
echo "/workspace/app/src/main/java/com/apkfactory/reference/MainActivity.java:12: error: incompatible types: String cannot be converted to int"
echo "* What went wrong:"
echo "Execution failed for task ':app:compileDebugJavaWithJavac'."
echo "> Compilation failed; see the compiler error output for details."
echo "BUILD FAILED in 1s"
exit 1
`;
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-zip-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function rezip(srcZip, dest, mutate) {
  withTmp((dir) => {
    execFileSync('unzip', ['-q', srcZip, '-d', dir]);
    mutate(dir);
    const files = execFileSync('find', ['.', '-type', 'f'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').map((f) => f.slice(2)).sort();
    fs.rmSync(dest, { force: true });
    execFileSync('zip', ['-X', '-q', dest, '-@'], { cwd: dir, input: files.join('\n') });
  });
  return dest;
}
/** { ok, broken, nested } zips. With E2E_STUB=1 the Gradle wrapper script is replaced by a stub (no Android SDK needed). */
function fixtures() {
  const stub = process.env.E2E_STUB === '1';
  const ok = path.join(OUT, 'fixture-ok.zip');
  const broken = path.join(OUT, 'fixture-broken.zip');
  rezip(REF_ZIP, ok, (d) => { if (stub) { fs.writeFileSync(path.join(d, 'gradlew'), STUB_OK, { mode: 0o755 }); } });
  rezip(REF_ZIP, broken, (d) => {
    if (stub) fs.writeFileSync(path.join(d, 'gradlew'), STUB_BROKEN, { mode: 0o755 });
    const f = path.join(d, 'app/src/main/java/com/apkfactory/reference/MainActivity.java');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('super.onCreate(savedInstanceState);', 'super.onCreate(savedInstanceState);\n        int broken = "not an int";'));
  });
  return { ok, broken };
}

module.exports = { API, WEB, OUT, REF_ZIP, sha256, check, finish, api, register, upload, waitBuild, fixtures, rezip, withTmp };
