/**
 * Stage 6 — OUTPUT
 * Locate the built APK/AAB, validate its size, copy it to the
 * permanent storage directory, then clean up the build workspace.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';
import { DockerRunner } from '../../docker-runner';
import { SANDBOX } from '../../security/sandbox-config';

const runner = new DockerRunner();

// Known output paths for common Gradle tasks
const APK_CANDIDATES = [
  'app/build/outputs/apk/debug/app-debug.apk',
  'app/build/outputs/apk/release/app-release.apk',
  'app/build/outputs/apk/release/app-release-unsigned.apk',
  'app/build/outputs/bundle/release/app-release.aab',
  'build/outputs/apk/debug/app-debug.apk',
  'build/outputs/apk/release/app-release.apk',
];

export async function stageOutput(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 6/6: OUTPUT ──────────────────────────────');

  // ── 1. Locate APK ─────────────────────────────────────────────────────────
  let apkPath: string | null = null;

  for (const rel of APK_CANDIDATES) {
    const full = path.join(ctx.projectRoot, rel);
    try {
      await fs.access(full);
      apkPath = full;
      break;
    } catch {}
  }

  // Glob fallback
  if (!apkPath) {
    apkPath = await runner.findApkInWorkspace(ctx.projectRoot);
  }

  if (!apkPath) {
    await ctx.log('error', 'Build claimed success but no APK/AAB found');
    return { ok: false, fatal: true, error: 'APK not found after successful build' };
  }

  await ctx.log('info', `APK found: ${path.relative(ctx.projectRoot, apkPath)}`);

  // ── 2. Validate APK size ──────────────────────────────────────────────────
  const stat = await fs.stat(apkPath);
  const apkSize = stat.size;

  if (apkSize === 0) {
    return { ok: false, fatal: true, error: 'APK file is empty (0 bytes)' };
  }

  if (apkSize > SANDBOX.APK_MAX_SIZE_BYTES) {
    await ctx.log('warn', `APK is large: ${(apkSize / 1024 / 1024).toFixed(1)}MB`);
  }

  await ctx.log('info', `APK size: ${(apkSize / 1024 / 1024).toFixed(2)} MB`);

  // ── 3. Upload artifact via API ───────────────────────────────────────────
  await ctx.log('info', `Uploading APK...`);
  try {
    const uploadResult = await ctx.uploadApk(apkPath);
    ctx.apkUrl = uploadResult.apkUrl;
    ctx.apkSize = apkSize;
    await ctx.log('info', `✓ APK uploaded successfully (${(apkSize / 1024 / 1024).toFixed(2)} MB)`);
  } catch (err: any) {
    await ctx.log('error', `Failed to upload APK: ${err.message}`);
    return { ok: false, fatal: true, error: `APK upload failed: ${err.message}` };
  }

  // ── 4. Cleanup workspace ──────────────────────────────────────────────────
  await ctx.log('info', 'Cleaning up workspace...');
  await cleanupWorkspace(ctx);

  return { ok: true };
}

async function cleanupWorkspace(ctx: PipelineContext): Promise<void> {
  // Remove build output dirs (large) but keep source for potential re-builds
  const dirsToClean = [
    path.join(ctx.projectRoot, 'app', 'build'),
    path.join(ctx.projectRoot, 'build'),
    path.join(ctx.projectRoot, '.gradle'),
  ];

  for (const dir of dirsToClean) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }

  // If workspace is separate from the original project path, clean it
  if (ctx.workspaceDir && ctx.workspaceDir !== ctx.sourceRepoPath) {
    try {
      // Keep the source dir for AI fix re-attempts, only remove build artifacts
      // Full workspace cleanup happens after the job completes entirely
    } catch {}
  }
}
