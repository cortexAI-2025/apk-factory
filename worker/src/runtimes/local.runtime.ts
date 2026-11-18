/**
 * LocalRuntime — IRuntime implementation that runs builds directly on the host,
 * without a Docker container. Used when Docker networking is unavailable or the
 * host already has the required Android SDK.
 *
 * Security: no sandbox isolation. Only suitable for CI/validation environments
 * where the host is trusted. NOT for production use.
 *
 * Activated via: RUNTIME=local
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IRuntime, ContainerRunOptions, ContainerRunResult, RuntimeInfo } from './runtime.interface';

/** Env vars forwarded to the build process. */
const BUILD_ENV: Record<string, string | undefined> = {
  ANDROID_HOME:      process.env.ANDROID_HOME      || '/opt/android-sdk',
  ANDROID_SDK_ROOT:  process.env.ANDROID_SDK_ROOT  || '/opt/android-sdk',
  JAVA_HOME:         process.env.JAVA_HOME          || '/usr/lib/jvm/java-21-openjdk-amd64',
  PATH: [
    '/opt/android-sdk/build-tools/37.0.0',
    '/opt/android-sdk/platform-tools',
    '/opt/android-sdk/cmdline-tools/latest/bin',
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin',
    process.env.PATH,
  ].filter(Boolean).join(':'),
  GRADLE_OPTS:      '-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8',
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || '/tmp/apk-local-gradle',
  HOME:             process.env.HOME || '/tmp/apk-local-home',
  TERM:             'dumb',
  CI:               'true',
  // Forward the agent proxy so Gradle can reach Maven repositories.
  JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || '',
  HTTPS_PROXY:      process.env.HTTPS_PROXY || '',
  HTTP_PROXY:       process.env.HTTP_PROXY  || '',
  https_proxy:      process.env.HTTPS_PROXY || '',
  http_proxy:       process.env.HTTP_PROXY  || '',
};

export class LocalRuntime implements IRuntime {
  readonly name = 'local';
  readonly securityLevel: RuntimeInfo['securityLevel'] = 'process';

  async isAvailable(): Promise<boolean> {
    // Available when RUNTIME=local is explicitly set
    return process.env.RUNTIME === 'local';
  }

  async info(): Promise<RuntimeInfo> {
    return {
      name: this.name,
      available: await this.isAvailable(),
      version: process.version,
      securityLevel: this.securityLevel,
      description: 'Direct host execution (no container isolation) — validation only',
    };
  }

  async run(opts: ContainerRunOptions): Promise<ContainerRunResult> {
    const { buildId, projectPath, gradleCommand, shell = false, onLog, onProgress, timeoutMs = 1_500_000 } = opts;
    const startMs = Date.now();
    const lines: string[] = [];

    onLog(`[local] Build ID: ${buildId}`, 'stdout');
    onLog(`[local] Project:  ${projectPath}`, 'stdout');
    onLog(`[local] Mode:     ${shell ? 'shell-script' : 'direct'}`, 'stdout');
    onLog(`[local] WARNING:  no container isolation (RUNTIME=local — validation environment only)`, 'stderr');

    // Make gradlew executable if present
    if (!shell) {
      try { await fs.chmod(path.join(projectPath, 'gradlew'), 0o755); } catch {}
    }

    // Ensure Gradle home exists
    await fs.mkdir(BUILD_ENV.GRADLE_USER_HOME!, { recursive: true });
    await fs.mkdir(BUILD_ENV.HOME!, { recursive: true });

    // Build argv
    const argv: string[] = shell
      ? ['bash', '-lc', gradleCommand]
      : [...gradleCommand.trim().split(/\s+/), '--no-daemon', '--stacktrace', '--console=plain'];

    onLog(`[local] Command:  ${argv.join(' ')}`, 'stdout');

    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env, ...BUILD_ENV };

      const proc = spawn(argv[0], argv.slice(1), {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;

      const handleData = (data: Buffer, stream: 'stdout' | 'stderr') => {
        const text = data.toString();
        lines.push(text);
        for (const line of text.split('\n')) {
          const l = line.trim();
          if (!l) continue;
          onLog(l, stream);
          if (onProgress) this.detectProgress(l, onProgress);
        }
      };

      proc.stdout.on('data', (d) => handleData(d, 'stdout'));
      proc.stderr.on('data', (d) => handleData(d, 'stderr'));

      const timer = setTimeout(() => {
        timedOut = true;
        onLog('[local] TIMEOUT — killing build process', 'stderr');
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startMs;
        const exitCode = timedOut ? 124 : (code ?? 1);
        onLog(`[local] Exit code=${exitCode} duration=${(durationMs / 1000).toFixed(1)}s`, 'stdout');
        resolve({
          exitCode,
          success: exitCode === 0,
          output: lines.join(''),
          durationMs,
          runtime: this.name,
          stoppedBy: timedOut ? 'timeout' : undefined,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        onLog(`[local] Process error: ${err.message}`, 'stderr');
        resolve({
          exitCode: 1,
          success: false,
          output: err.message,
          durationMs: Date.now() - startMs,
          runtime: this.name,
        });
      });
    });
  }

  async stop(_buildId: string): Promise<void> {
    // No container to stop; the build process is killed via timeout or the
    // proc reference. For now this is a no-op.
  }

  private detectProgress(line: string, cb: (pct: number, phase: string) => void) {
    const table: [RegExp, number, string][] = [
      [/^> Configure project/,              10, 'Configuring'],
      [/> Task :[\w:]*:preBuild/,           15, 'Pre-build'],
      [/> Task :[\w:]*:compileDebugKotlin/, 40, 'Compiling Kotlin'],
      [/> Task :[\w:]*:compileDebugJava/,   50, 'Compiling Java'],
      [/> Task :[\w:]*:mergeDebugRes/,      60, 'Merging Resources'],
      [/> Task :[\w:]*:packageDebug/,       85, 'Packaging APK'],
      [/> Task :[\w:]*:assembleDebug/,      95, 'Assembling'],
      [/BUILD SUCCESSFUL/,                 100, 'Done'],
    ];
    for (const [rx, pct, phase] of table) {
      if (rx.test(line)) { cb(pct, phase); return; }
    }
  }
}
