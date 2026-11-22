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
import { stripTemplateDebugSigningShell } from './template-signing';
import { PipelineContext } from '../pipeline/types';

export const reactNativeCliEngine: BuildEngine = {
  id: 'REACT_NATIVE_CLI',

  composeCommand(ctx: PipelineContext, extraGradleArgs?: string): ComposedCommand {
    const pm = ctx.packageManager || 'npm';
    const gradleRoot = ctx.gradleRoot || 'android';
    const task = resolveGradleTask(ctx.buildType);
    const gradleInvocation = [
      'bash', './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    // The RN template enables Jetifier and a 2G heap. On a 4 GB build
    // container that combination is OOM-killed inside JetifyTransform
    // (observed on the 0.73 template). Rewrite only the workspace copy.
    const normalize = [
      'const fs=require("fs");',
      'const p="android/gradle.properties";',
      'if(!fs.existsSync(p)) process.exit(0);',
      'let t=fs.readFileSync(p,"utf8"); const orig=t;',
      'const mb=(n,u)=>String(u).toLowerCase()==="g"?parseInt(n,10)*1024:parseInt(n,10);',
      't=t.replace(/-Xmx(\\d+)([gGmM])/g,(all,n,u)=>mb(n,u)>1280?"-Xmx1280m":all);',
      'if(/android\\.enableJetifier\\s*=/.test(t)) t=t.replace(/android\\.enableJetifier\\s*=\\s*true/gi,"android.enableJetifier=false");',
      'if(/org\\.gradle\\.daemon\\s*=/.test(t)) t=t.replace(/org\\.gradle\\.daemon\\s*=\\s*true/gi,"org.gradle.daemon=false");',
      'else t+=(t.endsWith("\\n")?"":"\\n")+"org.gradle.daemon=false\\n";',
      'if(!/org\\.gradle\\.workers\\.max\\s*=/.test(t)) t+="org.gradle.workers.max=1\\n";',
      't=t.replace(/^reactNativeArchitectures=.*$/m,(line)=>line.includes(",")?"reactNativeArchitectures=arm64-v8a":line);',
      'let installed=[];',
      'try{installed=require("fs").readdirSync("/opt/android-sdk/ndk").filter((n)=>require("fs").existsSync("/opt/android-sdk/ndk/"+n+"/source.properties"));}catch(e){}',
      'installed.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));',
      'const ndk=installed[installed.length-1];',
      'if(ndk){ for(const name of ["build.gradle","build.gradle.kts"]){ const f="android/"+name; if(!fs.existsSync(f)) continue; const g=fs.readFileSync(f,"utf8"); const next=g.replace(/ndkVersion\\s*=\\s*["\'][^"\']+["\']/g, "ndkVersion = \\""+ndk+"\\""); if(next!==g){ fs.writeFileSync(f,next); console.log("[engine:react-native-cli] ndkVersion aligned to image NDK "+ndk); } } }',
      'if(t!==orig){ fs.writeFileSync(p,t); console.log("[engine:react-native-cli] normalized Gradle memory and jetifier"); }',
    ].join('');
    const script = [
      'set -euo pipefail',
      `echo "[engine:react-native-cli] package manager: ${pm}"`,
      installCommand(pm),
      `node -e ${JSON.stringify(normalize)}`,
      stripTemplateDebugSigningShell('react-native-cli'),
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew 2>/dev/null || true',
      gradleInvocation,
    ].join('\n');

    return { command: script, shell: true };
  },
};
