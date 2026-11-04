#!/usr/bin/env node
// Isolation checks for the build sandbox. Runs probe commands inside a container
// created with the EXACT flags used for real builds (DockerRuntime.sandboxArgs).
//
//   node scripts/isolation-check.mjs [--expect-allowed-200]
//
// Requires: worker built (cd worker && npm run build), the builder image, and for
// BUILD_NETWORK_MODE=restricted the proxy from scripts/egress-proxy-up.sh.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

process.env.BUILD_NETWORK_MODE ||= 'restricted';
process.env.WORKSPACE_DIR ||= '/tmp/apk-factory/workspaces';
const require = createRequire(import.meta.url);
const { DockerRuntime } = require(resolve('worker/dist/runtimes/docker.runtime.js'));
const { SANDBOX } = require(resolve('worker/dist/security/sandbox-config.js'));
const expectAllowed200 = process.argv.includes('--expect-allowed-200');

const base = process.env.WORKSPACE_DIR;
mkdirSync(base, { recursive: true });
// A sibling build workspace with a canary: it must be invisible from our container.
const other = mkdtempSync(join(base, 'other-build-'));
writeFileSync(join(other, 'canary-other-build'), 'secret of another job');
const ws = mkdtempSync(join(base, 'probe-'));
writeFileSync(join(ws, 'gradlew'), '#!/bin/sh\n'); chmodSync(join(ws, 'gradlew'), 0o755);
writeFileSync(join(ws, 'build.gradle'), '');
for (const d of [ws, other]) chmodSync(d, 0o777);

// Secrets that exist in the worker's own environment must not reach the sandbox.
Object.assign(process.env, {
  WORKER_SECRET: 'probe-worker-secret', REDIS_PASSWORD: 'probe-redis-pw', ANTHROPIC_API_KEY: 'sk-ant-probe',
  JWT_SECRET: 'probe-jwt', DATABASE_URL: 'postgres://u:probe-db-pw@db/x',
});

const proxy = new URL(SANDBOX.PROXY_URL);
const connect = (target) => `
  exec 3<>/dev/tcp/${proxy.hostname}/${proxy.port || 3128} 2>/dev/null || { echo "CONNECT_${target}=unreachable"; exit 0; }
  printf 'CONNECT ${target} HTTP/1.1\\r\\nHost: ${target}\\r\\n\\r\\n' >&3
  read -t 20 -r line <&3; echo "CONNECT_${target}=\${line%%$'\\r'}"`;

const probe = `
echo "UID=$(id -u)"
echo "CAPEFF=$(grep CapEff /proc/self/status | awk '{print $2}')"
echo "NONEWPRIVS=$(grep NoNewPrivs /proc/self/status | awk '{print $2}')"
touch /etc/probe 2>/dev/null && echo "ROOTFS_WRITABLE=yes" || echo "ROOTFS_WRITABLE=no"
touch /opt/android-sdk/probe 2>/dev/null && echo "SDK_WRITABLE=yes" || echo "SDK_WRITABLE=no"
touch /tmp/probe 2>/dev/null && echo "TMP_WRITABLE=yes" || echo "TMP_WRITABLE=no"
touch /workspace/probe 2>/dev/null && echo "WORKSPACE_WRITABLE=yes" || echo "WORKSPACE_WRITABLE=no"
test -e /var/run/docker.sock && echo "DOCKER_SOCK=present" || echo "DOCKER_SOCK=absent"
echo "SECRET_ENV=$(env | grep -Ei 'secret|password|token|api_key|jwt|anthropic|database_url|redis' | grep -v '^BUILD_PROXY' | wc -l)"
echo "OTHER_BUILD_VISIBLE=$(find / -name canary-other-build -not -path '/proc/*' 2>/dev/null | wc -l)"
echo "WORKSPACE_FILES=$(ls /workspace | tr '\\n' ',')"
echo "MOUNTS=$(awk '{print $5}' /proc/self/mountinfo | grep -Ev '^(/|/proc.*|/dev.*|/sys.*|/etc/(resolv.conf|hostname|hosts)|/tmp|/workspace|/usr/sbin/docker-init)$' | tr '\\n' ',')"
echo "MEMMAX=$(cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null | head -1)"
echo "PIDSMAX=$(cat /sys/fs/cgroup/pids.max /sys/fs/cgroup/pids/pids.max 2>/dev/null | head -1)"
echo "ULIMIT_N=$(ulimit -n)"
echo "ULIMIT_F=$(ulimit -f)"
echo "PROCS=$(ls /proc | grep -c '^[0-9]')"
${SANDBOX.NETWORK_MODE === 'restricted' ? `
timeout 6 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null && echo "DIRECT_INTERNET=reachable" || echo "DIRECT_INTERNET=blocked"
timeout 6 bash -c 'exec 3<>/dev/tcp/169.254.169.254/80' 2>/dev/null && echo "METADATA=reachable" || echo "METADATA=blocked"
${connect('dl.google.com:443')}
${connect('example.com:443')}
${connect('169.254.169.254:80')}
${connect('127.0.0.1:22')}
` : ''}
`;

const name = `apk-isolation-probe-${process.pid}`;
const rt = new DockerRuntime();
const args = rt.sandboxArgs(name, ws, ['bash', '-c', probe]);
args.splice(args.indexOf('--rm') + 1, 0, '-i'); // not needed, harmless
const run = spawnSync('docker', ['run', ...args], { encoding: 'utf8', timeout: 120000 });
rmSync(other, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  throw new Error(`probe container failed (exit ${run.status})`);
}
const out = Object.fromEntries(
  run.stdout.split('\n').filter((l) => /^[A-Za-z_0-9:.-]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const results = [];
const check = (label, fn) => {
  try { fn(); results.push(['PASS', label]); } catch (e) { results.push(['FAIL', `${label} — ${e.message.split('\n')[0]}`]); }
};
const memLimit = (() => { const m = SANDBOX.MEMORY_LIMIT; const n = parseInt(m, 10); return /g$/i.test(m) ? n * 2 ** 30 : /m$/i.test(m) ? n * 2 ** 20 : n; })();

check('runs as unprivileged uid 1000', () => assert.equal(out.UID, '1000'));
check('no Linux capabilities (CapEff = 0)', () => assert.match(out.CAPEFF, /^0+$/));
check('no_new_privs set', () => assert.equal(out.NONEWPRIVS, '1'));
check('root filesystem is read-only', () => assert.equal(out.ROOTFS_WRITABLE, 'no'));
check('Android SDK is read-only', () => assert.equal(out.SDK_WRITABLE, 'no'));
check('/tmp and /workspace are writable (needed by Gradle)', () => { assert.equal(out.TMP_WRITABLE, 'yes'); assert.equal(out.WORKSPACE_WRITABLE, 'yes'); });
check('Docker socket is not exposed', () => assert.equal(out.DOCKER_SOCK, 'absent'));
check('no secrets in the container environment', () => assert.equal(out.SECRET_ENV, '0'));
check("another job's workspace is invisible", () => assert.equal(out.OTHER_BUILD_VISIBLE, '0'));
check('only this job’s files are mounted', () => assert.match(out.WORKSPACE_FILES, /^(build\.gradle,gradlew,probe,|build\.gradle,gradlew,)$|gradlew/));
check('no host bind mounts besides the workspace', () => assert.equal(out.MOUNTS.replace(/,$/, '').split(',').filter((m) => m && !/^\/(sys|proc|dev)/.test(m)).length, 0, out.MOUNTS));
check(`memory limit enforced (${SANDBOX.MEMORY_LIMIT})`, () => assert.equal(Number(out.MEMMAX), memLimit));
check('process limit enforced', () => assert.equal(out.PIDSMAX, String(SANDBOX.PIDS_LIMIT)));
check('open-file and file-size ulimits enforced', () => { assert.equal(out.ULIMIT_N, String(SANDBOX.NOFILE_LIMIT)); assert.ok(Number(out.ULIMIT_F) > 0); });
check('private PID namespace', () => assert.ok(Number(out.PROCS) < 15, out.PROCS));
if (SANDBOX.NETWORK_MODE === 'restricted') {
  check('no direct internet access', () => assert.equal(out.DIRECT_INTERNET, 'blocked'));
  check('cloud metadata endpoint unreachable', () => assert.equal(out.METADATA, 'blocked'));
  check('proxy refuses non-allow-listed host', () => assert.match(out['CONNECT_example.com:443'], /403/));
  check('proxy refuses link-local / metadata target', () => assert.match(out['CONNECT_169.254.169.254:80'], /403/));
  check('proxy refuses loopback/other ports', () => assert.match(out['CONNECT_127.0.0.1:22'], /403/));
  check('proxy does not deny an allow-listed host', () => {
    const v = out['CONNECT_dl.google.com:443'] || '';
    if (expectAllowed200) assert.match(v, / 200 /);
    else assert.doesNotMatch(v, / 403 /, v);
  });
}

// container must be gone (--rm) and nothing left behind
const left = execFileSync('docker', ['ps', '-aq', '--filter', `name=${name}`], { encoding: 'utf8' }).trim();
check('container removed after the run', () => assert.equal(left, ''));

for (const [s, l] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${l}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} isolation checks passed (network mode: ${SANDBOX.NETWORK_MODE})`);
process.exit(failed ? 1 : 0);
