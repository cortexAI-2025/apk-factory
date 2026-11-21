import { Framework, PackageManager } from '../detection/types';
import { PipelineContext } from '../pipeline/types';

export interface ComposedCommand {
  /**
   * Android Native (shell=false): a bare Gradle invocation.
   * Multi-step engines (shell=true): a full bash script.
   */
  command: string;
  shell: boolean;
}

export interface BuildEngine {
  readonly id: Framework;
  /**
   * @param extraGradleArgs  e.g. "--init-script /workspace/.gradle/init.d/apk-factory-offline.gradle"
   *                         (appended to the final gradlew invocation when the Maven offline cache is available).
   */
  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand;
}

export function resolveGradleTask(buildType: PipelineContext['buildType']): string {
  switch (buildType) {
    case 'RELEASE': return 'assembleRelease';
    case 'AAB':     return 'bundleRelease';
    default:        return 'assembleDebug';
  }
}

export function installCommand(pm: PackageManager): string {
  // Prefer the lockfile. If it is missing or out of date, fall back to a
  // resolving install so a GitHub import can still compile.
  switch (pm) {
    case 'pnpm': return 'pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile';
    case 'yarn': return 'yarn install --frozen-lockfile || yarn install';
    default:     return 'if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; else npm install --no-audit --no-fund; fi';
  }
}

