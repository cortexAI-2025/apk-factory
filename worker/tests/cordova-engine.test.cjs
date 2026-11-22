// Regression (CI run 45015609173, HTTP Docker webview): cordova RELEASE "artifact not found after
// successful build". The log shows packageReleaseBundle/signReleaseBundle: cordova-android defaults
// --release to an AAB, so no APK was produced.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cordovaEngine } = require('../dist/engines/cordova.engine');

const cmd = (buildType) => cordovaEngine.composeCommand({ buildType, packageManager: 'npm', buildSystemInfo: {} }).command;
const build = (c) => c.split('\n').find((l) => l.startsWith('npx cordova build'));

test('cordova RELEASE explicitly asks for an APK', () => {
  assert.equal(build(cmd('RELEASE')), 'npx cordova build android --release -- --packageType=apk');
});
test('cordova AAB asks for a bundle', () => {
  assert.equal(build(cmd('AAB')), 'npx cordova build android --release -- --packageType=bundle');
});
test('cordova DEBUG is unchanged', () => {
  assert.equal(build(cmd('DEBUG')), 'npx cordova build android --debug');
});
