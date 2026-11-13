import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext } from './types';

/** Select only Gradle outputs matching the requested task, never source APKs. */
export async function findBuildArtifact(
  projectRoot: string,
  buildType: PipelineContext['buildType'],
): Promise<string | null> {
  const extension = buildType === 'AAB' ? '.aab' : '.apk';
  const outputKind = buildType === 'AAB' ? 'bundle' : 'apk';
  const variant = buildType === 'DEBUG' ? 'debug' : 'release';
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.gradle'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      // Do not follow symbolic links from uploaded projects.
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        const relative = path.relative(projectRoot, full).split(path.sep);
        const outputIndex = relative.findIndex((part, i) =>
          part === 'build' && relative[i + 1] === 'outputs' && relative[i + 2] === outputKind,
        );
        if (outputIndex < 0) continue;
        const variants = relative.slice(outputIndex + 3, -1);
        // Supports debug/release and flavor variants such as freeRelease.
        if (variants.some((part) => part.toLowerCase().endsWith(variant))) matches.push(full);
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
        const buildIdx = rel.findIndex((p, i) => p === 'build' && rel[i + 1] === 'outputs' && rel[i + 2] === 'apk');
        if (buildIdx < 0) continue;
        const variantDirs = rel.slice(buildIdx + 3, -1);
        if (variantDirs.length === 0 || variantDirs.some((p) => /androidTest/i.test(p))) continue;
        if (!variantDirs[variantDirs.length - 1].toLowerCase().endsWith('debug')) continue;
        const variant = variantDirs
          .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
          .join('');
        found.push({
          file: full,
          fileName: entry.name,
          module: rel.slice(0, buildIdx).join('/') || '.',
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
