/**
 * Stage 5 — BUILD
 * Execute the Gradle command inside an isolated Docker sandbox.
 * If autoFix is enabled and the build fails, invoke the AI fixer
 * and retry up to MAX_FIX_ATTEMPTS times.
 *
 * Build → Error Analysis → LLM/Rule-based Patch → Rebuild (×3 max)
 */
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';
import { DockerRunner } from '../../docker-runner';
import { LogParser } from '../../log-parser';
import { AiFixer } from '../../ai-fixer';
import { STAGE_TIMEOUTS } from '../../security/sandbox-config';

const runner = new DockerRunner();
const parser = new LogParser();
const fixer = new AiFixer();

const MAX_FIX_ATTEMPTS = 3;

export async function stageBuild(
  ctx: PipelineContext,
  job?: Job,
): Promise<StageResult> {
  await ctx.log('info', '─── Stage 5/6: BUILD ───────────────────────────────');

  let attempt = 0;
  let lastOutput = '';

  while (true) {
    if (attempt > 0) {
      await ctx.updateStatus('FIXING');
      await ctx.log('info', `────── Auto-fix attempt ${attempt}/${MAX_FIX_ATTEMPTS} ──────`);
    }

    // ── Run Docker build ──────────────────────────────────────────────────
    await ctx.log('info', `Running: ${ctx.gradleCommand}`);
    await ctx.log('info', `Sandbox: memory=${process.env.BUILD_MEMORY || '3g'} cpus=${process.env.BUILD_CPUS || '2'} network=none`);

    const result = await runner.run({
      buildId: ctx.buildId,
      projectPath: ctx.projectRoot,
      gradleCommand: ctx.gradleCommand,
      timeoutMs: STAGE_TIMEOUTS.BUILD,
      onLog: async (line, stream) => {
        const level = parser.classifyLogLevel(line);
        await ctx.log(level as any, line);
      },
      onProgress: async (percent, phase) => {
        await ctx.updateProgress(percent, phase);
        if (job) await job.updateProgress(percent);
      },
    });

    lastOutput = result.output;
    ctx.buildDurationMs = (ctx.buildDurationMs || 0) + result.durationMs;

    // ── Build succeeded ───────────────────────────────────────────────────
    if (result.success) {
      await ctx.log('info', `BUILD SUCCESSFUL (${(result.durationMs / 1000).toFixed(1)}s)`);
      ctx.autoFixAttempts = attempt;
      return { ok: true };
    }

    // ── Build timed out ───────────────────────────────────────────────────
    if (result.exitCode === 124) {
      await ctx.log('error', 'Build timed out');
      return { ok: false, fatal: true, error: 'Build timed out' };
    }

    await ctx.log('error', `BUILD FAILED (exit code ${result.exitCode})`);

    // ── No auto-fix or attempts exhausted ────────────────────────────────
    if (!ctx.autoFix || attempt >= MAX_FIX_ATTEMPTS) {
      ctx.autoFixAttempts = attempt;
      const errors = parser.parseErrors(lastOutput);
      const summary = errors.length > 0
        ? errors.map((e) => `[${e.type}] ${e.message}`).join('\n')
        : 'Build failed — see logs for details';
      return { ok: false, error: summary };
    }

    // ── Parse errors ──────────────────────────────────────────────────────
    const errors = parser.parseErrors(lastOutput);
    if (errors.length === 0) {
      await ctx.log('warn', 'No recognizable error patterns found — cannot auto-fix');
      ctx.autoFixAttempts = attempt;
      return { ok: false, error: 'Build failed with unrecognized errors' };
    }

    await ctx.log('info', `Detected ${errors.length} error type(s):`);
    for (const e of errors) {
      await ctx.log('warn', `  [${e.type}] ${e.message}`);
    }
    await ctx.log('info', 'Invoking AI AutoFix...');

    // ── Apply fix ─────────────────────────────────────────────────────────
    attempt++;
    const fixResult = await fixer.fix(ctx.projectRoot, errors, attempt);

    await ctx.reportFix(
      attempt,
      fixResult.description,
      fixResult.filesModified,
      fixResult.errorSummary,
      fixResult.success,
    );

    if (!fixResult.success || fixResult.filesModified.length === 0) {
      await ctx.log('error', 'AI fix could not generate applicable patches');
      ctx.autoFixAttempts = attempt;
      return { ok: false, error: fixResult.errorSummary || 'AI autofix failed' };
    }

    await ctx.log('info', `Fix applied: ${fixResult.description}`);
    for (const f of fixResult.filesModified) {
      await ctx.log('info', `  ✏  ${f}`);
    }
    await ctx.log('info', 'Rebuilding...');
  }
}
