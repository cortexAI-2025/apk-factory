/**
 * React Native CLI engine.
 *
 * Preconditions enforced upstream (02-detect.ts / 03-validate.ts):
 *   - android/ already exists and was committed to the repo (this engine
 *     does not run "react-native init" or generate native projects).
 *   - package.json + a matching lockfile are present.
 *
 * Steps (all inside the sandboxed container, shell=true):
 *   1. Install JS dependencies reproducibly (npm ci / yarn --frozen-lockfile
 *      / pnpm --frozen-lockfile) — this also runs autolinking, since RN's
 *      Gradle plugin resolves native modules from node_modules during the
 *      Gradle configure phase, not as a separate CLI step.
 *   2. cd into the Gradle root (ctx.gradleRoot, normally "android").
 *   3. Run the resolved Gradle task.
 */
import { BuildEngine, ComposedCommand, installCommand, resolveGradleTask } from './types';
import { PipelineContext } from '../pipeline/types';

export const reactNativeCliEngine: BuildEngine = {
  id: 'REACT_NATIVE_CLI',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const gradleRoot = ctx.gradleRoot || 'android';
    const task = resolveGradleTask(ctx.buildType);
    const gradleInvocation = [
      './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    const script = [
      'set -euo pipefail',
      `echo "[engine:react-native-cli] package manager: ${pm}"`,
      installCommand(pm),
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew',
      gradleInvocation,
    ].join('\n');

    return { command: script, shell: true };
  },
};
