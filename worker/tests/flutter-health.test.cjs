// Regression: `flutter --version` failed with
//   /opt/flutter/bin/cache/engine-dart-sdk.stamp: No such file or directory
// because the image's stamps are symlinks into /tmp, empty in a fresh container, and the
// toolchain check ran the SDK without the entrypoint that seeds them.
// These tests rebuild that layout around a fake SDK and drive the real shell scripts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const DIR = path.resolve(__dirname, '../../docker/android-builder');

function sdk(t, { dart = true, version = '3.50.1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'flutter');
  const seed = path.join(root, 'seed');
  const tmp = path.join(root, 'tmp-fresh'); // a fresh container's /tmp: does not exist yet
  for (const d of ['bin/cache/dart-sdk/bin', 'bin/internal', 'packages/flutter_tools']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(seed);
  fs.writeFileSync(path.join(home, 'bin/internal/engine.version'), 'abc\n');
  // fake `flutter`: like the real one, it needs the stamp to resolve
  fs.writeFileSync(path.join(home, 'bin/flutter'),
    `#!/bin/sh\ncat "${home}/bin/cache/engine-dart-sdk.stamp" >/dev/null || exit 1\necho "Flutter ${version} • channel stable"\n`, { mode: 0o755 });
  if (dart) {
    fs.writeFileSync(path.join(home, 'bin/cache/dart-sdk/bin/dart'), '#!/bin/sh\necho "Dart SDK version: 3.x"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(home, 'bin/cache/dart-sdk/version'), '3.x\n');
  }
  // exactly what the Dockerfile does: stamps become symlinks into the tmp dir
  fs.writeFileSync(path.join(seed, 'engine-dart-sdk.stamp'), 'engine-hash\n');
  fs.symlinkSync(path.join(tmp, 'engine-dart-sdk.stamp'), path.join(home, 'bin/cache/engine-dart-sdk.stamp'));
  fs.symlinkSync(path.join(tmp, 'flutter-cache.lock'), path.join(home, 'bin/cache/lockfile'));
  // what Flutter's shared.sh requires to NOT rebuild (= write under the SDK) at start:
  // a snapshot, pubspec.lock newer than pubspec.yaml, and flutter_tools.stamp == "<HEAD>:<args>"
  const git = (...a) => execFileSync('git', ['-C', home, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q'); fs.writeFileSync(path.join(home, 'VERSION'), version); git('add', '-A'); git('commit', '-q', '-m', 'x');
  const tools = path.join(home, 'packages/flutter_tools');
  fs.writeFileSync(path.join(tools, 'pubspec.yaml'), 'name: flutter_tools\n');
  fs.writeFileSync(path.join(home, 'bin/cache/flutter_tools.snapshot'), 'snap');
  // flutter_tools' resolved dependencies, as `pub get` writes them (one hosted package here)
  const pkgRoot = path.join(root, 'pub-cache/hosted/pub.dev/args-2.0.0');
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.writeFileSync(path.join(pkgRoot, 'pubspec.yaml'), 'name: args\n');
  fs.mkdirSync(path.join(tools, '.dart_tool'), { recursive: true });
  fs.writeFileSync(path.join(tools, '.dart_tool/package_config.json'), JSON.stringify({ configVersion: 2, packages: [
    { name: 'args', rootUri: `file://${pkgRoot}`, packageUri: 'lib/', languageVersion: '3.0' },
    { name: 'flutter_tools', rootUri: '../', packageUri: 'lib/', languageVersion: '3.0' },
  ] }));
  fs.writeFileSync(path.join(tools, 'pubspec.lock'), '# lock\n');
  const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(tools, 'pubspec.lock'), later, later);
  fs.writeFileSync(path.join(seed, 'flutter_tools.stamp'), `${git('rev-parse', 'HEAD').trim()}:`);
  fs.symlinkSync(path.join(tmp, 'flutter_tools.stamp'), path.join(home, 'bin/cache/flutter_tools.stamp'));
  return { home, seed, tmp, tools, pkgRoot, env: { PATH: process.env.PATH, FLUTTER_HOME: home, FLUTTER_STAMP_SEED: seed, FLUTTER_STAMP_DIR: tmp, FLUTTER_LOCK_FILE: path.join(tmp, 'flutter-cache.lock'), FLUTTER_VERSION: '3.50.1' } };
}
const sh = (script, env) => spawnSync('sh', [path.join(DIR, script)], { env, encoding: 'utf8' });

test('layout reproduces the original failure without the bootstrap', (t) => {
  const s = sdk(t);
  const r = spawnSync(path.join(s.home, 'bin/flutter'), ['--version'], { env: s.env, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'dangling stamp must break the bare SDK');
  assert.match(r.stderr, /engine-dart-sdk\.stamp: No such file/);
});

test('health check seeds the stamps itself and passes in a fresh container', (t) => {
  const s = sdk(t);
  const r = sh('flutter-health.sh', s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /flutter-health OK/);
  assert.ok(fs.existsSync(path.join(s.tmp, 'engine-dart-sdk.stamp')));
});

test('wrapper runs the SDK from a fresh /tmp with no entrypoint', (t) => {
  const s = sdk(t);
  const r = spawnSync('sh', [path.join(DIR, 'flutter-wrapper.sh'), '--version'], { env: s.env, encoding: 'utf8' });
  // invoked as flutter-wrapper.sh the tool name is not "dart", so it runs flutter
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Flutter 3\.50\.1/);
});

test('bootstrap is idempotent and keeps a stamp Flutter refreshed', (t) => {
  const s = sdk(t);
  sh('flutter-bootstrap.sh', s.env);
  fs.writeFileSync(path.join(s.tmp, 'engine-dart-sdk.stamp'), 'refreshed\n');
  sh('flutter-bootstrap.sh', s.env);
  assert.equal(fs.readFileSync(path.join(s.tmp, 'engine-dart-sdk.stamp'), 'utf8'), 'refreshed\n');
});

test('health check fails clearly when the Dart SDK is missing', (t) => {
  const s = sdk(t, { dart: false });
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FLUTTER HEALTH FAILED: Dart SDK missing/);
});

test('health check fails clearly when the stamp has no seed (incomplete image)', (t) => {
  const s = sdk(t);
  fs.rmSync(path.join(s.seed, 'engine-dart-sdk.stamp'));
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /engine-dart-sdk\.stamp does not resolve/);
});

test('health check fails on a different Flutter version (reproducibility)', (t) => {
  const s = sdk(t, { version: '3.49.0' });
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /expected Flutter 3\.50\.1/);
});

test('health check fails when the SDK is not installed', (t) => {
  const r = sh('flutter-health.sh', { PATH: process.env.PATH, FLUTTER_HOME: '/nonexistent/flutter' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SDK not installed/);
});

// Regression (CI run 45012681180, HTTP Docker flutter): with a fresh /tmp the tool stamp was
// missing, Flutter rebuilt its tool at start and died writing
// packages/flutter_tools/.dart_tool/package_config.json on the read-only root.
test('health check fails when flutter_tools.stamp is absent from the seed', (t) => {
  const s = sdk(t);
  fs.rmSync(path.join(s.seed, 'flutter_tools.stamp'));
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /flutter_tools\.stamp is missing or empty/);
});

test('health check fails when flutter_tools.stamp is for another revision', (t) => {
  const s = sdk(t);
  fs.writeFileSync(path.join(s.seed, 'flutter_tools.stamp'), 'deadbeef:');
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match the SDK revision/);
});

test('health check fails when pubspec.yaml is newer than pubspec.lock', (t) => {
  const s = sdk(t);
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(s.tools, 'pubspec.yaml'), later, later);
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pubspec\.yaml is newer than pubspec\.lock/);
});

test('health check fails when the tool snapshot is missing', (t) => {
  const s = sdk(t);
  fs.rmSync(path.join(s.home, 'bin/cache/flutter_tools.snapshot'));
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /flutter_tools\.snapshot is missing/);
});

// Regression (CI run on c91601b, HTTP Docker flutter): the toolchain step died with
// "cannot create /tmp/flutter-cache.lock: Permission denied" because a lock file left in the
// image by another user cannot be opened for writing by root (fs.protected_regular).
test('bootstrap and health survive a lock file that cannot be created', (t) => {
  const s = sdk(t);
  const env = { ...s.env, FLUTTER_LOCK_FILE: '/proc/no-such-dir/flutter-cache.lock' };
  const b = sh('flutter-bootstrap.sh', env);
  assert.equal(b.status, 0, b.stderr);
  const h = sh('flutter-health.sh', env);
  assert.equal(h.status, 0, h.stderr);
});

// Regression (CI run 45015609173, HTTP Docker flutter): `flutter build` died writing
// packages/flutter_tools/.dart_tool/package_config.json. Flutter (PubDependencies.isUpToDate) re-runs
// `pub get` on its own tool when a package listed there is missing/unreadable, e.g. after an image
// built as root with a root-only pub cache and run as builder with another PUB_CACHE.
test('health check fails when a flutter_tools dependency is not readable by the user', (t) => {
  const s = sdk(t);
  fs.rmSync(path.join(s.pkgRoot, 'pubspec.yaml'));
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /flutter_tools packages not readable[^]*args ->/);
});

test('health check fails when flutter_tools package_config.json is missing', (t) => {
  const s = sdk(t);
  fs.rmSync(path.join(s.tools, '.dart_tool'), { recursive: true });
  const r = sh('flutter-health.sh', s.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /package_config\.json is missing or unreadable/);
});
