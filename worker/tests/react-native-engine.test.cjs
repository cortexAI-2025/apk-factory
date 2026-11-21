// Lot 3 — React Native CLI engine.
// Engine unit tests are real (pure string composition). The pipeline test
// below runs the actual stageExtract -> stageDetect -> stageValidate chain
// on a real fixture directory — no mocks for those three stages — then
// composes the final command with the real engine. It stops there: no
// Docker daemon is available in this sandbox, so no npm/Gradle actually runs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { reactNativeCliEngine } = require('../dist/engines/react-native-cli.engine');
const { getEngine } = require('../dist/engines/engine-factory');
const { stageExtract } = require('../dist/pipeline/stages/01-extract');
const { stageDetect } = require('../dist/pipeline/stages/02-detect');
const { stageValidate } = require('../dist/pipeline/stages/03-validate');

// ── Engine unit tests ─────────────────────────────────────────────────────

test('react-native-cli engine: npm, debug build', () => {
  const ctx = { buildType: 'DEBUG', packageManager: 'npm', gradleRoot: 'android' };
  const { command, shell } = reactNativeCliEngine.composeCommand(ctx);
  assert.equal(shell, true);
  assert.match(command, /^set -euo pipefail\n/);
  assert.match(command, /npm ci/);
  assert.match(command, /cd android/);
  assert.match(command, /chmod \+x \.\/gradlew/);
  assert.match(command, /\.\/gradlew assembleDebug --no-daemon --stacktrace --console=plain$/);
});

test('react-native-cli engine: pnpm, release build, with Maven init-script arg appended to gradlew only', () => {
  const ctx = { buildType: 'RELEASE', packageManager: 'pnpm', gradleRoot: 'android' };
  const { command } = reactNativeCliEngine.composeCommand(ctx, '--init-script /workspace/.gradle/init.d/x.gradle');
  assert.match(command, /pnpm install --frozen-lockfile/);
  assert.match(command, /\.\/gradlew assembleRelease --no-daemon --stacktrace --console=plain --init-script \/workspace\/\.gradle\/init\.d\/x\.gradle$/);
  // The install step itself must never carry Gradle flags.
  assert.doesNotMatch(command.split('\n')[1], /--init-script/);
});

test('react-native-cli engine: yarn, AAB build', () => {
  const ctx = { buildType: 'AAB', packageManager: 'yarn', gradleRoot: 'android' };
  const { command } = reactNativeCliEngine.composeCommand(ctx);
  assert.match(command, /yarn install --frozen-lockfile/);
  assert.match(command, /\.\/gradlew bundleRelease/);
});

test('engine-factory: Android Native and undefined both resolve to the untouched native engine (shell=false)', () => {
  for (const framework of [undefined, 'ANDROID_NATIVE']) {
    const engine = getEngine(framework);
    const { command, shell } = engine.composeCommand({ gradleCommand: './gradlew assembleDebug' });
    assert.equal(shell, false);
    assert.equal(command, './gradlew assembleDebug');
  }
});

test('engine-factory: CAPACITOR, CORDOVA and FLUTTER each have a shell engine', () => {
  const cap = getEngine('CAPACITOR').composeCommand({ buildType: 'RELEASE', packageManager: 'npm', gradleRoot: 'android', buildSystemInfo: { androidGenerated: true } });
  assert.equal(cap.shell, true);
  assert.match(cap.command, /npx cap sync android/);
  assert.match(cap.command, /assembleRelease/);
  const cordova = getEngine('CORDOVA').composeCommand({ buildType: 'AAB', packageManager: 'npm' });
  assert.match(cordova.command, /cordova platform add android/);
  assert.match(cordova.command, /--packageType=bundle/);
  const flutter = getEngine('FLUTTER').composeCommand({ buildType: 'DEBUG' });
  assert.match(flutter.command, /flutter build apk --debug/);
  assert.match(flutter.command, /android-arm,android-arm64,android-x64/);
});

// ── Pipeline integration (real stages, no Docker) ───────────────────────────

async function source(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rn-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [f, c] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), c);
  }
  return root;
}
function context(t, root) {
  const logs = [];
  const ctx = {
    sourceRepoPath: root, buildId: 'rn-pipeline-test', buildType: 'DEBUG', autoFix: false,
    log: async (level, msg) => { logs.push([level, msg]); },
  };
  ctx._logs = logs;
  t.after(async () => {
    if (ctx.workspaceDir && ctx.workspaceDir !== root) await fs.rm(ctx.workspaceDir, { recursive: true, force: true });
  });
  return ctx;
}

const RN_PROJECT = {
  'package.json': JSON.stringify({ dependencies: { 'react-native': '0.74.0', react: '18.2.0' } }),
  'package-lock.json': '{}',
  'react-native.config.js': 'module.exports = {}',
  'android/gradlew': '#!/bin/sh\necho stub',
  'android/build.gradle': '// root',
  'android/app/build.gradle': "apply plugin: 'com.android.application'\nandroid { compileSdk 34 }",
};

test('a real React Native CLI fixture flows through EXTRACT -> DETECT -> VALIDATE and composes a runnable script', async (t) => {
  const root = await source(t, RN_PROJECT);
  const ctx = context(t, root);

  assert.deepEqual(await stageExtract(ctx), { ok: true });
  assert.deepEqual(await stageDetect(ctx), { ok: true });
  assert.equal(ctx.framework, 'REACT_NATIVE_CLI');
  assert.equal(ctx.projectType, 'REACT_NATIVE'); // legacy enum bridge

  assert.deepEqual(await stageValidate(ctx), { ok: true });
  assert.equal(ctx.gradleCommand, './gradlew assembleDebug');

  const { command, shell } = getEngine(ctx.framework).composeCommand(ctx);
  assert.equal(shell, true);
  assert.match(command, /npm ci/);
  assert.match(command, /cd android/);
  assert.match(command, /\.\/gradlew assembleDebug/);
});

test('a React Native CLI project missing android/ is rejected at DETECT with a precise, non-ambiguous reason', async (t) => {
  const root = await source(t, { 'package.json': RN_PROJECT['package.json'], 'package-lock.json': '{}' });
  const ctx = context(t, root);
  await stageExtract(ctx);
  const result = await stageDetect(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.fatal, true);
  assert.match(result.error, /does not run "react-native init"/);
});

test('a React Native CLI project missing its lockfile fails VALIDATE, not silently builds unreproducibly', async (t) => {
  const { 'package-lock.json': _drop, ...withoutLockfile } = RN_PROJECT;
  const root = await source(t, withoutLockfile);
  const ctx = context(t, root);
  await stageExtract(ctx);
  await stageDetect(ctx);
  const result = await stageValidate(ctx);
  assert.equal(result.ok, false);
  assert.match(result.error, /lockfile is required/);
});
