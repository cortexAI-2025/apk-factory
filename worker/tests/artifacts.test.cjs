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
