/**
 * GVisorRuntime — Google gVisor (runsc) sandbox.
 *
 * gVisor intercepts all syscalls inside the container through a user-space
 * kernel (Sentry), providing near-VM-level isolation with container speed.
 *
 * Requirements:
 *   - gVisor installed:  https://gvisor.dev/docs/user_guide/install/
 *   - Docker configured: /etc/docker/daemon.json must include:
 *       { "runtimes": { "runsc": { "path": "/usr/local/bin/runsc" } } }
 *   - Restart dockerd after config change
 *
 * Overhead: ~10-20% slower than runc; acceptable for security-sensitive builds.
 *
 * Note: gVisor has limited syscall support — some NDK tools may not work.
 *       The runtime falls back to 'docker' automatically if unavailable.
 */
import { spawn } from 'child_process';
import { BaseDockerRuntime } from './base.runtime';
import { RuntimeInfo } from './runtime.interface';
import { logger } from '../logger';

export class GVisorRuntime extends BaseDockerRuntime {
  readonly name           = 'gvisor';
  readonly securityLevel: RuntimeInfo['securityLevel'] = 'gvisor';

  protected runtimeFlags(): string[] {
    return ['--runtime', 'runsc'];
  }

  protected describe(): string {
    return 'gVisor (runsc) — user-space kernel intercepting all syscalls, near-VM isolation';
  }

  override async isAvailable(): Promise<boolean> {
    // 1. Docker must be available
    const dockerOk = await super.isAvailable();
    if (!dockerOk) return false;

    // 2. runsc binary must exist
    const runscExists = await new Promise<boolean>((resolve) => {
      const p = spawn('which', ['runsc'], { stdio: 'ignore' });
      p.on('close', (c) => resolve(c === 0));
      p.on('error', () => resolve(false));
    });
    if (!runscExists) return false;

    // 3. Docker daemon must have 'runsc' registered as a runtime
    const registeredInDocker = await new Promise<boolean>((resolve) => {
      let out = '';
      const p = spawn('docker', ['info', '--format', '{{json .Runtimes}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('close', () => {
        try { resolve(JSON.parse(out)?.runsc !== undefined); }
        catch { resolve(false); }
      });
      p.on('error', () => resolve(false));
    });

    if (!registeredInDocker) {
      logger.warn('[gvisor] runsc binary found but not registered in Docker daemon');
    }

    return registeredInDocker;
  }

  override async info(): Promise<RuntimeInfo> {
    const base = await super.info();
    if (base.available) {
      const version = await new Promise<string | undefined>((resolve) => {
        let out = '';
        const p = spawn('runsc', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
        p.stdout.on('data', (d) => { out += d.toString(); });
        p.on('close', () => resolve(out.match(/release-([\d.]+)/)?.[1]));
        p.on('error', () => resolve(undefined));
      });
      base.version = version;
    }
    return base;
  }
}
