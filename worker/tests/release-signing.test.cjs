const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureSigningMaterial, signReleaseArtifact } = require('../dist/signing/release-signing');

const execFileAsync = promisify(execFile);

function useKeyDir(t) {
  const prev = {
    dir: process.env.APK_FACTORY_KEY_DIR,
    path: process.env.KEYSTORE_PATH,
    pass: process.env.KEYSTORE_PASSWORD,
    alias: process.env.KEYSTORE_ALIAS,
    key: process.env.KEY_PASSWORD,
  };
  t.after(() => {
    for (const [env, value] of [
      ['APK_FACTORY_KEY_DIR', prev.dir],
      ['KEYSTORE_PATH', prev.path],
      ['KEYSTORE_PASSWORD', prev.pass],
      ['KEYSTORE_ALIAS', prev.alias],
      ['KEY_PASSWORD', prev.key],
    ]) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
  });
}

test('upload key stays outside the project and is reused', async (t) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-proj-'));
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-keys-'));
  t.after(() => Promise.all([
    fs.rm(project, { recursive: true, force: true }),
    fs.rm(keyDir, { recursive: true, force: true }),
  ]));
  useKeyDir(t);
  process.env.APK_FACTORY_KEY_DIR = keyDir;
  delete process.env.KEYSTORE_PATH;
  delete process.env.KEYSTORE_PASSWORD;

  const first = await ensureSigningMaterial();
  const second = await ensureSigningMaterial();
  assert.equal(first.source, 'generated');
  assert.equal(first.file, second.file);
  assert.equal(path.dirname(first.file), keyDir);
  const ks = await fs.stat(first.file);
  assert.ok(ks.size > 100);
  assert.equal((await fs.stat(first.storePassFile)).mode & 0o077, 0);
  const projectEntries = await fs.readdir(project);
  assert.deepEqual(projectEntries, []);
  await assert.rejects(fs.access(path.join(project, '.apk-factory', 'signing.init.gradle')));
});

test('unsigned AAB is signed after the build, not inside it', async (t) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-aab-'));
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-keys-'));
  t.after(() => Promise.all([
    fs.rm(project, { recursive: true, force: true }),
    fs.rm(keyDir, { recursive: true, force: true }),
  ]));
  useKeyDir(t);
  process.env.APK_FACTORY_KEY_DIR = keyDir;
  delete process.env.KEYSTORE_PATH;
  delete process.env.KEYSTORE_PASSWORD;

  const aab = path.join(project, 'app-release.aab');
  await fs.writeFile(path.join(project, 'bundle.txt'), 'payload');
  await execFileAsync('jar', ['cf', aab, '-C', project, 'bundle.txt']);

  const signed = await signReleaseArtifact(aab);
  assert.equal(signed.action, 'signed');
  await assert.rejects(
    execFileAsync('jarsigner', ['-verify', '-strict', aab], { encoding: 'utf8' }),
    (err) => err.code !== 16 && /jar verified/.test(err.stdout || ''),
  );
  const again = await signReleaseArtifact(aab);
  assert.equal(again.action, 'kept-project-signature');
  const names = await fs.readdir(project);
  assert.ok(!names.includes('upload.jks'));
  assert.ok(!names.some((name) => name.includes('signing.init')));
});

test('a bundle without a jar manifest is treated as unsigned', async (t) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-aab-raw-'));
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-keys-'));
  t.after(() => Promise.all([
    fs.rm(project, { recursive: true, force: true }),
    fs.rm(keyDir, { recursive: true, force: true }),
  ]));
  useKeyDir(t);
  process.env.APK_FACTORY_KEY_DIR = keyDir;
  delete process.env.KEYSTORE_PATH;
  delete process.env.KEYSTORE_PASSWORD;

  const payload = path.join(project, 'AndroidManifest.xml');
  const aab = path.join(project, 'app-release.aab');
  await fs.writeFile(payload, '<manifest/>');
  await execFileAsync('python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.write(sys.argv[2], "base/manifest/AndroidManifest.xml")
`, aab, payload]);
  const signed = await signReleaseArtifact(aab);
  assert.equal(signed.action, 'signed');
  const again = await signReleaseArtifact(aab);
  assert.equal(again.action, 'kept-project-signature');
});

test('an unwritable workspace is signed in a temp file, not beside the artifact', async (t) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-aab-ro-'));
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-keys-'));
  const fsp = require('fs/promises');
  const origCopy = fsp.copyFile;
  const hold = { path: '' };
  t.after(async () => {
    fsp.copyFile = origCopy;
    if (hold.path && hold.path !== aab) await fs.rm(path.dirname(hold.path), { recursive: true, force: true }).catch(() => {});
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(keyDir, { recursive: true, force: true });
  });
  useKeyDir(t);
  process.env.APK_FACTORY_KEY_DIR = keyDir;
  delete process.env.KEYSTORE_PATH;
  delete process.env.KEYSTORE_PASSWORD;

  const payload = path.join(project, 'AndroidManifest.xml');
  const aab = path.join(project, 'app-release.aab');
  await fs.writeFile(payload, '<manifest/>');
  await execFileAsync('python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.write(sys.argv[2], "base/manifest/AndroidManifest.xml")
`, aab, payload]);
  // Root ignores mode 0555. The CI failure is a non-owner EACCES on the
  // Gradle output, so the replace step is forced to fail the same way.
  fsp.copyFile = async (src, dest, ...rest) => {
    if (dest === aab) {
      const err = new Error(`EACCES: permission denied, copyfile '${src}' -> '${dest}'`);
      err.code = 'EACCES';
      throw err;
    }
    return origCopy(src, dest, ...rest);
  };

  const signed = await signReleaseArtifact(aab);
  hold.path = signed.path;
  assert.equal(signed.action, 'signed');
  assert.notEqual(path.resolve(signed.path), path.resolve(aab));
  assert.equal(path.basename(signed.path), 'app-release.aab');
  let text = '';
  try {
    const r = await execFileAsync('jarsigner', ['-verify', '-strict', signed.path], { encoding: 'utf8' });
    text = `${r.stdout}\n${r.stderr}`;
  } catch (err) {
    text = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (err.code === 16 || !/jar verified/i.test(text)) throw err;
  }
  assert.match(text, /jar verified/i);
  const names = await fs.readdir(project);
  assert.ok(!names.some((name) => name.startsWith('.signing-') || name.includes('upload.jks')));
});
