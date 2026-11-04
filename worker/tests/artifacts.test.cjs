const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findBuildArtifact } = require('../dist/pipeline/artifacts');
const { stageOutput } = require('../dist/pipeline/stages/06-output');

async function workspace(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of files) {
    const full = path.join(root, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, 'test artifact');
  }
  return root;
}

const debug = 'app/build/outputs/apk/debug/app-debug.apk';
const release = 'app/build/outputs/apk/release/app-release.apk';
const bundle = 'app/build/outputs/bundle/release/app-release.aab';
for (const [type, expected] of [['DEBUG', debug], ['RELEASE', release], ['AAB', bundle]]) {
  test(`${type} selects its own output when all variants exist`, async t => {
    const root = await workspace(t, [debug, release, bundle]);
    assert.equal(await findBuildArtifact(root, type), path.join(root, expected));
  });
}

test('does not substitute a debug APK or a source AAB for a missing release bundle', async t => {
  const root = await workspace(t, [debug, 'assets/sample.aab']);
  assert.equal(await findBuildArtifact(root, 'AAB'), null);
});

test('supports a custom module and flavored release output', async t => {
  const file = 'mobile/build/outputs/apk/free/release/mobile-free-release.apk';
  const root = await workspace(t, [file]);
  assert.equal(await findBuildArtifact(root, 'RELEASE'), path.join(root, file));
});

test('refuses ambiguous outputs rather than delivering an arbitrary module or split', async t => {
  const root = await workspace(t, [release, 'other/build/outputs/apk/release/other-release.apk']);
  await assert.rejects(findBuildArtifact(root, 'RELEASE'), /Multiple RELEASE artifacts/);
});

test('ignores symlink artifacts and dependencies', async t => {
  const root = await workspace(t, ['assets/sample.apk', `node_modules/example/${release}`]);
  await fs.mkdir(path.dirname(path.join(root, release)), { recursive: true });
  await fs.symlink(path.join(root, 'assets/sample.apk'), path.join(root, release));
  assert.equal(await findBuildArtifact(root, 'RELEASE'), null);
});

test('output stage uploads the AAB and records its URL and size', async t => {
  const root = await workspace(t, [debug, bundle]);
  let uploaded;
  const ctx = {
    projectRoot: root, buildType: 'AAB', workspaceDir: root, sourceRepoPath: root,
    log: async () => {},
    uploadApk: async file => {
      uploaded = file;
      return { apkUrl: 'https://example.test/build.aab' };
    },
  };
  assert.deepEqual(await stageOutput(ctx), { ok: true });
  assert.equal(uploaded, path.join(root, bundle));
  assert.equal(ctx.apkUrl, 'https://example.test/build.aab');
  assert.equal(ctx.apkSize, Buffer.byteLength('test artifact'));
});

test('output stage fails without uploading when the requested artifact is missing', async t => {
  const root = await workspace(t, [debug]);
  const result = await stageOutput({
    projectRoot: root, buildType: 'AAB', log: async () => {},
    uploadApk: async () => assert.fail('must not upload'),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /AAB artifact not found/);
});

const { listBuildArtifacts } = require('../dist/pipeline/artifacts');

test('debug: single APK is recommended', async t => {
  const root = await workspace(t, [debug]);
  const list = await listBuildArtifacts(root);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].variant, list[0].abi, list[0].recommended], ['debug', 'universal', true]);
});

test('debug: flavors and ABI splits are all listed, universal app build recommended first', async t => {
  const root = await workspace(t, [
    'app/build/outputs/apk/free/debug/app-free-arm64-v8a-debug.apk',
    'app/build/outputs/apk/free/debug/app-free-universal-debug.apk',
    'app/build/outputs/apk/paid/debug/app-paid-armeabi-v7a-debug.apk',
    'wear/build/outputs/apk/debug/wear-debug.apk',
  ]);
  const list = await listBuildArtifacts(root);
  assert.equal(list.length, 4);
  assert.equal(list.filter(a => a.recommended).length, 1);
  assert.equal(list[0].fileName, 'app-free-universal-debug.apk');
  assert.equal(list[0].variant, 'freeDebug');
  assert.deepEqual(list.map(a => a.abi).sort(), ['arm64-v8a', 'armeabi-v7a', 'universal', 'universal']);
});

test('debug: arm64-v8a is preferred over armeabi-v7a (Galaxy A-series are arm64)', async t => {
  const root = await workspace(t, [
    'app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk',
    'app/build/outputs/apk/debug/app-arm64-v8a-debug.apk',
  ]);
  assert.equal((await listBuildArtifacts(root))[0].abi, 'arm64-v8a');
});

test('debug: test APKs, release APKs and symlinks are never offered', async t => {
  const root = await workspace(t, [
    'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk', release, 'assets/sample.apk',
  ]);
  await fs.mkdir(path.join(root, 'app/build/outputs/apk/debug'), { recursive: true });
  await fs.symlink(path.join(root, 'assets/sample.apk'), path.join(root, debug));
  assert.deepEqual(await listBuildArtifacts(root), []);
});

test('output stage uploads every debug variant with sha256 and metadata', async t => {
  const root = await workspace(t, [
    'app/build/outputs/apk/free/debug/app-free-debug.apk', 'app/build/outputs/apk/paid/debug/app-paid-debug.apk',
  ]);
  const uploads = [];
  const ctx = {
    projectRoot: root, buildType: 'DEBUG', workspaceDir: root, sourceRepoPath: root, log: async () => {},
    uploadApk: async (file, meta) => { uploads.push(meta); return { apkUrl: `https://example.test/${meta.fileName}` }; },
  };
  assert.deepEqual(await stageOutput(ctx), { ok: true });
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(m => /^[a-f0-9]{64}$/.test(m.sha256)));
  assert.equal(uploads.filter(m => m.recommended).length, 1);
  assert.equal(ctx.artifactCount, 2);
});
