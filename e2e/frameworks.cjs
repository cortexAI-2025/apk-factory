// HTTP certification of one minimal project per framework.
// The worker compiles inside the Android builder image. This file does not
// simulate a build: a missing API or a failed job is a failed check.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const L = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..');
const IMAGE = process.env.BUILDER_IMAGE || 'apk-factory/android-builder:latest';
const BT = '/opt/android-sdk/build-tools/37.0.0';
const WANT = (process.env.FRAMEWORKS || 'java,kotlin,flutter,react-native,expo,capacitor,cordova')
  .split(',').map((s) => s.trim()).filter(Boolean);
const VARIANTS = (process.env.FRAMEWORK_VARIANTS || 'DEBUG,RELEASE,AAB')
  .split(',').map((s) => s.trim()).filter(Boolean);
const REPORT = [];

function redact(text) {
  let out = String(text ?? '');
  for (const key of ['DATABASE_URL', 'REDIS_PASSWORD', 'JWT_SECRET', 'WORKER_SECRET', 'E2E_WORKER_SECRET']) {
    const value = process.env[key];
    if (value && value.length > 3) out = out.split(value).join('***');
  }
  return out;
}

function writeText(name, text) {
  fs.mkdirSync(L.OUT, { recursive: true });
  fs.writeFileSync(path.join(L.OUT, name), redact(text));
}

function zipDir(dir, dest) {
  const files = execFileSync('find', ['.', '-type', 'f',
    '!', '-path', './node_modules/*', '!', '-path', './.git/*',
    '!', '-name', '.DS_Store'], { cwd: dir, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, ''));
  fs.rmSync(dest, { force: true });
  execFileSync('zip', ['-X', '-q', dest, '-@'], { cwd: dir, input: files.join('\n') });
  return dest;
}

function ensureLockfile(dir) {
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return;
  // Host npm avoids a second docker run that has killed the API on the
  // runner (OOM / a brief iptables reset) right before the upload.
  try {
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: dir, stdio: 'inherit', timeout: 600000,
    });
  } catch (err) {
    execFileSync('docker', [
      'run', '--rm', '--user', '0', '--network', 'bridge', '--memory', '2g', '--memory-swap', '2g',
      '--entrypoint', 'npm',
      '-e', 'HOME=/tmp', '-v', `${path.resolve(dir)}:/src`, '-w', '/src', IMAGE,
      'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund',
    ], { stdio: 'inherit', timeout: 600000 });
  }
  if (!fs.existsSync(path.join(dir, 'package-lock.json'))) {
    throw new Error(`npm did not write a lockfile in ${dir}`);
  }
}

function writeProject(dir, files) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

const PROJECTS = {
  java: {
    expect: { framework: 'ANDROID_NATIVE', language: 'JAVA', package: 'com.apkfactory.reference', versionName: '1.0' },
    async zip(dest) {
      fs.copyFileSync(path.join(ROOT, 'examples', 'reference-android.zip'), dest);
      return dest;
    },
  },
  kotlin: {
    expect: { framework: 'ANDROID_NATIVE', language: 'KOTLIN', package: 'com.apkfactory.reference', versionName: '1.0' },
    async zip(dest) {
      return zipDir(path.join(ROOT, 'examples', 'reference-kotlin'), dest);
    },
  },
  flutter: {
    expect: { framework: 'FLUTTER', package: 'com.example.fluttercert', versionName: '1.0.0' },
    async zip(dest) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-flutter-'));
      writeProject(dir, {
        'pubspec.yaml': [
          'name: fluttercert',
          'description: apk factory certification',
          "publish_to: 'none'",
          'version: 1.0.0+1',
          'environment:',
          "  sdk: '>=3.3.0 <4.0.0'",
          'dependencies:',
          '  flutter:',
          '    sdk: flutter',
          'flutter:',
          '  uses-material-design: true',
          '',
        ].join('\n'),
        'lib/main.dart': [
          "import 'package:flutter/material.dart';",
          'void main() => runApp(const MaterialApp(home: Scaffold(body: Text("cert"))));',
          '',
        ].join('\n'),
      });
      return zipDir(dir, dest);
    },
  },
  expo: {
    expect: { framework: 'EXPO_MANAGED', package: 'com.apkfactory.cert.expomanaged', versionName: '1.0.0' },
    async zip(dest) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-expo-'));
      writeProject(dir, {
        'package.json': JSON.stringify({
          name: 'expo-managed-min',
          version: '1.0.0',
          private: true,
          main: 'node_modules/expo/AppEntry.js',
          dependencies: { expo: '51.0.39', react: '18.2.0', 'react-native': '0.74.5' },
        }, null, 2),
        'app.json': JSON.stringify({
          expo: {
            name: 'ExpoCert',
            slug: 'expo-cert',
            version: '1.0.0',
            android: { package: 'com.apkfactory.cert.expomanaged', versionCode: 1 },
          },
        }, null, 2),
        'babel.config.js': 'module.exports = function (api) { api.cache(true); return { presets: ["babel-preset-expo"] }; };\n',
        'App.js': 'import { Text, View } from "react-native";\nexport default function App() { return <View><Text>cert</Text></View>; }\n',
      });
      ensureLockfile(dir);
      return zipDir(dir, dest);
    },
  },
  capacitor: {
    expect: { framework: 'CAPACITOR', package: 'com.apkfactory.cert.capacitor' },
    async zip(dest) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cap-'));
      writeProject(dir, {
        'package.json': JSON.stringify({
          name: 'cap-cert',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@capacitor/android': '6.2.0',
            '@capacitor/cli': '6.2.0',
            '@capacitor/core': '6.2.0',
          },
        }, null, 2),
        'capacitor.config.json': JSON.stringify({
          appId: 'com.apkfactory.cert.capacitor',
          appName: 'CapCert',
          webDir: 'www',
        }, null, 2),
        'www/index.html': '<!doctype html><html><body>cert</body></html>\n',
      });
      ensureLockfile(dir);
      return zipDir(dir, dest);
    },
  },
  cordova: {
    expect: { framework: 'CORDOVA', package: 'com.apkfactory.cert.cordova' },
    async zip(dest) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cordova-'));
      writeProject(dir, {
        'package.json': JSON.stringify({
          name: 'cordova-cert',
          version: '1.0.0',
          private: true,
          dependencies: { cordova: '12.0.0', 'cordova-android': '13.0.0' },
        }, null, 2),
        'config.xml': [
          "<?xml version='1.0' encoding='utf-8'?>",
          '<widget id="com.apkfactory.cert.cordova" version="1.0.0" xmlns="http://www.w3.org/ns/widgets">',
          '  <name>CordovaCert</name>',
          '  <content src="index.html" />',
          '  <preference name="android-minSdkVersion" value="24" />',
          '  <engine name="android" spec="13.0.0" />',
          '</widget>',
          '',
        ].join('\n'),
        'www/index.html': '<!doctype html><html><body>cert</body></html>\n',
      });
      ensureLockfile(dir);
      return zipDir(dir, dest);
    },
  },
  'react-native': {
    expect: { framework: 'REACT_NATIVE_CLI', package: 'com.apkfactory.cert.rn' },
    async zip(dest) {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-rn-'));
      const dir = path.join(parent, 'CertRn');
      execFileSync('npx', ['--yes', '@react-native-community/cli@13.6.9', 'init', 'CertRn',
        '--version', '0.73.9', '--skip-install', '--directory', dir,
        '--package-name', 'com.apkfactory.cert.rn'], {
        cwd: parent, stdio: 'inherit', timeout: 600000,
        env: { ...process.env, CI: 'true', npm_config_yes: 'true' },
      });
      if (!fs.existsSync(path.join(dir, 'package-lock.json'))) ensureLockfile(dir);
      for (const extra of ['ios', '.git', '.bundle']) {
        fs.rmSync(path.join(dir, extra), { recursive: true, force: true });
      }
      const gradle = fs.readFileSync(path.join(dir, 'android', 'app', 'build.gradle'), 'utf8');
      const pkg = gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1];
      if (pkg) PROJECTS['react-native'].expect.package = pkg;
      return zipDir(dir, dest);
    },
  },
};

function dockerTool(entrypoint, args, mounts) {
  try {
    return {
      code: 0,
      out: execFileSync('docker', [
        'run', '--rm', '--user', '0', '--entrypoint', entrypoint,
        ...mounts.flatMap((m) => ['-v', m]),
        IMAGE, ...args,
      ], { encoding: 'utf8', timeout: 180000 }),
    };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}` };
  }
}

function verifyApk(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const sign = dockerTool(`${BT}/apksigner`, ['verify', '--verbose', '--print-certs', `/in/${base}`], [`${dir}:/in:ro`]);
  const badging = dockerTool(`${BT}/aapt2`, ['dump', 'badging', `/in/${base}`], [`${dir}:/in:ro`]);
  const text = `${sign.out}\n${badging.out}`;
  const pkg = badging.out.match(/package: name='([^']+)'/);
  const versionCode = badging.out.match(/versionCode='([^']+)'/);
  const versionName = badging.out.match(/versionName='([^']+)'/);
  const dn = sign.out.match(/certificate DN: (.+)/);
  const cert = sign.out.match(/certificate SHA-256 digest: ([a-f0-9]+)/i);
  const v2 = /APK Signature Scheme v2\): true/.test(sign.out);
  return {
    ok: sign.code === 0 && /Verifies/.test(sign.out) && v2 && !!pkg,
    package: pkg?.[1] || '',
    versionCode: versionCode?.[1] || '',
    versionName: versionName?.[1] || '',
    signer: dn?.[1]?.trim() || '',
    certSha256: cert?.[1] || '',
    v2,
    detail: text.slice(0, 4000),
  };
}

function verifyAab(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-'));
  execFileSync('unzip', ['-qo', file, 'base/manifest/AndroidManifest.xml', '-d', dir]);
  const manifest = fs.readFileSync(path.join(dir, 'base/manifest/AndroidManifest.xml'));
  const strings = [];
  let cur = '';
  for (const b of manifest) {
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else { if (cur.length >= 2) strings.push(cur); cur = ''; }
  }
  if (cur.length >= 2) strings.push(cur);
  const next = (key) => {
    const i = strings.indexOf(key);
    return i >= 0 ? strings[i + 1] || '' : '';
  };
  const pkg = next('package');
  const versionName = next('versionName');
  const sign = dockerTool('jarsigner', ['-verify', '-certs', '-verbose', `/in/${path.basename(file)}`], [`${path.dirname(file)}:/in:ro`]);
  const signed = sign.code === 0 || sign.code === 4 || /jar verified/i.test(sign.out);
  const dn = sign.out.match(/X\.509,\s*(CN=[^\n]+)/);
  return {
    ok: signed && !!pkg && !pkg.includes(' '),
    package: pkg.includes(' ') ? '' : pkg,
    versionCode: '',
    versionName: /^\d/.test(versionName) ? versionName : '',
    signer: dn?.[1]?.trim() || '',
    certSha256: '',
    v2: false,
    detail: `${sign.out}\npackage=${pkg}\nversionName=${versionName}`.slice(0, 4000),
  };
}

async function buildLogs(token, projectId, buildId) {
  const lines = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await L.api(`/projects/${projectId}/builds/${buildId}/logs?offset=${offset}&limit=1000`, { token });
    const batch = r.body?.logs || [];
    for (const row of batch) lines.push(row.message);
    if (batch.length < 1000) break;
  }
  return lines.join('\n');
}

async function runVariant(spec, token, projectId, variant) {
  const row = { framework: spec.id, variant, status: 'ERROR' };
  const created = await L.api(`/projects/${projectId}/builds`, {
    method: 'POST', token, body: { buildType: variant, autoFix: false },
  });
  row.httpCreate = created.status;
  if (!created.body?.id) {
    row.error = redact(JSON.stringify(created.body)).slice(0, 500);
    L.check(`${spec.id} ${variant} job accepted`, false, `HTTP ${created.status} ${row.error}`);
    REPORT.push(row);
    return row;
  }
  row.buildId = created.body.id;
  const done = await L.waitBuild(token, projectId, row.buildId);
  row.status = done.status;
  row.runtime = done.runtime || '';
  const logs = await buildLogs(token, projectId, row.buildId);
  writeText(`logs/${spec.id}-${variant}.log`, logs);
  const detected = logs.match(/Framework\s+:\s+(\S+)/);
  const language = logs.match(/Native language\s+:\s+(\S+)/);
  const limits = logs.match(/Limits:.*$/m);
  row.detected = detected?.[1] || '';
  row.language = language?.[1] || '';
  row.limits = limits?.[0] || '';
  row.signingNote = (logs.match(/Signed .*|Artifact already carries the project signature.*/g) || []).join(' | ');
  L.check(`${spec.id} ${variant} compiled in Docker`, done.status === 'SUCCESS' && /docker/i.test(String(done.runtime || logs)),
    `${done.status} runtime=${done.runtime || '?'} ${done.errorMessage || ''}`);
  if (spec.expect.framework) {
    L.check(`${spec.id} ${variant} detected ${spec.expect.framework}`, row.detected === spec.expect.framework, row.detected || 'no framework line');
  }
  if (spec.expect.language) {
    L.check(`${spec.id} ${variant} language ${spec.expect.language}`, row.language.toUpperCase() === String(spec.expect.language).toUpperCase(), row.language || 'no language line');
  }
  if (done.status !== 'SUCCESS') {
    row.error = done.errorMessage || '';
    REPORT.push(row);
    return row;
  }
  const detail = (await L.api(`/projects/${projectId}/builds/${row.buildId}`, { token })).body;
  const artifact = (detail.artifacts || []).find((a) => a.recommended) || (detail.artifacts || [])[0];
  L.check(`${spec.id} ${variant} artifact stored`, !!artifact && artifact.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(artifact?.sha256 || ''), artifact?.fileName || 'none');
  if (!artifact) { REPORT.push(row); return row; }
  const dlPath = `/projects/${projectId}/builds/${row.buildId}/artifacts/${artifact.id}/download`;
  const own = await L.api(dlPath, { token, raw: true });
  const bytes = Buffer.from(await own.arrayBuffer());
  const fileHash = L.sha256(bytes);
  const header = own.headers.get('x-artifact-sha256') || '';
  row.fileName = artifact.fileName;
  row.bytes = bytes.length;
  row.sha256 = artifact.sha256;
  row.downloadSha256 = fileHash;
  row.headerSha256 = header;
  L.check(`${spec.id} ${variant} download matches stored SHA-256`,
    own.status === 200 && bytes.length === artifact.sizeBytes && fileHash === artifact.sha256 && header === artifact.sha256,
    `HTTP ${own.status} bytes ${bytes.length}/${artifact.sizeBytes} header ${header.slice(0, 12)}`);
  const file = path.join(L.OUT, `${spec.id}-${variant}${path.extname(artifact.fileName) || ''}`);
  fs.writeFileSync(file, bytes);
  let meta;
  try {
    meta = artifact.fileName.endsWith('.aab') ? verifyAab(file) : verifyApk(file);
  } catch (err) {
    meta = { ok: false, package: '', versionCode: '', versionName: '', signer: '', certSha256: '', v2: false, detail: err.message };
  }
  writeText(`verify/${spec.id}-${variant}.txt`, meta.detail);
  row.package = meta.package;
  row.versionCode = meta.versionCode;
  row.versionName = meta.versionName;
  row.signer = meta.signer;
  row.certSha256 = meta.certSha256;
  row.v2 = meta.v2;
  const debugKey = /CN=Android Debug/.test(meta.signer);
  row.productionSignature = /CN=APK Factory/.test(meta.signer);
  row.signatureLabel = row.productionSignature
    ? 'factory upload key'
    : debugKey ? 'Android debug key — not a production signature' : (meta.signer || 'unverified');
  L.check(`${spec.id} ${variant} package ${spec.expect.package || '(any)'}`,
    meta.ok && (!spec.expect.package || meta.package === spec.expect.package),
    `pkg=${meta.package || '?'} signer=${meta.signer || '?'} v2=${meta.v2}`);
  if (spec.expect.versionName) {
    L.check(`${spec.id} ${variant} versionName ${spec.expect.versionName}`, meta.versionName === spec.expect.versionName, meta.versionName || 'missing');
  }
  if (variant === 'DEBUG') {
    L.check(`${spec.id} DEBUG is the Android debug key, not the factory key`, debugKey, meta.signer || 'no signer');
  } else {
    L.check(`${spec.id} ${variant} signature verified`, meta.ok && !!meta.signer, meta.signer || meta.detail.slice(0, 180));
  }
  REPORT.push(row);
  return { ...row, dlPath, token };
}

async function main() {
  fs.mkdirSync(path.join(L.OUT, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(L.OUT, 'verify'), { recursive: true });
  const junk = path.join(L.OUT, 'not-a-zip.zip');
  fs.writeFileSync(junk, 'this is not a zip');
  const user = await L.register('fw-reject');
  const rejected = await L.upload(user.token, junk, 'not-zip');
  L.check('a non-zip upload is rejected', rejected.status === 400, `HTTP ${rejected.status}`);

  let isolationDone = false;
  let requeueDone = false;
  for (const id of WANT) {
    const spec = { id, ...PROJECTS[id] };
    if (!PROJECTS[id]) {
      L.check(`known framework ${id}`, false, 'not in the certification set');
      continue;
    }
    const owner = await L.register(`fw-${id.replace(/[^a-z0-9]+/gi, '')}`);
    let projectId;
    try {
      const dest = path.join(L.OUT, `src-${id}.zip`);
      await spec.zip(dest);
      const up = await L.upload(owner.token, dest, id);
      L.check(`${id} upload accepted`, up.status === 201 || up.status === 200, `HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 180)}`);
      projectId = up.body?.id;
    } catch (err) {
      L.check(`${id} project prepared and uploaded`, false, err.message);
      continue;
    }
    if (!projectId) continue;
    let debugFailed = false;
    for (const variant of VARIANTS) {
      if (debugFailed) {
        REPORT.push({ framework: id, variant, status: 'SKIPPED', error: 'debug build failed' });
        continue;
      }
      const row = await runVariant(spec, owner.token, projectId, variant);
      if (variant === 'DEBUG' && row.status !== 'SUCCESS') debugFailed = true;
      if (row.status === 'SUCCESS' && row.dlPath && !isolationDone) {
        isolationDone = true;
        const other = await L.register('fw-intruder');
        const stolen = await L.api(row.dlPath, { token: other.token, raw: true });
        L.check('another account cannot download the artifact', stolen.status === 404 || stolen.status === 403, `HTTP ${stolen.status}`);
        const anon = await L.api(row.dlPath, { raw: true });
        L.check('anonymous download is refused', anon.status === 401, `HTTP ${anon.status}`);
      }
      if (row.status === 'SUCCESS' && !requeueDone && variant === 'DEBUG') {
        requeueDone = true;
        const again = await L.api(`/projects/${projectId}/builds`, {
          method: 'POST', token: owner.token, body: { buildType: 'DEBUG', autoFix: false },
        });
        const second = again.body?.id;
        L.check(`${id} second POST creates a distinct build`, again.status < 300 && second && second !== row.buildId, `HTTP ${again.status}`);
        if (second) {
          const cancel = await L.api(`/projects/${projectId}/builds/${second}/cancel`, { method: 'POST', token: owner.token });
          L.check(`${id} duplicate build can be cancelled`, cancel.status < 300, `HTTP ${cancel.status}`);
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sha: process.env.GITHUB_SHA || '',
    run: process.env.GITHUB_RUN_ID || '',
    frameworks: WANT,
    variants: VARIANTS,
    results: REPORT,
  };
  writeText('frameworks-report.json', JSON.stringify(report, null, 2));
  const lines = REPORT.map((r) => `${r.status}\t${r.framework}\t${r.variant}\t${r.package || ''}\t${r.versionName || ''}\t${r.signatureLabel || ''}\t${r.sha256 || ''}`);
  writeText('frameworks-report.txt', lines.join('\n') + '\n');
  L.finish('frameworks');
}

main().catch((err) => {
  console.error(redact(err.stack || err.message));
  process.exit(1);
});
