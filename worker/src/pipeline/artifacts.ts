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
