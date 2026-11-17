/**
 * Expo engine (managed and bare) — no EAS Cloud involved anywhere.
 *
 * Steps (all inside the sandboxed container, shell=true):
 *   1. Install JS dependencies reproducibly.
 *   2. `expo prebuild --platform android --no-install` — but ONLY when
 *      android/ does not already exist (EXPO_BARE / a managed project whose
 *      native project was already generated and committed): re-running
 *      prebuild would overwrite any native customization the user made,
 *      which this engine must never do silently.
 *   3. cd into the Gradle root, run the resolved Gradle task.
 *
 * `--no-install` is passed because step 1 already installed dependencies —
 * prebuild must not re-run npm/yarn/pnpm itself (keeps one source of truth
 * for the install step, same lockfile-pinned reproducibility as Lot 3).
 */
import { BuildEngine, ComposedCommand, installCommand, resolveGradleTask } from './types';
import { PipelineContext } from '../pipeline/types';

export const expoEngine: BuildEngine = {
  id: 'EXPO_MANAGED',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const gradleRoot = ctx.gradleRoot || 'android';
    const task = resolveGradleTask(ctx.buildType);
    const androidAlreadyGenerated = ctx.buildSystemInfo?.androidGenerated === true;

    const prebuildStep = androidAlreadyGenerated
      ? 'echo "[engine:expo] android/ already present — skipping expo prebuild (never overwrite committed native changes)"'
      : 'npx expo prebuild --platform android --no-install';

    const gradleInvocation = [
      './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    const script = [
      'set -euo pipefail',
      `echo "[engine:expo] package manager: ${pm}"`,
      installCommand(pm),
      prebuildStep,
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew',
      gradleInvocation,
    ].join('\n');

    return { command: script, shell: true };
  },
};
