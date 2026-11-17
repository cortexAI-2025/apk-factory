/**
 * Android Native engine — preserves the exact pre-Lot-3 behavior: run the
 * Gradle command resolved by 03-validate.ts directly (shell=false), with
 * the Maven offline-cache init-script flag appended verbatim when present.
 */
import { BuildEngine, ComposedCommand } from './types';
import { PipelineContext } from '../pipeline/types';

export const androidNativeEngine: BuildEngine = {
  id: 'ANDROID_NATIVE',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const command = extraGradleArgs ? `${ctx.gradleCommand} ${extraGradleArgs}` : ctx.gradleCommand;
    return { command, shell: false };
  },
};
