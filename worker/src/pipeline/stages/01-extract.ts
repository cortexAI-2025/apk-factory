/**
 * Stage 1 — EXTRACT
 * Unzip the project archive into an isolated workspace directory.
 * Guards against zip-bomb, path-traversal and oversized files.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import extractZip from 'extract-zip';
import { PipelineContext, StageResult } from '../types';
import { FileScanner } from '../../security/file-scanner';
import { SANDBOX, STAGE_TIMEOUTS } from '../../security/sandbox-config';
import { v4 as uuidv4 } from 'uuid';

const scanner = new FileScanner();

export async function stageExtract(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 1/6: EXTRACT ─────────────────────────────');

  // If source is already a directory (GitHub clone), skip extraction
  if (ctx.sourceRepoPath) {
    await ctx.log('info', `Source is a cloned repo: ${ctx.sourceRepoPath}`);
    ctx.workspaceDir = ctx.sourceRepoPath;
    ctx.projectRoot = ctx.sourceRepoPath;
    return { ok: true };
  }

  if (!ctx.sourceZipPath) {
    return { ok: false, fatal: true, error: 'No source provided (no ZIP, no repo path)' };
  }

  // ── 1. ZIP bomb check ─────────────────────────────────────────────────────
  await ctx.log('info', `Checking archive safety: ${path.basename(ctx.sourceZipPath)}`);
  const bombCheck = await scanner.checkZipBomb(ctx.sourceZipPath);
  if (!bombCheck.safe) {
    await ctx.log('error', `Archive rejected: ${bombCheck.reason}`);
    return { ok: false, fatal: true, error: bombCheck.reason };
  }
  await ctx.log('info', 'Archive bomb check: PASS');

  // ── 2. Create isolated workspace ──────────────────────────────────────────
  const workspaceBase = SANDBOX.WORKSPACE_DIR;
  await fs.mkdir(workspaceBase, { recursive: true });
  const workspaceDir = path.join(workspaceBase, `${ctx.buildId}`);
  await fs.mkdir(workspaceDir, { recursive: true });
  ctx.workspaceDir = workspaceDir;

  await ctx.log('info', `Workspace: ${workspaceDir}`);

  // ── 3. Extract with path-traversal guard ─────────────────────────────────
  let totalExtractedBytes = 0;

  await ctx.log('info', 'Extracting archive...');

  try {
    await withTimeout(
      extractZip(ctx.sourceZipPath, {
        dir: workspaceDir,
        // onEntry callback to guard individual entries
        onEntry: (entry) => {
          // Guard path traversal
          const safe = path.resolve(workspaceDir, entry.fileName);
          if (!safe.startsWith(workspaceDir + path.sep) && safe !== workspaceDir) {
            throw new Error(`Path traversal attempt: ${entry.fileName}`);
          }

          // Accumulate uncompressed size
          totalExtractedBytes += entry.uncompressedSize || 0;
          if (totalExtractedBytes > SANDBOX.MAX_EXTRACTED_BYTES) {
            throw new Error(
              `Extraction aborted: total size ${(totalExtractedBytes / 1024 / 1024 / 1024).toFixed(2)}GB exceeds limit`,
            );
          }
        },
      }),
      STAGE_TIMEOUTS.EXTRACT,
      'Extraction timed out',
    );
  } catch (err: any) {
    await ctx.log('error', `Extraction failed: ${err.message}`);
    await cleanup(workspaceDir);
    return { ok: false, fatal: true, error: `Extraction failed: ${err.message}` };
  }

  await ctx.log('info', `Extracted ${(totalExtractedBytes / 1024 / 1024).toFixed(1)}MB`);

  // ── 4. Find actual project root (handle nested structures) ────────────────
  const projectRoot = await findProjectRoot(workspaceDir);
  ctx.projectRoot = projectRoot;
  await ctx.log('info', `Project root: ${path.relative(workspaceDir, projectRoot) || '.'}`);

  return { ok: true };
}

async function findProjectRoot(dir: string): Promise<string> {
  // Check current dir
  for (const f of ['build.gradle', 'build.gradle.kts', 'pubspec.yaml']) {
    try {
      await fs.access(path.join(dir, f));
      return dir;
    } catch {}
  }

  // Check one level deeper
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const subdirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(dir, e.name));

  for (const sub of subdirs) {
    for (const f of ['build.gradle', 'build.gradle.kts', 'pubspec.yaml']) {
      try {
        await fs.access(path.join(sub, f));
        return sub;
      } catch {}
    }
  }

  return dir;
}

async function cleanup(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
