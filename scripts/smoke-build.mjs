#!/usr/bin/env node
// Run against a disposable, configured APK Factory stack. Node 20+ and unzip.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/smoke-build.mjs /absolute/path/native-android.zip');
  process.exit(1);
}
const base = new URL(process.env.SMOKE_API_URL || 'http://localhost:4000');
const output = resolve(process.env.SMOKE_OUTPUT_DIR || `/tmp/apk-factory-smoke-${randomUUID()}`);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 1800000);
assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Invalid SMOKE_TIMEOUT_MS');
const zip = await readFile(zipPath);
execFileSync('unzip', ['-t', resolve(zipPath)], { stdio: 'ignore' });
await mkdir(output, { recursive: true });
let token;
let accountCreated = false;
const report = [];

async function request(route, { method = 'GET', body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(`/api/v1${route}`, base), {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
async function download(url) {
  const target = new URL(url, base);
  assert.equal(target.origin, base.origin, 'Artifact URL must use the configured public API origin');
  const response = await fetch(target, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  assert.equal(response.status, 200, 'Artifact download failed');
  return Buffer.from(await response.arrayBuffer());
}
const digest = data => createHash('sha256').update(data).digest('hex');
try {
  await request('/health');
  const registered = await request('/auth/register', { method: 'POST', body: {
    email: `smoke-${randomUUID()}@example.com`, name: 'Android build smoke test', password: randomUUID(),
  } });
  token = registered.token;
  assert.ok(token, 'Registration did not return a token');
  accountCreated = true;
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'native-android.zip');
  form.append('name', 'Android smoke test');
  const project = await request('/projects/upload', { method: 'POST', body: form });
  assert.ok(project.id, 'Upload did not return a project');

  for (const buildType of ['DEBUG', 'RELEASE', 'AAB']) {
    const route = `/projects/${project.id}/builds`;
    const build = await request(route, { method: 'POST', body: { buildType, autoFix: false } });
    assert.ok(build.id, 'Build creation did not return an ID');
    console.log(`${buildType}: queued ${build.id}`);
    const deadline = Date.now() + timeoutMs;
    let current;
    while (Date.now() < deadline) {
      current = await request(`${route}/${build.id}`);
      if (['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(current.status)) break;
      await new Promise(done => setTimeout(done, 5000));
    }
    if (current?.status !== 'SUCCESS') {
      const logs = await request(`${route}/${build.id}/logs?limit=1000`);
      await writeFile(join(output, `${buildType.toLowerCase()}-logs.json`), JSON.stringify(logs, null, 2));
      throw new Error(`${buildType}: ${current?.status || 'unknown'}: ${current?.errorMessage || 'deadline exceeded'}; logs: ${output}`);
    }
    const extension = buildType === 'AAB' ? '.aab' : '.apk';
    assert.ok(new URL(current.apkUrl).pathname.endsWith(extension), 'Wrong artifact format');
    const bytes = await download(current.apkUrl);
    assert.ok(bytes.length > 0, 'Empty artifact');
    assert.equal(bytes.length, current.apkSize, 'Downloaded artifact size differs from database');
    const file = join(output, `${buildType.toLowerCase()}${extension}`);
    await writeFile(file, bytes);
    execFileSync('unzip', ['-t', file], { stdio: 'ignore' });
    const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n');
    assert.ok(entries.includes(buildType === 'AAB' ? 'base/manifest/AndroidManifest.xml' : 'AndroidManifest.xml'), 'Android manifest missing');
    const link = await request(`${route}/${build.id}/public-link`, { method: 'POST' });
    assert.equal(digest(await download(link.publicLink)), digest(bytes), 'Share link returns different bytes');
    report.push({ buildType, buildId: build.id, size: bytes.length, sha256: digest(bytes), file });
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`${buildType}: compiled, downloaded, ZIP structure and share link verified (${bytes.length} bytes)`);
  }
  // Delete only the account and projects created by this successful test.
  await request('/me', { method: 'DELETE' });
  accountCreated = false;
  console.log(`PASS: DEBUG, RELEASE, AAB. Artifacts and report: ${output}`);
  console.log('Signature verification, installation and device tests remain separate checks.');
} catch (error) {
  console.error(error.message);
  if (accountCreated) console.error('Test account/project retained for debugging. Remove them from the disposable test stack after investigating.');
  process.exitCode = 1;
}
