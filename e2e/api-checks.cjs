// API-level checks: rejected archives, build failure diagnostics, owner-only artifact access.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const L = require('./lib.cjs');
const { api, check, OUT, API, sha256 } = L;

const PY = `
import sys, json, zipfile
spec = json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for e in spec:
        i = zipfile.ZipInfo(e['name']); i.create_system = 3; i.compress_type = zipfile.ZIP_DEFLATED
        i.external_attr = e.get('mode', 0o100644) << 16
        z.writestr(i, e['data'] * e.get('repeat', 1) if 'repeat' in e else e.get('data', 'x'))
`;
function makeZip(name, entries) {
  const f = path.join(OUT, name);
  execFileSync('python3', ['-I', '-c', PY, f], { input: JSON.stringify(entries) });
  return f;
}
const wrapperFiles = [
  { name: 'gradlew', mode: 0o100755 }, { name: 'gradle/wrapper/gradle-wrapper.properties' },
  { name: 'gradle/wrapper/gradle-wrapper.jar' }, { name: 'settings.gradle' },
  { name: 'app/build.gradle' }, { name: 'app/src/main/AndroidManifest.xml' },
];

(async () => {
  const A = await L.register('owner');
  const B = await L.register('intruder');
  const projectsBefore = (await api('/projects', { token: A.token })).body.projects.length;

  // ── 1. invalid archives are rejected with an actionable message ──────────
  const notZip = path.join(OUT, 'not-a-zip.zip'); fs.writeFileSync(notZip, 'this is plain text, not an archive');
  const cases = [
    ['plain text renamed .zip', notZip, /not a valid ZIP/],
    ['no Gradle wrapper', makeZip('no-wrapper.zip', wrapperFiles.filter((e) => !e.name.startsWith('gradle'))), /wrapper is missing|Gradle wrapper/],
    ['path traversal', makeZip('traversal.zip', [...wrapperFiles, { name: '../../evil.txt' }]), /escapes|Path/],
    ['symbolic link', makeZip('symlink.zip', [...wrapperFiles, { name: 'app/link', mode: 0o120777, data: '/etc/passwd' }]), /Symbolic links/],
    ['compression bomb', makeZip('bomb.zip', [...wrapperFiles, { name: 'zeros.bin', data: '0', repeat: 50_000_000 }]), /compression ratio|expands to more|too large/i],
    ['not an Android project', makeZip('not-android.zip', wrapperFiles.filter((e) => !e.name.endsWith('AndroidManifest.xml'))), /AndroidManifest/],
  ];
  for (const [label, file, re] of cases) {
    const r = await L.upload(A.token, file, label);
    const msg = typeof r.body === 'object' ? JSON.stringify(r.body.message) : String(r.body);
    check(`invalid ZIP rejected: ${label}`, r.status === 400 && re.test(msg), `HTTP ${r.status} ${msg.slice(0, 140)}`);
  }
  const form = new FormData(); form.append('name', 'x');
  const noFile = await api('/projects/upload', { method: 'POST', token: A.token, form });
  check('upload without a file is rejected (400)', noFile.status === 400, `HTTP ${noFile.status}`);
  const wrongExt = await L.upload(A.token, notZip, 'ext', 'project.tar');
  check('non-.zip file name is rejected (400)', wrongExt.status === 400, `HTTP ${wrongExt.status}`);
  const projectsAfter = (await api('/projects', { token: A.token })).body.projects.length;
  check('no project was created by any rejected archive', projectsAfter === projectsBefore, `${projectsBefore} → ${projectsAfter}`);

  // ── 2. Gradle failure → useful diagnosis, redacted logs ──────────────────
  const fx = L.fixtures();
  const broken = await L.upload(A.token, fx.broken, 'broken-app');
  check('broken project is accepted for build', broken.status < 300, `HTTP ${broken.status}`);
  const bb = (await api(`/projects/${broken.body.id}/builds`, { method: 'POST', token: A.token, body: { buildType: 'DEBUG', autoFix: false } })).body;
  const failed = await L.waitBuild(A.token, broken.body.id, bb.id);
  check('compile error ends in FAILED', failed.status === 'FAILED', failed.status);
  check('error message names the cause, file and line', /\[COMPILATION_ERROR\]/.test(failed.errorMessage || '') && /MainActivity\.java:\d+/.test(failed.errorMessage || ''), (failed.errorMessage || '').slice(0, 200));
  check('error message does not expose host paths', !/\/tmp\/apk-factory|\/home\/|\/app\/uploads/.test(failed.errorMessage || ''));
  const logs = (await api(`/projects/${broken.body.id}/builds/${bb.id}/logs?limit=1000`, { token: A.token })).body.logs.map((l) => l.message).join('\n');
  const forbidden = (process.env.E2E_FORBIDDEN || '').split(',').filter((s) => s.length >= 6);
  check('build logs contain no host paths or configured secrets', !/\/tmp\/apk-factory\/workspaces|\/app\/uploads/.test(logs) && forbidden.every((s) => !logs.includes(s)));
  check('failed build exposes no artifact', (failed.artifacts || []).length === 0);

  // ── 3. artifact access control ───────────────────────────────────────────
  let rep; try { rep = JSON.parse(fs.readFileSync(path.join(OUT, 'ui-report.json'), 'utf8')); } catch {}
  let ownerToken = A.token, projectId, buildId, artifact;
  if (rep) { ({ token: ownerToken, projectId, buildId } = rep); }
  else {
    const ok = await L.upload(A.token, fx.ok, 'good-app');
    projectId = ok.body.id;
    buildId = (await api(`/projects/${projectId}/builds`, { method: 'POST', token: A.token, body: { buildType: 'DEBUG', autoFix: false } })).body.id;
    const done = await L.waitBuild(A.token, projectId, buildId);
    check('reference project builds successfully', done.status === 'SUCCESS', `${done.status} ${done.errorMessage || ''}`);
  }
  const detail = (await api(`/projects/${projectId}/builds/${buildId}`, { token: ownerToken })).body;
  artifact = (detail.artifacts || []).find((a) => a.recommended) || (detail.artifacts || [])[0];
  check('build lists at least one artifact with name, size and SHA-256', !!artifact && artifact.fileName.endsWith('.apk') && artifact.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(artifact.sha256), JSON.stringify(artifact));
  const dlPath = `/projects/${projectId}/builds/${buildId}/artifacts/${artifact.id}/download`;

  const own = await api(dlPath, { token: ownerToken, raw: true });
  const bytes = Buffer.from(await own.arrayBuffer());
  check('owner can download the APK', own.status === 200 && bytes.length === artifact.sizeBytes, `HTTP ${own.status} ${bytes.length}/${artifact.sizeBytes}`);
  check('downloaded bytes match the displayed SHA-256', sha256(bytes) === artifact.sha256);
  check('download is served as an APK attachment, not cacheable', /android\.package-archive/.test(own.headers.get('content-type') || '') && /attachment/.test(own.headers.get('content-disposition') || '') && /no-store/.test(own.headers.get('cache-control') || ''));
  fs.writeFileSync(path.join(OUT, 'downloaded-by-owner.apk'), bytes);

  const other = await api(dlPath, { token: B.token, raw: true });
  check('second account cannot download the artifact', [403, 404].includes(other.status), `HTTP ${other.status}`);
  const anon = await api(dlPath, { raw: true });
  check('anonymous request is refused (401)', anon.status === 401, `HTTP ${anon.status}`);
  const otherBuild = await api(`/projects/${projectId}/builds/${buildId}`, { token: B.token });
  check('second account cannot read the build details', [403, 404].includes(otherBuild.status) && !JSON.stringify(otherBuild.body).includes(artifact.sha256), `HTTP ${otherBuild.status}`);
  const otherLogs = await api(`/projects/${projectId}/builds/${buildId}/logs`, { token: B.token });
  check('second account cannot read the build logs', [403, 404].includes(otherLogs.status), `HTTP ${otherLogs.status}`);

  const leaks = [`/files/artifacts/${buildId}/${artifact.id}.apk`, `/files/apks/${buildId}.apk`, `/files/projects/${projectId}/source/gradlew`, `/files/keystores/`];
  for (const p of leaks) {
    const r = await fetch(`${API}${p}`, { redirect: 'manual' });
    check(`no static exposure of ${p.replace(/[0-9a-f-]{36}/g, '<id>')}`, r.status === 404, `HTTP ${r.status}`);
  }
  const internal = await fetch(`${API}/api/v1/internal/builds/${buildId}/artifacts?fileName=x.apk`, { method: 'POST', body: 'x', headers: { 'x-worker-secret': 'wrong' } });
  check('internal worker endpoint refuses a wrong secret', internal.status === 401, `HTTP ${internal.status}`);
  const noSecret = await fetch(`${API}/api/v1/internal/builds/${buildId}/status`, { method: 'PATCH', body: '{}', headers: { 'content-type': 'application/json' } });
  check('internal worker endpoint refuses a missing secret', noSecret.status === 401, `HTTP ${noSecret.status}`);
  const rel = await api(`/projects/${projectId}/builds`, { method: 'POST', token: ownerToken, body: { buildType: 'RELEASE' } });
  check('V1 scope: release builds are refused', rel.status === 400, `HTTP ${rel.status}`);

  L.finish('api');
})().catch((e) => { console.error(e); process.exit(1); });
