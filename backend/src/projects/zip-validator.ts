import * as yauzl from 'yauzl';
import { BadRequestException } from '@nestjs/common';

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;   // total uncompressed
  maxFileBytes: number;    // single uncompressed file
  maxRatio: number;        // uncompressed / compressed for big entries
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotalBytes: parseInt(process.env.ZIP_MAX_EXTRACTED_MB || '1024', 10) * 1024 * 1024,
  maxFileBytes: parseInt(process.env.ZIP_MAX_FILE_MB || '256', 10) * 1024 * 1024,
  maxRatio: 100,
};

export interface ZipInspection {
  /** Directory prefix inside the archive holding the Gradle project ('' = archive root). */
  rootPrefix: string;
  entries: number;
  totalBytes: number;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EMPTY_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

function fail(message: string): never {
  throw new BadRequestException(message);
}

/** Reads only the central directory: nothing is extracted yet. */
function readEntries(zipPath: string): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err || new Error('cannot open archive'));
      const out: yauzl.Entry[] = [];
      zip.on('entry', (entry) => {
        out.push(entry);
        // stop early: the caller rejects when the entry count is exceeded
        if (out.length > DEFAULT_ZIP_LIMITS.maxEntries + 1) {
          zip.close();
          return resolve(out);
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/**
 * Validates an uploaded archive BEFORE extraction:
 *  - real ZIP signature, not encrypted, bounded entry count / sizes / ratio
 *  - no absolute or parent-escaping paths, no symbolic links
 *  - contains exactly one native Android Gradle project with its wrapper, at the
 *    archive root or up to three folders down
 */
export async function inspectZip(
  zipPath: string,
  head: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Promise<ZipInspection> {
  if (!head.subarray(0, 4).equals(ZIP_MAGIC) && !head.subarray(0, 4).equals(EMPTY_ZIP_MAGIC)) {
    fail('The uploaded file is not a valid ZIP archive.');
  }

  let entries: yauzl.Entry[];
  try {
    entries = await readEntries(zipPath);
  } catch (err: any) {
    if (/invalid relative path/i.test(err.message)) fail(`Path escapes the extraction folder: ${String(err.message).slice(-80)}`);
    if (/absolute path/i.test(err.message)) fail(`Absolute path in archive: ${String(err.message).slice(-80)}`);
    fail(`The ZIP archive is corrupted or unsupported (${String(err.message).slice(0, 120)}).`);
  }
  if (entries.length === 0) fail('The ZIP archive is empty.');
  if (entries.length > limits.maxEntries) {
    fail(`The ZIP archive has too many entries (limit ${limits.maxEntries}).`);
  }

  let total = 0;
  const files = new Set<string>();
  for (const e of entries) {
    const name = e.fileName;
    if (name.includes('\0') || name.includes('\\')) fail(`Illegal path in archive: ${JSON.stringify(name).slice(0, 80)}`);
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail(`Absolute path in archive: ${name.slice(0, 80)}`);
    if (name.split('/').some((p) => p === '..')) fail(`Path escapes the extraction folder: ${name.slice(0, 80)}`);
    if (name.length > 400) fail('A path in the archive is too long.');
    if (e.isEncrypted()) fail('Encrypted ZIP archives are not supported.');

    // Unix mode lives in the high 16 bits of the external attributes when made on Unix
    const madeByUnix = (e.versionMadeBy >> 8) === 3;
    const mode = e.externalFileAttributes >>> 16;
    const type = mode & 0o170000;
    if (madeByUnix && type === 0o120000) fail(`Symbolic links are not allowed in archives: ${name.slice(0, 80)}`);
    if (madeByUnix && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      fail(`Special file type not allowed in archive: ${name.slice(0, 80)}`);
    }

    if (e.uncompressedSize > limits.maxFileBytes) {
      fail(`File too large in archive (${name.slice(0, 60)}): limit ${Math.round(limits.maxFileBytes / 1048576)} MB per file.`);
    }
    if (e.uncompressedSize > 1_048_576 && e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > limits.maxRatio) {
      fail(`Suspicious compression ratio (${name.slice(0, 60)}): archive rejected.`);
    }
    total += e.uncompressedSize;
    if (total > limits.maxTotalBytes) {
      fail(`The archive expands to more than ${Math.round(limits.maxTotalBytes / 1048576)} MB.`);
    }
    if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) files.add(name);
  }

  // ── locate the Gradle project: archive root, or up to three folders down ──
  // (a GitHub "Download ZIP" wraps the repository in one folder, and monorepos keep the
  //  Android project in a sub-folder, e.g. repo-main/android/)
  const prefixes = new Set<string>(['']);
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i <= 3 && i < parts.length; i++) prefixes.add(parts.slice(0, i).join('/') + '/');
  }
  const has = (p: string, rel: string) => files.has(p + rel);
  const wrapperFiles = ['gradlew', 'gradle/wrapper/gradle-wrapper.properties', 'gradle/wrapper/gradle-wrapper.jar'];
  const candidates = [...prefixes].filter(
    (p) => wrapperFiles.every((w) => has(p, w)) &&
      (has(p, 'settings.gradle') || has(p, 'settings.gradle.kts') || has(p, 'build.gradle') || has(p, 'build.gradle.kts')),
  );

  if (candidates.length === 0) {
    const anyGradle = [...files].some((f) => /(^|\/)(build|settings)\.gradle(\.kts)?$/.test(f));
    if (!anyGradle) fail('No Gradle project found: the ZIP must contain build.gradle / settings.gradle.');
    fail(
      'The Gradle wrapper is missing. Include gradlew, gradle/wrapper/gradle-wrapper.properties and ' +
      'gradle/wrapper/gradle-wrapper.jar at the project root (or inside a sub-folder).',
    );
  }
  if (candidates.length > 1) {
    fail(`Several Android Gradle projects found in the archive (${candidates.map((c) => c || '.').slice(0, 5).join(', ')}); upload a ZIP with a single project.`);
  }
  const root = candidates[0];
  if (![...files].some((f) => f.startsWith(root) && f.endsWith('AndroidManifest.xml'))) {
    fail('No AndroidManifest.xml found: this does not look like a native Android project.');
  }

  return { rootPrefix: root, entries: entries.length, totalBytes: total };
}
