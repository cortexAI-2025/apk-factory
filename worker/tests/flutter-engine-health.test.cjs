// The Flutter build script must run the SDK health gate before any other flutter call,
// so an incomplete SDK fails with an explicit message instead of a missing-stamp error.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flutterEngine } = require('../dist/engines/flutter.engine');

for (const buildType of ['DEBUG', 'RELEASE', 'AAB']) {
  test(`flutter engine (${buildType}): health gate precedes every flutter call`, () => {
    const { command } = flutterEngine.composeCommand({ buildType, packageManager: 'npm', buildSystemInfo: {} });
    const health = command.indexOf('flutter-health');
    assert.ok(health > 0, 'flutter-health missing');
    assert.ok(health < command.indexOf('flutter --version'));
    assert.ok(health < command.indexOf('flutter pub get'));
    assert.match(command, /command -v flutter-health/); // optional on hosts without the image scripts
  });
}

// Regression (CI run on fddc15b, HTTP Docker flutter): Gradle failed with "The settings are not yet
// available for build" because the template includes the Flutter Gradle plugin build from the
// read-only SDK under /opt. The include must point at a writable copy.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { redirectFlutterToolsGradleInclude, flutterToolsGradleCopyShell } = require('../dist/engines/flutter.engine');

test('redirects the Kotlin and Groovy forms of the plugin include', () => {
  assert.equal(redirectFlutterToolsGradleInclude('includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")'), 'includeBuild("/tmp/flutter-tools-gradle")');
  assert.equal(redirectFlutterToolsGradleInclude("includeBuild('${flutterSdkPath}/packages/flutter_tools/gradle')"), 'includeBuild("/tmp/flutter-tools-gradle")');
  const other = 'includeBuild("../local-plugin")';
  assert.equal(redirectFlutterToolsGradleInclude(other), other);
});

test('the shell step copies the plugin build and rewrites settings in the workspace only', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftg-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync('/tmp/flutter-tools-gradle', { recursive: true, force: true }); });
  const sdk = path.join(root, 'sdk'); const proj = path.join(root, 'app');
  fs.mkdirSync(path.join(sdk, 'packages/flutter_tools/gradle'), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'packages/flutter_tools/gradle/settings.gradle.kts'), '// plugin build\n');
  fs.mkdirSync(path.join(proj, 'android'), { recursive: true });
  const settings = path.join(proj, 'android/settings.gradle.kts');
  fs.writeFileSync(settings, 'pluginManagement {\n    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")\n}\n');
  const out = execFileSync('bash', ['-c', flutterToolsGradleCopyShell()], { cwd: proj, env: { ...process.env, FLUTTER_HOME: sdk }, encoding: 'utf8' });
  assert.match(out, /moved to a writable copy/);
  assert.match(fs.readFileSync(settings, 'utf8'), /includeBuild\("\/tmp\/flutter-tools-gradle"\)/);
  assert.ok(fs.existsSync('/tmp/flutter-tools-gradle/settings.gradle.kts'));
  assert.ok(fs.existsSync(path.join(sdk, 'packages/flutter_tools/gradle/settings.gradle.kts'))); // SDK untouched
});

test('the build script applies the copy after flutter create and before pub get / build', () => {
  const { command } = flutterEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', buildSystemInfo: {} });
  const i = command.indexOf('writable copy');
  assert.ok(i > command.indexOf('flutter create') && i < command.indexOf('flutter pub get') && i < command.indexOf('flutter build apk'));
});

// Regression (CI run 45019917174, HTTP Docker flutter): "A problem occurred configuring project ':app'
// > Process sdkmanager finished with non-zero exit value 1". Flutter 3.50.1 asks for NDK 28.2.13676358,
// the image has 27.1.12297006 and its SDK is read-only.
const { alignFlutterNdk, flutterNdkAlignShell } = require('../dist/engines/flutter.engine');
const NDK = '27.1.12297006';

test('flutter.ndkVersion (Kotlin and Groovy) becomes the installed NDK', () => {
  assert.equal(alignFlutterNdk('    ndkVersion = flutter.ndkVersion\n', [NDK]), `    ndkVersion = "${NDK}"\n`);
  assert.equal(alignFlutterNdk('    ndkVersion flutter.ndkVersion\n', [NDK]), `    ndkVersion = "${NDK}"\n`);
});
test('a pinned NDK that is installed is kept, one that is not is replaced', () => {
  const pinned = `ndkVersion = "${NDK}"`;
  assert.equal(alignFlutterNdk(pinned, [NDK, '26.1.10909125']), pinned);
  assert.equal(alignFlutterNdk('ndkVersion = "25.0.0"', [NDK]), pinned);
});
test('nothing changes when no NDK is installed', () => {
  assert.equal(alignFlutterNdk('ndkVersion = flutter.ndkVersion', []), 'ndkVersion = flutter.ndkVersion');
});
test('the shell step rewrites the workspace gradle file and runs before pub get / build', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fndk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'android/app'), { recursive: true });
  const f = path.join(dir, 'android/app/build.gradle.kts');
  fs.writeFileSync(f, 'android { ndkVersion = flutter.ndkVersion }\n');
  execFileSync('bash', ['-c', flutterNdkAlignShell()], { cwd: dir, encoding: 'utf8' }); // no /opt/android-sdk here: no-op, must not crash
  assert.match(fs.readFileSync(f, 'utf8'), /flutter\.ndkVersion/);
  const { command } = flutterEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', buildSystemInfo: {} });
  const i = command.indexOf('aligned to the image NDK');
  assert.ok(i > command.indexOf('flutter create') && i < command.indexOf('flutter pub get') && i < command.indexOf('flutter build apk'));
});
