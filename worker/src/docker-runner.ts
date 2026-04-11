import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { SANDBOX } from './security/sandbox-config';

export interface DockerRunOptions {
  buildId: string;
  projectPath: string;    // Host path — bind-mounted as /workspace (rw)
  gradleCommand: string;  // e.g. './gradlew assembleDebug'
  onLog: (line: string, stream: 'stdout' | 'stderr') => void;
  onProgress?: (percent: number, phase: string) => void;
  timeoutMs?: number;
}

export interface DockerRunResult {
  exitCode: number;
  success: boolean;
  output: string;
  containerId?: string;
  durationMs: number;
}

export class DockerRunner {
  private activeContainers = new Map<string, string>(); // buildId → containerId

  // ── Main run ─────────────────────────────────────────────────────────────
  async run(opts: DockerRunOptions): Promise<DockerRunResult> {
    const {
      buildId,
      projectPath,
      gradleCommand,
      onLog,
      onProgress,
      timeoutMs = SANDBOX.BUILD_TIMEOUT_MS,
    } = opts;

    const startMs = Date.now();
    const containerName = `apk-build-${buildId.slice(0, 12)}`;
    const lines: string[] = [];

    // Validate project path exists
    try {
      await fs.access(projectPath);
    } catch {
      throw new Error(`Project path not found: ${projectPath}`);
    }

    // Ensure gradlew is executable inside the project
    const gradlewPath = path.join(projectPath, 'gradlew');
    try {
      await fs.chmod(gradlewPath, 0o755);
    } catch {
      // might not exist — validated later in pipeline
    }

    onLog(`[sandbox] Starting container: ${containerName}`, 'stdout');
    onLog(`[sandbox] Image: ${SANDBOX.IMAGE}`, 'stdout');
    onLog(`[sandbox] Limits: CPU=${SANDBOX.CPU_LIMIT} RAM=${SANDBOX.MEMORY_LIMIT} network=${SANDBOX.NETWORK_MODE}`, 'stdout');
    onLog(`[sandbox] Command: ${gradleCommand}`, 'stdout');

    const dockerArgs = this.buildDockerArgs(containerName, projectPath, gradleCommand);

    return new Promise((resolve) => {
      const proc = spawn('docker', ['run', ...dockerArgs], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let containerId: string | undefined;
      let timedOut = false;

      // Capture container ID from first stdout token
      proc.stdout.once('data', (chunk: Buffer) => {
        const first = chunk.toString().trim().split('\n')[0];
        if (/^[a-f0-9]{12,64}$/.test(first)) {
          containerId = first;
          this.activeContainers.set(buildId, containerId);
        }
      });

      const handleLine = (data: Buffer, stream: 'stdout' | 'stderr') => {
        const text = data.toString();
        lines.push(text);
        for (const line of text.split('\n')) {
          const l = line.trim();
          if (!l) continue;
          onLog(l, stream);
          // Parse progress hints
          if (onProgress) this.detectProgress(l, onProgress);
        }
      };

      proc.stdout.on('data', (d) => handleLine(d, 'stdout'));
      proc.stderr.on('data', (d) => handleLine(d, 'stderr'));

      // Hard timeout — kill container
      const timer = setTimeout(async () => {
        timedOut = true;
        onLog(`[sandbox] Build timeout after ${timeoutMs / 60000}min — stopping container`, 'stderr');
        await this.killContainer(containerName, containerId);
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeContainers.delete(buildId);

        const durationMs = Date.now() - startMs;
        const output = lines.join('');
        const exitCode = timedOut ? 124 : (code ?? 1);

        onLog(`[sandbox] Container exited (code=${exitCode}, duration=${(durationMs / 1000).toFixed(1)}s)`, 'stdout');

        resolve({
          exitCode,
          success: exitCode === 0,
          output,
          containerId,
          durationMs,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeContainers.delete(buildId);
        onLog(`[sandbox] Docker error: ${err.message}`, 'stderr');
        resolve({
          exitCode: 1,
          success: false,
          output: err.message,
          durationMs: Date.now() - startMs,
        });
      });
    });
  }

  // ── Force-stop a running build container ─────────────────────────────────
  async stopBuild(buildId: string): Promise<void> {
    const containerId = this.activeContainers.get(buildId);
    if (!containerId) return;
    await this.killContainer(`apk-build-${buildId.slice(0, 12)}`, containerId);
    this.activeContainers.delete(buildId);
  }

  // ── Find APK inside container's workspace output ──────────────────────────
  async findApkInWorkspace(projectPath: string): Promise<string | null> {
    const candidates = [
      'app/build/outputs/apk/debug/app-debug.apk',
      'app/build/outputs/apk/release/app-release-unsigned.apk',
      'app/build/outputs/apk/release/app-release.apk',
      'app/build/outputs/bundle/release/app-release.aab',
    ];

    for (const rel of candidates) {
      const full = path.join(projectPath, rel);
      try {
        await fs.access(full);
        return full;
      } catch {}
    }

    // Glob fallback
    return this.globFind(projectPath, ['.apk', '.aab']);
  }

  // ── Inspect running containers (health check) ─────────────────────────────
  async listActiveContainers(): Promise<string[]> {
    return [...this.activeContainers.values()];
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildDockerArgs(
    containerName: string,
    projectPath: string,
    gradleCommand: string,
  ): string[] {
    const args: string[] = [
      '--rm',                                             // auto-remove on exit
      '--name', containerName,

      // ── Resource limits ──────────────────────────────────────────────────
      '--memory', SANDBOX.MEMORY_LIMIT,
      '--memory-swap', SANDBOX.MEMORY_LIMIT,              // no swap
      '--cpus', SANDBOX.CPU_LIMIT,
      '--pids-limit', String(SANDBOX.PIDS_LIMIT),
      '--ulimit', `nofile=${SANDBOX.NOFILE_LIMIT}:${SANDBOX.NOFILE_LIMIT}`,
      '--ulimit', `nproc=${SANDBOX.NPROC_LIMIT}:${SANDBOX.NPROC_LIMIT}`,

      // ── Network isolation ────────────────────────────────────────────────
      '--network', SANDBOX.NETWORK_MODE,

      // ── Security flags ───────────────────────────────────────────────────
      '--security-opt', 'no-new-privileges:true',
      '--cap-drop', 'ALL',

      // Allow read-only root FS with tmpfs for writable paths
      '--read-only',
      '--tmpfs', '/tmp:size=512m,exec',
      '--tmpfs', '/root/.gradle/caches:size=100m',

      // ── Volumes ──────────────────────────────────────────────────────────
      // Project workspace: read-write (Gradle writes build output here)
      '--volume', `${projectPath}:/workspace:rw,z`,

      // Android SDK: read-only
      '--volume', `${SANDBOX.ANDROID_SDK_HOST}:${SANDBOX.ANDROID_SDK_CTR}:ro`,

      // Gradle dependency cache: read-only (pre-seeded)
      '--volume', `${SANDBOX.GRADLE_CACHE_HOST}:${SANDBOX.GRADLE_CACHE_CTR}:ro`,
    ];

    // Optional: seccomp profile
    if (process.env.USE_SECCOMP === 'true') {
      args.push('--security-opt', `seccomp=${SANDBOX.SECCOMP_PROFILE}`);
    }

    // Environment inside container
    args.push(
      '--env', `ANDROID_HOME=${SANDBOX.ANDROID_SDK_CTR}`,
      '--env', `ANDROID_SDK_ROOT=${SANDBOX.ANDROID_SDK_CTR}`,
      '--env', 'GRADLE_OPTS=-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8',
      '--env', 'TERM=dumb',
      '--env', 'CI=true',

      '--workdir', '/workspace',
      '--user', 'builder',        // non-root user defined in Dockerfile
    );

    // Image + entrypoint
    args.push(SANDBOX.IMAGE);

    // Split command safely (avoid shell injection)
    const cmdParts = gradleCommand.trim().split(/\s+/);
    args.push(...cmdParts, '--no-daemon', '--stacktrace', '--console=plain');

    return args;
  }

  private async killContainer(name: string, id?: string): Promise<void> {
    const target = id || name;
    try {
      await this.execDockerQuiet(['stop', '--time', String(SANDBOX.CONTAINER_STOP_TIMEOUT_S), target]);
    } catch {}
    try {
      await this.execDockerQuiet(['rm', '--force', target]);
    } catch {}
  }

  private execDockerQuiet(args: string[]): Promise<void> {
    return new Promise((resolve) => {
      const p = spawn('docker', args, { stdio: 'ignore' });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }

  private detectProgress(line: string, cb: (percent: number, phase: string) => void) {
    const table: Array<[RegExp, number, string]> = [
      [/^> Configure project/,                          10, 'Configuring project'],
      [/> Task :[\w:]*:preBuild/,                       15, 'Pre-build'],
      [/> Task :[\w:]*:generateDebugBuildConfig/,       20, 'Generating build config'],
      [/> Task :[\w:]*:compileDebugKotlin|compileReleaseKotlin/, 40, 'Compiling Kotlin'],
      [/> Task :[\w:]*:compileDebugJavaWithJavac/,      50, 'Compiling Java'],
      [/> Task :[\w:]*:mergeDebugResources|mergeReleaseResources/, 60, 'Merging resources'],
      [/> Task :[\w:]*:processDebugManifest/,           65, 'Processing manifest'],
      [/> Task :[\w:]*:dexBuilderDebug|dexBuilderRelease/, 75, 'Dexing'],
      [/> Task :[\w:]*:packageDebug|packageRelease/,    85, 'Packaging APK'],
      [/> Task :[\w:]*:assembleDebug|assembleRelease/,  95, 'Assembling'],
      [/BUILD SUCCESSFUL/,                              100, 'Done'],
    ];

    for (const [rx, pct, phase] of table) {
      if (rx.test(line)) { cb(pct, phase); return; }
    }
  }

  private async globFind(dir: string, exts: string[]): Promise<string | null> {
    try {
      const walk = async (d: string): Promise<string | null> => {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === 'node_modules' || e.name === '.gradle') continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            const found = await walk(full);
            if (found) return found;
          } else if (exts.some((x) => e.name.endsWith(x))) {
            return full;
          }
        }
        return null;
      };
      return await walk(dir);
    } catch {
      return null;
    }
  }
}
