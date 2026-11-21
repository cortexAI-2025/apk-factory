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
import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { IRuntime, ContainerRunOptions, ContainerRunResult, RuntimeInfo } from './runtime.interface';

function detectJavaHome(): string {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java'))) {
    return process.env.JAVA_HOME;
  }
  try {
    const bin = execFileSync('readlink', ['-f', execFileSync('which', ['java'], { encoding: 'utf8' }).trim()], { encoding: 'utf8' }).trim();
    return path.dirname(path.dirname(bin));
  } catch {
    return '/usr/lib/jvm/java-17-openjdk-amd64';
  }
}

function newestBuildTools(androidHome: string): string | undefined {
  try {
    const dir = path.join(androidHome, 'build-tools');
    const versions = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory());
    versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const last = versions[versions.length - 1];
    return last ? path.join(dir, last) : undefined;
  } catch {
    return undefined;
  }
}

function buildEnv(): NodeJS.ProcessEnv {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/android-sdk';
  const javaHome = detectJavaHome();
  const buildTools = newestBuildTools(androidHome);
  return {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || androidHome,
    JAVA_HOME: javaHome,
    FLUTTER_HOME: process.env.FLUTTER_HOME || '/opt/flutter',
    PUB_CACHE: process.env.PUB_CACHE || path.join(process.env.HOME || '/tmp/apk-local-home', '.pub-cache'),
    PATH: [
      buildTools,
      path.join(androidHome, 'platform-tools'),
      path.join(androidHome, 'cmdline-tools', 'latest', 'bin'),
      path.join(javaHome, 'bin'),
      process.env.FLUTTER_HOME ? path.join(process.env.FLUTTER_HOME, 'bin') : '/opt/flutter/bin',
      '/usr/local/bin',
      process.env.PATH,
    ].filter(Boolean).join(':'),
    GRADLE_OPTS: process.env.GRADLE_OPTS || '-Dorg.gradle.daemon=false -Xmx2048m -Dfile.encoding=UTF-8',
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || '/tmp/apk-local-gradle',
    HOME: process.env.HOME || '/tmp/apk-local-home',
    TERM: 'dumb',
    CI: 'true',
  };
}

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
      try { await fsp.chmod(path.join(projectPath, 'gradlew'), 0o755); } catch {}
    }

    const env = buildEnv();
    await fsp.mkdir(env.GRADLE_USER_HOME!, { recursive: true });
    await fsp.mkdir(env.HOME!, { recursive: true });

    // Build argv
    const argv: string[] = shell
      ? ['bash', '-lc', gradleCommand]
      : [...gradleCommand.trim().split(/\s+/), '--no-daemon', '--stacktrace', '--console=plain'];

    onLog(`[local] Command:  ${argv.join(' ')}`, 'stdout');

    return new Promise((resolve) => {
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
      [/> Task :[\w:]*:package(Debug|Release)/, 85, 'Packaging'],
      [/> Task :[\w:]*:(assembleDebug|assembleRelease|bundleRelease)/, 95, 'Assembling'],
      [/BUILD SUCCESSFUL/,                 100, 'Done'],
    ];
    for (const [rx, pct, phase] of table) {
      if (rx.test(line)) { cb(pct, phase); return; }
    }
  }
}
