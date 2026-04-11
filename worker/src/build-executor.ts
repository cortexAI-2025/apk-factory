import { Job } from 'bullmq';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { logger } from './logger';
import { LogParser } from './log-parser';
import { AiFixer } from './ai-fixer';

export interface BuildJobData {
  buildId: string;
  projectId: string;
  projectPath: string;
  gradleCommand: string;
  buildType: string;
  autoFix: boolean;
  userId: string;
}

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const WORKER_SECRET = process.env.WORKER_SECRET || 'worker-secret';

export class BuildExecutor {
  private readonly parser = new LogParser();
  private readonly fixer = new AiFixer();

  async run(job: Job<BuildJobData>): Promise<void> {
    const { buildId, projectPath, gradleCommand, autoFix } = job.data;
    const maxFixAttempts = 3;

    await this.updateBuildStatus(buildId, 'BUILDING');
    await this.addLog(buildId, 'info', `Starting build: ${gradleCommand}`);
    await this.addLog(buildId, 'info', `Project path: ${projectPath}`);

    let attempt = 0;
    let success = false;

    while (attempt <= (autoFix ? maxFixAttempts : 0) && !success) {
      if (attempt > 0) {
        await this.updateBuildStatus(buildId, 'FIXING');
        await this.addLog(buildId, 'warn', `--- Auto-fix attempt ${attempt}/${maxFixAttempts} ---`);
      }

      const result = await this.runGradle(buildId, projectPath, gradleCommand, job);

      if (result.success) {
        success = true;
        const apkPath = await this.findApk(projectPath);
        const apkSize = apkPath ? await this.getFileSize(apkPath) : 0;
        const apkUrl = apkPath
          ? await this.uploadApk(buildId, apkPath)
          : null;

        await this.updateBuildStatus(buildId, 'SUCCESS', {
          apkUrl,
          apkSize,
          errorMessage: null,
        });
        await this.addLog(buildId, 'info', `BUILD SUCCESSFUL${apkUrl ? ` - APK ready: ${apkUrl}` : ''}`);
        break;
      }

      // Build failed
      if (!autoFix || attempt >= maxFixAttempts) {
        const errors = this.parser.parseErrors(result.output);
        const errorMsg = errors.length > 0
          ? errors.map((e) => `[${e.type}] ${e.message}`).join('\n')
          : 'Build failed - see logs for details';

        await this.updateBuildStatus(buildId, 'FAILED', { errorMessage: errorMsg });
        await this.addLog(buildId, 'error', `BUILD FAILED after ${attempt} fix attempt(s)`);
        break;
      }

      // Try to auto-fix
      attempt++;
      const errors = this.parser.parseErrors(result.output);
      if (errors.length === 0) {
        await this.addLog(buildId, 'warn', 'No recognizable errors found - cannot auto-fix');
        await this.updateBuildStatus(buildId, 'FAILED', {
          errorMessage: 'Build failed with unrecognizable errors',
        });
        break;
      }

      await this.addLog(buildId, 'info', `Detected ${errors.length} error(s), running AI autofix...`);
      for (const err of errors) {
        await this.addLog(buildId, 'warn', `  [${err.type}] ${err.message}`);
      }

      const fixResult = await this.fixer.fix(projectPath, errors, attempt);
      await this.recordFix(buildId, attempt, fixResult);

      if (!fixResult.success) {
        await this.addLog(buildId, 'error', 'AI fix could not generate applicable patches');
        await this.updateBuildStatus(buildId, 'FAILED', {
          errorMessage: fixResult.errorSummary || 'AI fix failed',
        });
        break;
      }

      await this.addLog(buildId, 'info', `Fix applied: ${fixResult.description}`);
      for (const f of fixResult.filesModified) {
        await this.addLog(buildId, 'info', `  Modified: ${f}`);
      }
    }
  }

  private runGradle(
    buildId: string,
    projectPath: string,
    gradleCommand: string,
    job: Job,
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const [cmd, ...args] = gradleCommand.split(' ');
      const outputLines: string[] = [];

      // Ensure gradlew is executable
      const gradlewPath = path.join(projectPath, 'gradlew');
      fs.chmod(gradlewPath, 0o755).catch(() => {});

      const proc = spawn(cmd, [...args, '--stacktrace', '--no-daemon'], {
        cwd: projectPath,
        env: {
          ...process.env,
          ANDROID_HOME: process.env.ANDROID_HOME || '/opt/android-sdk',
          JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64',
          GRADLE_OPTS: '-Xmx2048m -Dorg.gradle.daemon=false',
        },
        shell: false,
      });

      const handleData = async (data: Buffer, level: 'info' | 'error') => {
        const text = data.toString();
        outputLines.push(text);

        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const logLevel = this.parser.classifyLogLevel(line);
          await this.addLog(buildId, logLevel, line);

          const progress = this.parser.parseProgress(line);
          if (progress) {
            await job.updateProgress(progress.percent);
          }
        }
      };

      proc.stdout.on('data', (d) => handleData(d, 'info'));
      proc.stderr.on('data', (d) => handleData(d, 'error'));

      proc.on('close', (code) => {
        const fullOutput = outputLines.join('');
        const success = this.parser.isBuildSuccess(fullOutput);
        resolve({ success, output: fullOutput });
      });

      proc.on('error', (err) => {
        this.addLog(buildId, 'error', `Process error: ${err.message}`);
        resolve({ success: false, output: err.message });
      });

      // Timeout: 25 minutes
      setTimeout(() => {
        proc.kill('SIGTERM');
        this.addLog(buildId, 'error', 'Build timed out after 25 minutes');
        resolve({ success: false, output: 'TIMEOUT' });
      }, 25 * 60 * 1000);
    });
  }

  private async findApk(projectPath: string): Promise<string | null> {
    const candidates = [
      'app/build/outputs/apk/debug/app-debug.apk',
      'app/build/outputs/apk/release/app-release.apk',
      'app/build/outputs/apk/release/app-release-unsigned.apk',
      'app/build/outputs/bundle/release/app-release.aab',
    ];

    for (const rel of candidates) {
      const full = path.join(projectPath, rel);
      try {
        await fs.access(full);
        return full;
      } catch {}
    }

    // Glob search
    try {
      const result = await this.findFiles(projectPath, '.apk');
      if (result.length > 0) return result[0];
    } catch {}

    return null;
  }

  private async findFiles(dir: string, ext: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findFiles(full, ext)));
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
    return results;
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await fs.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  private async uploadApk(buildId: string, apkPath: string): Promise<string | null> {
    try {
      const data = await fs.readFile(apkPath);
      const resp = await axios.post(
        `${API_BASE}/api/v1/internal/builds/${buildId}/apk`,
        data,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-worker-secret': WORKER_SECRET,
          },
          timeout: 120000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );
      return resp.data.apkUrl;
    } catch (err) {
      logger.error(`Failed to upload APK: ${err.message}`);
      // Fallback: build direct file URL
      return `${API_BASE}/files/apks/${buildId}.apk`;
    }
  }

  private async updateBuildStatus(
    buildId: string,
    status: string,
    extra: Record<string, any> = {},
  ): Promise<void> {
    try {
      await axios.patch(
        `${API_BASE}/api/v1/internal/builds/${buildId}/status`,
        { status, ...extra },
        { headers: { 'x-worker-secret': WORKER_SECRET }, timeout: 10000 },
      );
    } catch (err) {
      logger.error(`Failed to update build status: ${err.message}`);
    }
  }

  private async addLog(buildId: string, level: string, message: string): Promise<void> {
    logger.debug(`[${buildId}] ${level}: ${message}`);
    try {
      await axios.post(
        `${API_BASE}/api/v1/internal/builds/${buildId}/logs`,
        { level, message },
        { headers: { 'x-worker-secret': WORKER_SECRET }, timeout: 5000 },
      );
    } catch {}
  }

  private async recordFix(
    buildId: string,
    attempt: number,
    fix: { description: string; filesModified: string[]; errorSummary: string; success: boolean },
  ): Promise<void> {
    try {
      await axios.post(
        `${API_BASE}/api/v1/internal/builds/${buildId}/fixes`,
        { attempt, ...fix },
        { headers: { 'x-worker-secret': WORKER_SECRET }, timeout: 10000 },
      );
    } catch (err) {
      logger.error(`Failed to record fix: ${err.message}`);
    }
  }
}
