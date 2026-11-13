/**
 * BaseRuntime — shared logic for all Docker-based runtimes.
 * Subclasses override `runtimeFlag()` and `name`.
 */
import { spawn, execFile } from 'child_process';
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

    // The worker extracts as root but the sandbox runs as uid 1000 (builder):
    // make the workspace writable so Gradle can create build/ outputs.
    await new Promise<void>((resolve) =>
      execFile('chmod', ['-R', 'a+rwX', projectPath], () => resolve()),
    );

    onLog(`[${this.name}] Container: ${containerName}`, 'stdout');
    onLog(`[${this.name}] Image: ${SANDBOX.IMAGE}`, 'stdout');
    onLog(`[${this.name}] Limits: CPU=${SANDBOX.CPU_LIMIT} RAM=${SANDBOX.MEMORY_LIMIT} disk=${Math.round(SANDBOX.MAX_WORKSPACE_BYTES / 1048576)}MB network=${SANDBOX.NETWORK_MODE}`, 'stdout');
    if (SANDBOX.NETWORK_MODE === 'bridge') {
      onLog(`[${this.name}] WARNING: unrestricted network (BUILD_NETWORK_MODE=bridge) — use 'restricted' in production`, 'stderr');
    }
    onLog(`[${this.name}] Security: ${this.securityLevel}`, 'stdout');
    onLog(`[${this.name}] Command: ${gradleCommand}`, 'stdout');

    const args = this.sandboxArgs(containerName, projectPath, [
      ...gradleCommand.trim().split(/\s+/), '--no-daemon', '--stacktrace', '--console=plain',
    ], opts);

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

      let diskExceeded = false;
      const watchdog = setInterval(async () => {
        const used = await this.dirSize(projectPath);
        if (used > SANDBOX.MAX_WORKSPACE_BYTES && !diskExceeded) {
          diskExceeded = true;
          onLog(`[${this.name}] DISK LIMIT exceeded (${Math.round(used / 1048576)} MB > ${Math.round(SANDBOX.MAX_WORKSPACE_BYTES / 1048576)} MB) — killing container`, 'stderr');
          await this.killContainer(containerName);
        }
      }, 5000);

      const timer = setTimeout(async () => {
        timedOut = true;
        onLog(`[${this.name}] TIMEOUT after ${timeoutMs / 60000}min — killing container`, 'stderr');
        await this.killContainer(containerName);
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        clearInterval(watchdog);
        this.activeContainers.delete(buildId);
        const durationMs = Date.now() - startMs;
        const exitCode = timedOut ? 124 : (code ?? 1);
        const stoppedBy = timedOut ? 'timeout' : diskExceeded ? 'disk' : undefined;
        onLog(`[${this.name}] Exit code=${exitCode} duration=${(durationMs / 1000).toFixed(1)}s`, 'stdout');
        resolve({ exitCode, success: exitCode === 0 && !diskExceeded, output: lines.join(''), durationMs, runtime: this.name, containerId, stoppedBy });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(watchdog);
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

  /**
   * Full `docker run` argument list for a sandboxed command. Public so the
   * isolation checks (scripts/isolation-check.mjs) exercise the exact flags
   * used for real builds.
   */
  sandboxArgs(
    containerName: string,
    projectPath: string,
    command: string[],
    opts: Pick<ContainerRunOptions, 'extraVolumes' | 'extraEnv'> = {},
  ): string[] {
    // Docker-in-Docker note: the worker's own mount paths are not visible to the
    // daemon, so SDK and Gradle distributions come from the builder image and
    // only the workspace (identical host path) is bind-mounted.
    const restricted = SANDBOX.NETWORK_MODE === 'restricted';
    const proxy = restricted ? new URL(SANDBOX.PROXY_URL) : null;

    const args: string[] = [
      '--rm', '--name', containerName,
      '--label', 'apk-factory.sandbox=1',
      ...this.runtimeFlags(),
      // ── resources ──
      '--memory', SANDBOX.MEMORY_LIMIT,
      '--memory-swap', SANDBOX.MEMORY_LIMIT,
      '--cpus', SANDBOX.CPU_LIMIT,
      '--pids-limit', String(SANDBOX.PIDS_LIMIT),
      '--ulimit', `nofile=${SANDBOX.NOFILE_LIMIT}:${SANDBOX.NOFILE_LIMIT}`,
      '--ulimit', `nproc=${SANDBOX.NPROC_LIMIT}:${SANDBOX.NPROC_LIMIT}`,
      '--ulimit', `fsize=${SANDBOX.MAX_FILE_BYTES}:${SANDBOX.MAX_FILE_BYTES}`,
      // ── network ──
      '--network', restricted ? SANDBOX.NETWORK_NAME : SANDBOX.NETWORK_MODE,
      // ── privileges ──
      '--user', '1000:1000',
      '--security-opt', 'no-new-privileges:true',
      '--cap-drop', 'ALL',
      '--read-only',
      '--init',
      // /tmp holds the Gradle home, Android user home and dex temp files — needs exec
      '--tmpfs', '/tmp:size=2g,exec,mode=1777',
      '--volume', `${projectPath}:/workspace:rw`,
      ...(opts.extraVolumes || []),
      // ── environment: explicit allow-list, never the worker's own env ──
      '--env', 'ANDROID_HOME=/opt/android-sdk',
      '--env', 'ANDROID_SDK_ROOT=/opt/android-sdk',
      '--env', 'HOME=/tmp/home',
      '--env', 'ANDROID_USER_HOME=/tmp/android',
      '--env', 'GRADLE_OPTS=-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8',
      '--env', 'TERM=dumb', '--env', 'CI=true',
      ...(proxy ? ['--env', `BUILD_PROXY_HOST=${proxy.hostname}`, '--env', `BUILD_PROXY_PORT=${proxy.port || '3128'}`] : []),
      ...(opts.extraEnv || []),
      '--workdir', '/workspace',
      SANDBOX.IMAGE,
      ...command,
    ];

    if (process.env.USE_SECCOMP === 'true') {
      // insert the pair right before --cap-drop (never between a flag and its value)
      args.splice(args.indexOf('--cap-drop'), 0, '--security-opt', `seccomp=${SANDBOX.SECCOMP_PROFILE}`);
    }
    return args;
  }

  /** Total bytes under a directory (regular files only, no symlink following). */
  private async dirSize(dir: string): Promise<number> {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries;
      try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) {
          try { total += (await fs.lstat(full)).size; } catch {}
        }
      }
    }
    return total;
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
