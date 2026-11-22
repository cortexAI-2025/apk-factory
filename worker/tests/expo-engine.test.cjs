// Lot 4 — Expo engine (no EAS Cloud involved anywhere).
// Same split as Lot 3: real engine unit tests + a real pipeline integration
// run (EXTRACT -> DETECT -> VALIDATE), stopping short of Docker/npm/Gradle
// execution (no Docker daemon in this sandbox).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { expoEngine } = require('../dist/engines/expo.engine');
const { getEngine } = require('../dist/engines/engine-factory');
const { stageExtract } = require('../dist/pipeline/stages/01-extract');
const { stageDetect } = require('../dist/pipeline/stages/02-detect');
const { stageValidate } = require('../dist/pipeline/stages/03-validate');

// ── Engine unit tests ─────────────────────────────────────────────────────

test('expo engine: managed project (no android/ yet) runs prebuild before Gradle', () => {
  const ctx = { buildType: 'DEBUG', packageManager: 'npm', gradleRoot: undefined, buildSystemInfo: { androidGenerated: false } };
  const { command, shell } = expoEngine.composeCommand(ctx);
  assert.equal(shell, true);
  assert.match(command, /npm ci/);
  assert.match(command, /npx expo prebuild --platform android --no-install/);
  assert.match(command, /cd android/); // default gradleRoot fallback
  assert.match(command, /\.\/gradlew assembleDebug --no-daemon --stacktrace --console=plain$/);
  // install must precede prebuild, which must precede the gradlew line
  const installIdx = command.indexOf('npm ci');
  const prebuildIdx = command.indexOf('expo prebuild');
  const normalizeIdx = command.indexOf('splashscreen_background');
  const gradleIdx = command.indexOf('./gradlew');
  assert.ok(installIdx < prebuildIdx && prebuildIdx < normalizeIdx && normalizeIdx < gradleIdx, command);
});

test('expo engine: bare project (android/ already generated) skips prebuild entirely', () => {
  const ctx = { buildType: 'DEBUG', packageManager: 'yarn', gradleRoot: 'android', buildSystemInfo: { androidGenerated: true } };
  const { command } = expoEngine.composeCommand(ctx);
  assert.doesNotMatch(command, /npx expo prebuild/);
  assert.match(command, /skipping expo prebuild/);
  assert.match(command, /yarn install --frozen-lockfile/);
  assert.doesNotMatch(command, /splashscreen_background/);
  assert.doesNotMatch(command, /enableJetifier=false/);
});

test('expo engine: never depends on EAS (no "eas" token anywhere in the composed script)', () => {
  const managed = expoEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', buildSystemInfo: { androidGenerated: false } }).command;
  const bare = expoEngine.composeCommand({ buildType: 'DEBUG', packageManager: 'npm', buildSystemInfo: { androidGenerated: true } }).command;
  assert.doesNotMatch(managed, /\beas\b/i);
  assert.doesNotMatch(bare, /\beas\b/i);
});

test('engine-factory routes both EXPO_MANAGED and EXPO_BARE to the same engine', () => {
  assert.equal(getEngine('EXPO_MANAGED'), getEngine('EXPO_BARE'));
});

test('expo prebuild normalizer caps the generated template and adds the missing splash color', () => {
  const { execFileSync } = require('node:child_process');
  const fss = require('node:fs');
  const { EXPO_GENERATED_ANDROID_NORMALIZE_JS } = require('../dist/engines/expo.engine');
  const root = fss.mkdtempSync(path.join(os.tmpdir(), 'expo-norm-'));
  const props = path.join(root, 'android', 'gradle.properties');
  const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
  fss.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  fss.mkdirSync(path.join(res, 'values'), { recursive: true });
  fss.mkdirSync(path.join(res, 'values-night'), { recursive: true });
  fss.writeFileSync(props, [
    'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m',
    'android.enableJetifier=true',
    'reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64',
    '',
  ].join('\n'));
  fss.writeFileSync(path.join(res, 'drawable', 'splashscreen.xml'), '<item android:drawable="@color/splashscreen_background"/>');
  fss.writeFileSync(path.join(res, 'values', 'colors.xml'), '<resources>\n  <color name="colorPrimary">#023c69</color>\n</resources>\n');
  fss.writeFileSync(path.join(res, 'values-night', 'colors.xml'), '<resources/>\n');
  execFileSync(process.execPath, ['-e', EXPO_GENERATED_ANDROID_NORMALIZE_JS], { cwd: root });
  const capped = fss.readFileSync(props, 'utf8');
  assert.match(capped, /Xmx1280m/);
  assert.match(capped, /android\.enableJetifier=false/);
  assert.match(capped, /org\.gradle\.daemon=false/);
  assert.match(capped, /org\.gradle\.workers\.max=1/);
  assert.match(capped, /^reactNativeArchitectures=arm64-v8a$/m);
  assert.match(fss.readFileSync(path.join(res, 'values', 'colors.xml'), 'utf8'), /splashscreen_background">#ffffff/);
  const night = fss.readFileSync(path.join(res, 'values-night', 'colors.xml'), 'utf8');
  assert.match(night, /splashscreen_background">#000000/);
  assert.equal((night.match(/<resources/g) || []).length, 1);
  fss.rmSync(root, { recursive: true, force: true });
});

// ── Pipeline integration (real stages, no Docker) ───────────────────────────

async function source(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'expo-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [f, c] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), c);
  }
  return root;
}
function context(t, root) {
  const ctx = {
    sourceRepoPath: root, buildId: 'expo-pipeline-test', buildType: 'DEBUG', autoFix: false,
    log: async () => {},
  };
  t.after(async () => {
    if (ctx.workspaceDir && ctx.workspaceDir !== root) await fs.rm(ctx.workspaceDir, { recursive: true, force: true });
  });
  return ctx;
}

test('a real Expo managed fixture flows through EXTRACT -> DETECT -> VALIDATE and composes a prebuild script', async (t) => {
  const root = await source(t, {
    'package.json': JSON.stringify({ dependencies: { expo: '~51.0.0', 'react-native': '0.74.5' } }),
    'package-lock.json': '{}',
    'app.json': JSON.stringify({ expo: { name: 'demo', slug: 'demo' } }), // no android.package on purpose
  });
  const ctx = context(t, root);

  assert.deepEqual(await stageExtract(ctx), { ok: true });
  assert.deepEqual(await stageDetect(ctx), { ok: true });
  assert.equal(ctx.framework, 'EXPO_MANAGED');

  const result = await stageValidate(ctx);
  assert.equal(result.ok, true); // missing android.package only warns, never blocks
  assert.equal(ctx.gradleCommand, './gradlew assembleDebug');

  const { command, shell } = getEngine(ctx.framework).composeCommand(ctx);
  assert.equal(shell, true);
  assert.match(command, /expo prebuild/);
});

test('a real Expo bare fixture (android/ committed) skips prebuild in the composed script', async (t) => {
  const root = await source(t, {
    'package.json': JSON.stringify({ dependencies: { expo: '~51.0.0' } }),
    'pnpm-lock.yaml': '',
    'app.json': JSON.stringify({ expo: { name: 'demo', slug: 'demo', android: { package: 'com.example.demo' } } }),
    'android/gradlew': '#!/bin/sh\necho stub',
    'android/app/build.gradle': "apply plugin: 'com.android.application'",
  });
  const ctx = context(t, root);

  await stageExtract(ctx);
  await stageDetect(ctx);
  assert.equal(ctx.framework, 'EXPO_BARE');
  assert.equal(ctx.packageManager, 'pnpm');

  const validateResult = await stageValidate(ctx);
  assert.equal(validateResult.ok, true);

  const { command } = getEngine(ctx.framework).composeCommand(ctx);
  assert.doesNotMatch(command, /npx expo prebuild/);
  assert.match(command, /pnpm install --frozen-lockfile/);
});

test('an Expo project missing its lockfile fails VALIDATE', async (t) => {
  const root = await source(t, {
    'package.json': JSON.stringify({ dependencies: { expo: '~51.0.0' } }),
    'app.json': JSON.stringify({ expo: { name: 'demo', slug: 'demo' } }),
  });
  const ctx = context(t, root);
  await stageExtract(ctx);
  await stageDetect(ctx);
  const result = await stageValidate(ctx);
  assert.equal(result.ok, false);
  assert.match(result.error, /lockfile is required/);
});
