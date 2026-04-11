/**
 * Stage 5 — BUILD
 *
 * Runs the Gradle command inside a sandboxed container via the
 * selected IRuntime (Docker or gVisor).
 *
 * Before the first run:
 *   - Maven cache init script is injected (offline mode)
 *
 * On failure (autoFix=true):
 *   - Parse Gradle errors
 *   - Generate AI/rule-based patch
 *   - Rebuild — up to MAX_FIX_ATTEMPTS times
 */
import { Job } from 'bullmq';
import { PipelineContext, StageResult } from '../types';
import { getRuntime } from '../../runtimes/runtime-factory';
import { MavenCacheInjector } from '../../maven/cache-injector';
import { LogParser } from '../../log-parser';
import { AiFixer } from '../../ai-fixer';
import { STAGE_TIMEOUTS } from '../../security/sandbox-config';

const parser  = new LogParser();
const fixer   = new AiFixer();
const maven   = new MavenCacheInjector();

const MAX_FIX_ATTEMPTS = 3;

export async function stageBuild(ctx: PipelineContext, job?: Job): Promise<StageResult> {
  await ctx.log('info', '─── Stage 5/6: BUILD ───────────────────────────────');

  // ── Select runtime ────────────────────────────────────────────────────────
  let runtime;
  try {
    runtime = await getRuntime();
    await ctx.log('info', `Runtime: ${runtime.name} (isolation=${runtime.securityLevel})`);
  } catch (err: any) {
    return { ok: false, fatal: true, error: `Runtime unavailable: ${err.message}` };
  }

  // ── Maven offline cache ───────────────────────────────────────────────────
  const cacheAvailable = await maven.isCacheAvailable();
  if (cacheAvailable) {
    await ctx.log('info', 'Maven offline cache: available — injecting init script');
    await maven.inject(ctx.projectRoot);
  } else {
    await ctx.log('warn', 'Maven offline cache: not found — builds require network access (disable --network=none)');
  }

  // Extra volume mount for Maven cache
  const extraVolumes = cacheAvailable ? maven.volumeMount() : [];

  let attempt = 0;

  try {
    while (true) {
      if (attempt > 0) {
        await ctx.updateStatus('FIXING');
        await ctx.log('info', `────── Auto-fix attempt ${attempt}/${MAX_FIX_ATTEMPTS} ──────`);
      }

      await ctx.log('info', `Command: ${ctx.gradleCommand}`);

      const result = await runtime.run({
        buildId:      ctx.buildId,
        projectPath:  ctx.projectRoot,
        gradleCommand: ctx.gradleCommand,
        extraVolumes,
        timeoutMs:    STAGE_TIMEOUTS.BUILD,
        onLog: async (line) => {
          const level = parser.classifyLogLevel(line);
          await ctx.log(level as any, line);
        },
        onProgress: async (percent, phase) => {
          await ctx.updateProgress(percent, phase);
          if (job) await job.updateProgress(percent).catch(() => {});
        },
      });

      // ── Success ────────────────────────────────────────────────────────
      if (result.success) {
        await ctx.log('info', `BUILD SUCCESSFUL (${(result.durationMs / 1000).toFixed(1)}s, runtime=${result.runtime})`);
        ctx.autoFixAttempts = attempt;
        ctx.buildOutput = result.output;
        ctx.buildDurationMs = (ctx.buildDurationMs || 0) + result.durationMs;
        return { ok: true };
      }

      // ── Timeout ───────────────────────────────────────────────────────
      if (result.exitCode === 124) {
        return { ok: false, fatal: true, error: 'Build timed out' };
      }

      ctx.buildDurationMs = (ctx.buildDurationMs || 0) + result.durationMs;
      await ctx.log('error', `BUILD FAILED (exit=${result.exitCode})`);

      // ── No more fix attempts ──────────────────────────────────────────
      if (!ctx.autoFix || attempt >= MAX_FIX_ATTEMPTS) {
        ctx.autoFixAttempts = attempt;
        ctx.buildOutput = result.output;
        const errors = parser.parseErrors(result.output);
        return {
          ok: false,
          error: errors.length > 0
            ? errors.map((e) => `[${e.type}] ${e.message}`).join('\n')
            : 'Build failed — see logs for details',
        };
      }

      // ── Parse errors & fix ────────────────────────────────────────────
      const errors = parser.parseErrors(result.output);
      if (errors.length === 0) {
        ctx.autoFixAttempts = attempt;
        return { ok: false, error: 'Build failed with unrecognized errors — cannot auto-fix' };
      }

      await ctx.log('info', `Detected ${errors.length} error(s):`);
      for (const e of errors) {
        await ctx.log('warn', `  [${e.type}] ${e.message}`);
      }
      await ctx.log('info', 'Running AI AutoFix...');

      attempt++;
      const fixResult = await fixer.fix(ctx.projectRoot, errors, attempt);

      await ctx.reportFix(
        attempt,
        fixResult.description,
        fixResult.filesModified,
        fixResult.errorSummary,
        fixResult.success,
        (fixResult as any).patches,
      );

      if (!fixResult.success || fixResult.filesModified.length === 0) {
        ctx.autoFixAttempts = attempt;
        return { ok: false, error: fixResult.errorSummary || 'AI fix did not produce patches' };
      }

      await ctx.log('info', `Fix applied: ${fixResult.description}`);
      for (const f of fixResult.filesModified) {
        await ctx.log('info', `  ✏  ${f}`);
      }
      await ctx.log('info', 'Rebuilding...');
    }
  } finally {
    // Always clean up injected Maven script
    if (cacheAvailable) await maven.cleanup(ctx.projectRoot);
  }
}
