// CI run 45019917174: expo failed with "[CXX1210] ... No compatible library found" and nothing else; CMake's
// own output lives in .cxx/ and was never printed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { nativeBuildDiagnosticsTrap } = require('../dist/engines/native-diagnostics');
const { expoEngine } = require('../dist/engines/expo.engine');
const { reactNativeCliEngine } = require('../dist/engines/react-native-cli.engine');

function run(t, gradle, setup) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  setup?.(ws);
  return spawnSync('bash', ['-c', `set -euo pipefail\n${nativeBuildDiagnosticsTrap()}\n${gradle}`], { env: { ...process.env, WORKSPACE: ws }, encoding: 'utf8' });
}

test('a failing Gradle prints CMake logs and keeps its exit code', (t) => {
  const r = run(t, 'false || (exit 7)', (ws) => {
    const d = path.join(ws, 'node_modules/mod/android/.cxx/Debug/abc/arm64-v8a');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'configure_stderr.txt'), 'CMake Error at CMakeLists.txt:12: Could not find ReactAndroid\n');
  });
  assert.equal(r.status, 7);
  assert.match(r.stdout, /\[diagnostics\] node_modules\/mod\/android\/\.cxx\/Debug\/abc\/arm64-v8a\/configure_stderr\.txt/);
  assert.match(r.stdout, /CMake Error at CMakeLists\.txt:12/);
});

test('a passing Gradle prints nothing extra and exits 0', (t) => {
  const r = run(t, 'echo gradle-ok');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'gradle-ok');
});

test('expo and react-native install the trap before their Gradle invocation', () => {
  for (const c of [
    expoEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', gradleRoot: undefined, buildSystemInfo: { androidGenerated: false } }).command,
    reactNativeCliEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', buildSystemInfo: {} }).command,
  ]) {
    assert.ok(c.indexOf('trap apk_factory_native_diag EXIT') > 0 && c.indexOf('trap apk_factory_native_diag EXIT') < c.indexOf('./gradlew'));
  }
});
