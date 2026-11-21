/**
 * Release / AAB signing.
 *
 * Writes a Gradle init script + keystore into the build workspace so both the
 * local runtime and the Docker sandbox (workdir /workspace) can sign
 * assembleRelease and bundleRelease. A user keystore (KEYSTORE_*) wins;
 * otherwise a stable upload key is generated once under ~/.apk-factory and
 * never committed.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface SigningPrep {
  gradleArgs: string;
  source: 'env' | 'generated';
}

function gstr(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function generatedKeystore(dir: string): Promise<{ file: string; alias: string; storePass: string }> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'upload.jks');
  const credPath = path.join(dir, 'upload-keystore.json');
  if (await exists(file) && await exists(credPath)) {
    const cred = JSON.parse(await fs.readFile(credPath, 'utf8')) as { alias: string; storePass: string };
    return { file, alias: cred.alias, storePass: cred.storePass };
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
  await fs.writeFile(credPath, JSON.stringify({ alias, storePass }), { mode: 0o600 });
  return { file, alias, storePass };
}

export async function prepareReleaseSigning(projectRoot: string): Promise<SigningPrep> {
  const customPath = process.env.KEYSTORE_PATH || '';
  const customPass = process.env.KEYSTORE_PASSWORD || '';
  const useCustom = Boolean(customPath && customPass && await exists(customPath));

  const material = useCustom
    ? {
        file: customPath,
        alias: process.env.KEYSTORE_ALIAS || 'apk-factory',
        storePass: customPass,
        keyPass: process.env.KEY_PASSWORD || customPass,
      }
    : await generatedKeystore(process.env.APK_FACTORY_KEY_DIR || path.join(os.homedir(), '.apk-factory')).then((g) => ({
        ...g,
        keyPass: g.storePass,
      }));

  const destDir = path.join(projectRoot, '.apk-factory');
  await fs.mkdir(destDir, { recursive: true });
  const destKs = path.join(destDir, 'upload.jks');
  await fs.copyFile(material.file, destKs);
  await fs.chmod(destKs, 0o644);

  const script = `
def storePass = ${gstr(material.storePass)}
def keyPass = ${gstr(material.keyPass)}
def keyAliasName = ${gstr(material.alias)}
def applySigning = { proj ->
  proj.pluginManager.withPlugin("com.android.application") {
    proj.android {
      signingConfigs {
        apkFactory {
          storeFile rootProject.file(".apk-factory/upload.jks")
          storePassword storePass
          keyAlias keyAliasName
          keyPassword keyPass
        }
      }
      buildTypes.release.signingConfig = signingConfigs.apkFactory
    }
  }
}
gradle.projectsLoaded {
  applySigning(rootProject)
  rootProject.subprojects { applySigning(it) }
}
`;
  const scriptPath = path.join(destDir, 'signing.init.gradle');
  await fs.writeFile(scriptPath, script, { mode: 0o644 });
  return {
    gradleArgs: '--init-script .apk-factory/signing.init.gradle',
    source: useCustom ? 'env' : 'generated',
  };
}
