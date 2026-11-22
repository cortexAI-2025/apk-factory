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
 *   3. On that generated tree only, apply the limits the Expo SDK 51 /
 *      React Native template needed in order to compile: a heap the worker
 *      can actually afford, Jetifier off (JetifyTransform of react-android
 *      exhausts the heap), a single ABI, and the splash color the generated
 *      drawable references when app.json does not define one.
 *   4. cd into the Gradle root, run the resolved Gradle task.
 *
 * `--no-install` is passed because step 1 already installed dependencies —
 * prebuild must not re-run npm/yarn/pnpm itself (keeps one source of truth
 * for the install step, same lockfile-pinned reproducibility as Lot 3).
 */
import { BuildEngine, ComposedCommand, installCommand, resolveGradleTask } from './types';
import { stripTemplateDebugSigningShell } from './template-signing';
import { PipelineContext } from '../pipeline/types';

/**
 * Runs with cwd = project root, after `expo prebuild`, before Gradle.
 * No-op when android/gradle.properties is absent. Never used for a project
 * that already committed android/.
 */
export const EXPO_GENERATED_ANDROID_NORMALIZE_JS = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const root=process.cwd();',
  'const propsPath=path.join(root,"android","gradle.properties");',
  'if(fs.existsSync(propsPath)){',
  'let t=fs.readFileSync(propsPath,"utf8"); const orig=t;',
  'const mb=(n,u)=>String(u).toLowerCase()==="g"?parseInt(n,10)*1024:parseInt(n,10);',
  't=t.replace(/-Xmx(\\d+)([gGmM])/g,(all,n,u)=>mb(n,u)>1280?"-Xmx1280m":all);',
  't=t.replace(/-XX:MaxMetaspaceSize=(\\d+)([gGmM])/g,(all,n,u)=>mb(n,u)>512?"-XX:MaxMetaspaceSize=512m":all);',
  'if(/android\\.enableJetifier\\s*=/.test(t)) t=t.replace(/android\\.enableJetifier\\s*=\\s*true/gi,"android.enableJetifier=false");',
  'else t+=(t.endsWith("\\n")?"":"\\n")+"android.enableJetifier=false\\n";',
  'if(/org\\.gradle\\.daemon\\s*=/.test(t)) t=t.replace(/org\\.gradle\\.daemon\\s*=\\s*true/gi,"org.gradle.daemon=false");',
  'else t+=(t.endsWith("\\n")?"":"\\n")+"org.gradle.daemon=false\\n";',
  'if(!/org\\.gradle\\.workers\\.max\\s*=/.test(t)) t+="org.gradle.workers.max=1\\n";',
  't=t.replace(/^reactNativeArchitectures=.*$/m,(line)=>line.includes(",")?"reactNativeArchitectures=arm64-v8a":line);',
  'if(t!==orig){ fs.writeFileSync(propsPath,t); console.log("[engine:expo] normalized generated Gradle memory, jetifier and ABIs"); }',
  '}',
  'let installed=[];',
  'try{installed=fs.readdirSync("/opt/android-sdk/ndk").filter((n)=>fs.existsSync(path.join("/opt/android-sdk/ndk",n,"source.properties")));}catch(e){}',
  'installed.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));',
  'const ndk=installed[installed.length-1];',
  'if(ndk){',
  'for(const name of ["build.gradle","build.gradle.kts"]){',
  'const f=path.join(root,"android",name); if(!fs.existsSync(f)) continue;',
  'const g=fs.readFileSync(f,"utf8");',
  'const next=g.replace(/ndkVersion\\s*=\\s*["\'][^"\']+["\']/g, "ndkVersion = \\""+ndk+"\\"");',
  'if(next!==g){ fs.writeFileSync(f,next); console.log("[engine:expo] ndkVersion aligned to image NDK "+ndk); }',
  '}',
  '}',
  'function walk(dir,acc){ if(!fs.existsSync(dir)) return; for(const name of fs.readdirSync(dir)){ const full=path.join(dir,name); if(fs.statSync(full).isDirectory()) walk(full,acc); else if(name.endsWith(".xml")) acc.push(full); } }',
  'const res=path.join(root,"android","app","src","main","res");',
  'const xmls=[]; walk(res,xmls);',
  'const needs=xmls.some((f)=>fs.readFileSync(f,"utf8").includes("@color/splashscreen_background"));',
  'if(needs){',
  'const valuesDirs=fs.existsSync(res)?fs.readdirSync(res).filter((n)=>n==="values"||n.startsWith("values-")):[];',
  'if(!valuesDirs.includes("values")) valuesDirs.push("values");',
  'for(const dir of valuesDirs){',
  'const colors=path.join(res,dir,"colors.xml");',
  'const color=dir.includes("night")?"#000000":"#ffffff";',
  'if(!fs.existsSync(colors)){ fs.mkdirSync(path.dirname(colors),{recursive:true}); fs.writeFileSync(colors,"<resources>\\n  <color name=\\"splashscreen_background\\">"+color+"</color>\\n</resources>\\n"); console.log("[engine:expo] added missing splashscreen_background in "+dir); continue; }',
  'const text=fs.readFileSync(colors,"utf8");',
  'if(text.includes("splashscreen_background")) continue;',
  'const item="  <color name=\\"splashscreen_background\\">"+color+"</color>\\n";',
  'let next;',
  'if(/<resources\\s*\\/>/.test(text)) next=text.replace(/<resources\\s*\\/>/,"<resources>\\n"+item+"</resources>");',
  'else if(text.includes("</resources>")) next=text.replace("</resources>",item+"</resources>");',
  'else next=text+"\\n<resources>\\n"+item+"</resources>\\n";',
  'fs.writeFileSync(colors,next); console.log("[engine:expo] added missing splashscreen_background in "+dir);',
  '}',
  '}',
].join('');

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

    const normalizeStep = androidAlreadyGenerated
      ? ''
      : `node -e ${JSON.stringify(EXPO_GENERATED_ANDROID_NORMALIZE_JS)}`;

    const gradleInvocation = [
      'bash', './gradlew', task, '--no-daemon', '--stacktrace', '--console=plain', extraGradleArgs,
    ].filter(Boolean).join(' ');

    const script = [
      'set -euo pipefail',
      `echo "[engine:expo] package manager: ${pm}"`,
      installCommand(pm),
      prebuildStep,
      normalizeStep,
      stripTemplateDebugSigningShell('expo'),
      `cd ${gradleRoot}`,
      'chmod +x ./gradlew 2>/dev/null || true',
      gradleInvocation,
    ].filter((line) => line.length > 0).join('\n');

    return { command: script, shell: true };
  },
};
