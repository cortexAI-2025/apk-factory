import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
const run = promisify(execFile);

/** Trusted Android SDK executable only; never execute a tool from an import. */
export async function verifyApk(file: string): Promise<void> {
  const tool = process.env.APKSIGNER_PATH;
  if (!tool || !path.isAbsolute(tool)) throw new Error('Configure absolute APKSIGNER_PATH');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error('Invalid APK');
  await run(tool, ['verify', '--verbose', file], {
    timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, JAVA_HOME: process.env.JAVA_HOME, LANG: 'C' },
  });
}
