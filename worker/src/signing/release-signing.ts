/**
 * Release / AAB signing, outside the build sandbox.
 *
 * Gradle runs with no factory keystore and no signing init-script. After the
 * sandbox exits, an unsigned APK is signed with apksigner and an unsigned AAB
 * with jarsigner. An artifact the project already signed with its own key is
 * left as-is, so one build cannot read or replace another app's identity.
 *
 * The upload key lives only in APK_FACTORY_KEY_DIR (a persistent volume in
 * Compose). It is never copied into the project tree.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface SigningMaterial {
  file: string;
  alias: string;
  storePass: string;
  keyPass: string;
  source: 'env' | 'generated';
  storePassFile: string;
  keyPassFile: string;
}

export interface SignResult {
  action: 'signed' | 'kept-project-signature';
  source: 'env' | 'generated';
}

export function defaultKeyDir(): string {
  return process.env.APK_FACTORY_KEY_DIR
    || path.join(os.homedir(), '.apk-factory');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-c', `command -v ${JSON.stringify(cmd)} >/dev/null`]);
    return true;
  } catch {
    return false;
  }
}

async function writeSecret(file: string, value: string): Promise<void> {
  await fs.writeFile(file, value, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

async function generatedMaterial(dir: string): Promise<SigningMaterial> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const file = path.join(dir, 'upload.jks');
  const credPath = path.join(dir, 'upload-keystore.json');
  const storePassFile = path.join(dir, 'store.pass');
  const keyPassFile = path.join(dir, 'key.pass');

  if (await exists(file) && await exists(credPath)) {
    const cred = JSON.parse(await fs.readFile(credPath, 'utf8')) as { alias: string; storePass: string; keyPass?: string };
    const keyPass = cred.keyPass || cred.storePass;
    await writeSecret(storePassFile, cred.storePass);
    await writeSecret(keyPassFile, keyPass);
    return { file, alias: cred.alias, storePass: cred.storePass, keyPass, source: 'generated', storePassFile, keyPassFile };
  }

  if (!(await commandExists('keytool'))) {
    throw new Error('keytool is not installed in the worker. Install a JDK (openjdk-17-jdk-headless) or set KEYSTORE_PATH to an existing keystore.');
  }

  const storePass = crypto.randomBytes(18).toString('hex');
  const alias = 'apk-factory';
  await execFileAsync('keytool', [
    '-genkeypair', '-keystore', file,
    '-storetype', 'PKCS12',
    '-alias', alias,
    '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000',
    '-storepass', storePass,
    '-keypass', storePass,
    '-dname', 'CN=APK Factory, O=Aiworkpay, C=FR',
  ]);
  await fs.chmod(file, 0o600);
  await fs.writeFile(credPath, JSON.stringify({ alias, storePass, keyPass: storePass }), { mode: 0o600 });
  await fs.chmod(credPath, 0o600);
  await writeSecret(storePassFile, storePass);
  await writeSecret(keyPassFile, storePass);
  return { file, alias, storePass, keyPass: storePass, source: 'generated', storePassFile, keyPassFile };
}

export async function ensureSigningMaterial(): Promise<SigningMaterial> {
  const customPath = process.env.KEYSTORE_PATH || '';
  const customPass = process.env.KEYSTORE_PASSWORD || '';
  if (customPath && customPass && await exists(customPath)) {
    const dir = defaultKeyDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const keyPass = process.env.KEY_PASSWORD || customPass;
    const storePassFile = path.join(dir, 'external-store.pass');
    const keyPassFile = path.join(dir, 'external-key.pass');
    await writeSecret(storePassFile, customPass);
    await writeSecret(keyPassFile, keyPass);
    return {
      file: path.resolve(customPath),
      alias: process.env.KEYSTORE_ALIAS || 'apk-factory',
      storePass: customPass,
      keyPass,
      source: 'env',
      storePassFile,
      keyPassFile,
    };
  }
  return generatedMaterial(defaultKeyDir());
}

async function androidHomes(): Promise<string[]> {
  const found = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/android-sdk',
  ].filter((v): v is string => Boolean(v));
  return [...new Set(found)];
}

export async function findApksigner(): Promise<string | null> {
  if (process.env.APKSIGNER && await exists(process.env.APKSIGNER)) return process.env.APKSIGNER;
  for (const home of await androidHomes()) {
    const dir = path.join(home, 'build-tools');
    let versions: string[] = [];
    try {
      versions = await fs.readdir(dir);
    } catch {
      continue;
    }
    versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = versions.length - 1; i >= 0; i--) {
      const candidate = path.join(dir, versions[i], 'apksigner');
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

async function apkAlreadySigned(apk: string, apksigner: string): Promise<boolean> {
  try {
    await execFileAsync(apksigner, ['verify', apk]);
    return true;
  } catch {
    return false;
  }
}

async function aabAlreadySigned(aab: string): Promise<boolean> {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    const result = await execFileAsync('jarsigner', ['-verify', '-strict', aab], { encoding: 'utf8' });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (err: any) {
    code = typeof err.code === 'number' ? err.code : 1;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }
  const text = `${stdout}\n${stderr}`;
  if (code === 16 || /jar is unsigned/i.test(text) || /no manifest/i.test(text)) return false;
  return code === 0 || /jar verified/i.test(text);
}

async function signApkLocal(apksigner: string, apk: string, material: SigningMaterial): Promise<void> {
  const dir = path.dirname(apk);
  const signed = path.join(dir, `.signed-${path.basename(apk)}`);
  await execFileAsync(apksigner, [
    'sign',
    '--ks', material.file,
    '--ks-key-alias', material.alias,
    '--ks-pass', `file:${material.storePassFile}`,
    '--key-pass', `file:${material.keyPassFile}`,
    '--out', signed,
    apk,
  ]);
  await fs.rename(signed, apk);
  const idsig = `${signed}.idsig`;
  await fs.rm(idsig, { force: true });
}

async function signAabLocal(aab: string, material: SigningMaterial): Promise<void> {
  if (!(await commandExists('jarsigner'))) {
    throw new Error('jarsigner is not installed in the worker. Install openjdk-17-jdk-headless.');
  }
  const dir = path.dirname(aab);
  const tmp = path.join(dir, `.signing-${path.basename(aab)}`);
  await fs.copyFile(aab, tmp);
  await execFileAsync('jarsigner', [
    '-sigalg', 'SHA256withRSA',
    '-digestalg', 'SHA-256',
    '-keystore', material.file,
    '-storepass:file', material.storePassFile,
    '-keypass:file', material.keyPassFile,
    tmp,
    material.alias,
  ]);
  await fs.rename(tmp, aab);
}

export async function signReleaseArtifact(artifactPath: string, material?: SigningMaterial): Promise<SignResult> {
  const resolved = await (material ? Promise.resolve(material) : ensureSigningMaterial());
  const ext = path.extname(artifactPath).toLowerCase();
  if (ext === '.apk') {
    const apksigner = await findApksigner();
    if (!apksigner) {
      throw new Error('apksigner not found. Set ANDROID_HOME to an SDK with build-tools, or APKSIGNER to the binary.');
    }
    if (await apkAlreadySigned(artifactPath, apksigner)) {
      return { action: 'kept-project-signature', source: resolved.source };
    }
    await signApkLocal(apksigner, artifactPath, resolved);
    return { action: 'signed', source: resolved.source };
  }
  if (ext === '.aab') {
    if (!(await commandExists('jarsigner'))) {
      throw new Error('jarsigner is not installed in the worker. Install openjdk-17-jdk-headless.');
    }
    if (await aabAlreadySigned(artifactPath)) {
      return { action: 'kept-project-signature', source: resolved.source };
    }
    await signAabLocal(artifactPath, resolved);
    return { action: 'signed', source: resolved.source };
  }
  throw new Error(`Cannot sign ${ext || 'file'} — expected .apk or .aab`);
}
