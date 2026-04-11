/**
 * BaseRuntime — shared logic for all Docker-based runtimes.
 * Subclasses override `runtimeFlag()` and `name`.
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IRuntime, ContainerRunOptions, ContainerRunResult, RuntimeInfo } from './runtime.interface';
import { SANDBOX } from '../security/sandbox-config';
import { logger } from '../logger';

export abstract class BaseDockerRuntime implements IRuntime {
  abstract readonly name: string;
  abstract readonly securityLevel: RuntimeInfo['securityLevel'];

  /** Returns extra docker run flags for this runtime (e.g. --runtime=runsc). */
  protected abstract runtimeFlags(): string[];

  protected activeContainers = new Map<string, string>(); // buildId → containerName

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const p = spawn('docker', ['info', '--format', '{{json .}}'], { stdio: 'ignore' });
      p.on('close', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
  }

  async info(): Promise<RuntimeInfo> {
    const available = await this.isAvailable();
    let version: string | undefined;
    if (available) {
      version = await new Promise((resolve) => {
        let out = '';
        const p = spawn('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
        p.stdout.on('data', (d) => { out += d.toString(); });
        p.on('close', () => resolve(out.trim() || undefined));
        p.on('error', () => resolve(undefined));
      });
    }
    return {
      name: this.name,
      available,
      version,
      securityLevel: this.securityLevel,
      description: this.describe(),
    };
  }

  protected describe(): string { return this.name; }

  async run(opts: ContainerRunOptions): Promise<ContainerRunResult> {
    const { buildId, projectPath, gradleCommand, onLog, onProgress, timeoutMs = SANDBOX.BUILD_TIMEOUT_MS } = opts;
    const containerName = `apk-build-${buildId.slice(0, 12)}`;
    const startMs = Date.now();
    const lines: string[] = [];

    // Verify gradlew executable
    try { await fs.chmod(path.join(projectPath, 'gradlew'), 0o755); } catch {}

    onLog(`[${this.name}] Container: ${containerName}`, 'stdout');
    onLog(`[${this.name}] Image: ${SANDBOX.IMAGE}`, 'stdout');
    onLog(`[${this.name}] Limits: CPU=${SANDBOX.CPU_LIMIT} RAM=${SANDBOX.MEMORY_LIMIT} network=${SANDBOX.NETWORK_MODE}`, 'stdout');
    onLog(`[${this.name}] Security: ${this.securityLevel}`, 'stdout');
    onLog(`[${this.name}] Command: ${gradleCommand}`, 'stdout');

    const args = this.buildArgs(containerName, projectPath, gradleCommand, opts);

    return new Promise((resolve) => {
      const proc = spawn('docker', ['run', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      let timedOut = false;
      let containerId: string | undefined;

      proc.stdout.once('data', (chunk: Buffer) => {
        const first = chunk.toString().trim().split('\n')[0];
        if (/^[a-f0-9]{12,64}$/.test(first)) {
          containerId = first;
          this.activeContainers.set(buildId, containerName);
        }
      });

      const handleLine = (data: Buffer, stream: 'stdout' | 'stderr') => {
        const text = data.toString();
        lines.push(text);
        for (const line of text.split('\n')) {
          const l = line.trim();
          if (!l) continue;
          onLog(l, stream);
          if (onProgress) this.detectProgress(l, onProgress);
        }
      };

      proc.stdout.on('data', (d) => handleLine(d, 'stdout'));
      proc.stderr.on('data', (d) => handleLine(d, 'stderr'));

      const timer = setTimeout(async () => {
        timedOut = true;
        onLog(`[${this.name}] TIMEOUT after ${timeoutMs / 60000}min — killing container`, 'stderr');
        await this.killContainer(containerName);
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeContainers.delete(buildId);
        const durationMs = Date.now() - startMs;
        const exitCode = timedOut ? 124 : (code ?? 1);
        onLog(`[${this.name}] Exit code=${exitCode} duration=${(durationMs / 1000).toFixed(1)}s`, 'stdout');
        resolve({ exitCode, success: exitCode === 0, output: lines.join(''), durationMs, runtime: this.name, containerId });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeContainers.delete(buildId);
        onLog(`[${this.name}] Docker error: ${err.message}`, 'stderr');
        resolve({ exitCode: 1, success: false, output: err.message, durationMs: Date.now() - startMs, runtime: this.name });
      });
    });
  }

  async stop(buildId: string): Promise<void> {
    const name = this.activeContainers.get(buildId) || `apk-build-${buildId.slice(0, 12)}`;
    await this.killContainer(name);
    this.activeContainers.delete(buildId);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildArgs(
    containerName: string,
    projectPath: string,
    gradleCommand: string,
    opts: ContainerRunOptions,
  ): string[] {
    const args: string[] = [
      '--rm', '--name', containerName,
      ...this.runtimeFlags(),
      '--memory', SANDBOX.MEMORY_LIMIT,
      '--memory-swap', SANDBOX.MEMORY_LIMIT,
      '--cpus', SANDBOX.CPU_LIMIT,
      '--pids-limit', String(SANDBOX.PIDS_LIMIT),
      '--ulimit', `nofile=${SANDBOX.NOFILE_LIMIT}:${SANDBOX.NOFILE_LIMIT}`,
      '--ulimit', `nproc=${SANDBOX.NPROC_LIMIT}:${SANDBOX.NPROC_LIMIT}`,
      '--network', SANDBOX.NETWORK_MODE,
      '--security-opt', 'no-new-privileges:true',
      '--cap-drop', 'ALL',
      '--read-only',
      '--tmpfs', '/tmp:size=512m,exec',
      '--tmpfs', '/root/.gradle/caches:size=100m',
      '--volume', `${projectPath}:/workspace:rw,z`,
      '--volume', `${SANDBOX.ANDROID_SDK_HOST}:${SANDBOX.ANDROID_SDK_CTR}:ro`,
      '--volume', `${SANDBOX.GRADLE_CACHE_HOST}:${SANDBOX.GRADLE_CACHE_CTR}:ro`,
      ...(opts.extraVolumes || []),
      '--env', `ANDROID_HOME=${SANDBOX.ANDROID_SDK_CTR}`,
      '--env', `ANDROID_SDK_ROOT=${SANDBOX.ANDROID_SDK_CTR}`,
      '--env', 'GRADLE_OPTS=-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8',
      '--env', 'TERM=dumb', '--env', 'CI=true',
      ...(opts.extraEnv || []),
      '--workdir', '/workspace',
      '--user', 'builder',
      SANDBOX.IMAGE,
      ...gradleCommand.trim().split(/\s+/),
      '--no-daemon', '--stacktrace', '--console=plain',
    ];

    if (process.env.USE_SECCOMP === 'true') {
      args.splice(args.indexOf('--cap-drop') - 1, 0, '--security-opt', `seccomp=${SANDBOX.SECCOMP_PROFILE}`);
    }

    return args;
  }

  private async killContainer(name: string): Promise<void> {
    await this.exec(['stop', '--time', String(SANDBOX.CONTAINER_STOP_TIMEOUT_S), name]);
    await this.exec(['rm', '--force', name]);
  }

  private exec(args: string[]): Promise<void> {
    return new Promise((resolve) => {
      const p = spawn('docker', args, { stdio: 'ignore' });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }

  private detectProgress(line: string, cb: (pct: number, phase: string) => void) {
    const table: [RegExp, number, string][] = [
      [/^> Configure project/,              10, 'Configuring'],
      [/> Task :[\w:]*:preBuild/,           15, 'Pre-build'],
      [/> Task :[\w:]*:compileDebugKotlin/, 40, 'Compiling Kotlin'],
      [/> Task :[\w:]*:compileDebugJava/,   50, 'Compiling Java'],
      [/> Task :[\w:]*:mergeDebugRes/,      60, 'Merging Resources'],
      [/> Task :[\w:]*:processDebugManifest/, 65, 'Processing Manifest'],
      [/> Task :[\w:]*:dexBuilder/,         75, 'Dexing'],
      [/> Task :[\w:]*:packageDebug/,       85, 'Packaging APK'],
      [/> Task :[\w:]*:assembleDebug/,      95, 'Assembling'],
      [/BUILD SUCCESSFUL/,                 100, 'Done'],
    ];
    for (const [rx, pct, phase] of table) {
      if (rx.test(line)) { cb(pct, phase); return; }
    }
  }
}
