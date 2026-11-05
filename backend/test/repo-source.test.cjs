const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const R = require('../dist/projects/repo-source');

const parse = (u) => R.parseRepoUrl(u);
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

test('accepts repo, .git, trailing slash and www host', () => {
  for (const u of ['https://github.com/o/r', 'https://github.com/o/r/', 'https://github.com/o/r.git', 'https://www.github.com/o/r']) {
    const p = parse(u);
    assert.equal(p.kind, 'repo'); assert.equal(p.owner, 'o'); assert.equal(p.repo, 'r');
    assert.equal(p.cloneUrl, 'https://github.com/o/r.git'); assert.deepEqual(p.treePath, []);
  }
});
test('parses /tree/<branch>/<folder>', () => {
  assert.deepEqual(parse('https://github.com/o/r/tree/main/examples/app').treePath, ['main', 'examples', 'app']);
});
test('accepts GitHub archive and codeload ZIP links', () => {
  assert.deepEqual(parse('https://github.com/o/r/archive/refs/heads/main.zip').kind, 'zip');
  assert.deepEqual(parse('https://codeload.github.com/o/r/zip/refs/heads/main').kind, 'zip');
});
test('rejects other hosts, schemes, credentials, ports and odd paths', () => {
  throwsMsg(() => parse('https://evil.example.com/o/r'), /Only GitHub/);
  throwsMsg(() => parse('http://github.com/o/r'), /https/);
  throwsMsg(() => parse('git@github.com:o/r.git'), /Invalid URL/);
  throwsMsg(() => parse('https://user:pw@github.com/o/r'), /credentials/);
  throwsMsg(() => parse('https://github.com:8443/o/r'), /credentials or a port/);
  throwsMsg(() => parse('https://github.com/o'), /repository name/);
  throwsMsg(() => parse('https://github.com/o/r/issues/1'), /Unsupported GitHub URL/);
  throwsMsg(() => parse('https://github.com/o/r/tree/main/../../etc'), /Invalid folder|Unsupported GitHub URL/);
  throwsMsg(() => parse('https://github.com/o/r/tree/main/..%2f..%2fetc'), /Invalid folder/);
  throwsMsg(() => parse('https://github.com/o/r;rm -rf/x'), /Invalid owner or repository/);
  throwsMsg(() => parse('https://github.com/o/r/archive/x.tar.gz'), /Unsupported GitHub URL/);
  throwsMsg(() => parse('javascript:alert(1)'), /https/);
});
test('splitTreePath picks the longest matching ref (branches containing "/")', () => {
  const refs = ['main', 'claude/v1', 'claude/v1-zip-to-debug-apk'];
  assert.deepEqual(R.splitTreePath(['claude', 'v1-zip-to-debug-apk', 'examples', 'reference-android'], refs), { ref: 'claude/v1-zip-to-debug-apk', subdir: 'examples/reference-android' });
  assert.deepEqual(R.splitTreePath(['main'], refs), { ref: 'main', subdir: '' });
  throwsMsg(() => R.splitTreePath(['nope', 'x'], refs), /not found/);
});

// ── git-backed behaviour on local repositories ───────────────────────────────
function repo(t, files, extra = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  extra(dir);
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-q', '-m', 'init');
  return `file://${dir}`;
}
const project = (p = '') => ({
  [`${p}gradlew`]: '#!/bin/sh', [`${p}gradle/wrapper/gradle-wrapper.properties`]: 'x', [`${p}gradle/wrapper/gradle-wrapper.jar`]: 'PK',
  [`${p}settings.gradle`]: '', [`${p}app/build.gradle`]: '', [`${p}app/src/main/AndroidManifest.xml`]: '<manifest/>',
});
async function clone(t, url) {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-')), 'src');
  t.after(() => fs.rmSync(path.dirname(dest), { recursive: true, force: true }));
  await R.cloneRepo(url, dest, undefined, { allowFile: true });
  return dest;
}

test('clone removes .git and finds a project at the repository root', async (t) => {
  const dest = await clone(t, repo(t, project()));
  assert.ok(!fs.existsSync(path.join(dest, '.git')));
  assert.equal(await R.findGradleProject(dest), dest);
});
test('finds a project inside one folder (monorepo)', async (t) => {
  const dest = await clone(t, repo(t, { 'README.md': 'x', ...project('android/') }));
  assert.equal(await R.findGradleProject(dest), path.join(dest, 'android'));
});
test('several Android projects → asks for the folder URL', async (t) => {
  const dest = await clone(t, repo(t, { ...project('a/'), ...project('b/') }));
  await assert.rejects(R.findGradleProject(dest), (e) => /Several Android Gradle projects.*a, b|Several.*b, a/.test(e.message) && /tree/.test(e.message));
});
test('explicit sub-folder disambiguates', async (t) => {
  const dest = await clone(t, repo(t, { ...project('a/'), ...project('b/') }));
  assert.equal(await R.findGradleProject(path.join(dest, 'b')), path.join(dest, 'b'));
});
test('missing wrapper and non-gradle repositories give distinct messages', async (t) => {
  const noWrapper = await clone(t, repo(t, { 'build.gradle': '', 'app/src/main/AndroidManifest.xml': '' }));
  await assert.rejects(R.findGradleProject(noWrapper), /gradle-wrapper\.jar/);
  const none = await clone(t, repo(t, { 'README.md': 'hello' }));
  await assert.rejects(R.findGradleProject(none), /No Gradle project found/);
});
test('repositories containing symbolic links are refused', async (t) => {
  const url = repo(t, project(), (d) => fs.symlinkSync('/etc/passwd', path.join(d, 'passwd-link')));
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-')), 'src');
  t.after(() => fs.rmSync(path.dirname(dest), { recursive: true, force: true }));
  await assert.rejects(R.cloneRepo(url, dest, undefined, { allowFile: true }), /Symbolic links/);
});
test('file:// and other protocols are refused without allowFile', async (t) => {
  const url = repo(t, project());
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-')), 'src');
  t.after(() => fs.rmSync(path.dirname(dest), { recursive: true, force: true }));
  await assert.rejects(R.cloneRepo(url, dest, undefined, {}), /Failed to clone/);
});
test('unreachable or private repositories give a clear message', async () => {
  await assert.rejects(R.listRemoteRefs('file:///nonexistent/repo.git', {}), /not found, private, or unreachable/);
});
