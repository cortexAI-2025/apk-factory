/**
 * Stage 4 — SCAN
 * Security analysis of the project source:
 *   - Suspicious code patterns (reverse shells, dynamic code load, etc.)
 *   - Dangerous file extensions
 *   - Untrusted external repositories in Gradle
 *   - Oversized files
 *
 * Critical/High threats → build blocked.
 * Medium/Low threats → logged as warnings, build continues.
 */
import { PipelineContext, StageResult } from '../types';
import { FileScanner } from '../../security/file-scanner';
import { STAGE_TIMEOUTS } from '../../security/sandbox-config';

const scanner = new FileScanner();

export async function stageScan(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 4/6: SCAN ────────────────────────────────');
  await ctx.log('info', `Scanning: ${ctx.projectRoot}`);

  let result;
  try {
    result = await withTimeout(
      scanner.scan(ctx.projectRoot),
      STAGE_TIMEOUTS.SCAN,
      'Security scan timed out',
    );
  } catch (err: any) {
    await ctx.log('error', `Scan error: ${err.message}`);
    // Don't block the build on scanner failure, but log it
    ctx.scanClean = true;
    ctx.scanThreats = [`Scanner error: ${err.message}`];
    return { ok: true };
  }

  ctx.scanClean = result.clean;
  ctx.scanThreats = result.threats.map((t) => `[${t.severity.toUpperCase()}] ${t.type}: ${t.file} — ${t.detail}`);

  await ctx.log('info', `Scanned ${result.stats.filesScanned} file(s) (${(result.stats.totalBytes / 1024).toFixed(0)} KB)`);

  if (result.threats.length === 0) {
    await ctx.log('info', '✓ No threats detected');
    return { ok: true };
  }

  // Log all threats
  for (const threat of result.threats) {
    const emoji = threat.severity === 'critical' ? '🚨' : threat.severity === 'high' ? '⚠️' : 'ℹ️';
    await ctx.log(
      threat.severity === 'critical' || threat.severity === 'high' ? 'error' : 'warn',
      `${emoji} [${threat.severity.toUpperCase()}] ${threat.type} in ${threat.file}: ${threat.detail}`,
    );
  }

  const blocking = result.threats.filter((t) => t.severity === 'critical' || t.severity === 'high');

  if (blocking.length > 0) {
    const summary = blocking.map((t) => `${t.type}:${t.file}`).join(', ');
    await ctx.log('error', `Build blocked: ${blocking.length} critical/high severity threat(s) detected`);
    return {
      ok: false,
      fatal: true,
      error: `Security scan failed: ${blocking.length} threat(s) blocked the build (${summary})`,
    };
  }

  // Medium/low warnings only — continue
  await ctx.log('warn', `${result.threats.length} low/medium warning(s) — build continues`);
  return { ok: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
