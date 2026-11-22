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

/** The image ships one NDK and the SDK tree is read-only at build time. */
function alignNdk(gradleRoot: string): string {
  return [
    'const fs=require("fs");const path=require("path");',
    `const root=${JSON.stringify(gradleRoot)};`,
    'let installed=[];',
    'try{installed=fs.readdirSync("/opt/android-sdk/ndk").filter((n)=>fs.existsSync(path.join("/opt/android-sdk/ndk",n,"source.properties")));}catch(e){}',
    'installed.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));',
    'const ndk=installed[installed.length-1];',
    'if(ndk){for(const name of ["build.gradle","build.gradle.kts"]){const f=path.join(root,name);if(!fs.existsSync(f))continue;const g=fs.readFileSync(f,"utf8");const next=g.replace(/ndkVersion\\s*=\\s*["\'][^"\']+["\']/g,"ndkVersion = \\""+ndk+"\\"");if(next!==g){fs.writeFileSync(f,next);console.log("[engine] ndkVersion aligned to image NDK "+ndk+" in "+f);}}}',
  ].join('');
}

export const capacitorEngine: BuildEngine = {
  id: 'CAPACITOR',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const gradleRoot = ctx.gradleRoot || 'android';
    const task = resolveGradleTask(ctx.buildType);
    const gradleInvocation = [
      'bash', './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    const script = [
      'set -euo pipefail',
      `echo "[engine:capacitor] package manager: ${pm}"`,
      installCommand(pm),
      'if [ ! -f android/gradlew ]; then',
      '  echo "[engine:capacitor] android/ missing — npx cap add android"',
      '  npx cap add android',
      'fi',
      'npx cap sync android',
      `node -e ${JSON.stringify(alignNdk(gradleRoot))}`,
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew 2>/dev/null || true',
      gradleInvocation,
    ].join('\n');

    return { command: script, shell: true };
  },
};
