const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { detectFramework, mapFrameworkToProjectType } = require('../dist/detection/framework-detector');

async function project(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [f, c] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), c);
  }
  return root;
}

// ── Android Native — must keep working exactly as before (non-regression) ───

test('Android native (Groovy DSL) is detected with high confidence', async (t) => {
  const root = await project(t, {
    gradlew: '#!/bin/sh',
    'settings.gradle': "include ':app'",
    'build.gradle': 'buildscript {}',
    'app/build.gradle': "apply plugin: 'com.android.application'\nandroid {\n compileSdkVersion 34\n minSdkVersion 21\n}",
    'app/src/main/AndroidManifest.xml': '<manifest/>',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'ANDROID_NATIVE');
  assert.ok(r.confidence > 0.5, r.confidence);
  assert.equal(r.versions.compileSdk, 34);
  assert.equal(r.versions.minSdk, 21);
  assert.equal(r.buildSystem.hasGradleWrapper, true);
  assert.equal(r.buildSystem.gradleRoot, '.');
  assert.equal(mapFrameworkToProjectType(r.framework), 'ANDROID_NATIVE');
});

test('Android native (Kotlin DSL + version catalog) is detected and versions extracted', async (t) => {
  const root = await project(t, {
    gradlew: '#!/bin/sh',
    'settings.gradle.kts': 'include(":app")',
    'build.gradle.kts': '// root',
    'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid {\n compileSdk = 35\n}',
    'gradle/libs.versions.toml': '[versions]\nkotlin = "2.0.21"\nagp = "8.6.0"\n',
    'gradle/wrapper/gradle-wrapper.properties': 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'ANDROID_NATIVE');
  assert.equal(r.versions.kotlin, '2.0.21');
  assert.equal(r.versions.agp, '8.6.0');
  assert.equal(r.versions.gradle, '8.9');
  assert.equal(r.versions.compileSdk, 35);
});

// ── React Native CLI ─────────────────────────────────────────────────────────

test('React Native CLI (android/ committed) is detected, not confused with Expo', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { 'react-native': '0.74.0', react: '18.2.0' } }),
    'package-lock.json': '{}',
    'react-native.config.js': 'module.exports = {}',
    'android/gradlew': '#!/bin/sh',
    'android/build.gradle': '// root',
    'android/app/build.gradle': "apply plugin: 'com.android.application'\nandroid { compileSdk 34 }",
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'REACT_NATIVE_CLI');
  assert.equal(r.packageManager, 'npm');
  assert.equal(r.versions.reactNative, '0.74.0');
  assert.equal(r.buildSystem.gradleRoot, 'android');
  assert.equal(r.buildSystem.androidGenerated, true);
  assert.equal(mapFrameworkToProjectType(r.framework), 'REACT_NATIVE');
});

test('React Native CLI without android/ is flagged (androidGenerated=false)', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { 'react-native': '0.74.0' } }),
    'yarn.lock': '',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'REACT_NATIVE_CLI');
  assert.equal(r.packageManager, 'yarn');
  assert.equal(r.buildSystem.androidGenerated, false);
  assert.equal(r.buildSystem.gradleRoot, undefined);
});

// ── Expo ─────────────────────────────────────────────────────────────────────

test('Expo managed (no android/ yet) is detected as EXPO_MANAGED', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { expo: '~51.0.0', 'react-native': '0.74.5' } }),
    'package-lock.json': '{}',
    'app.json': JSON.stringify({ expo: { name: 'demo', slug: 'demo' } }),
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'EXPO_MANAGED');
  assert.equal(r.versions.expoSdk, '~51.0.0');
  assert.equal(r.buildSystem.androidGenerated, false);
});

test('Expo with a prebuilt android/ project is reclassified as EXPO_BARE', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { expo: '~51.0.0' } }),
    'pnpm-lock.yaml': '',
    'app.json': JSON.stringify({ expo: { name: 'demo', slug: 'demo' } }),
    'android/gradlew': '#!/bin/sh',
    'android/app/build.gradle': "apply plugin: 'com.android.application'",
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'EXPO_BARE');
  assert.equal(r.packageManager, 'pnpm');
  assert.equal(r.buildSystem.androidGenerated, true);
  assert.equal(r.buildSystem.gradleRoot, 'android');
});

// ── Capacitor / Vite / Next.js — detection only, no engine yet ──────────────

test('Capacitor is detected ahead of its underlying Vite bundler', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { '@capacitor/core': '6.0.0', '@capacitor/android': '6.0.0', vite: '5.0.0' } }),
    'capacitor.config.ts': 'export default {}',
    'vite.config.ts': 'export default {}',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'CAPACITOR');
  assert.ok(r.ambiguousWith.includes('VITE_WEB') === false || r.confidence > 0.3);
});

test('Vite alone (no Capacitor) is detected as VITE_WEB', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ devDependencies: { vite: '5.0.0' } }),
    'vite.config.ts': 'export default {}',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'VITE_WEB');
});

test('Next.js static export is distinguished from default SSR mode', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { next: '14.2.0' } }),
    'next.config.js': "module.exports = { output: 'export' }",
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'NEXTJS_WEB');
  assert.equal(r.versions.nextOutputMode, 'export');
});

test('Next.js without output:export is flagged as default (SSR, not static-exportable)', async (t) => {
  const root = await project(t, {
    'package.json': JSON.stringify({ dependencies: { next: '14.2.0' } }),
    'next.config.js': 'module.exports = {}',
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'NEXTJS_WEB');
  assert.equal(r.versions.nextOutputMode, 'default');
});

// ── Flutter — detection only ─────────────────────────────────────────────────

test('Flutter is detected from pubspec.yaml with maximum confidence', async (t) => {
  const root = await project(t, { 'pubspec.yaml': 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n' });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'FLUTTER');
  assert.equal(r.confidence, 1);
  assert.equal(r.versions.flutter, 'sdk');
  assert.equal(mapFrameworkToProjectType(r.framework), 'FLUTTER');
});

test('Kotlin and Java native projects stay ANDROID_NATIVE and record the language', async (t) => {
  const kotlin = await project(t, {
    'settings.gradle': 'include ":app"',
    'app/build.gradle': 'plugins { id "com.android.application" }\nandroid { compileSdk 34 }',
    'app/src/main/kotlin/com/example/MainActivity.kt': 'class MainActivity',
  });
  const java = await project(t, {
    'settings.gradle': 'include ":app"',
    'app/build.gradle': 'plugins { id "com.android.application" }\nandroid { compileSdk 34 }',
    'app/src/main/java/com/example/MainActivity.java': 'class MainActivity {}',
  });
  assert.equal((await detectFramework(kotlin)).framework, 'ANDROID_NATIVE');
  assert.equal((await detectFramework(kotlin)).versions.nativeLanguage, 'kotlin');
  assert.equal((await detectFramework(java)).versions.nativeLanguage, 'java');
});

test('Cordova is detected from config.xml and is not confused with Capacitor', async (t) => {
  const root = await project(t, {
    'config.xml': '<widget id="com.example.app" version="1.0.0"></widget>',
    'package.json': JSON.stringify({ dependencies: { 'cordova-android': '13.0.0' } }),
  });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'CORDOVA');
  assert.equal(mapFrameworkToProjectType(r.framework), 'ANDROID_NATIVE');
  assert.equal(r.versions.cordovaAndroid, '13.0.0');
});

// ── Unknown / ambiguous ──────────────────────────────────────────────────────

test('An empty directory is UNKNOWN with zero confidence', async (t) => {
  const root = await project(t, {});
  const r = await detectFramework(root);
  assert.equal(r.framework, 'UNKNOWN');
  assert.equal(r.confidence, 0);
});

test('A package.json with no recognizable framework dependency reports a clear diagnosis', async (t) => {
  const root = await project(t, { 'package.json': JSON.stringify({ dependencies: { lodash: '4.0.0' } }) });
  const r = await detectFramework(root);
  assert.equal(r.framework, 'UNKNOWN');
  assert.match(r.diagnosis, /No recognizable framework/);
});
