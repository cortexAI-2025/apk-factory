const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileScanner } = require('../dist/security/file-scanner');

async function project(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [f, c] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), c);
  }
  return root;
}

test('a standard Gradle wrapper project is not blocked (wrapper jar, gradlew.bat)', async t => {
  const root = await project(t, {
    gradlew: '#!/bin/sh', 'gradlew.bat': '@echo off', 'gradle/wrapper/gradle-wrapper.jar': 'PK',
    'build.gradle': '', 'app/src/main/AndroidManifest.xml': '<manifest/>',
  });
  const r = await new FileScanner().scan(root);
  assert.equal(r.clean, true, JSON.stringify(r.threats));
});
test('bundled libraries and helper scripts only warn', async t => {
  const root = await project(t, { 'build.gradle': '', 'app/libs/foo.jar': 'PK', 'tools/gen.sh': 'echo hi' });
  const r = await new FileScanner().scan(root);
  assert.equal(r.clean, true);
  assert.ok(r.threats.some(x => x.severity === 'medium'));
});
test('Windows executables are still blocked', async t => {
  const root = await project(t, { 'build.gradle': '', 'tools/x.exe': 'MZ' });
  assert.equal((await new FileScanner().scan(root)).clean, false);
});
test('shell execution in source is still blocked', async t => {
  const root = await project(t, { 'build.gradle': '', 'app/Evil.java': 'class E { void f() throws Exception { Runtime.getRuntime().exec("sh -c id"); } }' });
  assert.equal((await new FileScanner().scan(root)).clean, false);
});
