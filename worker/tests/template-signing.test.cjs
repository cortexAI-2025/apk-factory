// Regression (CI run 45012681180, react-native AAB): the template's release build type used the
// debug keystore, so the "signed release" shipped with CN=Android Debug and was kept as already signed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stripTemplateDebugSigning, stripTemplateDebugSigningShell } = require('../dist/engines/template-signing');
const { reactNativeCliEngine } = require('../dist/engines/react-native-cli.engine');
const { expoEngine } = require('../dist/engines/expo.engine');

// RN 0.7x app/build.gradle (relevant part)
const RN = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

test('drops the template debug signing even though the template declares a debug storeFile', () => {
  const out = stripTemplateDebugSigning(RN);
  assert.doesNotMatch(out, /signingConfig\s+signingConfigs\.debug/);
  assert.match(out, /storeFile file\('debug\.keystore'\)/); // debug keystore itself untouched
  assert.match(out, /minifyEnabled/);
});

test('keeps a project that declares its own release keystore', () => {
  const own = RN.replace('signingConfigs {', "signingConfigs {\n        release {\n            storeFile file('my.jks')\n        }").replace(/(release \{\n\s*\/\/ Caution[^\n]*\n\s*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
  assert.equal(stripTemplateDebugSigning(own), own);
});

test('the in-container shell step rewrites a workspace exactly like the host function', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'android/app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'android/app/build.gradle'), RN);
  const out = execFileSync('bash', ['-c', stripTemplateDebugSigningShell('react-native-cli')], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /removed template debug signing from android\/app\/build\.gradle/);
  assert.equal(fs.readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8'), stripTemplateDebugSigning(RN));
});

test('react-native and expo run the strip before Gradle', () => {
  const rn = reactNativeCliEngine.composeCommand({ buildType: 'AAB', packageManager: 'npm', buildSystemInfo: {} }).command;
  const ex = expoEngine.composeCommand({ buildType: 'AAB', packageManager: 'npm', gradleRoot: undefined, buildSystemInfo: { androidGenerated: false } }).command;
  for (const c of [rn, ex]) assert.ok(c.indexOf('removed template debug signing') > 0 && c.indexOf('removed template debug signing') < c.indexOf('./gradlew'));
});
