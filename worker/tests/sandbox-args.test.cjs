const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SANDBOX } = require('../dist/security/sandbox-config');
const { DockerRuntime } = require('../dist/runtimes/docker.runtime');
const { diagnoseFailure } = require('../dist/diagnose');

const rt = new DockerRuntime();
const args = (extra) => rt.sandboxArgs('apk-build-test', '/tmp/ws', ['./gradlew', 'assembleDebug'], extra);
const valueOf = (a, flag) => a[a.indexOf(flag) + 1];

test('network defaults to the restricted mode, never to open internet', () => {
  assert.equal(SANDBOX.NETWORK_MODE, 'restricted');
  assert.equal(valueOf(args(), '--network'), SANDBOX.NETWORK_NAME);
});
test('sandbox drops privileges and mounts only the workspace', () => {
  const a = args();
  assert.equal(valueOf(a, '--user'), '1000:1000');
  assert.equal(valueOf(a, '--cap-drop'), 'ALL');
  assert.ok(a.includes('--read-only'));
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--volume'), ['/tmp/ws:/workspace:rw']);
  assert.ok(!a.some((x) => /docker\.sock/.test(x)));
});
test('environment is an explicit allow-list without secrets', () => {
  process.env.WORKER_SECRET = 'must-not-leak';
  const envs = args().filter((x, i, arr) => arr[i - 1] === '--env');
  assert.ok(envs.every((e) => /^(ANDROID_HOME|ANDROID_SDK_ROOT|HOME|ANDROID_USER_HOME|GRADLE_OPTS|TERM|CI|BUILD_PROXY_HOST|BUILD_PROXY_PORT)=/.test(e)), envs.join(' '));
  assert.ok(!args().join(' ').includes('must-not-leak'));
});
test('USE_SECCOMP inserts a well-formed --security-opt pair (flag followed by its value)', () => {
  process.env.USE_SECCOMP = 'true';
  try {
    const a = args();
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--security-opt') assert.ok(!a[i + 1].startsWith('--'), `dangling --security-opt at ${i}: ${a[i + 1]}`);
    }
    const opts = a.filter((x, i) => a[i - 1] === '--security-opt');
    assert.ok(opts.includes('no-new-privileges:true'));
    assert.ok(opts.some((o) => o.startsWith('seccomp=')));
  } finally { delete process.env.USE_SECCOMP; }
});

test('disk quota and timeout are decided by the worker, not inferred from exit codes', () => {
  assert.equal(diagnoseFailure('', 1, 'disk').code, 'DISK_LIMIT');
  assert.equal(diagnoseFailure('', 137, 'timeout').code, 'TIMEOUT');
});
test('docker run failing with exit 125 is reported as a sandbox problem, not a disk quota', () => {
  const d = diagnoseFailure('docker: Error response from daemon: network apk-build-net not found.\n', 125);
  assert.equal(d.code, 'SANDBOX_UNAVAILABLE');
  assert.match(d.hint, /administrator/);
});
