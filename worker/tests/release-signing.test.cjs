const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareReleaseSigning } = require('../dist/signing/release-signing');

test('release signing writes a workspace init script and keystore', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-sign-'));
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-keys-'));
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(keyDir, { recursive: true, force: true }),
  ]));
  const prev = process.env.APK_FACTORY_KEY_DIR;
  process.env.APK_FACTORY_KEY_DIR = keyDir;
  delete process.env.KEYSTORE_PATH;
  delete process.env.KEYSTORE_PASSWORD;
  t.after(() => {
    if (prev === undefined) delete process.env.APK_FACTORY_KEY_DIR;
    else process.env.APK_FACTORY_KEY_DIR = prev;
  });

  const prep = await prepareReleaseSigning(root);
  assert.equal(prep.source, 'generated');
  assert.equal(prep.gradleArgs, '--init-script .apk-factory/signing.init.gradle');
  const script = await fs.readFile(path.join(root, '.apk-factory/signing.init.gradle'), 'utf8');
  assert.match(script, /signingConfigs/);
  assert.match(script, /apkFactory/);
  assert.match(script, /bundleRelease|buildTypes\.release/);
  const ks = await fs.stat(path.join(root, '.apk-factory/upload.jks'));
  assert.ok(ks.size > 100);
});
