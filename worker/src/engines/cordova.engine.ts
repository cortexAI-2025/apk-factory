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

function alignNdk(gradleRoot: string): string {
  return [
    'const fs=require("fs");const path=require("path");',
    `const root=${JSON.stringify(gradleRoot)};`,
    'let installed=[];',
    'try{installed=fs.readdirSync("/opt/android-sdk/ndk").filter((n)=>fs.existsSync(path.join("/opt/android-sdk/ndk",n,"source.properties")));}catch(e){}',
    'installed.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));',
    'const ndk=installed[installed.length-1];',
    'if(ndk){for(const name of ["build.gradle","build.gradle.kts"]){const f=path.join(root,name);if(!fs.existsSync(f))continue;const g=fs.readFileSync(f,"utf8");const next=g.replace(/ndkVersion\\s*=\\s*["\'][^"\']+["\']/g,"ndkVersion = \\""+ndk+"\\"");if(next!==g){fs.writeFileSync(f,next);console.log("[engine:cordova] ndkVersion aligned to image NDK "+ndk);}}}',
  ].join('');
}

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
      `node -e ${JSON.stringify(alignNdk('platforms/android'))}`,
      `npx cordova build android ${mode}${gradleTail}`,
    ].join('\n');
    return { command: script, shell: true };
  },
};
