// Lot 2 — runtime preparation for multi-step engines (RN CLI, Expo).
// These are unit/static tests only: no Docker daemon is available in this
// sandbox, so nothing here starts a real container or compiles anything.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DockerRuntime } = require('../dist/runtimes/docker.runtime');

const rt = new DockerRuntime();

test('Android Native (shell=false) splits the command and appends Gradle flags, unchanged', () => {
  const argv = rt.buildCommandArgv('./gradlew assembleDebug', false);
  assert.deepEqual(argv, ['./gradlew', 'assembleDebug', '--no-daemon', '--stacktrace', '--console=plain']);
});

test('RN CLI / Expo (shell=true) runs the full script via bash -c so PATH is kept', () => {
  const script = 'npm ci\ncd android\n./gradlew assembleDebug --no-daemon';
  const argv = rt.buildCommandArgv(script, true);
  assert.deepEqual(argv, ['bash', '-c', script]);
});

test('a shell-mode command composed with SKIP_GRADLE_PRECHECK reaches the sandbox env allow-list', () => {
  // extraEnv entries are raw docker-run argv pairs (see cache-injector.ts volumeMount()
  // for the same --volume convention), not bare "KEY=VALUE" strings.
  const args = rt.sandboxArgs('apk-build-test', '/tmp/ws', ['bash', '-c', 'npm ci && cd android && ./gradlew assembleDebug'], {
    extraEnv: ['--env', 'SKIP_GRADLE_PRECHECK=true'],
  });
  const envs = args.filter((x, i, arr) => arr[i - 1] === '--env');
  assert.ok(envs.includes('SKIP_GRADLE_PRECHECK=true'), envs.join(' '));
  // The command itself is the last three argv entries, passed through untouched.
  assert.deepEqual(args.slice(-3), ['bash', '-c', 'npm ci && cd android && ./gradlew assembleDebug']);
});

// ── Static checks on the entrypoint / Dockerfile (no execution) ─────────────

const dockerDir = path.join(__dirname, '..', '..', 'docker', 'android-builder');

test('entrypoint.sh only skips the gradlew precheck when SKIP_GRADLE_PRECHECK=true', () => {
  const sh = fs.readFileSync(path.join(dockerDir, 'entrypoint.sh'), 'utf-8');
  assert.match(sh, /SKIP_GRADLE_PRECHECK/);
  assert.match(sh, /if \[ "\$\{SKIP_GRADLE_PRECHECK:-\}" != "true" \]/);
});

test('entrypoint.sh exports HTTP(S)_PROXY for npm/yarn/pnpm alongside the Gradle proxy properties', () => {
  const sh = fs.readFileSync(path.join(dockerDir, 'entrypoint.sh'), 'utf-8');
  assert.match(sh, /export HTTPS_PROXY=/);
  assert.match(sh, /export https_proxy=/);
});

test('Dockerfile pins exact Node/pnpm/yarn versions (no bare "latest")', () => {
  const dockerfile = fs.readFileSync(path.join(dockerDir, 'Dockerfile'), 'utf-8');
  assert.match(dockerfile, /ENV NODE_VERSION=\d+\.\d+\.\d+/);
  assert.match(dockerfile, /corepack prepare pnpm@\d+\.\d+\.\d+ --activate/);
  assert.match(dockerfile, /corepack prepare yarn@\d+\.\d+\.\d+ --activate/);
  assert.doesNotMatch(dockerfile, /npm install -g/, 'no unversioned global CLI installs');
});

test('Dockerfile verifies the Node.js tarball checksum before extracting it', () => {
  const dockerfile = fs.readFileSync(path.join(dockerDir, 'Dockerfile'), 'utf-8');
  assert.match(dockerfile, /SHASUMS256\.txt/);
  assert.match(dockerfile, /sha256sum -c -/);
});

test('the egress allow-list adds exact npm registry hosts, no wildcards', () => {
  const list = fs.readFileSync(path.join(dockerDir, '..', 'egress-proxy', 'allowed-domains.txt'), 'utf-8');
  assert.match(list, /^registry\.npmjs\.org$/m);
  assert.doesNotMatch(list, /\*/, 'squid rejects overlapping wildcards — exact hosts only');
});
