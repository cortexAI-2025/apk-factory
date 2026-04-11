/**
 * RuntimeFactory
 *
 * Selects the most secure available container runtime for each build.
 *
 * Priority (most → least secure):
 *   gvisor  → user-space kernel (syscall interception)
 *   docker  → runc namespaces + cgroups + seccomp
 *
 * Override with env:
 *   RUNTIME=docker   force standard Docker
 *   RUNTIME=gvisor   force gVisor (fails if unavailable)
 *   RUNTIME=auto     pick best available (default)
 */
import { IRuntime, RuntimeInfo } from './runtime.interface';
import { DockerRuntime }  from './docker.runtime';
import { GVisorRuntime }  from './gvisor.runtime';
import { logger } from '../logger';

const FORCED = (process.env.RUNTIME || 'auto').toLowerCase();

// Singleton instances
const RUNTIMES: IRuntime[] = [
  new GVisorRuntime(),
  new DockerRuntime(),
];

let resolvedRuntime: IRuntime | null = null;

export async function getRuntime(): Promise<IRuntime> {
  if (resolvedRuntime) return resolvedRuntime;

  if (FORCED !== 'auto') {
    const forced = RUNTIMES.find((r) => r.name === FORCED);
    if (!forced) throw new Error(`Unknown RUNTIME="${FORCED}". Valid: docker, gvisor, auto`);
    const ok = await forced.isAvailable();
    if (!ok) throw new Error(`Forced RUNTIME="${FORCED}" is not available on this host`);
    resolvedRuntime = forced;
    logger.info(`[runtime] Forced runtime: ${forced.name} (${forced.securityLevel})`);
    return resolvedRuntime;
  }

  // Auto-select: try each in priority order
  for (const rt of RUNTIMES) {
    try {
      const ok = await rt.isAvailable();
      if (ok) {
        resolvedRuntime = rt;
        logger.info(`[runtime] Selected runtime: ${rt.name} (${rt.securityLevel})`);
        return resolvedRuntime;
      }
      logger.debug(`[runtime] ${rt.name} not available — trying next`);
    } catch (err: any) {
      logger.debug(`[runtime] ${rt.name} check failed: ${err.message}`);
    }
  }

  throw new Error('No container runtime available. Is Docker installed?');
}

/** Reset cached selection (useful in tests). */
export function resetRuntimeCache(): void {
  resolvedRuntime = null;
}

/** Return info for all runtimes (for the dashboard). */
export async function getAllRuntimeInfo(): Promise<RuntimeInfo[]> {
  return Promise.all(RUNTIMES.map((r) => r.info()));
}
