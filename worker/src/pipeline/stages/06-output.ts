/**
 * Stage 6 — OUTPUT
 * Locate the built APK/AAB, validate its size, copy it to the
 * permanent storage directory, then clean up the build workspace.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';
import { findBuildArtifact } from '../artifacts';
import { SANDBOX } from '../../security/sandbox-config';

export async function stageOutput(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 6/6: OUTPUT ──────────────────────────────');

  // Select the output for this build type; fail rather than upload a different variant.
  let apkPath: string | null;
  try {
    apkPath = await findBuildArtifact(ctx.projectRoot, ctx.buildType);
  } catch (err: any) {
    return { ok: false, fatal: true, error: err.message };
  }

  if (!apkPath) {
    return { ok: false, fatal: true, error: `${ctx.buildType} artifact not found after successful build` };
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
  // Every build now owns an isolated workspace; delete it after upload.
  // The guard preserves compatibility with callers using the original source.
  if (ctx.workspaceDir && ctx.workspaceDir !== ctx.sourceRepoPath) {
    await fs.rm(ctx.workspaceDir, { recursive: true, force: true }).catch(async (err) => {
      await ctx.log('warn', `Workspace cleanup failed: ${err.message}`);
    });
  }
}
