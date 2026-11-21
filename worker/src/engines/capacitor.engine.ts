/**
 * Capacitor engine (Ionic projects that ship a Capacitor config use this too).
 *
 * 1. Install JS dependencies (lockfile first, then a resolving install).
 * 2. `npx cap add android` only when android/gradlew is absent.
 * 3. `npx cap sync android` so the web assets and plugins match the native project.
 * 4. Gradle task from android/ (debug APK, release APK or AAB).
 */
import { BuildEngine, ComposedCommand, installCommand, resolveGradleTask } from './types';
import { PipelineContext } from '../pipeline/types';

export const capacitorEngine: BuildEngine = {
  id: 'CAPACITOR',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const gradleRoot = ctx.gradleRoot || 'android';
    const task = resolveGradleTask(ctx.buildType);
    const gradleInvocation = [
      './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    const script = [
      'set -euo pipefail',
      `echo "[engine:capacitor] package manager: ${pm}"`,
      installCommand(pm),
      'if [ ! -x android/gradlew ]; then',
      '  echo "[engine:capacitor] android/ missing — npx cap add android"',
      '  npx cap add android',
      'fi',
      'npx cap sync android',
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew',
      gradleInvocation,
    ].join('\n');

    return { command: script, shell: true };
  },
};
