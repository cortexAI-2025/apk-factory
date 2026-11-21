/**
 * Flutter engine.
 *
 * `flutter build apk` / `flutter build appbundle` drive the Android embedding.
 * A missing android/ directory is created with `flutter create` (does not
 * overwrite lib/ or pubspec.yaml).
 *
 * One fat APK/AAB is produced for arm, arm64 and x64 (no per-ABI split), so
 * artifact selection stays unambiguous. The factory upload key is applied
 * after this script exits; it is not passed to Flutter or Gradle.
 */
import { BuildEngine, ComposedCommand } from './types';
import { PipelineContext } from '../pipeline/types';

const ABIS = 'android-arm,android-arm64,android-x64';

function flutterInvocation(ctx: PipelineContext, extraGradleArgs?: string): string {
  const tail = extraGradleArgs ? ` -- ${extraGradleArgs}` : '';
  if (ctx.buildType === 'AAB') return `flutter build appbundle --release --target-platform ${ABIS}${tail}`;
  if (ctx.buildType === 'RELEASE') return `flutter build apk --release --target-platform ${ABIS}${tail}`;
  return `flutter build apk --debug --target-platform ${ABIS}${tail}`;
}

export const flutterEngine: BuildEngine = {
  id: 'FLUTTER',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const script = [
      'set -euo pipefail',
      'command -v flutter >/dev/null 2>&1 || { echo "[engine:flutter] flutter is not installed in this build image"; exit 127; }',
      'flutter --version',
      'if [ ! -d android ]; then',
      '  echo "[engine:flutter] android/ missing — adding the Android embedding"',
      '  flutter create --platforms=android .',
      'fi',
      'flutter pub get',
      flutterInvocation(ctx, extraGradleArgs),
    ].join('\n');
    return { command: script, shell: true };
  },
};
