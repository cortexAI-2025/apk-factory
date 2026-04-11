/**
 * APK Factory — Build Pipeline Orchestrator
 *
 * Full pipeline:
 *   1. EXTRACT  — unzip with bomb/traversal protection
 *   2. DETECT   — project type, SDK/Gradle versions
 *   3. VALIDATE — gradlew, build.gradle, manifest checks
 *   4. SCAN     — security analysis of source code
 *   5. BUILD    — Docker-sandboxed Gradle + AI AutoFix loop
 *   6. OUTPUT   — locate APK, validate, copy to storage
 */
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { logger } from '../logger';
import { PipelineContext } from './types';
import { stageExtract }  from './stages/01-extract';
import { stageDetect }   from './stages/02-detect';
import { stageValidate } from './stages/03-validate';
import { stageScan }     from './stages/04-scan';
import { stageBuild }    from './stages/05-build';
import { stageOutput }   from './stages/06-output';

const API_BASE      = process.env.API_BASE_URL  || 'http://localhost:4000';
const WORKER_SECRET = process.env.WORKER_SECRET || 'worker-secret';

export interface PipelineInput {
  buildId:       string;
  projectId:     string;
  userId:        string;
  sourceZipPath?: string;
  sourceRepoPath?: string;
  buildType:     'DEBUG' | 'RELEASE' | 'AAB';
  autoFix:       boolean;
}

export async function runPipeline(input: PipelineInput, job?: Job): Promise<void> {
  // ── Build shared context ──────────────────────────────────────────────────
  const ctx: PipelineContext = {
    ...input,
    workspaceDir:      '',
    projectRoot:       '',
    gradleCommand:     '',
    hasGradleWrapper:  false,
    scanClean:         true,
    scanThreats:       [],
    autoFixAttempts:   0,
    buildOutput:       '',

    // ── Callbacks into the backend API ──────────────────────────────────────
    log: async (level, message) => {
      logger[level]?.(`[${input.buildId}] ${message}`);
      try {
        await apiPost(`/internal/builds/${input.buildId}/logs`, { level, message });
      } catch {}
    },

    reportFix: async (attempt, description, filesModified, errorSummary, success) => {
      try {
        await apiPost(`/internal/builds/${input.buildId}/fixes`, {
          attempt, description, filesModified, errorSummary, success,
        });
      } catch {}
    },

    updateStatus: async (status, extra = {}) => {
      try {
        await apiPatch(`/internal/builds/${input.buildId}/status`, { status, ...extra });
      } catch {}
    },

    updateProgress: async (percent, phase) => {
      if (job) await job.updateProgress(percent).catch(() => {});
    },
  };

  // ── Run stages sequentially ───────────────────────────────────────────────
  const stages = [
    { name: 'EXTRACTING',  fn: () => stageExtract(ctx) },
    { name: 'DETECTING',   fn: () => stageDetect(ctx) },
    { name: 'VALIDATING',  fn: () => stageValidate(ctx) },
    { name: 'SCANNING',    fn: () => stageScan(ctx) },
    { name: 'BUILDING',    fn: () => stageBuild(ctx, job) },
    { name: 'OUTPUTTING',  fn: () => stageOutput(ctx) },
  ];

  try {
    await ctx.updateStatus('BUILDING');

    for (const stage of stages) {
      logger.info(`[${input.buildId}] Running stage: ${stage.name}`);
      await ctx.updateStatus(
        stage.name === 'BUILDING' ? 'BUILDING' :
        stage.name === 'OUTPUTTING' ? 'BUILDING' : 'BUILDING',
      );

      const result = await stage.fn();

      if (!result.ok) {
        logger.error(`[${input.buildId}] Stage ${stage.name} failed: ${result.error}`);
        await ctx.log('error', `Stage ${stage.name} failed: ${result.error}`);
        await ctx.updateStatus('FAILED', { errorMessage: result.error });
        await cleanupWorkspace(ctx);
        return;
      }
    }

    // ── All stages passed ─────────────────────────────────────────────────
    const apkUrl = ctx.apkHostPath
      ? `${API_BASE}/files/apks/${path.basename(ctx.apkHostPath)}`
      : undefined;

    await ctx.updateStatus('SUCCESS', {
      apkUrl,
      apkSize: ctx.apkSize,
      errorMessage: null,
    });

    await ctx.log('info', `Pipeline complete. APK: ${apkUrl || 'N/A'}`);

  } catch (err: any) {
    logger.error(`[${input.buildId}] Pipeline crashed: ${err.message}`, { stack: err.stack });
    await ctx.updateStatus('FAILED', { errorMessage: `Internal error: ${err.message}` }).catch(() => {});
    await cleanupWorkspace(ctx).catch(() => {});
    throw err;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function cleanupWorkspace(ctx: PipelineContext): Promise<void> {
  if (ctx.workspaceDir && ctx.workspaceDir !== ctx.sourceRepoPath) {
    await fs.rm(ctx.workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
}

function apiPost(path: string, data: unknown): Promise<void> {
  return axios
    .post(`${API_BASE}/api/v1${path}`, data, {
      headers: { 'x-worker-secret': WORKER_SECRET },
      timeout: 8000,
    })
    .then(() => {});
}

function apiPatch(path: string, data: unknown): Promise<void> {
  return axios
    .patch(`${API_BASE}/api/v1${path}`, data, {
      headers: { 'x-worker-secret': WORKER_SECRET },
      timeout: 8000,
    })
    .then(() => {});
}
