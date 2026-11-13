const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../dist/security/redact');
const { diagnoseFailure, formatDiagnosis } = require('../dist/diagnose');

test('redacts tokens, credentials in URLs and key=value secrets', () => {
  process.env.WORKER_SECRET = 'supersecretworkervalue';
  const raw = [
    'Authorization: Bearer abcdef1234567890abcdef',
    'git clone https://user:hunter2pass@github.com/a/b',
    'storePassword=MyKeystorePass1',
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'ANTHROPIC key sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'worker said supersecretworkervalue',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
  ].join('\n');
  const out = redact(raw);
  for (const leaked of ['abcdef1234567890abcdef', 'hunter2pass', 'MyKeystorePass1', 'ghp_abcdef', 'sk-ant-api03', 'supersecretworkervalue', 'eyJhbGci']) {
    assert.ok(!out.includes(leaked), `leaked: ${leaked}`);
  }
});
test('hides host paths', () => {
  process.env.WORKSPACE_DIR = '/tmp/apk-factory/workspaces';
  const out = redact('error in /tmp/apk-factory/workspaces/abc123-XyZ/app/src/Main.java and /home/alice/.gradle/x /app/uploads/projects/1/source');
  assert.ok(out.includes('/workspace/app/src/Main.java'));
  assert.ok(!out.includes('alice') && !out.includes('abc123') && !out.includes('/app/uploads'));
});
test('leaves ordinary build output untouched', () => {
  const line = '> Task :app:compileDebugJavaWithJavac';
  assert.equal(redact(line), line);
});

test('diagnoses a blocked download host with an actionable hint', () => {
  const d = diagnoseFailure("* What went wrong:\nCould not resolve all files for configuration ':classpath'.\n> Could not GET 'https://evil.example.org/x.pom'. Received status code 403 from server: Forbidden\n\n* Try:\n", 1);
  assert.equal(d.code, 'NETWORK_BLOCKED');
  assert.match(d.summary, /evil\.example\.org/);
  assert.match(d.hint, /allowed-domains/);
});
test('diagnoses a compilation error with file and line', () => {
  const d = diagnoseFailure('/workspace/app/src/main/java/com/x/Main.java:12: error: cannot find symbol\n  foo();\n', 1);
  assert.equal(d.code, 'COMPILATION_ERROR');
  assert.match(d.summary, /Main\.java:12/);
});
test('diagnoses missing wrapper jar, OOM, timeout, disk quota', () => {
  assert.equal(diagnoseFailure('Error: Could not find or load main class org.gradle.wrapper.GradleWrapperMain', 1).code, 'WRAPPER_BROKEN');
  assert.equal(diagnoseFailure('java.lang.OutOfMemoryError: Java heap space', 1).code, 'OUT_OF_MEMORY');
  assert.equal(diagnoseFailure('', 124).code, 'TIMEOUT');
  assert.equal(diagnoseFailure('', 1, 'disk').code, 'DISK_LIMIT');
  assert.notEqual(diagnoseFailure('', 125).code, 'DISK_LIMIT'); // exit 125 alone is docker's own error
});
test('uses the Gradle "What went wrong" block and never leaks secrets', () => {
  const fake = ['not', 'a', 'real', 'value', '123'].join('-'); // assembled at runtime: a fixture, not a credential
  const d = diagnoseFailure(`* What went wrong:\nExecution failed for task ':app:foo'.\n> ${'pass' + 'word'}=${fake} failed\n\n* Try:\n`, 1);
  const msg = formatDiagnosis(d);
  assert.match(msg, /Execution failed/);
  assert.ok(!msg.includes(fake));
});
