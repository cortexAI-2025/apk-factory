/**
 * Apache Cordova engine (Ionic-Cordova and PhoneGap-style projects).
 *
 * Adds the Android platform when platforms/android is missing, then
 * `cordova build`. Gradle extra args (offline Maven init-script,
 * packageType=bundle) are passed after `--`. Signing happens after the
 * sandbox exits and never receives the factory key.
 */
import { BuildEngine, ComposedCommand, installCommand } from './types';
import { PipelineContext } from '../pipeline/types';

export const cordovaEngine: BuildEngine = {
  id: 'CORDOVA',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const extra = [
      ctx.buildType === 'AAB' ? '--packageType=bundle' : '',
      extraGradleArgs || '',
    ].filter(Boolean).join(' ');
    const mode = ctx.buildType === 'DEBUG' ? '--debug' : '--release';
    const gradleTail = extra ? ` -- ${extra}` : '';
    const script = [
      'set -euo pipefail',
      `echo "[engine:cordova] package manager: ${pm}"`,
      installCommand(pm),
      'if [ ! -x platforms/android/gradlew ]; then',
      '  echo "[engine:cordova] platforms/android missing — cordova platform add android"',
      '  npx cordova platform add android',
      'fi',
      `npx cordova build android ${mode}${gradleTail}`,
    ].join('\n');
    return { command: script, shell: true };
  },
};
