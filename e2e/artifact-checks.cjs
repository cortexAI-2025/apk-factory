// Artifact handling against the real API + database + disk (no worker, no Docker).
//   internal upload validation, server-side SHA-256, recommended file, owner-only download,
//   storage layout, project/account deletion, retention purge.
// Needs: E2E_WORKER_SECRET (same as the backend's WORKER_SECRET), E2E_UPLOADS_PATH (backend's UPLOADS_PATH).
// Run it while NO worker is consuming the build queue. Optional: E2E_ARTIFACT_MAX_MB (backend ARTIFACT_MAX_MB),
// E2E_RETENTION=1 (backend started with RETENTION_HOURS=0.0005 RETENTION_SWEEP_MINUTES=1).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./lib.cjs');
const { api, check, API, sha256 } = L;

const SECRET = process.env.E2E_WORKER_SECRET;
const UPLOADS = process.env.E2E_UPLOADS_PATH;
if (!SECRET || !UPLOADS) { console.error('E2E_WORKER_SECRET and E2E_UPLOADS_PATH are required'); process.exit(2); }

const internal = (route, { method = 'POST', body, query = {}, secret = SECRET } = {}) =>
  fetch(`${API}/api/v1/internal/builds${route}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, {
    method, body, headers: { 'x-worker-secret': secret, ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const artDir = (buildId) => path.join(UPLOADS, 'artifacts', buildId);
const filesIn = (buildId) => { try { return fs.readdirSync(artDir(buildId)); } catch { return []; } };

async function newBuild(token, name) {
  const fx = L.fixtures();
  const p = await L.upload(token, fx.ok, name);
  const b = (await api(`/projects/${p.body.id}/builds`, { method: 'POST', token, body: { buildType: 'DEBUG', autoFix: false } })).body;
  return { projectId: p.body.id, buildId: b.id };
}
const detail = async (token, projectId, buildId) => (await api(`/projects/${projectId}/builds/${buildId}`, { token })).body;

(async () => {
  const A = await L.register('art-owner');
  const B = await L.register('art-other');

  if (process.env.E2E_RETENTION !== '1') {
    const { projectId, buildId } = await newBuild(A.token, 'artifact-app');
    const apk1 = crypto.randomBytes(3000), apk2 = crypto.randomBytes(2000);
    const q = (o) => ({ fileName: 'app-universal-debug.apk', variant: 'debug', abi: 'universal', module: 'app', recommended: 'true', ...o });

    // ── upload validation ──
    const noSecret = await internal(`/${buildId}/artifacts`, { body: apk1, query: q({}), secret: 'wrong' });
    check('upload refused with a wrong worker secret (401)', noSecret.status === 401, `HTTP ${noSecret.status}`);
    const badSha = await internal(`/${buildId}/artifacts`, { body: apk1, query: q({ sha256: 'a'.repeat(64) }) });
    check('checksum mismatch is rejected (400) and stores nothing', badSha.status === 400 && filesIn(buildId).length === 0, `HTTP ${badSha.status} files=${filesIn(buildId).length}`);
    for (const [label, fileName] of [['path traversal name', '../../etc/x.apk'], ['script name', 'evil.sh'], ['double extension', 'a.apk.html'], ['AAB while release builds are disabled', 'app.aab'], ['empty name', '']]) {
      const r = await internal(`/${buildId}/artifacts`, { body: apk1, query: q({ fileName }) });
      check(`file name rejected: ${label}`, r.status === 400, `HTTP ${r.status}`);
    }
    const empty = await internal(`/${buildId}/artifacts`, { body: '', query: q({}) });
    check('empty artifact is rejected (400)', empty.status === 400, `HTTP ${empty.status}`);
    if (process.env.E2E_ARTIFACT_MAX_MB) {
      const big = Buffer.alloc((Number(process.env.E2E_ARTIFACT_MAX_MB) + 1) * 1024 * 1024, 7);
      const r = await internal(`/${buildId}/artifacts`, { body: big, query: q({}) }).catch((e) => ({ status: `network:${e.cause?.code || e.message}` }));
      check('oversized artifact is refused and leaves no file', (r.status === 413 || String(r.status).startsWith('network')) && filesIn(buildId).length === 0, `HTTP ${r.status} files=${filesIn(buildId).length}`);
    }
    check('nothing was stored by the rejected uploads', filesIn(buildId).length === 0 && (await detail(A.token, projectId, buildId)).artifacts.length === 0);

    // ── accepted uploads: server computes size + SHA-256 ──
    const ok1 = await internal(`/${buildId}/artifacts`, { body: apk1, query: q({}) });
    const j1 = await ok1.json();
    check('valid upload accepted without a client checksum (201)', ok1.status === 201 && j1.sha256 === sha256(apk1) && j1.apkSize === apk1.length, `HTTP ${ok1.status} ${JSON.stringify(j1).slice(0, 120)}`);
    const ok2 = await internal(`/${buildId}/artifacts`, { body: apk2, query: q({ fileName: 'app-arm64-v8a-debug.apk', abi: 'arm64-v8a', recommended: 'false', sha256: sha256(apk2) }) });
    check('second variant accepted with a matching checksum', ok2.status === 201, `HTTP ${ok2.status}`);

    const d = await detail(A.token, projectId, buildId);
    check('build lists both variants, the recommended one first', d.artifacts.length === 2 && d.artifacts[0].recommended && d.artifacts[0].abi === 'universal' && d.artifacts[1].abi === 'arm64-v8a', JSON.stringify(d.artifacts.map((a) => [a.fileName, a.recommended])));
    check('apkUrl points to the authenticated download route, not a static file', /\/api\/v1\/projects\/.+\/builds\/.+\/artifacts\/.+\/download$/.test(d.apkUrl || '') && !/\/files\//.test(d.apkUrl || ''), d.apkUrl);
    check('API exposes SHA-256 and size but never the storage path', d.artifacts.every((a) => /^[a-f0-9]{64}$/.test(a.sha256) && a.sizeBytes > 0 && !('storagePath' in a)) && !JSON.stringify(d).includes(UPLOADS));
    const names = filesIn(buildId);
    check('files are stored under opaque ids, never under user-supplied names', names.length === 2 && names.every((n) => /^[0-9a-f-]{36}\.apk$/.test(n)), names.join(','));

    // ── owner-only download ──
    for (const [a, bytes] of [[d.artifacts[0], apk1], [d.artifacts[1], apk2]]) {
      const url = `/projects/${projectId}/builds/${buildId}/artifacts/${a.id}/download`;
      const own = await api(url, { token: A.token, raw: true });
      const got = Buffer.from(await own.arrayBuffer());
      check(`owner downloads ${a.fileName} with the right bytes`, own.status === 200 && sha256(got) === a.sha256 && got.equals(bytes), `HTTP ${own.status}`);
      check(`other account gets 404 for ${a.fileName}`, (await api(url, { token: B.token, raw: true })).status === 404);
    }
    const mix = await api(`/projects/${projectId}/builds/${buildId}/artifacts/${crypto.randomUUID()}/download`, { token: A.token, raw: true });
    check('unknown artifact id gives 404', mix.status === 404, `HTTP ${mix.status}`);
    const notUuid = await api(`/projects/${projectId}/builds/${buildId}/artifacts/..%2F..%2Fx/download`, { token: A.token, raw: true });
    check('malformed artifact id is rejected (400/404)', [400, 404].includes(notUuid.status), `HTTP ${notUuid.status}`);

    // ── a finished build refuses further uploads ──
    await internal(`/${buildId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'FAILED', errorMessage: 'x' }) });
    const late = await internal(`/${buildId}/artifacts`, { body: apk1, query: q({}) });
    check('a finished build no longer accepts artifacts (409)', late.status === 409, `HTTP ${late.status}`);

    // ── deletion removes files AND rows ──
    const second = await newBuild(A.token, 'to-delete');
    await internal(`/${second.buildId}/artifacts`, { body: apk1, query: q({}) });
    check('artifact stored for the project to delete', filesIn(second.buildId).length === 1);
    const del = await api(`/projects/${second.projectId}`, { method: 'DELETE', token: A.token });
    check('deleting a project removes its artifact files', del.status < 300 && filesIn(second.buildId).length === 0 && !fs.existsSync(artDir(second.buildId)), `HTTP ${del.status}`);

    const accDel = await api('/me', { method: 'DELETE', token: A.token });
    check('deleting the account removes every artifact file', accDel.status < 300 && filesIn(buildId).length === 0 && !fs.existsSync(artDir(buildId)), `HTTP ${accDel.status}`);
    check('the other account is unaffected by that deletion', (await api('/auth/profile', { token: B.token })).status === 200);
  } else {
    // ── retention purge (backend started with RETENTION_HOURS=0.0005 RETENTION_SWEEP_MINUTES=1) ──
    const { projectId, buildId } = await newBuild(A.token, 'retention-app');
    const apk = crypto.randomBytes(1500);
    await internal(`/${buildId}/artifacts`, { body: apk, query: { fileName: 'app-debug.apk', variant: 'debug', abi: 'universal', recommended: 'true' } });
    await internal(`/${buildId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'SUCCESS' }) });
    const before = await detail(A.token, projectId, buildId);
    check('artifact exists right after the build finished', before.artifacts.length === 1 && filesIn(buildId).length === 1);
    const end = Date.now() + 130000;
    let purged = false;
    while (Date.now() < end) {
      if (filesIn(buildId).length === 0 && (await detail(A.token, projectId, buildId)).artifacts.length === 0) { purged = true; break; }
      await sleep(5000);
    }
    const after = await detail(A.token, projectId, buildId);
    check('retention sweep purged the artifact file and row', purged, `files=${filesIn(buildId).length} rows=${after.artifacts?.length}`);
    check('the build no longer advertises a download link', !after.apkUrl && !after.publicLink, String(after.apkUrl));
    const gone = await api(`/projects/${projectId}/builds/${buildId}/artifacts/${before.artifacts[0].id}/download`, { token: A.token, raw: true });
    check('downloading a purged artifact gives 404', gone.status === 404, `HTTP ${gone.status}`);
    const rebuild = await api(`/projects/${projectId}/builds`, { method: 'POST', token: A.token, body: { buildType: 'DEBUG' } });
    check('rebuilding a purged project asks for a new upload (400)', rebuild.status === 400 && /upload the project again/i.test(JSON.stringify(rebuild.body)), `HTTP ${rebuild.status}`);
  }
  L.finish(process.env.E2E_RETENTION === '1' ? 'retention' : 'artifacts');
})().catch((e) => { console.error(e); process.exit(1); });
