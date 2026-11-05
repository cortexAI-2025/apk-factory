/**
 * Stage 6 — OUTPUT
 * Locate the built APK/AAB, validate its size, copy it to the
 * permanent storage directory, then clean up the build workspace.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { findBuildArtifact, listBuildArtifacts } from '../artifacts';
import { SANDBOX } from '../../security/sandbox-config';

export async function stageOutput(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 6/6: OUTPUT ──────────────────────────────');

  if (ctx.buildType === 'DEBUG') return stageOutputDebug(ctx);

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

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** V1: every installable debug APK is uploaded with its variant, ABI and SHA-256. */
async function stageOutputDebug(ctx: PipelineContext): Promise<StageResult> {
  const artifacts = await listBuildArtifacts(ctx.projectRoot);
  if (artifacts.length === 0) {
    return { ok: false, fatal: true, error: 'DEBUG artifact not found after successful build' };
  }
  await ctx.log('info', `Found ${artifacts.length} debug APK(s):`);

  let recommendedUrl: string | undefined;
  let recommendedSize = 0;
  for (const a of artifacts) {
    const size = (await fs.stat(a.file)).size;
    if (size === 0) return { ok: false, fatal: true, error: `APK file is empty: ${a.fileName}` };
    if (size > SANDBOX.APK_MAX_SIZE_BYTES) {
      return { ok: false, fatal: true, error: `APK ${a.fileName} exceeds the ${Math.round(SANDBOX.APK_MAX_SIZE_BYTES / 1048576)} MB limit` };
    }
    const digest = await sha256(a.file);
    await ctx.log('info', `  ${a.recommended ? '★' : '·'} ${path.relative(ctx.projectRoot, a.file)} — variant ${a.variant}, ${a.abi}, ${(size / 1048576).toFixed(2)} MB, sha256 ${digest}`);
    try {
      const r = await ctx.uploadApk(a.file, {
        fileName: a.fileName, variant: a.variant, abi: a.abi, module: a.module, recommended: a.recommended, sha256: digest,
      });
      if (a.recommended) { recommendedUrl = r.apkUrl; recommendedSize = size; }
    } catch (err: any) {
      await ctx.log('error', `Failed to upload ${a.fileName}: ${err.message}`);
      return { ok: false, fatal: true, error: `APK upload failed: ${err.message}` };
    }
  }
  ctx.apkUrl = recommendedUrl;
  ctx.apkSize = recommendedSize;
  ctx.artifactCount = artifacts.length;
  await ctx.log('info', `✓ ${artifacts.length} artifact(s) uploaded`);
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
