const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageExtract } = require('../dist/pipeline/stages/01-extract');
const { stageOutput } = require('../dist/pipeline/stages/06-output');
const { SANDBOX } = require('../dist/security/sandbox-config');

async function source(t, files = { 'build.gradle': '// original' }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}
function context(t, root) {
  const ctx = { sourceRepoPath: root, buildId: 'workspace-test', buildType: 'DEBUG', log: async () => {} };
  t.after(async () => {
    if (ctx.workspaceDir && ctx.workspaceDir !== root) await fs.rm(ctx.workspaceDir, { recursive: true, force: true });
  });
  return ctx;
}

test('directory source is copied under the host-visible workspace; AI edits leave originals intact', async t => {
  const root = await source(t);
  const ctx = context(t, root);
  assert.deepEqual(await stageExtract(ctx), { ok: true });
  assert.equal(path.dirname(ctx.workspaceDir), SANDBOX.WORKSPACE_DIR);
  assert.notEqual(ctx.projectRoot, root);
  await fs.writeFile(path.join(ctx.projectRoot, 'build.gradle'), '// AI patch');
  assert.equal(await fs.readFile(path.join(root, 'build.gradle'), 'utf8'), '// original');
});

test('concurrent builds and retries of the same source have distinct workspaces', async t => {
  const root = await source(t);
  const first = context(t, root), second = context(t, root);
  const results = await Promise.all([stageExtract(first), stageExtract(second)]);
  assert.ok(results.every(result => result.ok));
  assert.notEqual(first.workspaceDir, second.workspaceDir);
  await fs.rm(first.workspaceDir, { recursive: true });
  assert.equal(await fs.readFile(path.join(second.projectRoot, 'build.gradle'), 'utf8'), '// original');
});

test('old artifacts in custom modules, caches, and Git history are excluded', async t => {
  const root = await source(t, {
    'build.gradle': '// project', 'mobile/build.gradle': '// module',
    'mobile/build/outputs/apk/debug/stale.apk': 'stale',
    '.gradle/cache': 'cache', '.git/config': 'git', 'node_modules/pkg/index.js': 'dependency',
  });
  const ctx = context(t, root);
  assert.equal((await stageExtract(ctx)).ok, true);
  for (const file of ['mobile/build', '.gradle', '.git', 'node_modules']) {
    await assert.rejects(fs.access(path.join(ctx.projectRoot, file)), { code: 'ENOENT' });
  }
  assert.equal(await fs.readFile(path.join(ctx.projectRoot, 'mobile/build.gradle'), 'utf8'), '// module');
  await fs.access(path.join(root, 'mobile/build/outputs/apk/debug/stale.apk'));
});

test('nested GitHub project roots are resolved after copying', async t => {
  const root = await source(t, { 'android/build.gradle.kts': '// project' });
  const ctx = context(t, root);
  assert.equal((await stageExtract(ctx)).ok, true);
  assert.equal(ctx.projectRoot, path.join(ctx.workspaceDir, 'android'));
});

test('symlinks escaping the source fail before compilation and remove partial workspace', async t => {
  const root = await source(t);
  await fs.symlink('/etc/passwd', path.join(root, 'external.txt'));
  const ctx = context(t, root);
  const result = await stageExtract(ctx);
  assert.equal(result.ok, false);
  assert.match(result.error, /Symbolic links/);
  await assert.rejects(fs.access(ctx.workspaceDir), { code: 'ENOENT' });
  await fs.access(path.join(root, 'build.gradle'));
});

test('successful artifact upload removes the complete workspace, preserving source', async t => {
  const root = await source(t);
  const ctx = context(t, root);
  assert.equal((await stageExtract(ctx)).ok, true);
  const apk = path.join(ctx.projectRoot, 'mobile/build/outputs/apk/debug/mobile-debug.apk');
  await fs.mkdir(path.dirname(apk), { recursive: true });
  await fs.writeFile(apk, 'new artifact');
  ctx.uploadApk = async file => {
    assert.equal(await fs.readFile(file, 'utf8'), 'new artifact');
    return { apkUrl: 'http://example.test/new.apk' };
  };
  assert.equal((await stageOutput(ctx)).ok, true);
  await assert.rejects(fs.access(ctx.workspaceDir), { code: 'ENOENT' });
  await fs.access(path.join(root, 'build.gradle'));
});
