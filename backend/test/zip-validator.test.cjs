const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectZip } = require('../dist/projects/zip-validator');

const PY = `
import sys, json, zipfile
spec = json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for e in spec:
        i = zipfile.ZipInfo(e['name']); i.create_system = e.get('system', 3)
        i.external_attr = (e.get('mode', 0o100644)) << 16
        z.writestr(i, e.get('data', 'x'))
`;
function make(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'p.zip');
  execFileSync('python3', ['-I', '-c', PY, file], { input: JSON.stringify(entries) });
  return file;
}
const head = (f) => fs.readFileSync(f).subarray(0, 4);
const project = (p = '') => [
  { name: `${p}gradlew`, mode: 0o100755 },
  { name: `${p}gradle/wrapper/gradle-wrapper.properties` },
  { name: `${p}gradle/wrapper/gradle-wrapper.jar` },
  { name: `${p}settings.gradle` },
  { name: `${p}app/build.gradle` },
  { name: `${p}app/src/main/AndroidManifest.xml` },
];
const rejects = (promise, re) => assert.rejects(promise, (e) => re.test(e.message));

test('accepts a project at the archive root', async (t) => {
  const f = make(t, project());
  assert.equal((await inspectZip(f, head(f))).rootPrefix, '');
});
test('accepts a project inside a single parent folder (GitHub style)', async (t) => {
  const f = make(t, project('MyApp-main/'));
  assert.equal((await inspectZip(f, head(f))).rootPrefix, 'MyApp-main/');
});
test('accepts a monorepo ZIP: repository folder + android sub-folder', async (t) => {
  const f = make(t, [...project('repo-main/android/'), { name: 'repo-main/README.md' }, { name: 'repo-main/web/package.json' }]);
  assert.equal((await inspectZip(f, head(f))).rootPrefix, 'repo-main/android/');
});
test('does not look deeper than three folders', async (t) => {
  const f = make(t, project('a/b/c/d/'));
  await rejects(inspectZip(f, head(f)), /wrapper is missing|No Gradle/);
});
test('ignores __MACOSX metadata', async (t) => {
  const f = make(t, [...project('App/'), { name: '__MACOSX/App/._gradlew' }]);
  assert.equal((await inspectZip(f, head(f))).rootPrefix, 'App/');
});
test('rejects a file that is not a ZIP', async (t) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zipv-')), 'x.zip');
  fs.writeFileSync(f, 'hello world, not a zip');
  t.after(() => fs.rmSync(path.dirname(f), { recursive: true, force: true }));
  await rejects(inspectZip(f, head(f)), /not a valid ZIP/);
});
test('rejects a truncated/corrupted ZIP', async (t) => {
  const f = make(t, project());
  const buf = fs.readFileSync(f); fs.writeFileSync(f, buf.subarray(0, buf.length - 30));
  await rejects(inspectZip(f, head(f)), /corrupted|unsupported/);
});
test('rejects a missing Gradle wrapper with an actionable message', async (t) => {
  const f = make(t, project().filter((e) => !e.name.startsWith('gradle') ));
  await rejects(inspectZip(f, head(f)), /wrapper is missing.*gradle-wrapper\.jar/s);
});
test('rejects an archive without any Gradle build file', async (t) => {
  const f = make(t, [{ name: 'readme.txt' }]);
  await rejects(inspectZip(f, head(f)), /No Gradle project/);
});
test('rejects a Gradle project that is not Android', async (t) => {
  const f = make(t, project().filter((e) => !e.name.endsWith('AndroidManifest.xml')));
  await rejects(inspectZip(f, head(f)), /AndroidManifest/);
});
test('rejects path traversal', async (t) => {
  const f = make(t, [...project(), { name: '../../evil.txt' }]);
  await rejects(inspectZip(f, head(f)), /escapes/);
});
test('rejects absolute paths', async (t) => {
  const f = make(t, [...project(), { name: '/etc/cron.d/x' }]);
  await rejects(inspectZip(f, head(f)), /Absolute path/);
});
test('rejects symbolic links', async (t) => {
  const f = make(t, [...project(), { name: 'app/link', mode: 0o120777, data: '/etc/passwd' }]);
  await rejects(inspectZip(f, head(f)), /Symbolic links/);
});
test('rejects a symbolic link even when "version made by" claims a non-Unix host (forged header)', async (t) => {
  const f = make(t, [...project(), { name: 'app/link', mode: 0o120777, data: '/etc/passwd', system: 0 }]);
  await rejects(inspectZip(f, head(f)), /Symbolic links/);
});
test('rejects special files (device/fifo modes)', async (t) => {
  const f = make(t, [...project(), { name: 'app/fifo', mode: 0o010644 }]);
  await rejects(inspectZip(f, head(f)), /Special file type/);
});
test('rejects an archive larger than the extraction limit', async (t) => {
  const f = make(t, [...project(), { name: 'big.bin', data: 'a'.repeat(5000) }]);
  await rejects(inspectZip(f, head(f), { maxEntries: 100, maxTotalBytes: 1000, maxFileBytes: 1e9, maxRatio: 100 }), /expands to more than/);
});
test('rejects too many entries', async (t) => {
  const f = make(t, project());
  await rejects(inspectZip(f, head(f), { maxEntries: 3, maxTotalBytes: 1e9, maxFileBytes: 1e9, maxRatio: 100 }), /too many entries/);
});
test('rejects an ambiguous archive with two projects', async (t) => {
  const f = make(t, [...project('a/'), ...project('b/')]);
  await rejects(inspectZip(f, head(f)), /single project/);
  await rejects(inspectZip(f, head(f)), /a\/, b\/|b\/, a\//);
});
