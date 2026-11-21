import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext } from './types';

/** Select only Gradle / Flutter outputs matching the requested task, never source APKs. */
export async function findBuildArtifact(
  projectRoot: string,
  buildType: PipelineContext['buildType'],
): Promise<string | null> {
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.gradle'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && matchesRequestedOutput(path.relative(projectRoot, full).split(path.sep), entry.name, buildType)) {
        matches.push(full);
      }
    }
  }

  await walk(projectRoot);
  matches.sort();
  if (matches.length > 1) {
    throw new Error(`Multiple ${buildType} artifacts found; cannot choose safely: ${matches.map((file) => path.relative(projectRoot, file)).join(', ')}`);
  }
  return matches[0] ?? null;
}

function matchesRequestedOutput(
  relative: string[],
  fileName: string,
  buildType: PipelineContext['buildType'],
): boolean {
  const wantAab = buildType === 'AAB';
  const variant = buildType === 'DEBUG' ? 'debug' : 'release';
  if (wantAab ? !fileName.endsWith('.aab') : !fileName.endsWith('.apk')) return false;
  const located = locateOutput(relative);
  if (!located) return false;
  if (wantAab) {
    return located.kind === 'bundle' && located.variants.some((part) => part.toLowerCase().endsWith('release'));
  }
  if (located.kind === 'apk') {
    return located.variants.some((part) => part.toLowerCase().endsWith(variant));
  }
  return fileName.toLowerCase().includes(`-${variant}`);
}

function locateOutput(relative: string[]): { kind: string; variants: string[]; buildIndex: number } | null {
  const idx = relative.findIndex((part, i) =>
    part === 'outputs'
    && (relative[i + 1] === 'apk' || relative[i + 1] === 'bundle' || relative[i + 1] === 'flutter-apk')
    && relative.slice(0, i).includes('build'),
  );
  if (idx < 0) return null;
  const buildIndex = relative.lastIndexOf('build', idx);
  return {
    kind: relative[idx + 1],
    variants: relative.slice(idx + 2, -1),
    buildIndex,
  };
}

// ── Debug APK discovery with variants (V1) ─────────────────────────────────

export interface BuiltArtifact {
  file: string;          // absolute path
  fileName: string;
  module: string;        // gradle module directory ('app', 'mobile', …)
  variant: string;       // e.g. 'debug', 'freeDebug'
  abi: string;           // 'universal' unless the file name carries an ABI split
  recommended: boolean;
  reason: string;
}

const ABI_RE = /(arm64-v8a|armeabi-v7a|x86_64|x86|universal)/;

/**
 * Lists every installable debug APK produced by `assembleDebug` and flags the
 * one to offer first. Test APKs (androidTest) and symlinks are never returned.
 * Preference: module "app" > other modules; universal APK > arm64-v8a (the ABI
 * of current Samsung Galaxy A-series phones) > other splits.
 */
export async function listBuildArtifacts(projectRoot: string): Promise<BuiltArtifact[]> {
  const found: BuiltArtifact[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.gradle'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.apk')) {
        const rel = path.relative(projectRoot, full).split(path.sep);
        const located = locateOutput(rel);
        if (!located || (located.kind !== 'apk' && located.kind !== 'flutter-apk')) continue;
        if (located.kind === 'apk') {
          if (located.variants.length === 0 || located.variants.some((p) => /androidTest/i.test(p))) continue;
          if (!located.variants[located.variants.length - 1].toLowerCase().endsWith('debug')) continue;
        } else if (!entry.name.toLowerCase().includes('-debug')) {
          continue;
        }
        const variant = located.kind === 'flutter-apk'
          ? 'debug'
          : located.variants
            .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
            .join('');
        const module = located.kind === 'flutter-apk'
          ? 'app'
          : (rel.slice(0, located.buildIndex).join('/') || '.');
        found.push({
          file: full,
          fileName: entry.name,
          module,
          variant,
          abi: (entry.name.match(ABI_RE) || [, 'universal'])[1] as string,
          recommended: false,
          reason: '',
        });
      }
    }
  }
  await walk(projectRoot);

  const score = (a: BuiltArtifact) =>
    (a.module === 'app' ? 100 : 0) + (a.abi === 'universal' ? 50 : a.abi === 'arm64-v8a' ? 40 : 0) -
    (a.variant.length > 5 ? 1 : 0);
  found.sort((a, b) => score(b) - score(a) || a.file.localeCompare(b.file));
  if (found[0]) {
    found[0].recommended = true;
    found[0].reason = found.length === 1
      ? 'only debug APK produced'
      : `module ${found[0].module}, ${found[0].abi} build`;
  }
  return found;
}
