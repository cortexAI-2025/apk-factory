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
